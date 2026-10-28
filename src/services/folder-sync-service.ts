import { App, TFile } from "obsidian";
import type { StorageService } from "./storage";
import type { MediaItem } from "../models/media";
import type { TMDBService } from "../api/tmdb";
import { MediaStatus, MediaType } from "../types/enums";
import {
  frontmatterTimestamp,
  readNoteFrontmatter,
  reconcileListNote,
} from "./note-reconcile-service";
import {
  buildMediaTitleIndex,
  generateListNote,
  restoreListFromNote,
} from "./list-note-generator";
import { generateMediaNote } from "./note-generator/media-note-generator";
import {
  applyMediaPayload,
  deriveAggregates,
  noteMatchesCache,
  parseMediaPayload,
  type MediaSyncPayload,
  type PayloadApplyStats,
} from "./sync-payload";
import {
  removeTombstone,
  tombstonePath,
  type TombstoneKind,
} from "./sync-tombstones";
import { deleteMedia } from "./media-delete-service";
import { importEpisodesForShow } from "./episode-import";
import { mapWithConcurrency } from "./importer/concurrency";
import { maybeYield } from "./importer/yield";
import type { BackupReason, BackupService } from "./backup-service";
import { isRecentSelfWrite } from "./self-writes";
import { trackOperation, journalEvent } from "./operation-log";
import { syncStatus } from "./sync-status";

const YIELD_EVERY = 25;
const PROGRESS_THROTTLE_MS = 100;
const WATCHER_DEBOUNCE_MS = 1500;
const WRITE_CONCURRENCY = 4;
const ARTWORK_CONCURRENCY = 4;

export type SyncStatus =
  | "ok"
  | "folderNotFound"
  | "noFiles"
  | "busy"
  | "backupFailed";

export interface SyncResult {
  status: SyncStatus;
  itemsChecked: number;
  cacheUpdates: number;
  folderUpdates: number;
  artworkUpdates: number;
  conflicts: number;
}

export type SyncProgress = (done: number, total: number) => void;

export interface SyncOptions {
  createMissingNotes?: boolean;
  reason?: Extract<BackupReason, "manual" | "startup">;
  onProgress?: SyncProgress;
  pipelineHeld?: boolean;
  background?: boolean;
}

type Fm = Record<string, unknown>;

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) {
    return parseFloat(v);
  }
  return null;
}

function validStatus(v: unknown): MediaStatus | null {
  if (v === "up_to_date") return MediaStatus.WaitingForNewSeason;
  return typeof v === "string" &&
    (Object.values(MediaStatus) as string[]).includes(v)
    ? (v as MediaStatus)
    : null;
}

function tmdbPathFromUrl(v: unknown): string | null {
  const url = asString(v);
  if (!url) return null;
  const m = /\/t\/p\/[^/]+(\/.+)$/.exec(url);
  return m ? m[1] : null;
}

function dateOnly(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  return asString(v);
}

function needsTmdbData(m: MediaItem): boolean {
  if (!m.tmdbId) return false;
  const noImages = !m.posterPath && !m.backdropPath;
  const sparse = m.cast.length === 0 && m.genreIds.length === 0;
  return noImages || sparse;
}

export class FolderSyncService {
  private running = false;
  private pending = new Set<string>();
  private timer: number | null = null;
  private tmdbChecked = new Set<string>();
  private disposed = false;

  constructor(
    private app: App,
    private storage: StorageService,
    private getTmdb: () => TMDBService | null,
    private onChanged: () => void,
    private backup: BackupService,
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  baseFolder(): string {
    const raw = this.storage.settings.get().mediaFolderPath || "MediaVault";
    return raw.replace(/\/+$/, "");
  }

  isInFolder(path: string): boolean {
    return path.startsWith(`${this.baseFolder()}/`);
  }

  private folderFiles(): TFile[] {
    const prefix = `${this.baseFolder()}/`;
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(prefix));
  }

