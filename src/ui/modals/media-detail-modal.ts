import { App, Modal, Notice, Menu, setIcon, TFile } from "obsidian";
import { renderMobileBackButton } from "./modal-chrome";
import { confirmDialog } from "./confirm-modal";
import type { StorageService } from "../../services/storage";
import type { TMDBService } from "../../api/tmdb";
import type {
  TraktService,
  TraktComment,
  TraktCommentTarget,
} from "../../api/trakt";
import { describeTraktError } from "../../api/trakt";
import { ensureValidTraktToken } from "../../services/trakt-token";
import type MediaVaultPlugin from "../../main";
import { MediaItem } from "../../models/media";
import { MediaType, MediaStatus } from "../../types/enums";
import { RatingEvolutionPoint, WatchSession } from "../../models/review";
import { Episode, EpisodeProgress, EpisodeWatch } from "../../models/episode";
import {
  sortSessionsChronological,
  getRatingEvolution,
} from "../../services/review-logic";
import { deleteWatchSession } from "../../services/watch-session-service";
import {
  deleteMedia,
  describeDeletionScope,
} from "../../services/media-delete-service";
import {
  markEpisodeWatched,
  markSeasonWatched,
  findUnwatchedPrecedingEpisodes,
  removeOneEpisodeWatch,
  addSeasonRewatch,
  removeOneSeasonWatch,
} from "../../services/episode-status-sync";
import {
  addEpisodeWatch,
  updateEpisodeWatch,
  deleteEpisodeWatch,
  sortEpisodeWatchesChronological,
} from "../../services/episode-watch-service";
import { filterAndSortCommentsByLanguage } from "../../services/comment-localization";
import {
  importEpisodesForShow,
  needsEpisodeSync,
} from "../../services/episode-import";
import { renderRatingEvolutionChart } from "../components/rating-chart";
import { renderExpandableText } from "../components/expandable-text";
import {
  statusLabel,
  formatRating,
  progressFillClasses,
} from "../components/media-render";
import { tmdbImageUrl } from "../../api/tmdb-normalize";
import { WatchSessionModal } from "./watch-session-modal";
import { generateMediaNote } from "../../services/note-generator/media-note-generator";
import { ComfortProfileModal } from "./comfort-profile-modal";
import { AddToListModal } from "./add-to-list-modal";
import { ImagePickerModal } from "./image-picker-modal";
import { MoviePartialWatchModal } from "./movie-progress-modal";
import {
  completeMovieFromProgress,
  resumeMovie,
} from "../../services/movie-progress-service";
import { ActorDetailsModal } from "./actor-details-modal";
import { addMediaFromTMDB } from "../../services/media-import";
import { resumeSeries } from "../../services/drop-series-service";
import { DropSeriesModal } from "./drop-series-modal";
import { addDestructiveMenuItem } from "../components/destructive-menu-item";
import { makeClearable } from "../components/clearable-input";
import { t } from "../../i18n";
import { getLocalizedGenreNames } from "../../services/genre-labels";

type DetailTab =
  | "history"
  | "episodes"
  | "comments"
  | "cast"
  | "episode-detail";

function formatEpisodeRuntime(minutes: number | null): string {
  if (!minutes) return "—";
  return `${minutes}m`;
}

export class MediaDetailModal extends Modal {
  private storage: StorageService;
  private tmdb: TMDBService;
  private trakt?: TraktService;
  private media: MediaItem;
  private onChanged?: () => void;

  private plugin?: MediaVaultPlugin;

  private isPreview: boolean;
  private previewTmdbRating: number | null = null;
  private pendingHighlightCommentId: number | null = null;
  private listContext?: {
    listId: string;
    listTitle: string;
    onRemoved?: () => void;
  };

  private activeTab: DetailTab = "episodes";
  private expandedSeasons = new Set<number>();
  private descriptionExpanded = false;
  private heroImgEl: HTMLImageElement | null = null;
  private heroImgUrl: string | null = null;
  private selectedEpisode: Episode | null = null;
  private tabBeforeEpisodeDetail: DetailTab = "episodes";
  private episodesScrollTop = 0;
  private TRAKT_COMMENT_LIMIT = 2000;

  constructor(
    app: App,
    storage: StorageService,
    tmdb: TMDBService,
    media: MediaItem,
    onChanged?: () => void,
    plugin?: MediaVaultPlugin,
    initialTab: DetailTab = "episodes",
    trakt?: TraktService,
    initialEpisode?: Episode,
    isPreview = false,
    previewTmdbRating: number | null = null,
    listContext?: { listId: string; listTitle: string; onRemoved?: () => void },
  ) {
    super(app);
    this.storage = storage;
    this.tmdb = tmdb;
    this.trakt = trakt;
    this.media = media;
    this.onChanged = onChanged;
    this.plugin = plugin;
    this.isPreview = isPreview;
    this.previewTmdbRating = previewTmdbRating;
    this.listContext = listContext;
    if (media.type === MediaType.TVShow && initialEpisode) {
      this.selectedEpisode = initialEpisode;
      this.activeTab = "episode-detail";
    } else if (media.type === MediaType.TVShow) {
      this.activeTab = isPreview ? "cast" : initialTab;
    } else {
      this.activeTab =
        initialTab === "episodes" || initialTab === "episode-detail"
          ? isPreview
            ? "cast"
            : "history"
          : initialTab;
    }
  }

  onOpen(): void {
    this.modalEl.addClass("mediavault-detail-modal");
    this.plugin?.registerLocaleAwareModal(this);
    this.attachDismissKeyboardOnOutsideTap();
    void this.initialize();
  }

