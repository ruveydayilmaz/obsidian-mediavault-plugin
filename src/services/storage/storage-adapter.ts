import type { Plugin } from "obsidian";
import {
  VaultData,
  createEmptyVaultData,
  CURRENT_SCHEMA_VERSION,
} from "./schema";
import { runMigrations } from "./migrations";
import { journalEvent } from "../operation-log";
import { utf8Length } from "../../utils/utf8";
import { digestString } from "../../utils/hash53";
import { yieldToEventLoop } from "../importer/yield";

const SAVE_DEBOUNCE_MS = 400;

type StorageGroup =
  | "media"
  | "settings"
  | "watchHistory"
  | "episodes"
  | "movieProgress"
  | "lists"
  | "comfort"
  | "notifications";

const GROUP_KEYS: Record<StorageGroup, (keyof VaultData)[]> = {
  media: ["media"],
  settings: ["settings"],
  watchHistory: ["watchSessions"],
  episodes: ["episodes", "episodeProgress", "episodeWatches"],
  movieProgress: ["movieProgress"],
  lists: ["customLists"],
  comfort: ["comfortProfiles", "comfortPresets"],
  notifications: ["notifications"],
};

const ALL_GROUPS = Object.keys(GROUP_KEYS) as StorageGroup[];

function fileNameForGroup(group: StorageGroup): string {
  return group.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`) + ".json";
}

export class StorageAdapter {
  private plugin: Plugin;
  private data: VaultData = createEmptyVaultData();
  private saveTimeout: number | null = null;
  private savePromise: Promise<void> | null = null;
  private resolveSavePromise: (() => void) | null = null;

  private lastWrittenDigest = new Map<StorageGroup, string>();
  private flushChain: Promise<void> = Promise.resolve();
  readonly loadWarnings: string[] = [];

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  private get storageDir(): string {
    return `${this.plugin.manifest.dir ?? `.obsidian/plugins/${this.plugin.manifest.id}`}/storage`;
  }

  private groupPath(group: StorageGroup): string {
    return `${this.storageDir}/${fileNameForGroup(group)}`;
  }

  private get metaPath(): string {
    return `${this.storageDir}/meta.json`;
  }

  private get adapter() {
    return this.plugin.app.vault.adapter;
  }

  async initialize(): Promise<void> {
    const meta = await this.readJson<{ migrated?: boolean; version?: number }>(
      this.metaPath,
    );

    if (meta?.migrated) {
      await this.loadFromSplitFiles(meta.version ?? 0);
      return;
    }

    const legacy: unknown = await this.plugin.loadData();
    if (!legacy) {
      this.data = createEmptyVaultData();
      await this.writeAllGroups();
      await this.writeMeta({ migrated: true, version: this.data.version });
      return;
    }

    const migratedData = runMigrations(legacy as Record<string, unknown>);
    this.data = migratedData;

    try {
      await this.writeAllGroups();
      await this.writeMeta({ migrated: true, version: this.data.version });
    } catch (err) {
      console.error(
        "MediaVault: storage split migration failed, will retry next launch.",
        err,
      );
    }
  }

  private async loadFromSplitFiles(storedVersion: number): Promise<void> {
    const empty = createEmptyVaultData();
    const results = await Promise.all(
      ALL_GROUPS.map(async (group) => {
        const partial = await this.readGroupFile(group);
        return { group, partial };
      }),
    );

    const merged: VaultData = { ...empty };
    for (const { group, partial } of results) {
      if (!partial) continue;
      for (const key of GROUP_KEYS[group]) {
        if (partial[key] !== undefined) {
          (merged as unknown as Record<string, unknown>)[key] = (
            partial as Record<string, unknown>
          )[key];
        }
      }
    }
    merged.version = storedVersion;

    const needsMigration = storedVersion < CURRENT_SCHEMA_VERSION;
    this.data = needsMigration
      ? runMigrations(merged as unknown as Record<string, unknown>)
      : merged;

    for (const group of ALL_GROUPS) {
      this.lastWrittenDigest.set(
        group,
        digestString(JSON.stringify(this.dataForGroup(group))),
      );
    }

    if (needsMigration) {
      await this.writeAllGroups();
      await this.writeMeta({ migrated: true, version: this.data.version });
    }
  }

  private dataForGroup(group: StorageGroup): Partial<VaultData> {
    const out: Partial<VaultData> = {};
    for (const key of GROUP_KEYS[group]) {
      (out as Record<string, unknown>)[key] = (
        this.data as unknown as Record<string, unknown>
      )[key];
    }
    return out;
  }

  private async readJson<T>(path: string): Promise<T | null> {
    try {
      if (!(await this.adapter.exists(path))) return null;
      const raw = await this.adapter.read(path);
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private async tryParse(path: string): Promise<Partial<VaultData> | null> {
    try {
      if (!(await this.adapter.exists(path))) return null;
      const parsed = JSON.parse(
        await this.adapter.read(path),
      ) as Partial<VaultData> | null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async readGroupFile(
    group: StorageGroup,
  ): Promise<Partial<VaultData> | null> {
    const path = this.groupPath(group);
    const tmpPath = `${path}.tmp`;
    const mainExists = await this.adapter.exists(path).catch(() => false);
    const main = await this.tryParse(path);
    if (main) return main;

    const recovered = await this.tryParse(tmpPath);
    if (recovered) {
      console.warn(
        `MediaVault: recovered "${fileNameForGroup(group)}" from an interrupted write`,
      );
      return recovered;
    }

    if (mainExists) {
      const aside = `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      try {
        await this.adapter.rename(path, aside);
        this.loadWarnings.push(fileNameForGroup(group));
        console.error(
          `MediaVault: "${fileNameForGroup(group)}" could not be parsed; kept as "${aside}"`,
        );
      } catch (err) {
        console.error(
          `MediaVault: "${fileNameForGroup(group)}" is unreadable and could not be set aside`,
          err instanceof Error ? err.message : "unknown error",
        );
        throw new Error(
          `MediaVault data file "${fileNameForGroup(group)}" is damaged and could not be preserved`,
        );
      }
    }
    return null;
  }

  private async writeAtomic(path: string, json: string): Promise<void> {
    const tmpPath = `${path}.tmp`;
    await this.adapter.write(tmpPath, json);
    const stat = await this.adapter.stat(tmpPath);
    const expected = utf8Length(json);
    if (!stat || stat.size !== expected) {
      throw new Error(
        `incomplete write to "${tmpPath}" (${stat?.size ?? 0} of ${expected} bytes)`,
      );
    }
    if (await this.adapter.exists(path)) await this.adapter.remove(path);
    await this.adapter.rename(tmpPath, path);
  }

  private async ensureDir(): Promise<void> {
    if (!(await this.adapter.exists(this.storageDir))) {
      await this.adapter.mkdir(this.storageDir);
    }
  }

  private async writeGroup(group: StorageGroup): Promise<void> {
    await this.ensureDir();
    const json = JSON.stringify(this.dataForGroup(group));
    await this.writeAtomic(this.groupPath(group), json);
    this.lastWrittenDigest.set(group, digestString(json));
  }

  private async writeAllGroups(): Promise<void> {
    await this.ensureDir();
    await Promise.all(ALL_GROUPS.map((g) => this.writeGroup(g)));
  }

  private async writeMeta(meta: {
    migrated: boolean;
    version: number;
  }): Promise<void> {
    await this.ensureDir();
    await this.adapter.write(this.metaPath, JSON.stringify(meta));
  }

  getData(): VaultData {
    return this.data;
  }

  async factoryReset(): Promise<void> {
    if (this.saveTimeout) {
      window.clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    const pending = this.resolveSavePromise;
    this.savePromise = null;
    this.resolveSavePromise = null;
    pending?.();
    this.lastWrittenDigest.clear();

    await this.flushChain;
    await this.removePathIfExists(this.storageDir);
    await this.removePathIfExists(this.legacyDataPath);

    this.data = createEmptyVaultData();
    await this.writeAllGroups();
    await this.writeMeta({ migrated: true, version: this.data.version });
  }

  private get legacyDataPath(): string {
    return `${this.plugin.manifest.dir ?? `.obsidian/plugins/${this.plugin.manifest.id}`}/data.json`;
  }

  private async removePathIfExists(path: string): Promise<void> {
    try {
      if (!(await this.adapter.exists(path))) return;
      const stat = await this.adapter.stat(path);
      if (stat?.type === "folder") {
        await this.adapter.rmdir(path, true);
      } else {
        await this.adapter.remove(path);
      }
    } catch (err) {
      console.error(
        `MediaVault: failed to remove "${path}" during factory reset.`,
        err,
      );
    }
  }

  requestSave(): Promise<void> {
    if (this.saveTimeout) {
      window.clearTimeout(this.saveTimeout);
    }

    if (!this.savePromise) {
      this.savePromise = new Promise((resolve) => {
        this.resolveSavePromise = resolve;
      });
    }
    const promise = this.savePromise;

    this.saveTimeout = window.setTimeout(() => {
      this.saveTimeout = null;
      this.flush().catch((err) => {
        console.error(
          "MediaVault: could not save data",
          err instanceof Error ? err.message : "unknown error",
        );
      });
    }, SAVE_DEBOUNCE_MS);

    return promise;
  }

  dispose(): void {
    if (this.saveTimeout) {
      window.clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
  }

  flush(): Promise<void> {
    if (this.saveTimeout) {
      window.clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    const pending = this.resolveSavePromise;
    this.savePromise = null;
    this.resolveSavePromise = null;

    const run = this.flushChain.then(() => this.writeDirtyGroups());
    this.flushChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run.finally(() => pending?.());
  }

  private async writeDirtyGroups(): Promise<void> {
    this.data.version = CURRENT_SCHEMA_VERSION;

    let firstError: Error | null = null;
    let ensured = false;
    for (const group of ALL_GROUPS) {
      const startedAt = Date.now();
      let json: string | null = JSON.stringify(this.dataForGroup(group));
      const digest = digestString(json);
      if (digest === this.lastWrittenDigest.get(group)) {
        json = null;
        continue;
      }
      journalEvent("cache-write", {
        group,
        chars: json.length,
        serializeMs: Date.now() - startedAt,
      });
      try {
        if (!ensured) {
          await this.ensureDir();
          ensured = true;
        }
        await this.writeAtomic(this.groupPath(group), json);
        this.lastWrittenDigest.set(group, digest);
      } catch (err) {
        firstError ??= err instanceof Error ? err : new Error(String(err));
      }
      json = null;
      await yieldToEventLoop();
    }
    if (firstError) throw firstError;
  }
}