  async sync(opts: SyncOptions = {}): Promise<SyncResult> {
    const empty = (status: SyncStatus): SyncResult => ({
      status,
      itemsChecked: 0,
      cacheUpdates: 0,
      folderUpdates: 0,
      artworkUpdates: 0,
      conflicts: 0,
    });

    journalEvent("sync-requested", { reason: opts.reason ?? "manual" });
    const held = opts.pipelineHeld === true;
    if (this.disposed || this.running || (!held && this.storage.pipelineBusy)) {
      journalEvent("sync-lock-rejected", {
        reason: opts.reason ?? "manual",
        running: this.running,
        pipelineBusy: this.storage.pipelineBusy,
      });
      if (held) syncStatus.skip("folderSync.alreadyRunning");
      return empty("busy");
    }
    this.running = true;
    const release = held ? () => undefined : this.storage.acquirePipeline();
    const requiresBackup = (opts.reason ?? "manual") === "manual";
    syncStatus.adopt(opts.reason !== "startup");
    syncStatus.setStage(requiresBackup ? "backup" : "preparing");
    journalEvent("sync-lock-acquired", { reason: opts.reason ?? "manual" });
    try {
      const outcome = await trackOperation(
        `folder-sync:${opts.reason ?? "manual"}`,
        async () => {
          const files = this.folderFiles();
          if (files.length === 0 && (await this.storage.media.count()) === 0) {
            const missing = this.app.vault.getAbstractFileByPath(this.baseFolder())
              ? "noFiles"
              : "folderNotFound";
            syncStatus.skip(`folderSync.${missing}`);
            return empty(missing);
          }

          if (requiresBackup) {
            journalEvent("backup-requested", { files: files.length });
            try {
              const made = await this.backup.ensure("manual");
              journalEvent("backup-result", {
                created: made !== null,
                notes: made?.counts.notes ?? 0,
              });
              syncStatus.markBackupRetained();
            } catch (err) {
              console.error(
                "MediaVault: pre-sync backup failed; sync not run",
                err instanceof Error ? err.message : "unknown error",
              );
              syncStatus.fail(
                "backup.failedAbort",
                err instanceof Error ? err.message.slice(0, 160) : null,
              );
              return empty("backupFailed");
            }
          } else {
            journalEvent("backup-skipped", { reason: opts.reason ?? "manual" });
          }
          if (this.disposed) {
            syncStatus.skip("folderSync.alreadyRunning");
            return empty("busy");
          }
          syncStatus.setStage("preparing");
          const processed = await this.process(files, { ...opts, full: true });
          if (processed.status === "ok") {
            syncStatus.complete({
              checked: processed.itemsChecked,
              cache: processed.cacheUpdates,
              folder: processed.folderUpdates,
              artwork: processed.artworkUpdates,
              conflicts: processed.conflicts,
            });
          } else {
            syncStatus.skip("folderSync.alreadyRunning");
          }
          return processed;
        },
      );
      return outcome.ran ? outcome.value : empty("busy");
    } catch (err) {
      syncStatus.fail(
        "folderSync.syncFailed",
        err instanceof Error ? err.message.slice(0, 160) : null,
      );
      throw err;
    } finally {
      this.running = false;
      release();
    }
  }