  private attachDismissKeyboardOnOutsideTap(): void {
    this.contentEl.addEventListener("pointerdown", (evt) => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return;
      if (active.tagName !== "TEXTAREA" && active.tagName !== "INPUT") return;
      if (evt.target instanceof Node && active.contains(evt.target)) return;
      active.blur();
    });
  }

  private async initialize(): Promise<void> {
    await this.render();
    if (this.media.type === MediaType.TVShow && !this.isPreview) {
      void this.maybeAutoSyncEpisodes();
    }
  }

  private async maybeAutoSyncEpisodes(): Promise<void> {
    const episodes = await this.storage.episodes.findByMediaId(this.media.id);
    const intervalHours = this.storage.settings.get().episodeSyncIntervalHours;

    if (!needsEpisodeSync(this.media, episodes.length > 0, intervalHours))
      return;

    try {
      await importEpisodesForShow(this.storage, this.tmdb, this.media);
      const refreshed = await this.storage.media.findById(this.media.id);
      if (refreshed) this.media = refreshed;
      this.onChanged?.();

      if (this.activeTab === "episodes") {
        await this.refreshEpisodesTabContent();
      }
    } catch {
      // The user can manually refresh episodes from the hero menu if they want to retry
    }
  }

  private async refreshEpisodesTabContent(): Promise<void> {
    const container = this.contentEl.querySelector<HTMLElement>(
      ".mediavault-detail-episodes-tab-content",
    );
    if (!container) {
      await this.rerenderPreservingEpisodesScroll();
      return;
    }

    const scrollTop = this.contentEl.scrollTop;
    container.empty();
    await this.renderEpisodesTab(container);
    if (scrollTop > 0) {
      window.requestAnimationFrame(() => {
        this.contentEl.scrollTop = scrollTop;
      });
    }
  }

  private async render(): Promise<void> {
    const { contentEl } = this;

    const fresh = await this.storage.media.findById(this.media.id);
    if (fresh) this.media = fresh;

    const localizedGenres = this.isPreview
      ? this.media.genres
      : await getLocalizedGenreNames(this.tmdb, this.media);

    contentEl.empty();
    contentEl.addClass("mediavault-detail-modal");
    renderMobileBackButton(this, contentEl, () => this.handleBack());

    if (this.activeTab === "episode-detail" && this.selectedEpisode) {
      await this.renderEpisodeDetailTab(contentEl, this.selectedEpisode);
      return;
    }

    await this.renderHeader(contentEl, localizedGenres);

    this.renderTabBar(contentEl);

    if (this.activeTab === "episodes" && this.media.type === MediaType.TVShow) {
      const episodesContainer = contentEl.createDiv({
        cls: "mediavault-detail-episodes-tab-content",
      });
      await this.renderEpisodesTab(episodesContainer);
      if (this.episodesScrollTop > 0) {
        const restoreTarget = this.episodesScrollTop;
        this.episodesScrollTop = 0;
        window.requestAnimationFrame(() => {
          contentEl.scrollTop = restoreTarget;
        });
      }
    } else if (this.activeTab === "comments") {
      await this.renderCommentsTab(contentEl);
    } else if (this.activeTab === "cast") {
      await this.renderCastTab(contentEl);
    } else {
      await this.renderWatchHistoryTab(contentEl);
    }
  }

  private async rerenderPreservingEpisodesScroll(): Promise<void> {
    if (this.activeTab === "episodes") {
      this.episodesScrollTop = this.contentEl.scrollTop;
    }
    await this.render();
  }

  private handleBack(): void {
    if (this.activeTab === "episode-detail") {
      this.activeTab = this.tabBeforeEpisodeDetail;
      this.selectedEpisode = null;
      void this.render();
      return;
    }
    this.close();
  }

  private async renderHeader(
    contentEl: HTMLElement,
    localizedGenres: string[],
  ): Promise<void> {
    await this.renderHero(contentEl, localizedGenres);

    const body = contentEl.createDiv({ cls: "mediavault-detail-body" });

    const detail = body.createDiv({
      cls: "mediavault-detail-status",
      text: statusLabel(this.media.status),
    });

    if (this.isPreview) {
      if (this.previewTmdbRating !== null) {
        detail.createDiv({
          cls: "mediavault-detail-rating",
          text: t("detail.tmdbRatingLabel", {
            rating: formatRating(this.previewTmdbRating),
          }),
        });
      }
    } else if (this.media.averageRating !== null) {
      detail.createDiv({
        cls: "mediavault-detail-rating",
        text: t("detail.averageRatingAcrossWatches", {
          rating: formatRating(this.media.averageRating),
          count: this.media.watchCount,
          plural: this.media.watchCount === 1 ? "" : "es",
        }),
      });
    }
    if (this.media.synopsis) {
      this.renderDescription(body, this.media.synopsis);
    }
  }

  private async renderHero(
    contentEl: HTMLElement,
    localizedGenres: string[],
  ): Promise<void> {
    const hero = contentEl.createDiv({ cls: "mediavault-detail-hero" });

    const bannerUrl = tmdbImageUrl(
      this.media.backdropPath ?? this.media.posterPath,
      "original",
    );
    if (bannerUrl) {
      if (this.heroImgEl && this.heroImgUrl === bannerUrl) {
        hero.appendChild(this.heroImgEl);
      } else {
        const img = hero.createEl("img", {
          cls: "mediavault-detail-banner-img",
          attr: { src: bannerUrl, alt: "" },
        });
        this.heroImgEl = img;
        this.heroImgUrl = bannerUrl;
      }
    } else {
      this.heroImgEl = null;
      this.heroImgUrl = null;
    }
    hero.createDiv({ cls: "mediavault-detail-banner-overlay" });

    const menuBtn = contentEl.createEl("button", {
      cls: "clickable-icon mediavault-detail-menu-btn",
    });
    setIcon(menuBtn, "more-vertical");
    menuBtn.setAttr("aria-label", t("detail.moreOptions"));
    if (this.isPreview) {
      menuBtn.addClass("is-hidden");
    } else {
      menuBtn.addEventListener("click", (evt) => this.openHeroMenu(evt));
    }

    const heroContent = hero.createDiv({
      cls: "mediavault-detail-hero-content",
    });
    const left = heroContent.createDiv({ cls: "mediavault-detail-hero-main" });
    const titleRow = left.createDiv({ cls: "mediavault-detail-title-row" });

    titleRow.createEl("h2", { text: this.media.title });
    if (!this.isPreview) {
      this.renderFavoriteButton(
        titleRow,
        this.media.isFavorite,
        t("detail.toggleFavorite"),
        async () => {
          const updated = await this.storage.media.update(this.media.id, {
            isFavorite: !this.media.isFavorite,
          });
          if (updated) this.media = updated;
          this.onChanged?.();
        },
      );
    }
    left.createDiv({
      cls: "mediavault-detail-meta",
      text: [this.media.year, localizedGenres.join(", ")]
        .filter(Boolean)
        .join(" · "),
    });

    if (this.isPreview) {
      await this.renderAddToLibraryAction(heroContent);
    } else if (MediaType.Movie === this.media.type) {
      const logBtn = heroContent.createEl("button", {
        cls: "mediavault-detail-log-btn mod-cta",
        attr: {
          "aria-label": t("watchSession.logWatch"),
        },
      });
      setIcon(logBtn, "plus-circle");

      logBtn.addEventListener("click", () => {
        new WatchSessionModal(this.app, this.storage, {
          mediaId: this.media.id,
          mediaTitle: this.media.title,
          onSaved: () => void this.refreshAndNotify(),
        }).open();
      });
    }

    if (this.isPreview) return;

    if (this.media.type === MediaType.TVShow) {
      const episodes = await this.storage.episodes.findByMediaId(this.media.id);
      const progress = await this.storage.episodeProgress.getShowProgress(
        this.media.id,
        episodes,
      );
      this.renderProgressBar(hero, progress.percentWatched, true);
    } else {
      await this.renderMoviePartialProgress(hero);
    }
  }

  private renderFavoriteButton(
    container: HTMLElement,
    isFavorite: boolean,
    ariaLabel: string,
    onToggle: () => Promise<void>,
  ): HTMLButtonElement {
    const btn = container.createEl("button", {
      cls: `clickable-icon mediavault-fav-btn ${isFavorite ? "is-favorite" : ""}`,
    });
    setIcon(btn, "star");
    btn.setAttr("aria-label", ariaLabel);

    btn.addEventListener("click", (evt) => {
      evt.stopPropagation();

      const nowFavorite = !btn.hasClass("is-favorite");
      btn.toggleClass("is-favorite", nowFavorite);
      btn.disabled = true;

      void (async () => {
        try {
          await onToggle();
        } finally {
          btn.disabled = false;
        }
      })();
    });
    return btn;
  }

  private async renderAddToLibraryAction(
    heroContent: HTMLElement,
  ): Promise<void> {
    const mediaType = this.media.type;
    const existing = await this.storage.media.findByTmdbId(
      this.media.tmdbId,
      mediaType,
    );

    if (existing) {
      const inLibraryBtn = heroContent.createEl("button", {
        cls: "mediavault-add-to-library-btn mediavault-in-library-btn",
        text: t("detail.inLibrary"),
      });
      inLibraryBtn.disabled = true;
      return;
    }

    const addBtn = heroContent.createEl("button", {
      cls: "mod-cta",
      attr: {
        "aria-label": t("common.addToLibraryAria"),
      },
    });
    setIcon(addBtn, "bookmark-plus");

    addBtn.addEventListener("click", (evt) => {
      void this.handleAddMedia(addBtn, evt);
    });
  }

  private async handleAddMedia(
    addBtn: HTMLButtonElement,
    evt: MouseEvent,
  ): Promise<void> {
    evt.stopPropagation();
    addBtn.disabled = true;

    try {
      const mediaKind = this.media.type === MediaType.Movie ? "movie" : "tv";

      const result = await addMediaFromTMDB(
        this.storage,
        this.tmdb,
        this.media.tmdbId,
        mediaKind,
      );

      new Notice(
        result.alreadyExisted
          ? t("notice.alreadyInLibrary", { title: result.mediaItem.title })
          : t("notice.addedToLibrary", { title: result.mediaItem.title }),
      );

      this.media = result.mediaItem;
      this.isPreview = false;
      this.onChanged?.();
      this.plugin?.refreshLibraryViews();
      this.plugin?.refreshListViews();
      this.plugin?.refreshExploreViews();

      await this.render();
    } catch (err) {
      new Notice(
        t("notice.couldNotAdd", {
          title: this.media.title,
          error: err instanceof Error ? err.message : String(err),
        }),
      );

      addBtn.disabled = false;
    }
  }

  private async renderMoviePartialProgress(hero: HTMLElement): Promise<void> {
    const progress = await this.storage.movieProgress.findByMediaId(
      this.media.id,
    );
    if (!progress) return;

    const wrap = hero.createDiv({ cls: "mediavault-movie-progress-wrap" });
    const percent =
      progress.totalRuntime > 0
        ? (progress.currentMinute / progress.totalRuntime) * 100
        : 0;
    this.renderProgressBar(wrap, percent, true);

    const label =
      progress.totalRuntime > 0
        ? t("detail.resumeFromMinuteFull", {
            minute: progress.currentMinute,
            total: progress.totalRuntime,
            percent: Math.round(percent),
          })
        : t("detail.resumeFromMinute", { minute: progress.currentMinute });
    wrap.createDiv({
      cls: "mediavault-detail-meta mediavault-movie-progress-label",
      text: label,
    });

    const actions = wrap.createDiv({
      cls: "mediavault-movie-progress-actions",
    });

    const updateBtn = actions.createEl("button", {
      text: t("detail.updateProgress"),
    });
    updateBtn.addEventListener(
      "click",
      () => void this.openMoviePartialWatchModal(),
    );

    const finishBtn = actions.createEl("button", {
      cls: "mod-cta",
      text: t("detail.markAsFinished"),
    });
    finishBtn.addEventListener("click", () => {
      void this.handleFinishMovie();
    });
  }

  private async handleFinishMovie(): Promise<void> {
    await completeMovieFromProgress(this.storage, this.media.id);
    new Notice(t("notice.markedFinished", { title: this.media.title }));
    this.onChanged?.();
    await this.refreshAndNotify();
  }

  private async openMoviePartialWatchModal(): Promise<void> {
    const existing = await this.storage.movieProgress.findByMediaId(
      this.media.id,
    );
    new MoviePartialWatchModal(this.app, this.storage, {
      media: this.media,
      existingMinute: existing?.currentMinute ?? null,
      onSaved: () => void this.refreshAndNotify(),
    }).open();
  }

  private openHeroMenu(
    evt: MouseEvent,
    confirmingDelete = false,
    confirmingRemoveFromList = false,
  ): void {
    const menu = new Menu();

    menu.addItem((item) =>
      item
        .setTitle(t("detail.editPoster"))
        .setIcon("image")
        .onClick(() => this.openImagePicker("poster")),
    );

    menu.addItem((item) =>
      item
        .setTitle(t("detail.editBanner"))
        .setIcon("image")
        .onClick(() => this.openImagePicker("backdrop")),
    );

    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle(
          this.media.notePath ? t("detail.openNote") : t("detail.generateNote"),
        )
        .setIcon("file-text")
        .onClick(async () => {
          const path = await generateMediaNote(
            this.app,
            this.storage,
            this.media,
          );
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) {
            await this.app.workspace.getLeaf(false).openFile(file);
          }
          this.onChanged?.();
        }),
    );

    menu.addItem((item) =>
      item
        .setTitle(t("comfort.profileTitle"))
        .setIcon("heart")
        .onClick(() => {
          new ComfortProfileModal(this.app, this.storage, this.media, () =>
            this.onChanged?.(),
          ).open();
        }),
    );

    menu.addItem((item) =>
      item
        .setTitle(t("addToList.title"))
        .setIcon("list-plus")
        .onClick(() => {
          new AddToListModal(this.app, this.storage, this.media, () =>
            this.onChanged?.(),
          ).open();
        }),
    );

    if (this.listContext) {
      addDestructiveMenuItem(menu, evt, {
        label: t("lists.removeFromList"),
        icon: "list-x",
        confirming: confirmingRemoveFromList,
        rebuild: (_m, confirming) =>
          this.openHeroMenu(evt, confirmingDelete, confirming),
        onConfirm: () => void this.removeFromListAndClose(),
      });
    }

    if (this.plugin) {
      menu.addSeparator();

      addDestructiveMenuItem(menu, evt, {
        label: t("detail.delete"),
        confirming: confirmingDelete,
        rebuild: (_m, confirming) => this.openHeroMenu(evt, confirming),
        onConfirm: () => void this.confirmAndDelete(true),
      });
    }

    if (this.media.type === MediaType.Movie) {
      menu.addSeparator();

      menu.addItem((item) =>
        item
          .setTitle(t("detail.markAsPartiallyWatched"))
          .setIcon("timer")
          .onClick(() => void this.openMoviePartialWatchModal()),
      );

      if (this.media.status === MediaStatus.Dropped) {
        menu.addItem((item) =>
          item
            .setTitle(t("detail.resumeWatching"))
            .setIcon("play")
            .onClick(async () => {
              await resumeMovie(this.storage, this.media.id);
              this.onChanged?.();
              await this.refreshAndNotify();
            }),
        );
      }
    }

    if (this.media.type === MediaType.TVShow) {
      menu.addSeparator();

      menu.addItem((item) =>
        item
          .setTitle(t("detail.refreshEpisodes"))
          .setIcon("refresh-cw")
          .onClick(() => void this.runEpisodeImport()),
      );

      if (this.media.status === MediaStatus.Dropped) {
        menu.addItem((item) =>
          item
            .setTitle(t("detail.resumeWatching"))
            .setIcon("play")
            .onClick(async () => {
              await resumeSeries(this.storage, this.media.id);
              this.onChanged?.();
              await this.refreshAndNotify();
            }),
        );
      } else {
        menu.addItem((item) =>
          item
            .setTitle(t("detail.markAsDropped"))
            .setIcon("x-circle")
            .onClick(() => {
              new DropSeriesModal(this.app, this.storage, {
                mediaId: this.media.id,
                mediaTitle: this.media.title,
                onDropped: () => {
                  this.onChanged?.();
                  void this.refreshAndNotify();
                },
              }).open();
            }),
        );
      }
    }

    menu.showAtMouseEvent(evt);
  }

  private openImagePicker(imageKind: "poster" | "backdrop"): void {
    const mediaKind = this.media.type === MediaType.Movie ? "movie" : "tv";
    new ImagePickerModal(
      this.app,
      this.tmdb,
      this.media.tmdbId,
      mediaKind,
      imageKind,
      imageKind === "poster" ? this.media.posterPath : this.media.backdropPath,
      async (filePath) => {
        const patch =
          imageKind === "poster"
            ? { posterPath: filePath }
            : { backdropPath: filePath };
        const updated = await this.storage.media.update(this.media.id, patch);
        if (updated) this.media = updated;
        this.onChanged?.();
        await this.render();
      },
    ).open();
  }

  private renderDescription(container: HTMLElement, synopsis: string): void {
    renderExpandableText(container, synopsis, this.descriptionExpanded, () => {
      this.descriptionExpanded = !this.descriptionExpanded;
      void this.render();
    });
  }

  private renderTabBar(contentEl: HTMLElement): void {
    const bar = contentEl.createDiv({ cls: "mediavault-detail-tabs" });
    const tabs: { id: DetailTab; label: string }[] =
      this.media.type === MediaType.TVShow
        ? [
            ...(this.isPreview
              ? []
              : [
                  {
                    id: "history" as DetailTab,
                    label: t("detail.watchHistory"),
                  },
                ]),
            { id: "episodes", label: t("detail.episodes") },
            { id: "cast", label: t("detail.cast") },
            { id: "comments", label: t("detail.comments") },
          ]
        : [
            ...(this.isPreview
              ? []
              : [
                  {
                    id: "history" as DetailTab,
                    label: t("detail.watchHistory"),
                  },
                ]),
            { id: "cast", label: t("detail.cast") },
            { id: "comments", label: t("detail.comments") },
          ];

    tabs.forEach((tab) => {
      const btn = bar.createEl("button", {
        cls: `mediavault-detail-tab ${this.activeTab === tab.id ? "is-active" : ""}`,
        text: tab.label,
      });
      btn.addEventListener("click", () => {
        if (this.activeTab === tab.id) return;
        this.activeTab = tab.id;
        void this.render();
      });
    });
  }

  private async renderWatchHistoryTab(contentEl: HTMLElement): Promise<void> {
    if (this.media.status === MediaStatus.Dropped && this.media.droppedReason) {
      const droppedSection = contentEl.createDiv({
        cls: "mediavault-detail-section mediavault-dropped-banner",
      });
      droppedSection.createEl("h3", { text: t("detail.dropped") });
      droppedSection.createDiv({
        cls: "mediavault-detail-meta",
        text: t("detail.reason"),
      });
      droppedSection.createEl("p", {
        cls: "mediavault-dropped-reason",
        text: `"${this.media.droppedReason}"`,
      });
    }

    const sessions = await this.storage.watchSessions.findWhere(
      (s) => s.mediaId === this.media.id,
    );

    const evolution = getRatingEvolution(sessions);
    const rated = evolution.filter(
      (p) => p.rating !== null,
    ) as (RatingEvolutionPoint & { rating: number })[];

    if (rated.length > 1) {
      // TODO: this still shows the chart if there is only one rating
      const chartSection = contentEl.createDiv({
        cls: "mediavault-detail-section",
      });
      chartSection.createEl("h3", { text: t("detail.ratingEvolution") });
      const chartContainer = chartSection.createDiv({
        cls: "mediavault-chart-container",
      });
      renderRatingEvolutionChart(chartContainer, evolution);
    }

    const timelineSection = contentEl.createDiv({
      cls: "mediavault-detail-section",
    });
    timelineSection.createEl("h3", {
      text: t("detail.watchHistoryCount", { count: sessions.length }),
    });

    if (sessions.length === 0) {
      timelineSection.createDiv({
        cls: "mediavault-timeline-empty",
        text: t("detail.noWatchesLoggedYet"),
      });
    } else {
      const timeline = timelineSection.createDiv({
        cls: "mediavault-timeline",
      });
      const chronological = sortSessionsChronological(sessions).reverse();
      chronological.forEach((session) => {
        this.renderTimelineEntry(timeline, session);
      });
    }
  }

  private renderTimelineEntry(
    container: HTMLElement,
    session: WatchSession,
  ): void {
    const entry = container.createDiv({ cls: "mediavault-timeline-entry" });
    const entryInfo = entry.createDiv({
      cls: "mediavault-timeline-entry-info",
    });

    const entryHeader = entryInfo.createDiv({
      cls: "mediavault-timeline-entry-header",
    });
    const watchLabel =
      session.rewatchNumber === 0
        ? t("detail.firstWatch")
        : t("detail.rewatchNumber", { n: session.rewatchNumber });
    entryHeader.createSpan({
      cls: "mediavault-timeline-watch-label",
      text: watchLabel,
    });
    entryHeader.createSpan({
      cls: "mediavault-timeline-date",
      text: session.watchDate,
    });
    if (session.rating !== null) {
      entryHeader.createSpan({
        cls: "mediavault-timeline-rating",
        text: `★ ${session.rating.toFixed(1)}`,
      });
    }

    if (session.mood || session.context || session.watchSource) {
      entryInfo.createDiv({
        cls: "mediavault-timeline-context",
        text: [session.mood, session.context, session.watchSource]
          .filter(Boolean)
          .join(" · "),
      });
    }

    if (session.review) {
      entryInfo.createEl("p", {
        cls: "mediavault-timeline-review",
        text: session.review,
      });
    }

    const actions = entry.createDiv({ cls: "mediavault-timeline-actions" });

    const menuBtn = actions.createEl("button", { cls: "clickable-icon" });
    setIcon(menuBtn, "more-vertical");
    menuBtn.setAttr("aria-label", t("detail.watchEntryOptions"));

    const openEntryMenu = (evt: MouseEvent, confirmingDelete = false) => {
      evt.stopPropagation();

      const menu = new Menu();

      menu.addItem((item) =>
        item
          .setTitle(t("detail.edit"))
          .setIcon("pencil")
          .onClick(() => {
            new WatchSessionModal(this.app, this.storage, {
              mediaId: this.media.id,
              mediaTitle: this.media.title,
              existingSession: session,
              onSaved: () => void this.refreshAndNotify(),
            }).open();
          }),
      );

      menu.addSeparator();

      addDestructiveMenuItem(menu, evt, {
        label: t("detail.delete"),
        confirming: confirmingDelete,
        rebuild: (_m, confirming) => openEntryMenu(evt, confirming),
        onConfirm: () => {
          void (async () => {
            await deleteWatchSession(this.storage, session.id);
            new Notice(t("notice.watchEntryDeleted"));
            await this.refreshAndNotify();
          })();
        },
      });

      menu.showAtMouseEvent(evt);
    };

    menuBtn.addEventListener("click", (evt) => openEntryMenu(evt));
  }

  private async renderCommentsTab(contentEl: HTMLElement): Promise<void> {
    const section = contentEl.createDiv({ cls: "mediavault-detail-section" });
    const heading = section.createDiv({ cls: "mediavault-comments-heading" });
    heading.createEl("h3", { text: t("detail.comments") });

    if (!this.trakt) {
      section.createDiv({
        cls: "mediavault-modal-hint",
        text: t("detail.traktUnavailable"),
      });
      return;
    }

    const target: TraktCommentTarget =
      this.media.type === MediaType.Movie
        ? { kind: "movie", tmdbId: this.media.tmdbId }
        : { kind: "show", tmdbId: this.media.tmdbId };

    const fetchComments = () =>
      this.media.type === MediaType.Movie
        ? this.trakt!.getMovieComments(this.media.tmdbId)
        : this.trakt!.getShowComments(this.media.tmdbId);

    const composeToggle = heading.createDiv({
      cls: "mediavault-comment-compose-toggle",
    });
    setIcon(composeToggle, "square-pen");
    composeToggle.setAttribute("aria-label", t("detail.writeComment"));

    const listWrap = section.createDiv();

    const composer = await this.renderCommentComposer(section, target, () =>
      this.refreshCommentList(listWrap, target, fetchComments),
    );
    composer?.addClass("is-collapsed");
    composeToggle.addEventListener("click", () => {
      composer?.toggleClass("is-collapsed", !composer.hasClass("is-collapsed"));
      if (composer && !composer.hasClass("is-collapsed")) {
        composer
          .querySelector<HTMLTextAreaElement>(
            ".mediavault-comment-compose-input",
          )
          ?.focus();
      }
    });

    if (composer) section.insertBefore(composer, listWrap);

    await this.refreshCommentList(listWrap, target, fetchComments);
  }

  private async refreshCommentList(
    listWrap: HTMLElement,
    target: TraktCommentTarget,
    fetchComments: () => Promise<TraktComment[]>,
  ): Promise<void> {
    listWrap.empty();
    const loading = listWrap.createDiv({
      cls: "mediavault-modal-hint",
      text: t("detail.loadingComments"),
    });

    let comments: TraktComment[];
    try {
      comments = await fetchComments();
    } catch (err) {
      loading.setText(
        t("detail.couldNotLoadComments", { error: (err as Error).message }),
      );
      return;
    }

    loading.remove();
    const highlightId = this.pendingHighlightCommentId;
    this.pendingHighlightCommentId = null;
    await this.renderCommentList(listWrap, comments, target, highlightId);
  }

  private async renderCastTab(contentEl: HTMLElement): Promise<void> {
    const section = contentEl.createDiv({ cls: "mediavault-detail-section" });
    section.createEl("h3", { text: t("detail.cast") });

    const mediaKind = this.media.type === MediaType.Movie ? "movie" : "tv";
    const loading = section.createDiv({
      cls: "mediavault-modal-hint",
      text: t("detail.loadingCast"),
    });
    let cast;
    try {
      cast = await this.tmdb.getCredits(this.media.tmdbId, mediaKind);
    } catch (err) {
      loading.setText(
        t("detail.couldNotLoadCast", { error: (err as Error).message }),
      );
      return;
    }
    loading.remove();

    if (cast.length === 0) {
      section.createDiv({
        cls: "mediavault-modal-hint",
        text: t("detail.noCastInfo"),
      });
      return;
    }

    const grid = section.createDiv({ cls: "mediavault-cast-grid" });
    [...cast]
      .sort((a, b) => a.order - b.order)
      .forEach((member) => {
        const card = grid.createDiv({ cls: "mediavault-cast-card" });
        const photoUrl = tmdbImageUrl(member.profilePath, "w200");
        if (photoUrl) {
          card.createEl("img", {
            cls: "mediavault-cast-photo",
            attr: { src: photoUrl, alt: member.name, loading: "lazy" },
          });
        } else {
          card.createDiv({
            cls: "mediavault-cast-photo mediavault-cast-photo-empty",
            text: "🎭",
          });
        }
        const info = card.createDiv({ cls: "mediavault-cast-info" });
        info.createDiv({ cls: "mediavault-cast-name", text: member.name });
        info.createDiv({
          cls: "mediavault-detail-meta",
          text: member.character,
        });

        card.addEventListener("click", () => {
          new ActorDetailsModal(
            this.app,
            this.storage,
            this.tmdb,
            member.tmdbPersonId,
          ).open();
        });
      });
  }

  private async renderCommentList(
    container: HTMLElement,
    rawComments: TraktComment[],
    target: TraktCommentTarget,
    highlightId: number | null = null,
  ): Promise<void> {
    const settings = this.storage.settings.get();
    const comments = filterAndSortCommentsByLanguage(
      rawComments,
      settings.commentsPrimaryLanguage,
      settings.commentsAdditionalLanguages,
    );

    if (comments.length === 0) {
      container.createDiv({
        cls: "mediavault-modal-hint",
        text:
          rawComments.length > 0
            ? t("comments.emptyFilteredLanguages")
            : t("comments.emptyTrakt"),
      });
      return;
    }

    const currentUser = this.trakt
      ? await this.trakt.getCurrentUser().catch(() => null)
      : null;

    const list = container.createDiv({ cls: "mediavault-comments-list" });
    comments.forEach((comment) => {
      const item = list.createDiv({ cls: "mediavault-comment-item" });
      if (comment.id === highlightId) {
        item.addClass("is-newly-posted");
        window.setTimeout(() => item.removeClass("is-newly-posted"), 2500);
      }

      const avatarEl = item.createDiv({ cls: "mediavault-comment-avatar" });
      if (comment.avatarUrl) {
        avatarEl.createEl("img", {
          attr: { src: comment.avatarUrl, alt: comment.userName },
        });
      } else {
        avatarEl.setText(comment.userName.slice(0, 1).toUpperCase());
      }

      const main = item.createDiv({ cls: "mediavault-comment-main" });

      const header = main.createDiv({ cls: "mediavault-comment-header" });
      header.createSpan({
        cls: "mediavault-comment-author",
        text: comment.userName,
        attr: { title: comment.userName },
      });
      if (comment.userRating !== null) {
        header.createSpan({
          cls: "mediavault-comment-rating",
          text: `★ ${comment.userRating}/10`,
        });
      }
      if (comment.spoiler) {
        header.createSpan({
          cls: "mediavault-comment-spoiler-tag",
          text: t("detail.spoiler"),
        });
      }
      header.createSpan({
        cls: "mediavault-comment-date",
        text: comment.createdAt.slice(0, 10),
      });

      const body = main.createEl("p", {
        cls: "mediavault-comment-body",
        text: comment.comment,
      });
      if (comment.spoiler) {
        body.addClass("is-spoiler-hidden");
        body.addEventListener(
          "click",
          () => body.removeClass("is-spoiler-hidden"),
          { once: true },
        );
      }

      const footer = main.createDiv({ cls: "mediavault-comment-footer" });
      footer.createSpan({
        cls: "mediavault-comment-likes",
        text: t("detail.likesCount", {
          count: comment.likes,
          plural: comment.likes === 1 ? "" : "s",
        }),
      });

      if (
        currentUser &&
        currentUser.username === comment.userName &&
        this.trakt
      ) {
        const actions = footer.createDiv({ cls: "mediavault-comment-actions" });

        const editBtn = actions.createEl("button", {
          cls: "clickable-icon",
          text: t("detail.edit"),
        });
        editBtn.addEventListener("click", () => {
          this.renderCommentEditForm(main, body, comment, target);
        });

        const deleteBtn = actions.createEl("button", {
          cls: "clickable-icon",
          text: t("detail.delete"),
        });
        deleteBtn.addEventListener("click", () => {
          void this.handleDeleteComment(deleteBtn, comment.id, target, item);
        });
      }
    });
  }

  private async handleDeleteComment(
    deleteBtn: HTMLButtonElement,
    commentId: number,
    target: TraktCommentTarget,
    item: HTMLElement,
  ): Promise<void> {
    if (!(await confirmDialog(this.app, t("detail.deleteCommentConfirm")))) {
      return;
    }

    try {
      await this.trakt!.deleteComment(commentId);
      this.trakt!.invalidateCommentsCache(target);
      new Notice(t("notice.commentDeleted"));
      item.remove();
    } catch (err) {
      new Notice(
        t("notice.couldNotDeleteComment", {
          error: describeTraktError(err),
        }),
      );
    }
  }

  private renderCommentEditForm(
    item: HTMLElement,
    body: HTMLElement,
    comment: TraktComment,
    target: TraktCommentTarget,
  ): void {
    const existingActions = item.querySelector(".mediavault-comment-actions");
    existingActions?.remove();

    const textarea = item.createEl("textarea", {
      cls: "mediavault-comment-edit-input",
    });
    textarea.value = comment.comment;
    body.replaceWith(textarea);
    makeClearable(textarea);

    const editActions = item.createDiv({ cls: "mediavault-comment-actions" });
    const saveBtn = editActions.createEl("button", {
      cls: "mod-cta",
      text: t("detail.save"),
    });
    const cancelBtn = editActions.createEl("button", {
      text: t("common.cancel"),
    });

    cancelBtn.addEventListener("click", () => void this.render());
    saveBtn.addEventListener("click", () => {
      void this.handleSaveComment(
        comment.id,
        textarea,
        comment.spoiler,
        target,
      );
    });
  }

  private async handleSaveComment(
    commentId: number,
    textarea: HTMLTextAreaElement,
    spoiler: boolean,
    target: TraktCommentTarget,
  ): Promise<void> {
    const value = textarea.value.trim();

    if (value === "") {
      new Notice(t("detail.commentEmptyError"));
      return;
    }

    try {
      await this.trakt!.updateComment(commentId, value, spoiler);

      this.trakt!.invalidateCommentsCache(target);
      new Notice(t("notice.commentUpdated"));
      await this.render();
    } catch (err) {
      new Notice(
        t("notice.couldNotUpdateComment", {
          error: describeTraktError(err),
        }),
      );
    }
  }

  private async renderCommentComposer(
    container: HTMLElement,
    target: TraktCommentTarget,
    onPosted: () => Promise<void>,
  ): Promise<HTMLElement | null> {
    const composer = container.createDiv({
      cls: "mediavault-comment-composer",
    });
    const token = await ensureValidTraktToken(this.storage);

    if (!token) {
      composer.createDiv({
        cls: "mediavault-modal-hint",
        text: t("detail.connectTraktToComment"),
      });
      return composer;
    }

    composer.createEl("h4", { text: t("detail.writePublicComment") });
    const textarea = composer.createEl("textarea", {
      cls: "mediavault-comment-compose-input",
      attr: {
        placeholder: t("detail.commentPlaceholder"),
        enterkeyhint: "done",
      },
    });
    makeClearable(textarea);
    const counter = composer.createDiv({
      cls: "mediavault-comment-char-counter",
      text: `0 / ${this.TRAKT_COMMENT_LIMIT}`,
    });
    textarea.addEventListener("input", () => {
      counter.setText(`${textarea.value.length} / ${this.TRAKT_COMMENT_LIMIT}`);
      counter.toggleClass(
        "is-over-limit",
        textarea.value.length > this.TRAKT_COMMENT_LIMIT,
      );
    });

    const doneBtn = composer.createEl("button", {
      cls: "clickable-icon mediavault-comment-compose-done",
      attr: { "aria-label": t("detail.dismissKeyboard") },
    });
    setIcon(doneBtn, "chevron-down");
    doneBtn.addEventListener("click", () => textarea.blur());

    const warningEl = composer.createDiv({
      cls: "mediavault-comment-refresh-warning",
    });

    const buttonRow = composer.createDiv({
      cls: "mediavault-comment-compose-buttons",
    });

    const cancelBtn = buttonRow.createEl("button", {
      cls: "mediavault-comment-compose-cancel",
      text: t("common.cancel"),
    });
    cancelBtn.addEventListener("click", () => {
      textarea.value = "";
      counter.setText(`0 / ${this.TRAKT_COMMENT_LIMIT}`);
      textarea.blur();
      composer.addClass("is-collapsed");
    });

    const postBtn = buttonRow.createEl("button", {
      cls: "mod-cta",
      text: t("detail.postComment"),
    });
    postBtn.addEventListener("click", () => {
      void this.handlePostComment(
        textarea,
        warningEl,
        postBtn,
        counter,
        composer,
        target,
        onPosted,
      );
    });

    return composer;
  }

  private async handlePostComment(
    textarea: HTMLTextAreaElement,
    warningEl: HTMLElement,
    postBtn: HTMLButtonElement,
    counter: HTMLElement,
    composer: HTMLElement,
    target: TraktCommentTarget,
    onPosted: () => Promise<void>,
  ): Promise<void> {
    const text = textarea.value.trim();

    if (text === "") {
      new Notice(t("detail.writeSomethingFirst"));
      return;
    }

    if (text.length > this.TRAKT_COMMENT_LIMIT) {
      new Notice(
        t("detail.commentTooLong", {
          limit: this.TRAKT_COMMENT_LIMIT,
        }),
      );
      return;
    }

    warningEl.empty();
    postBtn.disabled = true;
    postBtn.setText(t("detail.posting"));

    let posted;

    try {
      posted = await this.trakt!.postComment(target, text);
    } catch (err) {
      new Notice(
        t("notice.couldNotPostComment", {
          error: describeTraktError(err),
        }),
      );
      postBtn.disabled = false;
      postBtn.setText(t("detail.postComment"));
      return;
    }

    new Notice(t("notice.commentPosted"));
    textarea.value = "";
    counter.setText(`0 / ${this.TRAKT_COMMENT_LIMIT}`);
    composer.addClass("is-collapsed");
    this.pendingHighlightCommentId = posted.id;
    postBtn.setText(t("detail.refreshing"));

    await this.refreshCommentsAfterPost(warningEl, postBtn, onPosted);
  }

  private async refreshCommentsAfterPost(
    warningEl: HTMLElement,
    postBtn: HTMLButtonElement,
    onPosted: () => Promise<void>,
  ): Promise<void> {
    try {
      await onPosted();
      warningEl.empty();
    } catch (err) {
      warningEl.empty();
      warningEl.createDiv({
        cls: "mediavault-modal-hint mediavault-comment-refresh-warning-text",
        text: `${t("detail.refreshFailedHint")}: ${(err as Error).message}`,
      });
      const retryBtn = warningEl.createEl("button", {
        text: t("detail.retry"),
      });
      retryBtn.addEventListener(
        "click",
        () => void this.refreshCommentsAfterPost(warningEl, postBtn, onPosted),
      );
    } finally {
      postBtn.disabled = false;
      postBtn.setText(t("detail.postComment"));
    }
  }

  private async renderEpisodesTab(contentEl: HTMLElement): Promise<void> {
    const episodes = await this.storage.episodes.findByMediaId(this.media.id);

    if (episodes.length === 0) {
      if (this.isPreview) {
        contentEl.createDiv({
          cls: "mediavault-episode-empty",
          text: t("detail.addToLibraryHint"),
        });
        return;
      }
      contentEl.createDiv({
        cls: "mediavault-episode-empty",
        text: t("detail.noEpisodeDataYet"),
      });
      const importBtn = contentEl.createEl("button", {
        text: t("detail.importEpisodesFromTmdb"),
        cls: "mod-cta",
      });
      importBtn.addEventListener("click", () => void this.runEpisodeImport());
      return;
    }

    const seasonNumbers = [
      ...new Set(episodes.map((e) => e.seasonNumber)),
    ].sort((a, b) => a - b);
    const progressRecords = await this.storage.episodeProgress.findByMediaId(
      this.media.id,
    );
    const progressByEpisodeId = new Map(
      progressRecords.map((p) => [p.episodeId, p]),
    );

    const allWatches = await this.storage.episodeWatches.findByMediaId(
      this.media.id,
    );
    const watchesByEpisodeId = new Map<string, EpisodeWatch[]>();
    for (const watch of allWatches) {
      const bucket = watchesByEpisodeId.get(watch.episodeId);
      if (bucket) bucket.push(watch);
      else watchesByEpisodeId.set(watch.episodeId, [watch]);
    }

    const activeSeason = seasonNumbers.find((seasonNumber) => {
      const seasonEpisodes = episodes.filter(
        (e) => e.seasonNumber === seasonNumber,
      );
      const watched = seasonEpisodes.filter(
        (e) => progressByEpisodeId.get(e.id)?.watched,
      ).length;

      return watched > 0 && watched < seasonEpisodes.length;
    });

    const seasonsContainer = contentEl.createDiv({ cls: "mediavault-seasons" });

    if (this.expandedSeasons.size === 0 && activeSeason !== undefined) {
      this.expandedSeasons.add(activeSeason);
    }

    for (const seasonNumber of seasonNumbers) {
      const seasonEpisodes = episodes
        .filter((e) => e.seasonNumber === seasonNumber)
        .sort((a, b) => a.episodeNumber - b.episodeNumber);
      this.renderSeason(
        seasonsContainer,
        seasonNumber,
        seasonEpisodes,
        progressByEpisodeId,
        watchesByEpisodeId,
      );
    }
  }

  private renderProgressBar(
    container: HTMLElement,
    percent: number,
    isFullProgress: boolean = false,
  ): void {
    const style = isFullProgress
      ? "mediavault-progress-bar-full"
      : "mediavault-progress-bar";
    const bar = container.createDiv({ cls: style });
    const fill = bar.createDiv({
      cls: progressFillClasses("mediavault-progress-fill", this.media.status),
    });
    fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  }

  private renderSeason(
    container: HTMLElement,
    seasonNumber: number,
    episodes: Episode[],
    progressByEpisodeId: Map<string, EpisodeProgress>,
    watchesByEpisodeId: Map<string, EpisodeWatch[]>,
  ): void {
    const watchedCount = episodes.filter(
      (e) => progressByEpisodeId.get(e.id)?.watched,
    ).length;
    const total = episodes.length;
    const percent = total > 0 ? (watchedCount / total) * 100 : 0;

    const seasonEl = container.createDiv({ cls: "mediavault-season" });

    const header = seasonEl.createDiv({ cls: "mediavault-season-header" });
    const isExpanded = this.expandedSeasons.has(seasonNumber);
    const toggle = header.createSpan({
      cls: "mediavault-season-toggle",
      text: isExpanded ? "\u25be" : "\u25b8",
    });
    header.createSpan({
      cls: "mediavault-season-title",
      text: t("detail.season", { n: seasonNumber }),
    });
    header.createSpan({
      cls: "mediavault-season-count",
      text: `${watchedCount}/${total}`,
    });

    this.renderProgressBar(header, percent);

    const episodesEl = seasonEl.createDiv({
      cls: "mediavault-season-episodes",
    });
    episodesEl.toggleClass("is-hidden", !isExpanded);

    header.addEventListener("click", (evt) => {
      if ((evt.target as HTMLElement).closest("button")) return;
      if (this.expandedSeasons.has(seasonNumber)) {
        this.expandedSeasons.delete(seasonNumber);
        toggle.setText("\u25b8");
        episodesEl.addClass("is-hidden");
      } else {
        this.expandedSeasons.add(seasonNumber);
        toggle.setText("\u25be");
        episodesEl.removeClass("is-hidden");
      }
    });

    const actions = header.createDiv({ cls: "mediavault-season-actions" });
    const seasonWatchCount =
      total > 0
        ? Math.min(
            ...episodes.map((e) => watchesByEpisodeId.get(e.id)?.length ?? 0),
          )
        : 0;
    const seasonWatched = watchedCount === total && seasonWatchCount > 0;

    const toggleWatchBtn = actions.createEl("button", {
      cls:
        seasonWatchCount === 0
          ? "mediavault-detail-log-btn mediavault-episode-watch-btn mediavault-episode-watch-btn-unwatched"
          : "mediavault-detail-log-btn mod-cta mediavault-episode-watch-btn",
    });
    if (!seasonWatched) {
      setIcon(toggleWatchBtn, "check-check");
      toggleWatchBtn.setAttr("aria-label", t("detail.markSeasonWatched"));
    } else {
      toggleWatchBtn.setText(`\u00d7${seasonWatchCount}`);
      toggleWatchBtn.setAttr(
        "aria-label",
        t("detail.watchedNTimes", {
          n: seasonWatchCount,
          plural: seasonWatchCount === 1 ? "" : "s",
        }),
      );
    }

    toggleWatchBtn.addEventListener("click", (evt) => {
      void this.handleToggleSeasonWatched(
        toggleWatchBtn,
        evt,
        seasonWatched,
        episodes,
        seasonNumber,
      );
    });

    if (seasonWatched) {
      const LONG_PRESS_MS = 550;
      let longPressTimer: number | null = null;
      const clearTimer = () => {
        if (longPressTimer !== null) {
          window.clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      };
      toggleWatchBtn.addEventListener("pointerdown", (evt) => {
        if (evt.button !== undefined && evt.button !== 0) return;
        clearTimer();
        longPressTimer = window.setTimeout(() => {
          void (async () => {
            longPressTimer = null;
            toggleWatchBtn.dataset.longPressed = "1";

            if (
              !(await confirmDialog(
                this.app,
                t("detail.removeOneSeasonWatchConfirm"),
              ))
            ) {
              return;
            }

            await removeOneSeasonWatch(this.storage, episodes);
            this.plugin?.refreshLibraryViews();
            this.plugin?.refreshListViews();
            this.onChanged?.();
            await this.rerenderPreservingEpisodesScroll();
          })();
        }, LONG_PRESS_MS);
      });
      toggleWatchBtn.addEventListener("pointerup", clearTimer);
      toggleWatchBtn.addEventListener("pointercancel", clearTimer);
      toggleWatchBtn.addEventListener("pointerleave", clearTimer);
    }

    for (const ep of episodes) {
      this.renderEpisodeRow(
        episodesEl,
        ep,
        progressByEpisodeId.get(ep.id) ?? null,
        watchesByEpisodeId.get(ep.id) ?? [],
      );
    }
  }

  private async handleToggleSeasonWatched(
    toggleWatchBtn: HTMLButtonElement,
    evt: MouseEvent,
    seasonWatched: boolean,
    episodes: Episode[],
    seasonNumber: number,
  ): Promise<void> {
    evt.stopPropagation();

    if (toggleWatchBtn.dataset.longPressed) {
      delete toggleWatchBtn.dataset.longPressed;
      return;
    }

    if (!seasonWatched) {
      await markSeasonWatched(this.storage, episodes, true);
      new Notice(t("notice.markedSeasonWatched", { n: seasonNumber }));
    } else {
      await addSeasonRewatch(this.storage, episodes);
      this.plugin?.refreshLibraryViews();
      this.plugin?.refreshListViews();
    }

    this.onChanged?.();
    await this.rerenderPreservingEpisodesScroll();
  }

  private renderEpisodeRow(
    container: HTMLElement,
    episode: Episode,
    progress: EpisodeProgress | null,
    episodeWatches: EpisodeWatch[],
  ): void {
    const row = container.createDiv({
      cls: "mediavault-episode-row is-clickable",
    });
    row.addEventListener("click", (evt) => {
      if ((evt.target as HTMLElement).closest("input, button")) return;
      this.openEpisodeDetail(episode);
    });

    const thumb = row.createDiv({ cls: "mediavault-episode-thumb" });
    const thumbUrl = tmdbImageUrl(episode.thumbnailPath, "w200");
    if (thumbUrl) {
      thumb.createEl("img", {
        attr: { src: thumbUrl, alt: episode.title, loading: "lazy" },
      });
    }

    const info = row.createDiv({ cls: "mediavault-episode-info" });
    info.createDiv({
      cls: "mediavault-episode-title",
      text: `${episode.episodeNumber}. ${episode.title}`,
    });
    info.createDiv({
      cls: "mediavault-episode-meta",
      text: [episode.airDate, formatEpisodeRuntime(episode.runtime)]
        .filter(Boolean)
        .join(" · "),
    });

    const watches = sortEpisodeWatchesChronological(episodeWatches);

    const watchBtn = row.createEl("button", {
      cls:
        watches.length === 0
          ? "mediavault-detail-log-btn mediavault-episode-watch-btn mediavault-episode-watch-btn-unwatched"
          : "mediavault-detail-log-btn mod-cta mediavault-episode-watch-btn",
    });
    if (watches.length === 0) {
      setIcon(watchBtn, "check");
      watchBtn.setAttr("aria-label", t("detail.markWatched"));
    } else {
      watchBtn.setText(`\u00d7${watches.length}`);
      watchBtn.setAttr(
        "aria-label",
        t("detail.watchedNTimes", {
          n: watches.length,
          plural: watches.length === 1 ? "" : "s",
        }),
      );
    }
    watchBtn.addEventListener("click", (evt) => {
      evt.stopPropagation();

      void (async () => {
        if (watchBtn.dataset.longPressed) {
          delete watchBtn.dataset.longPressed;
          return;
        }

        if (watches.length === 0) {
          await this.markEpisodeWatchedWithSmartCompletion(episode);
        } else {
          await addEpisodeWatch(this.storage, episode);
          this.plugin?.refreshLibraryViews();
          this.plugin?.refreshListViews();
        }

        this.onChanged?.();
        await this.rerenderPreservingEpisodesScroll();
      })();
    });

    if (watches.length > 0) {
      const LONG_PRESS_MS = 550;
      let longPressTimer: number | null = null;
      const clearTimer = () => {
        if (longPressTimer !== null) {
          window.clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      };
      watchBtn.addEventListener("pointerdown", (evt) => {
        if (evt.button !== undefined && evt.button !== 0) return;

        clearTimer();

        longPressTimer = window.setTimeout(() => {
          void (async () => {
            longPressTimer = null;
            watchBtn.dataset.longPressed = "1";

            if (
              !(await confirmDialog(
                this.app,
                t("detail.removeOneWatchConfirm"),
              ))
            ) {
              return;
            }

            await removeOneEpisodeWatch(this.storage, episode);
            this.plugin?.refreshLibraryViews();
            this.plugin?.refreshListViews();
            this.onChanged?.();
            await this.rerenderPreservingEpisodesScroll();
          })();
        }, LONG_PRESS_MS);
      });
      watchBtn.addEventListener("pointerup", clearTimer);
      watchBtn.addEventListener("pointercancel", clearTimer);
      watchBtn.addEventListener("pointerleave", clearTimer);
    }
  }

  private async markEpisodeWatchedWithSmartCompletion(
    episode: Episode,
  ): Promise<void> {
    const [allEpisodes, progress] = await Promise.all([
      this.storage.episodes.findByMediaId(this.media.id),
      this.storage.episodeProgress.findByMediaId(this.media.id),
    ]);
    const preceding = findUnwatchedPrecedingEpisodes(
      allEpisodes,
      episode,
      progress,
    );

    if (preceding.length === 0) {
      await markEpisodeWatched(this.storage, episode, true);
      return;
    }

    const confirmed = await confirmDialog(
      this.app,
      t("detail.previousEpisodesPrompt"),
    );
    if (confirmed) {
      await markSeasonWatched(this.storage, [...preceding, episode], true);
      new Notice(
        t("notice.markedPrevEpisodesWatched", { n: preceding.length }),
      );
    } else {
      await markEpisodeWatched(this.storage, episode, true);
    }
  }

  private openEpisodeDetail(episode: Episode): void {
    if (this.activeTab !== "episode-detail") {
      this.tabBeforeEpisodeDetail = this.activeTab;
      this.episodesScrollTop = this.contentEl.scrollTop;
    }
    this.selectedEpisode = episode;
    this.activeTab = "episode-detail";
    void this.render();
  }

  private async renderEpisodeDetailTab(
    contentEl: HTMLElement,
    episode: Episode,
  ): Promise<void> {
    const progress = await this.storage.episodeProgress.findByEpisodeId(
      episode.id,
    );
    this.renderEpisodeHero(contentEl, episode, progress?.isFavorite ?? false);
    await this.renderEpisodeNavRow(contentEl, episode);

    const watches = sortEpisodeWatchesChronological(
      await this.storage.episodeWatches.findByEpisodeId(episode.id),
    );

    if (!progress?.watched) {
      await this.renderUnwatchedEpisodeBody(contentEl, episode);
    } else {
      await this.renderWatchedEpisodeBody(contentEl, episode, watches);
    }
  }

  private async renderEpisodeNavRow(
    contentEl: HTMLElement,
    episode: Episode,
  ): Promise<void> {
    const allEpisodes = [
      ...(await this.storage.episodes.findByMediaId(this.media.id)),
    ].sort((a, b) =>
      a.seasonNumber !== b.seasonNumber
        ? a.seasonNumber - b.seasonNumber
        : a.episodeNumber - b.episodeNumber,
    );
    const index = allEpisodes.findIndex((e) => e.id === episode.id);
    const prevEpisode = index > 0 ? allEpisodes[index - 1] : null;
    const nextEpisode =
      index >= 0 && index < allEpisodes.length - 1
        ? allEpisodes[index + 1]
        : null;

    const nav = contentEl.createDiv({ cls: "mediavault-episode-nav-row" });

    const prevBtn = nav.createEl("button", {
      cls: "clickable-icon mediavault-episode-nav-btn mediavault-episode-nav-prev",
    });
    setIcon(prevBtn, "chevron-left");
    prevBtn.createSpan({
      text: prevEpisode
        ? `S${prevEpisode.seasonNumber}E${prevEpisode.episodeNumber} \u2014 ${t("detail.previous")}`
        : t("detail.previous"),
    });
    prevBtn.disabled = !prevEpisode;
    prevBtn.setAttr("aria-label", t("detail.previousEpisode"));
    if (prevEpisode) {
      const target = prevEpisode;
      prevBtn.addEventListener("click", () => {
        this.selectedEpisode = target;
        void this.render();
      });
    }

    const nextBtn = nav.createEl("button", {
      cls: "clickable-icon mediavault-episode-nav-btn mediavault-episode-nav-next",
    });
    nextBtn.createSpan({
      text: nextEpisode
        ? `S${nextEpisode.seasonNumber}E${nextEpisode.episodeNumber} \u2014 ${t("detail.next")}`
        : t("detail.next"),
    });
    setIcon(nextBtn, "chevron-right");
    nextBtn.disabled = !nextEpisode;
    nextBtn.setAttr("aria-label", t("detail.nextEpisode"));
    if (nextEpisode) {
      const target = nextEpisode;
      nextBtn.addEventListener("click", () => {
        this.selectedEpisode = target;
        void this.render();
      });
    }
  }

  private renderEpisodeHero(
    contentEl: HTMLElement,
    episode: Episode,
    isFavorite: boolean,
  ): void {
    const hero = contentEl.createDiv({
      cls: "mediavault-detail-hero mediavault-episode-hero",
    });

    const bannerPath =
      episode.thumbnailPath ?? this.media.backdropPath ?? this.media.posterPath;
    const bannerUrl = tmdbImageUrl(bannerPath, "original");
    if (bannerUrl) {
      hero.createEl("img", {
        cls: "mediavault-detail-banner-img",
        attr: { src: bannerUrl, alt: "" },
      });
    }
    hero.createDiv({ cls: "mediavault-detail-banner-overlay" });

    const heroContent = hero.createDiv({
      cls: "mediavault-detail-hero-content",
    });
    const left = heroContent.createDiv({ cls: "mediavault-detail-hero-main" });
    const titleRow = left.createDiv({
      cls: "mediavault-detail-title-row",
    });
    titleRow.createEl("h2", { text: episode.title });

    this.renderFavoriteButton(
      titleRow,
      isFavorite,
      t("detail.toggleFavoriteEpisode"),
      async () => {
        const current = await this.storage.episodeProgress.findByEpisodeId(
          episode.id,
        );
        if (current) {
          await this.storage.episodeProgress.update(current.id, {
            isFavorite: !current.isFavorite,
          });
        } else {
          const created = await markEpisodeWatched(
            this.storage,
            episode,
            false,
          );
          await this.storage.episodeProgress.update(created.id, {
            isFavorite: true,
          });
        }
        this.onChanged?.();
      },
    );

    const metaRow = left.createDiv({
      cls: "mediavault-detail-meta mediavault-episode-meta-row",
    });
    const leftMeta = metaRow.createDiv({
      cls: "mediavault-episode-meta-left",
    });
    leftMeta.createSpan({
      cls: "mediavault-episode-meta-full",
      text: t("detail.seasonEpisodeLabel", {
        season: episode.seasonNumber,
        episode: episode.episodeNumber,
      }),
    });
    leftMeta.createSpan({
      cls: "mediavault-episode-meta-short",
      text: t("detail.seasonEpisodeLabelShort", {
        season: episode.seasonNumber,
        episode: episode.episodeNumber,
      }),
    });
    metaRow.createDiv({
      cls: "mediavault-episode-meta-right",
      text: [formatEpisodeRuntime(episode.runtime), episode.airDate]
        .filter(Boolean)
        .join(" • "),
    });
  }

  private async renderUnwatchedEpisodeBody(
    contentEl: HTMLElement,
    episode: Episode,
  ): Promise<void> {
    const infoSection = contentEl.createDiv({
      cls: "mediavault-detail-section",
    });
    if (episode.synopsis) {
      infoSection.createEl("p", {
        cls: "mediavault-detail-synopsis",
        text: episode.synopsis,
      });
    } else {
      infoSection.createDiv({
        cls: "mediavault-modal-hint",
        text: t("detail.noEpisodeOverview"),
      });
    }

    const markBtn = infoSection.createEl("button", {
      cls: "mod-cta mediavault-mark-watched-btn",
      text: t("detail.markAsWatched"),
    });
    markBtn.addEventListener("click", () => {
      void this.handleMarkEpisodeWatched(episode);
    });

    await this.renderEpisodeCastCrew(contentEl, episode);
  }

  private async handleMarkEpisodeWatched(episode: Episode): Promise<void> {
    await addEpisodeWatch(this.storage, episode);
    new Notice(t("notice.markedEpisodeWatched", { title: episode.title }));
    this.plugin?.refreshLibraryViews();
    this.plugin?.refreshListViews();
    await this.render();
  }

  private async renderWatchedEpisodeBody(
    contentEl: HTMLElement,
    episode: Episode,
    watches: EpisodeWatch[],
  ): Promise<void> {
    const reviewSection = contentEl.createDiv({
      cls: "mediavault-detail-section",
    });
    reviewSection.createEl("h3", { text: t("detail.episodeWatchHistory") });

    if (watches.length > 1) {
      const chartWrap = reviewSection.createDiv({
        cls: "mediavault-episode-rating-evolution",
      });
      chartWrap.createDiv({
        cls: "mediavault-detail-meta",
        text: t("detail.ratingEvolution"),
      });
      renderRatingEvolutionChart(
        chartWrap.createDiv(),
        watches.map((w, i) => ({
          watchSessionId: w.id,
          rewatchNumber: i,
          watchDate: w.watchedAt,
          rating: w.rating,
        })),
      );
    }

    watches.forEach((watch, i) =>
      this.renderEpisodeWatchCard(reviewSection, episode, watch, i + 1),
    );

    const addBtn = reviewSection.createEl("button", {
      cls: "mediavault-add-watch-btn",
      text: t("detail.logRewatch"),
    });
    addBtn.addEventListener("click", () => {
      void (async () => {
        await addEpisodeWatch(this.storage, episode);
        this.plugin?.refreshLibraryViews();
        this.plugin?.refreshListViews();
        await this.render();
      })();
    });

    const commentsSection = contentEl.createDiv({
      cls: "mediavault-detail-section",
    });
    const commentsHeading = commentsSection.createDiv({
      cls: "mediavault-comments-heading",
    });
    commentsHeading.createEl("h3", { text: t("detail.comments") });
    if (!this.trakt) {
      commentsSection.createDiv({
        cls: "mediavault-modal-hint",
        text: t("detail.traktUnavailable"),
      });
      return;
    }

    if (episode.tmdbEpisodeId !== null) {
      const composeToggle = commentsHeading.createDiv({
        cls: "mediavault-comment-compose-toggle",
      });
      setIcon(composeToggle, "square-pen");
      composeToggle.setAttribute("aria-label", t("detail.writeComment"));

      const target: TraktCommentTarget = {
        kind: "episode",
        showTmdbId: this.media.tmdbId,
        season: episode.seasonNumber,
        episode: episode.episodeNumber,
        episodeTmdbId: episode.tmdbEpisodeId,
      };
      const fetchComments = () =>
        this.trakt!.getEpisodeComments(
          this.media.tmdbId,
          episode.seasonNumber,
          episode.episodeNumber,
        );
      const listWrap = commentsSection.createDiv();
      const composer = await this.renderCommentComposer(
        commentsSection,
        target,
        () => this.refreshCommentList(listWrap, target, fetchComments),
      );
      composer?.addClass("is-collapsed");
      composeToggle.addEventListener("click", () => {
        composer?.toggleClass(
          "is-collapsed",
          !composer.hasClass("is-collapsed"),
        );
        if (composer && !composer.hasClass("is-collapsed")) {
          composer
            .querySelector<HTMLTextAreaElement>(
              ".mediavault-comment-compose-input",
            )
            ?.focus();
        }
      });

      if (composer) commentsSection.insertBefore(composer, listWrap);
      await this.refreshCommentList(listWrap, target, fetchComments);
    } else {
      const fallbackTarget: TraktCommentTarget = {
        kind: "episode",
        showTmdbId: this.media.tmdbId,
        season: episode.seasonNumber,
        episode: episode.episodeNumber,
        episodeTmdbId: 0,
      };
      const listWrap = commentsSection.createDiv();
      await this.refreshCommentList(listWrap, fallbackTarget, () =>
        this.trakt!.getEpisodeComments(
          this.media.tmdbId,
          episode.seasonNumber,
          episode.episodeNumber,
        ),
      );
    }
  }

  private renderEpisodeWatchCard(
    container: HTMLElement,
    episode: Episode,
    watch: EpisodeWatch,
    watchNumber: number,
  ): void {
    const card = container.createDiv({ cls: "mediavault-episode-review-card" });

    const headerRow = card.createDiv({
      cls: "mediavault-episode-watch-card-header",
    });
    headerRow.createEl("strong", {
      text: t("detail.watchNumber", { n: watchNumber }),
    });
    headerRow.createSpan({
      cls: "mediavault-detail-meta",
      text: watch.watchedAt,
    });

    const deleteBtn = headerRow.createEl("button", {
      cls: "clickable-icon mediavault-delete-watch-btn",
    });
    setIcon(deleteBtn, "trash-2");
    deleteBtn.setAttr("aria-label", t("detail.deleteThisWatch"));
    deleteBtn.addEventListener("click", () => {
      void this.handleDeleteEpisodeWatch(episode, watch.id);
    });

    this.renderEpisodeStarRating(card, watch);
    this.renderEpisodeEmotionPicker(card, watch);

    const notesInput = card.createEl("textarea", {
      cls: "mediavault-episode-notes-input",
      attr: { placeholder: t("watchSession.review") },
    });
    notesInput.value = watch.review ?? "";
    makeClearable(notesInput);
    notesInput.addEventListener("blur", () => {
      void (async () => {
        const value = notesInput.value.trim();

        if (value === (watch.review ?? "")) return;

        await updateEpisodeWatch(this.storage, watch.id, {
          review: value === "" ? null : value,
        });
      })();
    });
  }

  private async handleDeleteEpisodeWatch(
    episode: Episode,
    watchId: string,
  ): Promise<void> {
    await deleteEpisodeWatch(this.storage, episode, watchId);
    this.plugin?.refreshLibraryViews();
    this.plugin?.refreshListViews();
    this.onChanged?.();
    await this.render();
  }

  private renderEpisodeStarRating(
    container: HTMLElement,
    watch: EpisodeWatch,
  ): void {
    const wrap = container.createDiv({ cls: "mediavault-episode-star-rating" });
    const current = watch.rating ?? 0;

    for (let i = 1; i <= 5; i++) {
      const star = wrap.createEl("button", {
        cls: "clickable-icon mediavault-star-btn",
      });
      setIcon(star, "star");
      star.toggleClass("is-filled", i <= current);
      star.setAttr(
        "aria-label",
        t("detail.rateStars", { n: i, plural: i === 1 ? "" : "s" }),
      );
      star.addEventListener("click", () => {
        void (async () => {
          await updateEpisodeWatch(this.storage, watch.id, { rating: i });
          await this.render();
        })();
      });
    }
  }

  private static readonly EMOTIONS = [
    { id: "happy", icon: "smile" },
    { id: "joy", icon: "laugh" },
    { id: "neutral", icon: "meh" },
    { id: "sad", icon: "frown" },
    { id: "crying", icon: "droplets" },
    { id: "shocked", icon: "siren" },
    { id: "love", icon: "heart" },
    { id: "mindblown", icon: "brain" },
  ];

  private renderEpisodeEmotionPicker(
    container: HTMLElement,
    watch: EpisodeWatch,
  ): void {
    const wrap = container.createDiv({
      cls: "mediavault-episode-emotion-picker",
    });
    wrap.createDiv({
      cls: "mediavault-detail-meta",
      text: t("detail.howWasIt"),
    });
    const row = wrap.createDiv({ cls: "mediavault-emotion-row" });

    MediaDetailModal.EMOTIONS.forEach((emotion) => {
      const btn = row.createEl("button", {
        cls: "mediavault-emotion-btn",
      });

      setIcon(btn, emotion.icon);

      btn.toggleClass("is-selected", watch.emotion === emotion.id);

      btn.addEventListener("click", () => {
        void (async () => {
          const next = watch.emotion === emotion.id ? null : emotion.id;

          await updateEpisodeWatch(this.storage, watch.id, {
            emotion: next,
          });

          await this.render();
        })();
      });
    });
  }

  private async renderEpisodeCastCrew(
    contentEl: HTMLElement,
    episode: Episode,
  ): Promise<void> {
    const section = contentEl.createDiv({ cls: "mediavault-detail-section" });
    const loading = section.createDiv({
      cls: "mediavault-modal-hint",
      text: t("detail.loadingCrew"),
    });
    try {
      const { crew } = await this.tmdb.getEpisodeCredits(
        this.media.tmdbId,
        episode.seasonNumber,
        episode.episodeNumber,
      );
      loading.remove();

      if (crew.length > 0) {
        section.createEl("h3", { text: t("detail.crew") });
        const crewList = section.createDiv({
          cls: "mediavault-episode-crew-list",
        });
        crew.forEach((c) => {
          crewList.createDiv({
            cls: "mediavault-detail-meta",
            text: `${c.name} — ${c.job}`,
          });
        });
      } else {
        section.remove();
      }
    } catch {
      loading.remove();
    }
  }

  private async runEpisodeImport(): Promise<void> {
    new Notice(t("notice.importingEpisodes", { title: this.media.title }));
    try {
      const result = await importEpisodesForShow(
        this.storage,
        this.tmdb,
        this.media,
      );
      new Notice(
        t("notice.importedEpisodes", {
          added: result.episodesAdded,
          seasons: result.seasonsProcessed,
        }),
      );
      await this.render();
    } catch (err) {
      new Notice(
        t("notice.episodeImportFailed", { error: (err as Error).message }),
      );
    }
  }

  private async refreshAndNotify(): Promise<void> {
    await this.render();
    this.onChanged?.();
  }

  private async removeFromListAndClose(): Promise<void> {
    if (!this.listContext) return;
    const { listId, listTitle, onRemoved } = this.listContext;
    await this.storage.customLists.removeMedia(listId, this.media.id);
    new Notice(
      t("addToList.removedNotice", {
        title: this.media.title,
        list: listTitle,
      }),
    );
    this.close();
    onRemoved?.();
    this.onChanged?.();
    if (this.plugin) this.plugin.refreshListViews();
  }

  private async confirmAndDelete(alreadyConfirmed = false): Promise<void> {
    if (!alreadyConfirmed) {
      const scope = describeDeletionScope(this.media);
      const confirmed = await confirmDialog(
        this.app,
        t("detail.deleteConfirmBodyWithScope", {
          title: this.media.title,
          scope: scope.map((line) => `\u2022 ${line}`).join("\n"),
        }),
      );
      if (!confirmed) return;
    }

    const summary = await deleteMedia(this.app, this.storage, this.media.id);
    if (!summary) {
      new Notice(t("notice.itemNoLongerExists"));
      this.close();
      return;
    }

    new Notice(t("notice.mediaDeleted", { title: summary.mediaTitle }));
    this.close();

    if (this.plugin) {
      this.plugin.refreshLibraryViews();
      this.plugin.refreshListViews();
    } else {
      this.onChanged?.();
    }
  }

  onClose(): void {
    this.plugin?.unregisterLocaleAwareModal(this);
    this.contentEl.empty();
  }

  rerenderForLocaleChange(): void {
    void this.render();
  }
}
