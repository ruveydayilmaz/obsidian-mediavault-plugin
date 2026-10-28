import { onSeriesWatchCompleted } from "./services/watch-session-service";
import { MediaStatus, MediaType } from "./types/enums";
import { importEpisodesForShow } from "./services/episode-import";
import { Notice, Plugin, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { MediaVaultSettings } from "./settings/settings";
import { MediaVaultSettingTab } from "./settings/settings-tab";

const COMMAND_NAME_KEYS: Record<string, string> = {
  "mediavault-add-media": "command.addMedia",
  "mediavault-open-library": "command.openLibrary",
  "mediavault-open-lists": "command.openLists",
  "mediavault-open-watch-next": "command.openWatchNext",
  "mediavault-open-explore": "command.openExplore",
  "mediavault-show-notifications": "command.showNotifications",
  "mediavault-check-notifications-now": "command.checkNotificationsNow",
  "mediavault-import-watch-history": "command.importWatchHistory",
  "mediavault-recommendations": "command.recommendations",
  "mediavault-comfort-finder": "command.comfortFinder",
  "mediavault-view-stats": "command.viewStats",
  "mediavault-view-stats-quick": "command.viewStatsQuick",
  "mediavault-sync-notes": "command.syncNotes",
  "mediavault-export-library": "command.exportLibrary",
  "mediavault-import-export-file": "command.importMediaVaultExport",
  "mediavault-regenerate-all-notes": "command.regenerateAllNotes",
  "mediavault-trakt-sync-now": "command.traktSyncNow",
  "mediavault-trakt-regenerate-note": "command.traktRegenerateNote",
  "mediavault-test-tmdb-connection": "command.testTmdbConnection",
};
import {
  PLUGIN_NAME,
  RIBBON_ICON,
  VIEW_TYPE_LIBRARY,
  VIEW_TYPE_ANALYTICS,
  VIEW_TYPE_LISTS,
  VIEW_TYPE_WATCH_NEXT,
  VIEW_TYPE_EXPLORE,
} from "./constants";
import { StorageService } from "./services/storage";
import { StatisticsService } from "./services/statistics-service";
import { TMDBService, resolveTmdbLanguage } from "./api/tmdb";
import { initLocalImageService } from "./services/local-image-service";
import { AddMediaModal } from "./ui/modals/add-media-modal";
import { LibraryView } from "./ui/views/library-view";
import { AnalyticsView } from "./ui/views/analytics-view";
import { ListsView } from "./ui/views/lists-view";
import { WatchNextView } from "./ui/views/watch-next-view";
import { ExploreView } from "./ui/views/explore-view";
import { SelectMediaModal } from "./ui/modals/select-media-modal";
import { WatchSessionModal } from "./ui/modals/watch-session-modal";
import { MediaDetailModal } from "./ui/modals/media-detail-modal";
import { ImportModal } from "./ui/modals/import-modal";
import { TraktService } from "./api/trakt";
import { setupMobileKeyboardSupport } from "./utils/mobile-keyboard";
import { ensureValidTraktToken } from "./services/trakt-token";
import { pullFromTrakt, pushToTrakt } from "./services/trakt-sync";
import { generateTraktHistoryNote } from "./services/trakt-note-generator";
import {
  generateMediaNote,
  generateNotesInBatches,
} from "./services/note-generator/media-note-generator";
import { NoteSyncService } from "./services/note-sync-service";
import { BackupService } from "./services/backup-service";
import {
  FolderSyncService,
  type SyncResult,
} from "./services/folder-sync-service";
import {
  generateAllListNotes,
  generateListNote,
  resolveListNotePath,
} from "./services/list-note-generator";
import { mapWithConcurrency } from "./services/importer/concurrency";
import { exportMediaToVault } from "./services/mediavault-export";
import type { ExportCategoryOptions } from "./services/mediavault-export";
import { MediaVaultImportExportModal } from "./ui/modals/mediavault-import-export-modal";
import { ExportSelectionModal } from "./ui/modals/export-selection-modal";
import { AnalyticsSummaryModal } from "./ui/modals/analytics-summary-modal";
import { ComfortFinderModal } from "./ui/modals/comfort-finder-modal";
import { seedBuiltInPresets } from "./services/comfort/seed-presets";
import { RecommendationsModal } from "./ui/modals/recommendations-modal";
import { NotificationHistoryModal } from "./ui/modals/notification-history-modal";
import {
  runNotificationCheck,
  shouldRunDailyCheck,
} from "./services/notification-service";
import type { MediaItem } from "./models/media";
import type { Episode } from "./models/episode";
import {
  applyAndroidBodyClass,
  applyWebBodyClass,
  removeWebBodyClass,
  applyAndroidMenuOffset,
  setupAndroidSafeArea,
  teardownAndroidSafeArea,
} from "./utils/platform";
import { i18n, t, Locale } from "./i18n";
import { trackOperation, setJournal, journalEvent } from "./services/operation-log";
import { Diagnostics } from "./services/diagnostics";
import { syncStatus, SyncStatusState } from "./services/sync-status";
import { SyncProgressModal } from "./ui/modals/sync-progress-modal";

const STARTUP_DELAY_MS = 1500;

export default class MediaVaultPlugin extends Plugin {
  storage!: StorageService;
  tmdb!: TMDBService;
  trakt!: TraktService;
  statistics!: StatisticsService;
  private syncIntervalHandle: number | null = null;
  private notificationCheckIntervalHandle: number | null = null;
  private noteSyncIntervalHandle: number | null = null;
  noteSync!: NoteSyncService;
  backup!: BackupService;
  folderSync!: FolderSyncService;
  private mediaChangeDebounceHandle: number | null = null;
  private unloaded = false;
  private manualSyncInFlight = false;
  private syncProgressModal: SyncProgressModal | null = null;
  private syncStatusBarEl: HTMLElement | null = null;
  diagnostics: Diagnostics | null = null;
  private startupSettled = false;
  private scheduledTimers = new Set<number>();
  private unsubscribeLocaleChange: (() => void) | null = null;
  private localeAwareModals: Set<{ rerenderForLocaleChange: () => void }> =
    new Set();

  private scheduleTask(delayMs: number, fn: () => void): void {
    const handle = window.setTimeout(() => {
      this.scheduledTimers.delete(handle);
      if (this.unloaded) return;
      fn();
    }, delayMs);
    this.scheduledTimers.add(handle);
  }

  async onload() {
    applyAndroidBodyClass();
    applyWebBodyClass();
    this.register(() => removeWebBodyClass());
    setupAndroidSafeArea(this.app);

    this.storage = new StorageService(this);
    await this.storage.initialize();
    try {
      const pluginDir =
        this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
      this.diagnostics = new Diagnostics(
        this.app.vault.adapter,
        `${pluginDir}/diagnostics.json`,
      );
      await this.diagnostics.init();
      setJournal(this.diagnostics);
    } catch {
      this.diagnostics = null;
    }
    const setAside = this.storage.adapter.loadWarnings;
    if (setAside.length > 0) {
      new Notice(t("backup.dataFileSetAside", { files: setAside.join(", ") }), 15000);
    }
    initLocalImageService(this.app);
    i18n.setLocale(this.storage.settings.get().language);
    applyAndroidMenuOffset(this.storage.settings.get().androidMenuOffsetPx);
    this.register(() =>
      document.body.style.removeProperty("--mediavault-android-menu-offset"),
    );
    this.unsubscribeLocaleChange = i18n.onChange(() => this.onLocaleChanged());
    this.statistics = new StatisticsService(this.storage);
    await seedBuiltInPresets(this.storage);
    await this.ensureNotificationActivationDate();

    this.backup = new BackupService(
      this.app,
      this.storage,
      this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`,
      this.manifest.version,
    );
    this.noteSync = new NoteSyncService(this.app, this.storage, this.backup);
    this.register(
      onSeriesWatchCompleted((session) => {
        void this.showSeriesCompletedNotice(session.id, session.mediaId);
      }),
    );
    this.folderSync = new FolderSyncService(
      this.app,
      this.storage,
      () => this.tmdb ?? null,
      () => {
      this.refreshLibraryViews();
      this.refreshListViews();
        this.refreshExploreViews();
      },
      this.backup,
    );
    this.register(() => this.folderSync.dispose());

    this.storage.media.onUpdated = () => {
      if (this.unloaded) return;
      this.mediaUpdateEvents++;
      if (this.mediaChangeDebounceHandle !== null) {
        window.clearTimeout(this.mediaChangeDebounceHandle);
      }
      this.mediaChangeDebounceHandle = window.setTimeout(() => {
        this.mediaChangeDebounceHandle = null;
        this.requestEditSync();
      }, 4000);
    };

    this.tmdb = new TMDBService({
      getApiKey: () => this.storage.settings.get().tmdbApiKey,
      getCacheDurationMinutes: () =>
        this.storage.settings.get().cacheDurationMinutes,
      getShowAdultContent: () => this.storage.settings.get().showAdultContent,
      getLanguage: () =>
        resolveTmdbLanguage(
          this.storage.settings.get().tmdbLanguage,
          this.storage.settings.get().language,
        ),
    });

    this.trakt = new TraktService({
      getClientId: () => this.storage.settings.get().traktClientId,
      getClientSecret: () => this.storage.settings.get().traktClientSecret,
      getAccessToken: () => this.storage.settings.get().traktAccessToken,
    });

    this.setupTraktAutoSync();
    this.setupNotificationSchedule();
    this.setupNoteSyncSchedule();
    this.setupSyncStatusBar();
    this.scheduleStartupSequence();
    this.setupInputKeyboardUX();
    setupMobileKeyboardSupport(this);

    this.registerView(VIEW_TYPE_LIBRARY, (leaf) => new LibraryView(leaf, this));
    this.registerView(
      VIEW_TYPE_ANALYTICS,
      (leaf) => new AnalyticsView(leaf, this),
    );
    this.registerView(VIEW_TYPE_LISTS, (leaf) => new ListsView(leaf, this));
    this.registerView(
      VIEW_TYPE_WATCH_NEXT,
      (leaf) => new WatchNextView(leaf, this),
    );
    this.registerView(VIEW_TYPE_EXPLORE, (leaf) => new ExploreView(leaf, this));

    this.addRibbonIcon(RIBBON_ICON, PLUGIN_NAME, () => {
      void this.activateLibraryView();
    });

    this.addCommand({
      id: "add-media",
      name: t("command.addMedia"),
      callback: () => {
        this.openAddMediaModal();
      },
    });

    this.addCommand({
      id: "open-library",
      name: t("command.openLibrary"),
      callback: () => {
        void this.activateLibraryView();
      },
    });

    this.addCommand({
      id: "open-lists",
      name: t("command.openLists"),
      callback: () => {
        void this.activateListsView();
      },
    });

    this.addCommand({
      id: "open-watch-next",
      name: t("command.openWatchNext"),
      callback: () => {
        void this.activateWatchNextView();
      },
    });

    this.addCommand({
      id: "open-explore",
      name: t("command.openExplore"),
      callback: () => {
        void this.activateExploreView();
      },
    });

    this.addCommand({
      id: "show-notifications",
      name: t("command.showNotifications"),
      callback: () => {
        new NotificationHistoryModal(this.app, this).open();
      },
    });

    this.addCommand({
      id: "check-notifications-now",
      name: t("command.checkNotificationsNow"),
      callback: () => {
        void this.runNotificationCheckNow();
      },
    });

    this.addCommand({
      id: "import-watch-history",
      name: t("command.importWatchHistory"),
      callback: () => {
        if (!this.storage.settings.get().tmdbApiKey) {
          new Notice(t("notice.addTmdbKeyBeforeImporting"));
          return;
        }
        new ImportModal(this.app, this.storage, this.tmdb, () => {
          this.refreshLibraryViews();
          this.refreshListViews();
        }).open();
      },
    });

    this.addCommand({
      id: "recommendations",
      name: t("command.recommendations"),
      callback: () => {
        if (!this.storage.settings.get().tmdbApiKey) {
          new Notice(t("notice.addTmdbKeyFirst"));
          return;
        }
        new RecommendationsModal(
          this.app,
          this.storage,
          this.tmdb,
          this,
        ).open();
      },
    });

    this.addCommand({
      id: "comfort-finder",
      name: t("command.comfortFinder"),
      callback: () => {
        new ComfortFinderModal(this.app, this.storage, this.tmdb).open();
      },
    });

    this.addCommand({
      id: "view-stats",
      name: t("command.viewStats"),
      callback: () => {
        void this.activateAnalyticsView();
      },
    });

    this.addCommand({
      id: "view-stats-quick",
      name: t("command.viewStatsQuick"),
      callback: () => {
        new AnalyticsSummaryModal(this.app, this.storage, this.tmdb).open();
      },
    });

    this.addCommand({
      id: "sync-notes",
      name: t("command.syncNotes"),
      callback: () => {
        void this.runManualNoteSync();
      },
    });

    this.addCommand({
      id: "show-sync-progress",
      name: t("syncProgress.command"),
      callback: () => {
        this.openSyncProgress();
      },
    });

    this.addCommand({
      id: "export-library",
      name: t("command.exportLibrary"),
      callback: () => {
        void this.runExportLibrary();
      },
    });

    this.addCommand({
      id: "import-export-file",
      name: t("command.importMediaVaultExport"),
      callback: () => {
        new MediaVaultImportExportModal(this.app, this.storage, () => {
          this.refreshLibraryViews();
          this.refreshListViews();
        }).open();
      },
    });

    this.addCommand({
      id: "regenerate-all-notes",
      name: t("command.regenerateAllNotes"),
      callback: () => {
        void this.regenerateAllNotes();
      },
    });

    this.addCommand({
      id: "trakt-sync-now",
      name: t("command.traktSyncNow"),
      callback: () => {
        void this.runTraktSync();
      },
    });

    this.addCommand({
      id: "trakt-regenerate-note",
      name: t("command.traktRegenerateNote"),
      callback: async () => {
        await generateTraktHistoryNote(
          this.app,
          this.storage,
          this.storage.settings.get().traktHistoryNotePath,
        );
        new Notice(t("notice.traktHistoryRegenerated"));
      },
    });

    this.addCommand({
      id: "test-tmdb-connection",
      name: t("command.testTmdbConnection"),
      callback: async () => {
        if (!this.storage.settings.get().tmdbApiKey) {
          new Notice(t("notice.addTmdbKeyFirst"));
          return;
        }
        try {
          const result = await this.tmdb.searchMovies("Interstellar");
          new Notice(t("notice.tmdbOk", { count: result.total }));
        } catch (err) {
          new Notice(
            t("notice.tmdbRequestFailed", { error: (err as Error).message }),
          );
        }
      },
    });

    this.addSettingTab(new MediaVaultSettingTab(this.app, this));
  }

  private openAddMediaModal(): void {
    if (!this.storage.settings.get().tmdbApiKey) {
      new Notice(t("notice.addTmdbKeyBeforeSearching"));
      return;
    }
    new AddMediaModal(this.app, this.tmdb, this.storage, (media) => {
      this.refreshLibraryViews();
      if (this.storage.settings.get().autoCreateNotes && media) {
        void generateMediaNote(this.app, this.storage, media);
      }
    }).open();
  }

  async generateNoteFor(media: MediaItem): Promise<void> {
    try {
      const { notePath: path } = await generateMediaNote(
        this.app,
        this.storage,
        media,
      );
      new Notice(t("notice.noteUpdated", { path }));
    } catch (err) {
      new Notice(
        t("notice.noteGenerationFailed", { error: (err as Error).message }),
      );
    }
  }

  async regenerateAllNotes(): Promise<void> {
    const all = await this.storage.media.getAll();
    const lists = await this.storage.customLists.getAll();
    const total = all.length + lists.length;
    if (total === 0) return;

    const notice = new Notice(
      t("notice.regeneratingNotes", { count: total }),
      0,
    );

    const result =
      all.length > 0
        ? await generateNotesInBatches(
            this.app,
            this.storage,
            all,
            (done, doneTotal) => {
              notice.setMessage(
                t("notice.regeneratingNotesProgress", { done, total: doneTotal }),
              );
            },
          )
        : { succeeded: 0, failed: 0, total: 0 };

    let listsSucceeded = 0;
    if (lists.length > 0) {
      const listResult = await generateAllListNotes(
        this.app,
        this.storage,
        (done, doneTotal) => {
          notice.setMessage(t("notice.regeneratingListNotesProgress", { done, total: doneTotal }));
        },
      );
      listsSucceeded = listResult.succeeded;
    }

    notice.hide();
    new Notice(
      t("notice.regeneratedNotes", {
        count: result.succeeded + listsSucceeded,
        total,
      }),
    );
  }

  private async showSeriesCompletedNotice(
    sessionId: string,
    mediaId: string,
  ): Promise<void> {
    const media = await this.storage.media.findById(mediaId);
    if (!media) return;
    const notice = new Notice("", 8000);
    const el = notice.messageEl;
    el.empty();
    el.addClass("mediavault-series-completed-notice");
    setIcon(el.createSpan(), "pencil");
    el.createSpan({
      text: t("notice.seriesCompleted", { title: media.title }),
    });
    el.setAttr("role", "button");
    el.setAttr("tabindex", "0");
    const open = () => {
      notice.hide();
      void (async () => {
        const session = await this.storage.watchSessions.findById(sessionId);
        if (!session) return;
        new WatchSessionModal(this.app, this.storage, {
          mediaId,
          mediaTitle: media.title,
          existingSession: session,
          onSaved: () => {
            this.refreshLibraryViews();
            this.refreshListViews();
          },
        }).open();
      })();
    };
    el.addEventListener("click", open);
    el.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" || evt.key === " ") open();
    });
  }

  async refreshGeneratedNotes(): Promise<void> {
    if (this.storage.pipelineBusy) {
      this.scheduleTask(3000, () => void this.refreshGeneratedNotes());
      return;
    }
    const media = (await this.storage.media.getAll()).filter(
      (m) => !!m.notePath && this.app.vault.getAbstractFileByPath(m.notePath) instanceof TFile,
    );
    await mapWithConcurrency(media, 4, async (m) => {
      try {
        await generateMediaNote(this.app, this.storage, m, {
          respectNewerNote: true,
        });
      } catch (err) {
        console.warn(`MediaVault: could not refresh note for "${m.title}"`, err);
      }
    });
    const base = this.storage.settings.get().mediaFolderPath || "MediaVault";
    for (const list of await this.storage.customLists.getAll()) {
      const path = resolveListNotePath(base.replace(/\/+$/, ""), list);
      if (this.app.vault.getAbstractFileByPath(path) instanceof TFile) {
        try {
          await generateListNote(this.app, this.storage, list, path);
        } catch (err) {
          console.warn(`MediaVault: could not refresh list note "${list.title}"`, err);
        }
      }
    }
  }

  private async repairEpisodeLists(): Promise<void> {
    if (!this.storage.settings.get().tmdbApiKey) return;
    const release = await this.storage.acquirePipelineWhenFree();
    try {
      await this.repairEpisodeListsLocked();
    } finally {
      release();
    }
  }

  private async repairEpisodeListsLocked(): Promise<void> {
    if (this.unloaded) return;
    const shows = (await this.storage.media.getAll())
      .filter(
        (m) =>
          m.type === MediaType.TVShow &&
          !m.episodesLastSyncedAt &&
          m.status === MediaStatus.Watching,
      )
      .slice(0, 40);
    if (shows.length === 0) return;
    {
      const outcome = await trackOperation(
        "episode-repair",
        async () => {
          for (const show of shows) {
            if (this.unloaded) return;
            try {
              await importEpisodesForShow(this.storage, this.tmdb, show);
            } catch {
              continue;
            }
          }
        },
        { exclusive: true },
      );
      if (outcome.ran && !this.unloaded) {
        this.refreshLibraryViews();
        this.refreshListViews();
      }
    }
  }

  openSyncProgress(): void {
    if (this.syncProgressModal) return;
    if (syncStatus.state.stage === "idle") {
      new Notice(t("syncProgress.notRun"));
      return;
    }
    const modal = new SyncProgressModal(this.app, () => {
      void this.runManualNoteSync();
    });
    const originalOnClose = modal.onClose.bind(modal);
    modal.onClose = (): void => {
      originalOnClose();
      this.syncProgressModal = null;
    };
    this.syncProgressModal = modal;
    modal.open();
  }

  private setupSyncStatusBar(): void {
    const el = this.addStatusBarItem();
    el.addClass("mediavault-sync-status-item");
    el.setAttribute("aria-label", t("syncProgress.openProgress"));
    el.addClass("is-hidden");
    el.addEventListener("click", () => this.openSyncProgress());
    this.syncStatusBarEl = el;
    let hideHandle: number | null = null;
    const render = (state: SyncStatusState): void => {
      if (hideHandle !== null) {
        window.clearTimeout(hideHandle);
        hideHandle = null;
      }
      if (state.stage === "idle") {
        el.addClass("is-hidden");
        return;
      }
      el.removeClass("is-hidden");
      if (state.stage === "queued") {
        el.setText(t("syncProgress.statusQueued"));
      } else if (state.stage === "completed") {
        el.setText(t("syncProgress.statusDone"));
        hideHandle = window.setTimeout(() => {
          el.addClass("is-hidden");
        }, 6000);
      } else if (state.stage === "failed" || state.stage === "skipped") {
        el.setText(t("syncProgress.statusFailed"));
      } else {
        const percent =
          state.total && state.total > 0
            ? `${Math.min(99, Math.floor((state.done / state.total) * 100))}%`
            : "…";
        el.setText(t("syncProgress.statusRunning", { percent }));
      }
    };
    const unsubscribe = syncStatus.subscribe(render);
    this.register(() => {
      unsubscribe();
      if (hideHandle !== null) window.clearTimeout(hideHandle);
      el.remove();
      this.syncStatusBarEl = null;
    });
  }

  async runManualNoteSync(): Promise<void> {
    journalEvent("manual-sync-requested", {
      lockHeld: this.storage.pipelineBusy,
      startupSettled: this.startupSettled,
    });
    if (this.manualSyncInFlight) {
      this.openSyncProgress();
      return;
    }
    this.manualSyncInFlight = true;
    const backgroundActive = syncStatus.running;
    const queued = this.storage.pipelineBusy || this.folderSync.isRunning();
    if (!backgroundActive) syncStatus.begin(true, queued);
    this.openSyncProgress();
    let release: (() => void) | null = null;
    try {
      release = await this.storage.acquirePipelineWhenFree();
      if (this.unloaded) {
        syncStatus.skip("syncProgress.notRun");
        return;
      }
      if (backgroundActive) syncStatus.begin(true, false);
      const result = await this.folderSync.sync({
        reason: "manual",
        createMissingNotes: true,
        pipelineHeld: true,
      });
      if (result.status === "ok") this.diagnostics?.markSyncHealthy();
      this.reportSync(result, true);
    } catch (err) {
      console.error("MediaVault: sync failed", err);
      syncStatus.fail(
        "folderSync.syncFailed",
        err instanceof Error ? err.message.slice(0, 160) : null,
      );
      new Notice(t("folderSync.syncFailed"));
    } finally {
      release?.();
      this.manualSyncInFlight = false;
    }
  }

  private reportSync(result: SyncResult, verbose: boolean): void {
    if (result.status === "folderNotFound") {
      if (verbose) new Notice(t("folderSync.folderNotFound"));
      return;
    }
    if (result.status === "noFiles") {
      if (verbose) new Notice(t("folderSync.noFiles"));
      return;
    }
    if (result.status === "backupFailed") {
      new Notice(t("backup.failedAbort"));
      return;
    }
    if (result.status === "busy") {
      if (verbose) new Notice(t("folderSync.alreadyRunning"));
      return;
    }
    const changed =
      result.cacheUpdates > 0 ||
      result.folderUpdates > 0 ||
      result.artworkUpdates > 0;
    if (changed) {
      this.refreshLibraryViews();
      this.refreshListViews();
      this.refreshExploreViews();
    }
    if (verbose || changed || result.conflicts > 0) {
      new Notice(
        `${t("folderSync.syncComplete")}\n${t("folderSync.summary", {
          checked: result.itemsChecked,
          cache: result.cacheUpdates,
          folder: result.folderUpdates,
          artwork: result.artworkUpdates,
          conflicts: result.conflicts,
        })}`,
      );
    }
  }

  async runExportLibrary(): Promise<void> {
    const all = await this.storage.media.getAll();
    if (all.length === 0) {
      new Notice(t("notice.libraryEmpty"));
      return;
    }
    new ExportSelectionModal(this.app, all, (result) => {
      void this.runExportFor(result.items, result.categories);
    }).open();
  }

  async runExportFor(
    mediaItems: MediaItem[],
    categories?: ExportCategoryOptions,
  ): Promise<void> {
    if (mediaItems.length === 0) {
      new Notice(t("notice.libraryEmpty"));
      return;
    }
    const notice = new Notice(t("exportImport.exporting"), 0);
    try {
      const path = await exportMediaToVault(
        this.app,
        this.storage,
        mediaItems,
        (done, total) => {
          notice.setMessage(t("exportImport.exportingProgress", { done, total }));
        },
        categories,
      );
      notice.hide();
      new Notice(t("exportImport.exportComplete", { path }));
    } catch (err) {
      notice.hide();
      new Notice(
        t("exportImport.exportFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  private async openSelectMediaThen(
    callback: (media: MediaItem) => void,
    filter?: (media: MediaItem) => boolean,
  ): Promise<void> {
    const all = await this.storage.media.getAll();
    const candidates = filter ? all.filter(filter) : all;
    if (candidates.length === 0) {
      new Notice(
        filter ? t("notice.noMatchingTvShows") : t("notice.libraryEmpty"),
      );
      return;
    }
    new SelectMediaModal(this.app, candidates, callback).open();
  }

  openLogWatch(media: MediaItem): void {
    new WatchSessionModal(this.app, this.storage, {
      mediaId: media.id,
      mediaTitle: media.title,
      onSaved: () => {
        this.refreshLibraryViews();
        this.refreshListViews();
      },
    }).open();
  }

  openMediaDetail(
    media: MediaItem,
    episode?: Episode,
    listContext?: { listId: string; listTitle: string; onRemoved?: () => void },
    onClosed?: () => void,
  ): void {
    const modal = new MediaDetailModal(
      this.app,
      this.storage,
      this.tmdb,
      media,
      () => {
        this.refreshLibraryViews();
        this.refreshListViews();
      },
      this,
      "episodes",
      this.trakt,
      episode,
      false,
      null,
      listContext,
    );
    modal.onClosedHook = onClosed;
    modal.open();
  }

  openEpisodeTracker(media: MediaItem): void {
    new MediaDetailModal(
      this.app,
      this.storage,
      this.tmdb,
      media,
      () => {
        this.refreshLibraryViews();
        this.refreshListViews();
      },
      this,
      "episodes",
      this.trakt,
    ).open();
  }

  async setLanguage(language: Locale): Promise<void> {
    await this.storage.settings.update({ language });
    i18n.setLocale(language);
  }

  private onLocaleChanged(): void {
    this.tmdb.clearCache();
    this.refreshLibraryViews();
    this.refreshListViews();
    this.refreshExploreViews();
    this.refreshCommandNames();
    this.localeAwareModals.forEach((modal) => modal.rerenderForLocaleChange());
  }

  private refreshCommandNames(): void {
    const appWithCommands = this.app as unknown as {
      commands?: { commands?: Record<string, { name: string }> };
    };
    const registry = appWithCommands.commands?.commands;
    if (!registry) return;
    for (const [id, nameKey] of Object.entries(COMMAND_NAME_KEYS)) {
      const command = registry[`${this.manifest.id}:${id}`];
      if (command) command.name = t(nameKey);
    }
  }

  registerLocaleAwareModal(modal: {
    rerenderForLocaleChange: () => void;
  }): void {
    this.localeAwareModals.add(modal);
  }

  unregisterLocaleAwareModal(modal: {
    rerenderForLocaleChange: () => void;
  }): void {
    this.localeAwareModals.delete(modal);
  }

  refreshLibraryViews(options?: { skipWatchNext?: boolean }): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_LIBRARY).forEach((leaf) => {
      const view = leaf.view;
      if (view instanceof LibraryView) {
        void view.refresh();
      }
    });
    this.app.workspace.getLeavesOfType(VIEW_TYPE_ANALYTICS).forEach((leaf) => {
      const view = leaf.view;
      if (view instanceof AnalyticsView) {
        void view.refresh();
      }
    });
    if (!options?.skipWatchNext) {
      this.app.workspace
        .getLeavesOfType(VIEW_TYPE_WATCH_NEXT)
        .forEach((leaf) => {
          const view = leaf.view;
          if (view instanceof WatchNextView) {
            void view.refresh();
          }
        });
    }
  }

  private listDetailModals = new Set<{ refreshInPlace: () => void }>();

  registerListDetailModal(modal: { refreshInPlace: () => void }): void {
    this.listDetailModals.add(modal);
  }

  unregisterListDetailModal(modal: { refreshInPlace: () => void }): void {
    this.listDetailModals.delete(modal);
  }

  refreshListViews(): void {
    this.listDetailModals.forEach((modal) => modal.refreshInPlace());
    this.app.workspace.getLeavesOfType(VIEW_TYPE_LISTS).forEach((leaf) => {
      const view = leaf.view;
      if (view instanceof ListsView) {
        void view.refresh();
      }
    });
  }

  refreshExploreViews(): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_EXPLORE).forEach((leaf) => {
      const view = leaf.view;
      if (view instanceof ExploreView) {
        void view.refresh();
      }
    });
  }

  async activateAnalyticsView(): Promise<void> {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_ANALYTICS);

    if (existing.length > 0) {
      leaf = existing[0];
      const view = leaf.view;
      if (view instanceof AnalyticsView) void view.refresh();
    } else {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_ANALYTICS, active: true });
    }

    await workspace.revealLeaf(leaf);
  }

  async activateLibraryView(): Promise<void> {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_LIBRARY);

    if (existing.length > 0) {
      leaf = existing[0];
    } else {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_LIBRARY, active: true });
    }

    await workspace.revealLeaf(leaf);
  }

  async activateListsView(): Promise<void> {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_LISTS);

    if (existing.length > 0) {
      leaf = existing[0];
      const view = leaf.view;
      if (view instanceof ListsView) void view.refresh();
    } else {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_LISTS, active: true });
    }

    await workspace.revealLeaf(leaf);
  }

  async activateWatchNextView(): Promise<void> {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_WATCH_NEXT);

    if (existing.length > 0) {
      leaf = existing[0];
      const view = leaf.view;
      if (view instanceof WatchNextView) void view.refresh();
    } else {
      leaf = workspace.getRightLeaf(false);
      if (leaf)
        await leaf.setViewState({ type: VIEW_TYPE_WATCH_NEXT, active: true });
    }

    if (leaf) await workspace.revealLeaf(leaf);
  }

  async activateExploreView(): Promise<void> {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_EXPLORE);

    if (existing.length > 0) {
      leaf = existing[0];
      const view = leaf.view;
      if (view instanceof ExploreView) void view.refresh();
    } else {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_EXPLORE, active: true });
    }

    await workspace.revealLeaf(leaf);
  }

  async runTraktSync(opts: { auto?: boolean } = {}): Promise<void> {
    const settings = this.storage.settings.get();
    if (!settings.traktClientId || !settings.traktAccessToken) {
      if (!opts.auto) new Notice(t("notice.connectTraktFirst"));
      return;
    }
    if (this.unloaded) return;
    if (this.storage.pipelineBusy && !opts.auto) {
      new Notice(t("backup.syncBusy"));
      return;
    }

    const release = await this.storage.acquirePipelineWhenFree();
    try {
      if (this.unloaded) return;
      const outcome = await trackOperation(
        "trakt-sync",
        () => this.runTraktSyncBody(),
        { exclusive: true },
      );
      if (!outcome.ran && !opts.auto) new Notice(t("backup.syncBusy"));
    } finally {
      release();
    }
  }

  private async runTraktSyncBody(): Promise<void> {
    new Notice(t("notice.syncingWithTrakt"));
    try {
      const token = await ensureValidTraktToken(this.storage);
      if (!token) {
        new Notice(t("notice.traktConnectionInvalid"));
        return;
      }

      const pullResult = await pullFromTrakt(
        this.storage,
        this.tmdb,
        this.trakt,
      );
      const pushResult = await pushToTrakt(this.storage, this.trakt);

      await generateTraktHistoryNote(
        this.app,
        this.storage,
        this.storage.settings.get().traktHistoryNotePath,
      );

      this.refreshLibraryViews();

      const errorCount = pullResult.errors.length + pushResult.errors.length;
      new Notice(
        t("notice.traktSyncComplete", {
          movies: pullResult.moviesAdded,
          episodes: pullResult.episodesMarked,
          pushed: pushResult.pushed,
          errorSuffix:
            errorCount > 0
              ? t("notice.traktSyncErrorSuffix", { count: errorCount })
              : ".",
        }),
      );
      if (errorCount > 0) {
        console.warn("MediaVault Trakt sync errors:", [
          ...pullResult.errors,
          ...pushResult.errors,
        ]);
      }
    } catch (err) {
      new Notice(
        t("notice.traktSyncFailed", { error: (err as Error).message }),
      );
    }
  }

  private setupInputKeyboardUX(): void {
    const isOurs = (el: Element): boolean =>
      !!el.closest('[class*="mediavault-"]');

    this.registerDomEvent(document, "focusin", (evt) => {
      const target = evt.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!isOurs(target)) return;
      const textLike = ["text", "search", "number", "email", "url", "tel"];
      if (
        textLike.includes(target.type) &&
        !target.hasAttribute("enterkeyhint")
      ) {
        target.setAttribute("enterkeyhint", "done");
      }
    });

    this.registerDomEvent(document, "keydown", (evt) => {
      if (evt.key !== "Enter") return;
      const target = evt.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!isOurs(target)) return;
      target.blur();
    });
  }

  private setupTraktAutoSync(): void {
    const settings = this.storage.settings.get();
    if (!settings.traktAccessToken) return;

    if (settings.traktAutoSync === "interval") {
      const ms = Math.max(5, settings.traktSyncIntervalMinutes) * 60 * 1000;
      this.syncIntervalHandle = window.setInterval(() => {
        if (this.unloaded || !this.startupSettled) return;
        void this.runTraktSync({ auto: true });
      }, ms);
      this.registerInterval(this.syncIntervalHandle);
    }
  }

  private async ensureNotificationActivationDate(): Promise<void> {
    const settings = this.storage.settings.get();
    if (settings.notificationPluginActivationDate) return;

    const today = new Date().toISOString().slice(0, 10);
    await this.storage.settings.update({
      notificationPluginActivationDate: today,
    });
  }

  private setupNoteSyncSchedule(): void {
    this.noteSyncIntervalHandle = window.setInterval(
      () => {
        if (this.unloaded || !this.startupSettled) return;
        if (!this.isAutoNoteSyncEnabled()) return;
        void this.noteSync.checkAndSyncIfNeeded();
      },
      60 * 60 * 1000,
    );
    this.registerInterval(this.noteSyncIntervalHandle);

    this.setupNoteReconcileWatcher();
  }

  private mediaUpdateEvents = 0;
  private editSyncSeq = 0;
  private editSyncPending = false;
  private editSyncWaiting = false;

  private requestEditSync(): void {
    if (this.unloaded) return;
    if (!this.isAutoNoteSyncEnabled()) return;
    journalEvent("edit-sync-requested", {
      seq: ++this.editSyncSeq,
      updateEvents: this.mediaUpdateEvents,
      startupSettled: this.startupSettled,
      pipelineBusy: this.storage.pipelineBusy,
    });
    this.mediaUpdateEvents = 0;
    if (!this.startupSettled) {
      this.editSyncPending = true;
      return;
    }
    if (this.storage.pipelineBusy || this.noteSync.isRunning()) {
      if (this.editSyncWaiting) return;
      this.editSyncWaiting = true;
      void this.storage
        .acquirePipelineWhenFree()
        .then((release) => {
          release();
        })
        .catch(() => undefined)
        .finally(() => {
          this.editSyncWaiting = false;
          if (!this.unloaded) this.requestEditSync();
        });
      return;
    }
    void this.noteSync.checkAndSyncIfNeeded().catch((err) => {
      console.warn(
        "MediaVault: edit-triggered sync failed",
        err instanceof Error ? err.message : "unknown error",
      );
    });
  }

  private scheduleStartupSequence(): void {
    this.app.workspace.onLayoutReady(() => {
      this.scheduleTask(STARTUP_DELAY_MS, () => {
        void this.runStartupSequence();
      });
    });
  }

  private async runStartupSequence(): Promise<void> {
    const steps: [string, () => Promise<void>][] = [
      [
        "folder-sync",
        async () => {
          if (!this.isAutoNoteSyncEnabled()) return;
          if (this.diagnostics?.startupSyncSuppressed) {
            journalEvent("startup-sync-deferred");
            new Notice(t("backup.startupSyncDeferred"), 12000);
            return;
          }
          const result = await this.folderSync.sync({ reason: "startup" });
          if (result.status === "ok") this.diagnostics?.markSyncHealthy();
          this.reportSync(result, false);
        },
      ],
      ["episode-repair", () => this.repairEpisodeLists()],
      [
        "notifications",
        async () => {
          if (shouldRunDailyCheck(this.storage.settings.get())) {
            await this.runNotificationCheckNow();
          }
        },
      ],
      [
        "trakt-sync",
        async () => {
          const settings = this.storage.settings.get();
          if (
            settings.traktAccessToken &&
            settings.traktAutoSync === "on_startup"
          ) {
            await this.runTraktSync({ auto: true });
          }
        },
      ],
      [
        "note-sync",
        async () => {
          if (!this.isAutoNoteSyncEnabled()) return;
          if (this.diagnostics?.startupSyncSuppressed) return;
          await this.noteSync.checkOnStartup();
        },
      ],
    ];

    try {
      for (const [name, step] of steps) {
        if (this.unloaded) return;
        try {
          await step();
        } catch (err) {
          console.warn(
            `MediaVault: startup step "${name}" failed`,
            err instanceof Error ? err.message : "unknown error",
          );
        }
        if (name === "folder-sync") this.startupSettled = true;
      }
    } finally {
      this.startupSettled = true;
      if (this.editSyncPending) {
        this.editSyncPending = false;
        this.requestEditSync();
      }
    }
  }

  private isAutoNoteSyncEnabled(): boolean {
    return this.storage.settings.get().autoSyncNotes;
  }

  private setupNoteReconcileWatcher(): void {
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (this.unloaded || !this.startupSettled) return;
        if (!(file instanceof TFile) || file.extension !== "md") return;
        if (!this.isAutoNoteSyncEnabled()) return;
        this.folderSync.queuePath(file.path);
      }),
    );
  }

  private setupNotificationSchedule(): void {
    this.notificationCheckIntervalHandle = window.setInterval(() => {
      if (this.unloaded || !this.startupSettled) return;
      if (shouldRunDailyCheck(this.storage.settings.get())) {
        void this.runNotificationCheckNow();
      }
    }, 60 * 60 * 1000);
    this.registerInterval(this.notificationCheckIntervalHandle);
  }

  private notificationCheckInFlight: Promise<"completed" | "failed" | "skipped"> | null =
    null;

  runNotificationCheckNow(): Promise<"completed" | "failed" | "skipped"> {
    if (this.notificationCheckInFlight) return this.notificationCheckInFlight;
    const run = this.executeNotificationCheck().finally(() => {
      this.notificationCheckInFlight = null;
    });
    this.notificationCheckInFlight = run;
    return run;
  }

  private async executeNotificationCheck(): Promise<
    "completed" | "failed" | "skipped"
  > {
    if (!this.storage.settings.get().tmdbApiKey) return "skipped";
    if (this.unloaded) return "skipped";

    journalEvent("notification-check-requested", {
      queued: this.storage.pipelineBusy,
    });
    const release = await this.storage.acquirePipelineWhenFree();
    try {
      if (this.unloaded) return "skipped";
      const settings = this.storage.settings.get();
      let fired: Awaited<ReturnType<typeof runNotificationCheck>> = [];
      let failed = false;
      const outcome = await trackOperation(
        "notification-check",
        async () => {
          try {
            fired = await runNotificationCheck(this.storage, this.tmdb, settings);
          } catch (err) {
            failed = true;
            console.error(
              "MediaVault: notification check failed",
              err instanceof Error ? err.message : "unknown error",
            );
            return;
          }
          await this.storage.settings.update({
            notificationLastCheckedDate: new Date().toISOString().slice(0, 10),
          });
        },
        { exclusive: true },
      );
      if (!outcome.ran) return "skipped";
      if (failed) return "failed";
      if (!this.unloaded) {
        if (!settings.notificationSilent) this.showNotificationToasts(fired);
        if (fired.length > 0) this.refreshLibraryViews();
      }
      return "completed";
    } finally {
      release();
    }
  }

  private showNotificationToasts(
    fired: Awaited<ReturnType<typeof runNotificationCheck>>,
  ): void {
    if (fired.length === 0) return;

    if (fired.length === 1) {
      new Notice(`MediaVault: ${fired[0].message}`);
      return;
    }

    const fragment = createFragment((el) => {
      el.createDiv({ text: `MediaVault: ${fired[0].message}` });
      const goToBtn = el.createEl("button", {
        cls: "mediavault-notification-toast-action",
        text: t("notifications.goToNotifications", {
          count: fired.length - 1,
        }),
      });
      goToBtn.addEventListener("click", () => {
        notice.hide();
        new NotificationHistoryModal(this.app, this).open();
      });
    });
    const notice = new Notice(fragment, 0);
  }

  onunload() {
    journalEvent("plugin-unload");
    void this.diagnostics?.flush();
    setJournal(null);
    this.unloaded = true;
    this.scheduledTimers.forEach((handle) => window.clearTimeout(handle));
    this.scheduledTimers.clear();
    if (this.mediaChangeDebounceHandle !== null) {
      window.clearTimeout(this.mediaChangeDebounceHandle);
      this.mediaChangeDebounceHandle = null;
    }
    if (this.storage) this.storage.media.onUpdated = undefined;
    this.noteSync?.dispose();
    this.folderSync?.dispose();
    this.backup?.dispose();
    this.unsubscribeLocaleChange?.();
    teardownAndroidSafeArea();
    if (this.storage) {
      void this.storage.shutdown().catch((err) => {
        console.error(
          "MediaVault: could not save data on unload",
          err instanceof Error ? err.message : "unknown error",
        );
      });
    }
  }

  async saveSettings(patch?: Partial<MediaVaultSettings>): Promise<void> {
    if (patch) {
      await this.storage.settings.update(patch);
      if ("tmdbApiKey" in patch) {
        this.tmdb.clearCache();
      }
    } else {
      await this.storage.flush();
    }
  }

  async performFactoryReset(): Promise<void> {
    await this.storage.factoryReset();
    this.tmdb.clearCache();
    this.trakt.clearCache();

    new Notice(t("factoryReset.success"));

    const pluginId = this.manifest.id;
    const pluginsApi = (
      this.app as unknown as {
        plugins: {
          disablePlugin(id: string): Promise<void>;
          enablePlugin(id: string): Promise<void>;
        };
      }
    ).plugins;

    try {
      await pluginsApi.disablePlugin(pluginId);
      await pluginsApi.enablePlugin(pluginId);
    } catch (err) {
      console.error(
        "MediaVault: couldn't auto-reload after factory reset. A manual reload is needed to fully re-initialize.",
        err,
      );
      new Notice(t("factoryReset.reloadHint"));
    }
  }
}