  queuePath(path: string): void {
    if (this.disposed) return;
    if (!this.isInFolder(path) || !path.endsWith(".md")) return;

    if (isRecentSelfWrite(path)) return;
    this.pending.add(path);
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flushPending();
    }, WATCHER_DEBOUNCE_MS);
  }

  private async flushPending(): Promise<void> {
    if (this.disposed) return;
    if (this.running || this.storage.pipelineBusy) {
      this.timer = window.setTimeout(() => {
        this.timer = null;
        void this.flushPending();
      }, WATCHER_DEBOUNCE_MS);
      return;
    }
    const files: TFile[] = [];
    for (const p of this.pending) {
      const f = this.app.vault.getAbstractFileByPath(p);
      if (f instanceof TFile && f.extension === "md") files.push(f);
    }
    this.pending.clear();
    if (files.length === 0) return;
    this.running = true;
    const release = this.storage.acquirePipeline();
    try {
      await trackOperation("folder-sync:watcher", async () => {
        if (this.disposed) return;
        await this.process(files, { full: false });
      });
    } catch (err) {
      console.warn("MediaVault: folder sync batch failed", err);
    } finally {
      this.running = false;
      release();
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
  }

  private async tombstoneFor(
    kind: TombstoneKind,
    id: string,
    scanned: Map<string, { deletedAt: string; file: TFile }>,
  ): Promise<{ deletedAt: string; file: TFile } | null> {
    const hit = scanned.get(`${kind}:${id}`);
    if (hit) return hit;
    const f = this.app.vault.getAbstractFileByPath(
      tombstonePath(this.storage, kind, id),
    );
    if (!(f instanceof TFile)) return null;
    const fm = await readNoteFrontmatter(this.app, f);
    const at = fm ? frontmatterTimestamp(fm.mediavault_deleted_at) : null;
    return at ? { deletedAt: at, file: f } : null;
  }

  private async process(
    files: TFile[],
    opts: SyncOptions & { full: boolean },
  ): Promise<SyncResult> {
    const startedAt = new Date().toISOString();
    const result: SyncResult = {
      status: "ok",
      itemsChecked: 0,
      cacheUpdates: 0,
      folderUpdates: 0,
      artworkUpdates: 0,
      conflicts: 0,
    };
    let lastProgress = 0;
    const scanTotal = files.length;
    const report = (done: number, total: number, force = false) => {
      if (done <= scanTotal && total === scanTotal) {
        syncStatus.progress(done, scanTotal);
      } else if (total > scanTotal) {
        syncStatus.progress(Math.max(0, done - scanTotal), total - scanTotal);
      }
      const now = Date.now();
      if (opts.onProgress && (force || now - lastProgress >= PROGRESS_THROTTLE_MS)) {
        lastProgress = now;
        opts.onProgress(done, total);
      }
    };

    try {
      const storage = this.storage;

      await storage.flushTouches();

      // scan folder
      const mediaNotes = new Map<string, { file: TFile; fm: Fm }>();
      const listNotes = new Map<string, { file: TFile; fm: Fm }>();
      const tombstones = new Map<string, { deletedAt: string; file: TFile }>();
      const total = files.length;
      const needsRepair = new Set<string>();
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        result.itemsChecked++;
        try {
          const fm = await readNoteFrontmatter(this.app, file);

          if (fm && this.app.metadataCache.getFileCache(file)?.frontmatter === undefined) {
            const head = await this.app.vault.adapter.read(file.path);
            if (head.startsWith("---")) needsRepair.add(file.path);
          }
          if (fm) {
            if (fm.mediavault_tombstone === true) {
              const kind = fm.mediavault_deleted_kind;
              const id = fm.mediavault_deleted_id;
              const at = frontmatterTimestamp(fm.mediavault_deleted_at);
              if ((kind === "media" || kind === "list") && typeof id === "string" && at) {
                tombstones.set(`${kind}:${id}`, { deletedAt: at, file });
              }
            } else if (typeof fm.mediavault_id === "string") {
              if (!mediaNotes.has(fm.mediavault_id)) {
                mediaNotes.set(fm.mediavault_id, { file, fm });
              }
            } else if (
              fm.mediavault_list === true &&
              typeof fm.mediavault_list_id === "string"
            ) {
              if (!listNotes.has(fm.mediavault_list_id)) {
                listNotes.set(fm.mediavault_list_id, { file, fm });
              }
            }
          }
        } catch (err) {
          console.warn(`MediaVault: could not read "${file.path}"`, err);
        }
        report(i + 1, total);
        await maybeYield(i + 1, YIELD_EVERY);
        if (this.disposed) return result;
      }

      syncStatus.setStage("syncing", { changesBegun: true });
      journalEvent("scan-complete", {
        files: total,
        media: mediaNotes.size,
        lists: listNotes.size,
        tombstones: tombstones.size,
      });
      const allMedia = await storage.media.getAll();
      const mediaById = new Map(allMedia.map((m) => [m.id, m]));
      const tmdbKeys = new Set(allMedia.map((m) => `${m.type}:${m.tmdbId}`));
      const toWrite = new Set<string>();
      const creates: { file: TFile; fm: Fm }[] = [];
      const artworkIds = new Set<string>();
      const restoredTv = new Set<string>();

      for (const [id, { file, fm }] of mediaNotes) {
        try {
          const noteTs = frontmatterTimestamp(fm.mediavault_updated_at);
          const local = mediaById.get(id);

          const tomb = await this.tombstoneFor("media", id, tombstones);
          if (tomb) {
            if (noteTs && noteTs > tomb.deletedAt) {
              await removeTombstone(this.app, storage, "media", id);
            } else if (local && local.updatedAt > tomb.deletedAt) {
              await removeTombstone(this.app, storage, "media", id);
              toWrite.add(id);
              continue;
            } else {
              if (local) {
                await deleteMedia(this.app, storage, id);
                result.cacheUpdates++;
              }
              const stale = this.app.vault.getAbstractFileByPath(file.path);
              if (stale) await this.app.fileManager.trashFile(stale);
              continue;
            }
          }

          if (!local) {
            creates.push({ file, fm });
            continue;
          }

          // moved/renamed note
          if (
            local.notePath !== file.path &&
            (!local.notePath ||
              !this.app.vault.getAbstractFileByPath(local.notePath))
          ) {
            await storage.media.update(id, {
              notePath: file.path,
              updatedAt: local.updatedAt,
            });
          }

          if (!noteTs) {
            toWrite.add(id);
          } else {
            const content = await this.app.vault.adapter.read(file.path);
            const notePayload = parseMediaPayload(content);
            const cmp = noteTs.localeCompare(local.updatedAt);

            let cacheChanged = 0;
            let hydrationIncomplete = false;
            if (cmp > 0) {
              const r = await this.applyNoteToCache(file, fm, noteTs, id, notePayload);
              cacheChanged = 1;
              hydrationIncomplete = !!r && r.unresolved > 0;
            } else if (notePayload) {
              const r = await storage.withoutTouch(() =>
                applyMediaPayload(storage, id, notePayload, {
                  updatesOnly: cmp < 0 && local.syncVerified === true,
                }),
              );
              hydrationIncomplete = r.unresolved > 0;
              if (r.changed > 0) {
                cacheChanged = 1;
                await this.refreshAggregates(id, local.updatedAt);
              }
            }
            if (cacheChanged) result.cacheUpdates++;

            const fresh = (await storage.media.findById(id)) ?? local;
            if (cmp === 0 && !cacheChanged && this.editableDiffers(local, fm)) {
              result.conflicts++;
              console.warn(
                `MediaVault: sync conflict for "${local.title}" (${local.id}), both sides changed at the same version; keeping the local cache.`,
              );
            }

            if (hydrationIncomplete) {
              console.warn(
                `MediaVault: "${local.title}" not fully hydrated from its note; leaving the note untouched and retrying next sync.`,
              );
            } else if (
              cmp < 0 ||
              !(await noteMatchesCache(storage, fresh, content))
            ) {
              toWrite.add(id);
            }
            if (!hydrationIncomplete && !fresh.syncVerified && !toWrite.has(id)) {
              await storage.media.update(id, {
                syncVerified: true,
                updatedAt: fresh.updatedAt,
              });
            }
            if (cmp > 0 && needsTmdbData(fresh)) artworkIds.add(id);
          }
        } catch (err) {
          console.warn(`MediaVault: sync failed for "${file.path}"`, err);
        }
      }

      const byTmdb = new Map(allMedia.map((m) => [`${m.type}:${m.tmdbId}`, m]));
      for (let i = 0; i < creates.length; i++) {
        const { file, fm } = creates[i];
        try {
          const kind =
            fm.type === "movie" ? MediaType.Movie : fm.type === "tv" ? MediaType.TVShow : null;
          const tid = asNumber(fm.tmdb_id);
          const twin = kind && tid !== null ? byTmdb.get(`${kind}:${tid}`) : undefined;
          if (twin) {
            if (await this.mergeIntoExisting(file, twin, toWrite)) {
              result.cacheUpdates++;
            }
            continue;
          }
          const created = await this.createFromNote(file, fm, tmdbKeys);
          if (created) {
            result.cacheUpdates++;
            artworkIds.add(created.id);
            if (created.type === MediaType.TVShow) restoredTv.add(created.id);
          }
        } catch (err) {
          console.warn(`MediaVault: failed to restore "${file.path}"`, err);
        }
        await maybeYield(i + 1, YIELD_EVERY);
      }

      if (opts.full && opts.createMissingNotes) {
        for (const m of allMedia) {
          if (mediaNotes.has(m.id)) continue;
          if (m.notePath && this.app.vault.getAbstractFileByPath(m.notePath)) {
            continue;
          }
          const tomb = await this.tombstoneFor("media", m.id, tombstones);
          if (tomb) {
            if (m.updatedAt > tomb.deletedAt) {
              await removeTombstone(this.app, storage, "media", m.id);
            } else {
              await deleteMedia(this.app, storage, m.id);
              result.cacheUpdates++;
              continue;
            }
          }
          toWrite.add(m.id);
        }
      }

      if (opts.full) {
        for (const m of allMedia) if (needsTmdbData(m)) artworkIds.add(m.id);
      }

      for (const [id, { file }] of mediaNotes) {
        if (needsRepair.has(file.path) && (await storage.media.findById(id))) {
          toWrite.add(id);
        }
      }
      if (this.disposed) return result;
      const writeIds = [...toWrite];
      journalEvent("prepare-complete", {
        toWrite: writeIds.length,
        creates: creates.length,
        artwork: artworkIds.size,
        cacheUpdates: result.cacheUpdates,
      });
      const workTotal = total + writeIds.length + artworkIds.size;
      let done = total;
      await mapWithConcurrency(writeIds, WRITE_CONCURRENCY, async (id) => {
        if (this.disposed) return;
        const m = await storage.media.findById(id);
        if (m) {
          try {
            const { changed } = await generateMediaNote(this.app, storage, m);
            if (changed) result.folderUpdates++;
          } catch (err) {
            console.warn(`MediaVault: note write failed for "${m.title}"`, err);
          }
        }
        report(++done, workTotal);
        if ((done - total) % 50 === 0) {
          journalEvent("markdown-write-progress", { written: done - total, of: writeIds.length });
        }
        await maybeYield(done, YIELD_EVERY);
      });
      journalEvent("markdown-write-complete", { written: result.folderUpdates });

      if (this.disposed) return result;
      await this.syncLists(listNotes, tombstones, result, opts, needsRepair);

      const tmdb = this.getTmdb();
      const hasKey = !!storage.settings.get().tmdbApiKey;
      if (tmdb && hasKey && artworkIds.size > 0) {
        await mapWithConcurrency(
          [...artworkIds],
          ARTWORK_CONCURRENCY,
          async (id) => {
            if (this.disposed) return;
            if (this.tmdbChecked.has(id)) {
              report(++done, workTotal);
              return;
            }
            const m = await storage.media.findById(id);
            if (m) {
              try {
                if (await this.fillFromTmdb(tmdb, m)) result.artworkUpdates++;
                if (restoredTv.has(id)) {
                  const before = await storage.media.findById(id);
                  await importEpisodesForShow(storage, tmdb, m);
                  const after = await storage.media.findById(id);
                  if (before && after) {
                    if (after.status === before.status) {
                      await storage.media.update(id, {
                        updatedAt: before.updatedAt,
                      });
                    } else {
                      await generateMediaNote(this.app, storage, after);
                    }
                  }
                }
                this.tmdbChecked.add(id);
              } catch (err) {
                console.warn(`MediaVault: TMDB lookup failed for "${m.title}"`, err);
              }
            }
            report(++done, workTotal);
          },
        );
      }

      if (this.disposed) return result;
      report(workTotal, workTotal, true);
      syncStatus.setStage("finalizing");

      if (result.conflicts === 0) {
        await storage.settings.update({
          noteSyncState: {
            ...storage.settings.get().noteSyncState,
            status: "completed",
            lastSuccessfulSyncAt: startedAt,
            lastSyncCompletedAt: new Date().toISOString(),
            pendingMediaIds: [],
            failedMediaIds: [],
          },
        });
      }
      if (result.cacheUpdates > 0 || result.artworkUpdates > 0) {
        this.onChanged();
      }
      return result;
    } finally {
      // nothing to do here
    }
  }

  private editableDiffers(local: MediaItem, fm: Fm): boolean {
    const status = validStatus(fm.status);
    if (status && status !== local.status) return true;
    if ("platform" in fm) {
      const p = typeof fm.platform === "string" ? fm.platform : null;
      if (p !== local.platform) return true;
    }
    return false;
  }

  private async refreshAggregates(
    mediaId: string,
    updatedAt: string,
  ): Promise<void> {
    const aggs = await deriveAggregates(this.storage, mediaId);
    await this.storage.media.update(mediaId, { ...aggs, updatedAt });
  }

  private async applyNoteToCache(
    _file: TFile,
    fm: Fm,
    noteTs: string,
    mediaId: string,
    payload: MediaSyncPayload | null,
  ): Promise<PayloadApplyStats | null> {
    const storage = this.storage;
    const patch: Partial<MediaItem> = {};
    const status = validStatus(fm.status) ?? payload?.user?.status ?? null;
    if (status) patch.status = status;
    if ("platform" in fm) {
      patch.platform = typeof fm.platform === "string" ? fm.platform : null;
    } else if (payload?.user) {
      patch.platform = payload.user.platform ?? null;
    }
    if (payload?.user) this.userFieldsPatch(patch, payload);

    return storage.withoutTouch(async () => {
      const stats = payload
        ? await applyMediaPayload(storage, mediaId, payload)
        : null;
      const aggs = payload ? await deriveAggregates(storage, mediaId) : {};
      await storage.media.update(mediaId, {
        ...patch,
        ...aggs,
        updatedAt: noteTs,
      });
      return stats;
    });
  }

  private userFieldsPatch(
    patch: Partial<MediaItem>,
    payload: MediaSyncPayload,
  ): void {
    const u = payload.user;
    if (typeof u.isFavorite === "boolean") patch.isFavorite = u.isFavorite;
    if (typeof u.liked === "boolean") patch.liked = u.liked;
    if ("likedAt" in u) patch.likedAt = u.likedAt ?? null;
    if ("droppedReason" in u) patch.droppedReason = u.droppedReason ?? null;
    if (typeof u.notes === "string") patch.notes = u.notes;
    if (Array.isArray(u.tags)) patch.tags = u.tags;
  }

  private async mergeIntoExisting(
    file: TFile,
    twin: MediaItem,
    toWrite: Set<string>,
  ): Promise<boolean> {
    const storage = this.storage;
    const payload = parseMediaPayload(await this.app.vault.adapter.read(file.path));
    let changed = false;
    if (payload) {
      const r = await storage.withoutTouch(() =>
        applyMediaPayload(storage, twin.id, payload),
      );
      if (r.unresolved > 0) {
        console.warn(
          `MediaVault: "${twin.title}" not fully hydrated from "${file.path}"; note left untouched.`,
        );
        return false;
      }
      if (r.changed > 0) {
        changed = true;
        await this.refreshAggregates(twin.id, twin.updatedAt);
      }
    }
    const linkedGone =
      !twin.notePath || !this.app.vault.getAbstractFileByPath(twin.notePath);
    if (linkedGone) {
      await storage.media.update(twin.id, {
        notePath: file.path,
        updatedAt: twin.updatedAt,
      });
    }
    toWrite.add(twin.id);
    return changed;
  }

  private async createFromNote(
    file: TFile,
    fm: Fm,
    tmdbKeys: Set<string>,
  ): Promise<MediaItem | null> {
    const storage = this.storage;
    const type =
      fm.type === "movie"
        ? MediaType.Movie
        : fm.type === "tv"
          ? MediaType.TVShow
          : null;
    const tmdbId = asNumber(fm.tmdb_id);
    if (!type || tmdbId === null) return null;

    const key = `${type}:${tmdbId}`;
    if (tmdbKeys.has(key)) return null;

    const id = fm.mediavault_id as string;
    const noteTs =
      frontmatterTimestamp(fm.mediavault_updated_at) ??
      new Date().toISOString();
    const content = await this.app.vault.adapter.read(file.path);
    const payload = parseMediaPayload(content);

    const genres = Array.isArray(fm.genres)
      ? fm.genres.filter((g): g is string => typeof g === "string")
      : [];

    const base: Partial<MediaItem> = {
      status:
        validStatus(fm.status) ??
        payload?.user?.status ??
        MediaStatus.PlanToWatch,
      platform:
        asString(fm.platform) ?? payload?.user?.platform ?? null,
    };
    if (payload?.user) this.userFieldsPatch(base, payload);

    let created: MediaItem | null = null;
    try {
      created = await storage.withoutTouch(async () => {
        await storage.media.restore({
          id,
          tmdbId,
          type,
          title: asString(fm.title) ?? file.basename,
          year: asNumber(fm.year),
          releaseDate: dateOnly(fm.release_date),
          genres,
          synopsis: asString(fm.synopsis),
          runtime: asNumber(fm.runtime),
          country: asString(fm.country),
          language: asString(fm.language),
          posterPath: tmdbPathFromUrl(fm.poster),
          backdropPath: tmdbPathFromUrl(fm.backdrop),
          notePath: file.path,
          ...base,
          createdAt: noteTs,
          updatedAt: noteTs,
        });
        if (payload) {
          const r = await applyMediaPayload(storage, id, payload);
          if (r.unresolved > 0) {
            throw new Error(
              `hydration incomplete (${r.unresolved} records unresolved)`,
            );
          }
        }
        const aggs = payload ? await deriveAggregates(storage, id) : {};
        return storage.media.update(id, {
          ...aggs,
          lastActivityAt:
            (aggs as { lastWatchedDate?: string | null }).lastWatchedDate ??
            null,
          syncVerified: true,
          updatedAt: noteTs,
        });
      });
    } catch (err) {
      await storage.withoutTouch(async () => {
        await storage.watchSessions.deleteByMediaId(id);
        await storage.episodeProgress.deleteByMediaId(id);
        await storage.episodeWatches.deleteByMediaId(id);
        await storage.episodes.deleteByMediaId(id);
        await storage.movieProgress.deleteByMediaId(id);
        await storage.comfortProfiles.deleteByMediaId(id);
        await storage.media.delete(id);
      });
      throw err;
    }
    tmdbKeys.add(key);
    return created;
  }

  private async fillFromTmdb(tmdb: TMDBService, m: MediaItem): Promise<boolean> {
    const d =
      m.type === MediaType.Movie
        ? await tmdb.getMovie(m.tmdbId)
        : await tmdb.getTV(m.tmdbId);
    const patch: Partial<MediaItem> = {};
    if (!m.posterPath && d.posterPath) patch.posterPath = d.posterPath;
    if (!m.backdropPath && d.backdropPath) patch.backdropPath = d.backdropPath;
    if (!m.originalTitle && d.originalTitle) patch.originalTitle = d.originalTitle;
    if (m.genreIds.length === 0 && d.genreIds.length > 0) patch.genreIds = d.genreIds;
    if (m.genres.length === 0 && d.genres.length > 0) patch.genres = d.genres;
    if (m.cast.length === 0 && d.cast.length > 0) patch.cast = d.cast;
    if (m.crew.length === 0 && d.crew.length > 0) patch.crew = d.crew;
    if (m.productionCompanies.length === 0 && d.productionCompanies.length > 0) {
      patch.productionCompanies = d.productionCompanies;
    }
    if (m.runtime === null && d.runtime !== null) patch.runtime = d.runtime;
    if (!m.releaseDate && d.releaseDate) patch.releaseDate = d.releaseDate;
    if (m.year === null && d.year !== null) patch.year = d.year;
    if (!m.language && d.language) patch.language = d.language;
    if (!m.country && d.country) patch.country = d.country;
    if (!m.synopsis && d.overview) patch.synopsis = d.overview;
    if (!m.tvStatus && d.tvStatus) patch.tvStatus = d.tvStatus;
    if (Object.keys(patch).length === 0) return false;

    await this.storage.media.update(m.id, { ...patch, updatedAt: m.updatedAt });
    return true;
  }

  private async syncLists(
    listNotes: Map<string, { file: TFile; fm: Fm }>,
    tombstones: Map<string, { deletedAt: string; file: TFile }>,
    result: SyncResult,
    opts: SyncOptions & { full: boolean },
    needsRepair: Set<string>,
  ): Promise<void> {
    const storage = this.storage;
    const titleIndex = buildMediaTitleIndex(await storage.media.getAll());
    let n = 0;

    for (const [id, { file, fm }] of listNotes) {
      try {
        const noteTs = frontmatterTimestamp(fm.mediavault_updated_at);
        const local = await storage.customLists.findById(id);

        const tomb = await this.tombstoneFor("list", id, tombstones);
        if (tomb) {
          if (noteTs && noteTs > tomb.deletedAt) {
            await removeTombstone(this.app, storage, "list", id);
          } else if (local && local.updatedAt > tomb.deletedAt) {
            await removeTombstone(this.app, storage, "list", id);
            await generateListNote(this.app, storage, local, file.path);
            result.folderUpdates++;
            continue;
          } else {
            if (local) {
              await storage.customLists.delete(id);
              result.cacheUpdates++;
            }
            const stale = this.app.vault.getAbstractFileByPath(file.path);
            if (stale) await this.app.fileManager.trashFile(stale);
            continue;
          }
        }

        if (!local) {
          await restoreListFromNote(this.app, storage, file, fm, titleIndex);
          result.cacheUpdates++;
        } else if (!noteTs || noteTs < local.updatedAt) {
          const { changed } = await generateListNote(
            this.app,
            storage,
            local,
            file.path,
          );
          if (changed) result.folderUpdates++;
        } else {
          const outcome = await reconcileListNote(this.app, storage, file, {
            silent: true,
            frontmatter: fm,
            titleIndex,
          });
          if (outcome === "updated") result.cacheUpdates++;
          else if (outcome === "conflict") result.conflicts++;
        }
        if (needsRepair.has(file.path)) {
          const current = await storage.customLists.findById(id);
          if (current) {
            const { changed } = await generateListNote(
              this.app,
              storage,
              current,
              file.path,
            );
            if (changed) result.folderUpdates++;
          }
        }
      } catch (err) {
        console.warn(`MediaVault: list sync failed for "${file.path}"`, err);
      }
      await maybeYield(++n, YIELD_EVERY);
    }

    if (opts.full && opts.createMissingNotes) {
      for (const list of await storage.customLists.getAll()) {
        if (listNotes.has(list.id)) continue;
        const tomb = await this.tombstoneFor("list", list.id, tombstones);
        if (tomb) {
          if (list.updatedAt > tomb.deletedAt) {
            await removeTombstone(this.app, storage, "list", list.id);
          } else {
            await storage.customLists.delete(list.id);
            result.cacheUpdates++;
            continue;
          }
        }
        try {
          const { changed } = await generateListNote(this.app, storage, list);
          if (changed) result.folderUpdates++;
        } catch (err) {
          console.warn(`MediaVault: could not create list note "${list.title}"`, err);
        }
      }
    }
  }
}
