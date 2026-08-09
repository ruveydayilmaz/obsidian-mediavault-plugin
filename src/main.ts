import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
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
import { TMDBService, tmdbLanguageFor } from "./api/tmdb";
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
import { ensureValidTraktToken } from "./services/trakt-token";
import { pullFromTrakt, pushToTrakt } from "./services/trakt-sync";
import { generateTraktHistoryNote } from "./services/trakt-note-generator";
import { generateMediaNote } from "./services/note-generator/media-note-generator";
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
  setupAndroidSafeArea,
  teardownAndroidSafeArea,
} from "./utils/platform";
import { i18n, t } from "./i18n";

export default class MediaVaultPlugin extends Plugin {
  storage!: StorageService;
  tmdb!: TMDBService;
  trakt!: TraktService;
  statistics!: StatisticsService;
  private syncIntervalHandle: number | null = null;
  private notificationCheckIntervalHandle: number | null = null;
  private unsubscribeLocaleChange: (() => void) | null = null;
  private localeAwareModals: Set<{ rerenderForLocaleChange: () => void }> =
    new Set();

  async onload() {
    applyAndroidBodyClass();
    setupAndroidSafeArea(this.app);

    this.storage = new StorageService(this);
    await this.storage.initialize();
    i18n.setLocale(this.storage.settings.get().language);
    this.unsubscribeLocaleChange = i18n.onChange(() => this.onLocaleChanged());
    this.statistics = new StatisticsService(this.storage);
    await seedBuiltInPresets(this.storage);
    await this.ensureNotificationActivationDate();

    this.tmdb = new TMDBService({
      getApiKey: () => this.storage.settings.get().tmdbApiKey,
      getCacheDurationMinutes: () =>
        this.storage.settings.get().cacheDurationMinutes,
      getShowAdultContent: () => this.storage.settings.get().showAdultContent,
      getLanguage: () => tmdbLanguageFor(this.storage.settings.get().language),
    });

    this.trakt = new TraktService({
      getClientId: () => this.storage.settings.get().traktClientId,
      getClientSecret: () => this.storage.settings.get().traktClientSecret,
      getAccessToken: () => this.storage.settings.get().traktAccessToken,
    });

    this.setupTraktAutoSync();
    this.setupNotificationSchedule();
    this.setupInputKeyboardUX();

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
        new AnalyticsSummaryModal(this.app, this.storage).open();
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
      const path = await generateMediaNote(this.app, this.storage, media);
      new Notice(t("notice.noteUpdated", { path }));
    } catch (err) {
      new Notice(
        t("notice.noteGenerationFailed", { error: (err as Error).message }),
      );
    }
  }

  async regenerateAllNotes(): Promise<void> {
    const all = await this.storage.media.getAll();
    new Notice(t("notice.regeneratingNotes", { count: all.length }));
    let count = 0;
    for (const media of all) {
      try {
        await generateMediaNote(this.app, this.storage, media);
        count++;
      } catch (err) {
        console.warn(
          `MediaVault: failed to generate note for "${media.title}"`,
          err,
        );
      }
    }
    new Notice(t("notice.regeneratedNotes", { count, total: all.length }));
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
  ): void {
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
      episode,
      false,
      null,
      listContext,
    ).open();
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

  async setLanguage(language: "en" | "tr"): Promise<void> {
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

  refreshListViews(): void {
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

  async runTraktSync(): Promise<void> {
    const settings = this.storage.settings.get();
    if (!settings.traktClientId || !settings.traktAccessToken) {
      new Notice(t("notice.connectTraktFirst"));
      return;
    }

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

    if (settings.traktAutoSync === "on_startup") {
      window.setTimeout(() => void this.runTraktSync(), 3000);
    } else if (settings.traktAutoSync === "interval") {
      const ms = Math.max(5, settings.traktSyncIntervalMinutes) * 60 * 1000;
      this.syncIntervalHandle = window.setInterval(
        () => void this.runTraktSync(),
        ms,
      );
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

  private setupNotificationSchedule(): void {
    const tryRun = () => {
      if (shouldRunDailyCheck(this.storage.settings.get())) {
        void this.runNotificationCheckNow();
      }
    };

    window.setTimeout(tryRun, 5000);

    this.notificationCheckIntervalHandle = window.setInterval(
      tryRun,
      60 * 60 * 1000,
    );
    this.registerInterval(this.notificationCheckIntervalHandle);
  }

  async runNotificationCheckNow(): Promise<void> {
    if (!this.storage.settings.get().tmdbApiKey) return;

    const settings = this.storage.settings.get();
    let fired: Awaited<ReturnType<typeof runNotificationCheck>> = [];
    try {
      fired = await runNotificationCheck(this.storage, this.tmdb, settings);
    } catch (err) {
      console.error("MediaVault: notification check failed", err);
    }

    await this.storage.settings.update({
      notificationLastCheckedDate: new Date().toISOString().slice(0, 10),
    });

    if (!settings.notificationSilent) {
      fired.forEach((n) => new Notice(`MediaVault: ${n.message}`));
    }
    if (fired.length > 0) {
      this.refreshLibraryViews();
    }
  }

  onunload() {
    this.unsubscribeLocaleChange?.();
    teardownAndroidSafeArea();
    void this.storage.flush();
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
