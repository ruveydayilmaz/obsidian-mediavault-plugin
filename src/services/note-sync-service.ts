import type { App } from "obsidian";
import type { StorageService } from "./storage";
import type { MediaItem } from "../models/media";
import type { NoteSyncState } from "../settings/settings";
import { generateMediaNote } from "./note-generator/media-note-generator";
import { mapWithConcurrency } from "./importer/concurrency";
import { maybeYield } from "./importer/yield";
import { confirmDialog } from "../ui/modals/confirm-modal";
import { t } from "../i18n";
import { Notice } from "obsidian";
import type { BackupService } from "./backup-service";
import { trackOperation, journalEvent } from "./operation-log";

const SYNC_CONCURRENCY = 4;
const YIELD_EVERY = 5;
const CHECKPOINT_EVERY = 10;
const MAX_RECONCILE_PASSES = 3;

export type SyncProgressCallback = (done: number, total: number) => void;

export class NoteSyncService {
  private running = false;
  private disposed = false;
  private deferredThisSession = false;

  constructor(
    private app: App,
    private storage: StorageService,
    private backup: BackupService,
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  dispose(): void {
    this.disposed = true;
  }

  private async syncableMedia(): Promise<MediaItem[]> {
    return this.storage.media.findWhere((m) => !!m.notePath);
  }

  private latestUpdatedAt(items: MediaItem[]): string | null {
    let latest: string | null = null;
    for (const item of items) {
      if (!latest || item.updatedAt > latest) latest = item.updatedAt;
    }
    return latest;
  }

  private state(): NoteSyncState {
    return this.storage.settings.get().noteSyncState;
  }

  private async patchState(patch: Partial<NoteSyncState>): Promise<void> {
    await this.storage.settings.update({
      noteSyncState: { ...this.state(), ...patch },
    });
  }

  async checkOnStartup(): Promise<void> {
    if (this.disposed) return;
    const state = this.state();

    if (state.status === "syncing") {
      await this.patchState({ status: "interrupted" });
    }

    const afterInterrupt = this.state();
    if (
      afterInterrupt.status === "interrupted" &&
      afterInterrupt.pendingMediaIds.length > 0 &&
      !this.deferredThisSession
    ) {
      const proceed = await confirmDialog(
        this.app,
        t("noteSync.interruptedPrompt", {
          done: afterInterrupt.completedItems,
          total: afterInterrupt.totalItems,
        }),
        t("noteSync.continueSync"),
        t("noteSync.later"),
      );
      if (proceed) {
        await this.runSync({ resume: true });
      } else {
        this.deferredThisSession = true;
      }
      return;
    }

    await this.checkAndSyncIfNeeded();
  }

  async checkAndSyncIfNeeded(): Promise<void> {
    if (this.disposed || this.running) return;

    if (this.storage.pipelineBusy) return;

    const state = this.state();
    if (state.status === "syncing") return;

    const syncable = await this.syncableMedia();
    const latest = this.latestUpdatedAt(syncable);

    const needsSync =
      state.lastSuccessfulSyncAt === null ||
      (latest !== null && latest > state.lastSuccessfulSyncAt);

    if (!needsSync) return;

    await this.runSync({ resume: false });
  }

  async runManualSync(onProgress?: SyncProgressCallback): Promise<void> {
    if (this.running || this.storage.pipelineBusy) {
      new Notice(t("noteSync.alreadyRunning"));
      return;
    }
    this.deferredThisSession = false;
    const state = this.state();
    const resume =
      state.status === "interrupted" && state.pendingMediaIds.length > 0;
    await this.runSync({ resume, onProgress, manual: true });
  }

  private async computeQueue(resume: boolean): Promise<MediaItem[]> {
    const state = this.state();
    const syncable = await this.syncableMedia();

    const changed =
      state.lastSuccessfulSyncAt === null
        ? syncable
        : syncable.filter((m) => m.updatedAt > state.lastSuccessfulSyncAt!);

    if (!resume) return changed;

    const pendingSet = new Set(state.pendingMediaIds);
    const startedAt = state.lastSyncStartedAt;
    return changed.filter(
      (m) => pendingSet.has(m.id) || (startedAt !== null && m.updatedAt > startedAt),
    );
  }

  private async runSync(opts: {
    resume: boolean;
    onProgress?: SyncProgressCallback;
    manual?: boolean;
  }): Promise<void> {
    if (this.disposed || this.running || this.storage.pipelineBusy) return;
    this.running = true;
    const release = this.storage.acquirePipeline();
    try {
      await trackOperation("note-sync", () => this.runSyncBody(opts));
    } catch (err) {
      console.error(
        "MediaVault: note sync failed",
        err instanceof Error ? err.message : "unknown error",
      );
      try {
        if (this.state().status === "syncing") {
          await this.patchState({ status: "interrupted" });
        }
      } catch {
        return;
      }
    } finally {
      this.running = false;
      release();
    }
  }

  private async runSyncBody(opts: {
    resume: boolean;
    onProgress?: SyncProgressCallback;
    manual?: boolean;
  }): Promise<void> {
    {
      let queue = await this.computeQueue(opts.resume);
      journalEvent("note-sync-queue", {
        changed: queue.length,
        resume: opts.resume,
      });
      if (queue.length === 0) {
        await this.patchState({
          status: "completed",
          lastSuccessfulSyncAt: new Date().toISOString(),
          lastSyncCompletedAt: new Date().toISOString(),
          pendingMediaIds: [],
          failedMediaIds: [],
        });
        return;
      }

      if (opts.manual) {
        try {
          await this.backup.ensure("note-sync");
        } catch (err) {
          console.error("MediaVault: pre-sync backup failed; note sync not run", err);
          new Notice(t("backup.failedAbort"));
          return;
        }
      }

      const runStartedAt = new Date().toISOString();
      let totalSeen = 0;
      let completedTotal = 0;
      const allFailedIds = new Set<string>();

      await this.patchState({
        status: "syncing",
        lastSyncStartedAt: runStartedAt,
        totalItems: queue.length,
        completedItems: 0,
        pendingMediaIds: queue.map((m) => m.id),
        failedMediaIds: [],
      });

      let passStart = runStartedAt;
      let pass = 0;
      let converged = false;

      while (pass < MAX_RECONCILE_PASSES) {
        if (this.disposed) throw new Error("note sync stopped because the plugin was unloaded");
        totalSeen += queue.length;
        const pendingIds = new Set(queue.map((m) => m.id));
        let processedInPass = 0;

        await mapWithConcurrency(queue, SYNC_CONCURRENCY, async (media) => {
          if (this.disposed) return;
          try {
            await generateMediaNote(this.app, this.storage, media, {
              respectNewerNote: true,
            });
            allFailedIds.delete(media.id);
          } catch (err) {
            allFailedIds.add(media.id);
            console.warn(
              `MediaVault: note sync failed for "${media.title}" (${media.id})`,
              err,
            );
          }

          pendingIds.delete(media.id);
          completedTotal++;
          processedInPass++;

          if (
            processedInPass % CHECKPOINT_EVERY === 0 ||
            processedInPass === queue.length
          ) {
            await this.patchState({
              completedItems: completedTotal,
              pendingMediaIds: [...pendingIds],
              failedMediaIds: [...allFailedIds],
            });
            opts.onProgress?.(completedTotal, totalSeen);
          }

          await maybeYield(processedInPass, YIELD_EVERY);
        });

        pass++;
        journalEvent("note-sync-pass", {
          pass,
          processed: processedInPass,
          failed: allFailedIds.size,
        });
        const checkAt = new Date().toISOString();
        const syncable = await this.syncableMedia();
        const newlyChanged = syncable.filter((m) => m.updatedAt > passStart);

        if (newlyChanged.length === 0) {
          passStart = checkAt;
          converged = true;
          break;
        }

        queue = newlyChanged;
        passStart = checkAt;
      }

      const completedAt = new Date().toISOString();
      if (converged && allFailedIds.size === 0) {
        await this.patchState({
          status: "completed",
          lastSuccessfulSyncAt: passStart,
          lastSyncCompletedAt: completedAt,
          completedItems: completedTotal,
          totalItems: totalSeen,
          pendingMediaIds: [],
          failedMediaIds: [],
        });
      } else if (allFailedIds.size > 0) {
        await this.patchState({
          status: "failed",
          lastSyncCompletedAt: completedAt,
          completedItems: completedTotal,
          totalItems: totalSeen,
          pendingMediaIds: [...allFailedIds],
          failedMediaIds: [...allFailedIds],
        });
      } else {
        await this.patchState({
          status: "idle",
          lastSyncCompletedAt: completedAt,
          completedItems: completedTotal,
          totalItems: totalSeen,
          pendingMediaIds: [],
          failedMediaIds: [],
        });
      }
    }
  }
}
