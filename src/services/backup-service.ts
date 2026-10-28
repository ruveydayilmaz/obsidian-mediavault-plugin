import { isSafeNotePath } from "../utils/vault-path";
import { App, DataAdapter, TFile } from "obsidian";
import type { StorageService } from "./storage";
import type { VaultData } from "./storage/schema";
import { CURRENT_SCHEMA_VERSION } from "./storage/schema";
import { yieldToEventLoop } from "./importer/yield";
import { trackOperation, journalEvent } from "./operation-log";
import { syncStatus } from "./sync-status";
import { utf8Length } from "../utils/utf8";

export type BackupReason =
  | "manual"
  | "startup"
  | "watcher"
  | "note-sync"
  | "pre-restore";

export interface BackupMeta {
  format: 1;
  id: string;
  createdAt: string;
  reason: BackupReason;
  pluginVersion: string;
  schemaVersion: number;
  fingerprint: string;
  counts: Record<string, number>;
}

interface BackupFile {
  meta: BackupMeta;
  data: Omit<VaultData, "settings">;
  notes: { path: string; content: string }[];
}

const COLLECTIONS = [
  "media",
  "watchSessions",
  "episodes",
  "episodeProgress",
  "episodeWatches",
  "movieProgress",
  "comfortProfiles",
  "comfortPresets",
  "customLists",
  "notifications",
] as const;

export const DEFAULT_BACKUPS_TO_KEEP = 30;

const HASH_SLICE = 262144;
const BACKUP_TIMEOUT_MS = 180000;
const NOTE_BATCH = 8;
const WRITE_CHUNK_CHARS = 1048576;

class ChunkedFileWriter {
  private buffer = "";
  private started = false;
  bytes = 0;

  constructor(
    private adapter: DataAdapter,
    private path: string,
  ) {}

  async push(text: string): Promise<void> {
    this.buffer += text;
    if (this.buffer.length >= WRITE_CHUNK_CHARS) await this.drain();
  }

  async pushLarge(text: string): Promise<void> {
    for (let i = 0; i < text.length; i += WRITE_CHUNK_CHARS) {
      await this.push(text.slice(i, i + WRITE_CHUNK_CHARS));
    }
  }

  async finish(): Promise<void> {
    await this.drain();
  }

  private async drain(): Promise<void> {
    if (this.buffer.length === 0 && this.started) return;
    const chunk = this.buffer;
    this.buffer = "";
    this.bytes += utf8Length(chunk);
    if (!this.started) {
      this.started = true;
      await this.adapter.write(this.path, chunk);
    } else {
      await this.adapter.append(this.path, chunk);
    }
  }
}

class StreamHash53 {
  private h1 = 0xdeadbeef;
  private h2 = 0x41c6ce57;

  update(str: string): void {
    let h1 = this.h1;
    let h2 = this.h2;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    this.h1 = h1;
    this.h2 = h2;
  }

  async updateYielding(str: string): Promise<void> {
    for (let i = 0; i < str.length; i += HASH_SLICE) {
      this.update(str.slice(i, i + HASH_SLICE));
      if (str.length > HASH_SLICE) await yieldToEventLoop();
    }
  }

  digest(): string {
    let h1 = this.h1;
    let h2 = this.h2;
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }
}

const BACKUP_NAME = /^backup-(.+)-(manual|startup|watcher|note-sync|pre-restore)-fp([0-9a-f]+)-([0-9a-z]+)\.json$/;

export class BackupService {
  private chain: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(
    private app: App,
    private storage: StorageService,
    private pluginDir: string,
    private pluginVersion: string,
  ) {}

  get dir(): string {
    return `${this.pluginDir}/backups`;
  }

  private get adapter() {
    return this.app.vault.adapter;
  }

  private baseFolder(): string {
    return (this.storage.settings.get().mediaFolderPath || "MediaVault").replace(
      /\/+$/,
      "",
    );
  }

