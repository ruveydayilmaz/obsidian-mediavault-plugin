import type { Plugin } from "obsidian";
import {
  VaultData,
  createEmptyVaultData,
  CURRENT_SCHEMA_VERSION,
} from "./schema";
import { runMigrations } from "./migrations";

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

  private lastWrittenJson = new Map<StorageGroup, string>();

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
        const partial = await this.readJson<Partial<VaultData>>(
          this.groupPath(group),
        );
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
      this.lastWrittenJson.set(group, JSON.stringify(this.dataForGroup(group)));
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

  private async ensureDir(): Promise<void> {
    if (!(await this.adapter.exists(this.storageDir))) {
      await this.adapter.mkdir(this.storageDir);
    }
  }

  private async writeGroup(group: StorageGroup): Promise<void> {
    await this.ensureDir();
    const json = JSON.stringify(this.dataForGroup(group));
    await this.adapter.write(this.groupPath(group), json);
    this.lastWrittenJson.set(group, json);
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
    this.savePromise = null;
    this.resolveSavePromise = null;
    this.lastWrittenJson.clear();

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

    this.saveTimeout = window.setTimeout(() => {
      void this.flush().then(() => {
        this.resolveSavePromise?.();
        this.savePromise = null;
        this.resolveSavePromise = null;
      });
    }, SAVE_DEBOUNCE_MS);

    return this.savePromise;
  }

  async flush(): Promise<void> {
    if (this.saveTimeout) {
      window.clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.data.version = CURRENT_SCHEMA_VERSION;

    const candidates = ALL_GROUPS.map((group) => ({
      group,
      json: JSON.stringify(this.dataForGroup(group)),
    }));
    const dirty = candidates.filter(
      ({ group, json }) => json !== this.lastWrittenJson.get(group),
    );

    if (dirty.length === 0) return;
    await this.ensureDir();
    await Promise.all(
      dirty.map(async ({ group, json }) => {
        await this.adapter.write(this.groupPath(group), json);
        this.lastWrittenJson.set(group, json);
      }),
    );
  }
}