  private noteFiles(): TFile[] {
    const prefix = `${this.baseFolder()}/`;
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(prefix));
  }

  dispose(): void {
    this.disposed = true;
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("backup service was unloaded");
  }

  ensure(
    reason: BackupReason,
    opts: { minIntervalMs?: number } = {},
  ): Promise<BackupMeta | null> {
    const run = this.chain.then(async () => {
      const outcome = await trackOperation(`backup:${reason}`, () =>
        this.doEnsure(reason, opts),
      );
      return outcome.ran ? outcome.value : null;
    });
    this.chain = run.catch(() => undefined);
    return new Promise<BackupMeta | null>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("backup timed out")),
        BACKUP_TIMEOUT_MS,
      );
      run.then(
        (value) => {
          window.clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          window.clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
  }

  private async doEnsure(
    reason: BackupReason,
    opts: { minIntervalMs?: number },
  ): Promise<BackupMeta | null> {
    this.assertActive();
    await this.storage.flushTouches();

    const existing = await this.listNames();
    if (opts.minIntervalMs && existing.length > 0) {
      const latest = await this.readMeta(existing[existing.length - 1]);
      if (
        latest &&
        Date.now() - new Date(latest.createdAt).getTime() < opts.minIntervalMs
      ) {
        return null;
      }
    }

    const { settings: _settings, ...data } = this.storage.adapter.getData();
    void _settings;
    const files = [...this.noteFiles()].sort((x, y) =>
      x.path < y.path ? -1 : x.path > y.path ? 1 : 0,
    );
    const manifest = files
      .map((f) => `${f.path}|${f.stat.size}|${f.stat.mtime}`)
      .sort()
      .join("\n");

    const keys = Object.keys(data) as (keyof typeof data)[];
    const hash = new StreamHash53();
    hash.update("{");
    let first = true;
    for (const key of keys) {
      this.assertActive();
      const piece = JSON.stringify(data[key]);
      if (piece === undefined) continue;
      const head = `${first ? "" : ","}${JSON.stringify(key)}:`;
      first = false;
      hash.update(head);
      await hash.updateYielding(piece);
      await yieldToEventLoop();
    }
    hash.update("}");
    hash.update("\u0000");
    hash.update(manifest);
    const fingerprint = hash.digest();

    if (existing.some((n) => BACKUP_NAME.exec(n)?.[3] === fingerprint)) {
      return null;
    }

    const createdAt = new Date().toISOString();
    const rand = Math.random().toString(36).slice(2, 8);
    const stamp = createdAt.replace(/[:.]/g, "-");
    const id = `backup-${stamp}-${reason}-fp${fingerprint}-${rand}`;
    const counts: Record<string, number> = { notes: files.length };
    for (const key of COLLECTIONS) {
      counts[key] = (data[key] as unknown[]).length;
    }
    const meta: BackupMeta = {
      format: 1,
      id,
      createdAt,
      reason,
      pluginVersion: this.pluginVersion,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      fingerprint,
      counts,
    };

    this.assertActive();
    await this.ensureDir();
    await this.removeStaleTemps();
    const finalPath = `${this.dir}/${id}.json`;
    const tmpPath = `${finalPath}.tmp`;
    const sink = new ChunkedFileWriter(this.adapter, tmpPath);
    const startedAt = Date.now();
    journalEvent("backup-writing", { notes: files.length });
    try {
      if (await this.adapter.exists(finalPath)) {
        throw new Error("backup name collision");
      }
      await sink.push(`{"meta":${JSON.stringify(meta)},"data":{`);
      first = true;
      for (const key of keys) {
        this.assertActive();
        const piece = JSON.stringify(data[key]);
        if (piece === undefined) continue;
        await sink.push(`${first ? "" : ","}${JSON.stringify(key)}:`);
        first = false;
        await sink.pushLarge(piece);
        await yieldToEventLoop();
      }
      await sink.push('},"notes":[');

      for (let i = 0; i < files.length; i += NOTE_BATCH) {
        this.assertActive();
        const batch = files.slice(i, i + NOTE_BATCH);
        const contents = await Promise.all(
          batch.map((f) => this.adapter.read(f.path)),
        );
        for (let j = 0; j < batch.length; j++) {
          await sink.push(
            `${i + j > 0 ? "," : ""}${JSON.stringify({ path: batch[j].path, content: contents[j] })}`,
          );
        }
        syncStatus.progress(Math.min(files.length, i + batch.length), files.length);
        await yieldToEventLoop();
      }
      await sink.push("]}");
      await sink.finish();

      const stat = await this.adapter.stat(tmpPath);
      if (!stat || stat.size !== sink.bytes) {
        throw new Error(
          `incomplete write (${stat?.size ?? 0} of ${sink.bytes} bytes)`,
        );
      }
      journalEvent("backup-written", {
        bytes: stat.size,
        notes: files.length,
        ms: Date.now() - startedAt,
      });
      await this.adapter.rename(tmpPath, finalPath);
      await this.adapter.write(
        `${this.dir}/${id}.meta.json`,
        JSON.stringify(meta),
      );
    } catch (err) {
      if (await this.adapter.exists(tmpPath).catch(() => false)) {
        await this.adapter.remove(tmpPath).catch(() => undefined);
      }
      throw err;
    }

    await this.prune();
    return meta;
  }

  private async removeStaleTemps(): Promise<void> {
    try {
      const listing = await this.adapter.list(this.dir);
      for (const path of listing.files) {
        if (!path.endsWith(".json.tmp")) continue;
        try {
          await this.adapter.remove(path);
        } catch (err) {
          console.warn(
            "MediaVault: could not remove an incomplete backup file",
            err instanceof Error ? err.message : "unknown error",
          );
        }
      }
    } catch {
      return;
    }
  }

  private async ensureDir(): Promise<void> {
    if (!(await this.adapter.exists(this.dir))) {
      await this.adapter.mkdir(this.dir);
    }
  }

  private async listNames(): Promise<string[]> {
    try {
      if (!(await this.adapter.exists(this.dir))) return [];
      const listing = await this.adapter.list(this.dir);
      return listing.files
        .map((p) => p.slice(p.lastIndexOf("/") + 1))
        .filter((n) => BACKUP_NAME.test(n))
        .sort();
    } catch {
      return [];
    }
  }

  private async readMeta(name: string): Promise<BackupMeta | null> {
    const base = name.replace(/\.json$/, "");
    try {
      const sidecar = `${this.dir}/${base}.meta.json`;
      if (await this.adapter.exists(sidecar)) {
        return JSON.parse(await this.adapter.read(sidecar)) as BackupMeta;
      }
      const full = JSON.parse(
        await this.adapter.read(`${this.dir}/${name}`),
      ) as BackupFile;
      return full.meta;
    } catch {
      return null;
    }
  }

  async list(): Promise<BackupMeta[]> {
    const names = await this.listNames();
    const metas: BackupMeta[] = [];
    for (const name of names.reverse()) {
      const meta = await this.readMeta(name);
      if (meta) metas.push(meta);
    }
    return metas;
  }

  private async prune(): Promise<void> {
    const raw = this.storage.settings.get().backupKeepCount;
    const keep = Math.max(
      5,
      Math.min(500, Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_BACKUPS_TO_KEEP),
    );
    const names = (await this.listNames()).reverse();
    for (const name of names.slice(keep)) {
      try {
        await this.adapter.remove(`${this.dir}/${name}`);
        const sidecar = `${this.dir}/${name.replace(/\.json$/, "")}.meta.json`;
        if (await this.adapter.exists(sidecar)) await this.adapter.remove(sidecar);
      } catch (err) {
        console.warn(`MediaVault: could not prune backup "${name}"`, err);
      }
    }
  }

  async restore(id: string): Promise<{ notes: number; records: number }> {
    const name = `${id}.json`;
    if (!BACKUP_NAME.test(name)) throw new Error("invalid backup id");
    const file = JSON.parse(
      await this.adapter.read(`${this.dir}/${name}`),
    ) as BackupFile;
    if (
      !file?.meta ||
      file.meta.format !== 1 ||
      !file.data ||
      !Array.isArray(file.notes)
    ) {
      throw new Error("backup file is damaged");
    }
    if (file.meta.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      throw new Error("backup was created by an incompatible data version");
    }
    for (const key of COLLECTIONS) {
      if (!Array.isArray(file.data[key])) {
        throw new Error(`backup is missing "${key}"`);
      }
    }

    for (const note of file.notes) {
      if (
        !note ||
        typeof note.path !== "string" ||
        typeof note.content !== "string" ||
        !isSafeNotePath(note.path)
      ) {
        throw new Error("backup contains an unsafe note path");
      }
    }

    await this.ensure("pre-restore");

    const current = this.storage.adapter.getData();
    let records = 0;
    for (const key of COLLECTIONS) {
      (current[key] as unknown[]) = file.data[key];
      records += (file.data[key] as unknown[]).length;
    }
    this.storage.invalidateAll();
    await this.storage.adapter.flush();

    for (const note of file.notes) {
      await this.ensureFolderFor(note.path);
      const existing = this.app.vault.getAbstractFileByPath(note.path);
      if (existing instanceof TFile) {
        if ((await this.app.vault.read(existing)) !== note.content) {
          await this.app.vault.modify(existing, note.content);
        }
      } else {
        await this.app.vault.create(note.path, note.content);
      }
    }
    return { notes: file.notes.length, records };
  }

  private async ensureFolderFor(path: string): Promise<void> {
    const parts = path.split("/").slice(0, -1);
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        await this.app.vault.createFolder(cur).catch(() => undefined);
      }
    }
  }
}
