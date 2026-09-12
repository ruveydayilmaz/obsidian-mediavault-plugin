import { ItemView, WorkspaceLeaf, setIcon, Platform } from "obsidian";
import type MediaVaultPlugin from "../../main";
import { VIEW_TYPE_LIBRARY } from "../../constants";
import { t } from "../../i18n";
import {
  getLocalizedGenreNames,
  getLocalizedGenreName,
} from "../../services/genre-labels";
import { MediaType } from "../../types/enums";
import { MediaItem } from "../../models/media";
import {
  LibraryFilter,
  LibrarySortField,
  LibraryQuery,
  DEFAULT_LIBRARY_QUERY,
  runLibraryQuery,
  getProgressTabs,
  applyProgressTab,
} from "../../services/library-query";
import {
  renderPoster,
  statusLabel,
  formatRuntime,
  formatRating,
  getMediaPercentWatched,
  renderProgressOverlay,
  progressFillClasses,
} from "../components/media-render";
import { MediaDetailModal } from "../modals/media-detail-modal";
import { renderVirtualList } from "../components/virtual-list";
import { StatsBar } from "../components/stats-bar";
import { renderFavoritesSection } from "../components/favorites-carousel";
import { renderCustomListsCarousel } from "../components/custom-lists-carousel";
import { ListDetailModal } from "../modals/list-detail-modal";
import { tmdbImageUrl } from "../../api/tmdb-normalize";
import { resolveMediaImageSrc } from "../../services/local-image-service";
import { getSystemFavoriteLists } from "../../services/list-service";
import { isAndroidDevice } from "../../utils/platform";
import { makeClearable } from "../components/clearable-input";
import {
  FilterCriteria,
  createDefaultFilterCriteria,
  RuntimeMode,
  buildFilterContext,
  applyUniversalFilter,
  collectFilterOptions,
  hasActiveFilters,
} from "../../services/filter-service";

type ViewMode = "grid" | "list" | "table";
type ScreenTier = "mobile" | "tablet" | "desktop";

const MOBILE_BREAKPOINT_PX = 520;
const TABLET_BREAKPOINT_PX = 900;

function screenTierForWidth(width: number): ScreenTier {
  if (width < MOBILE_BREAKPOINT_PX) return "mobile";
  if (width < TABLET_BREAKPOINT_PX) return "tablet";
  return "desktop";
}

const MOBILE_GRID_BREAKPOINT_PX = 380;

function mobileGridColumnCount(): number {
  return window.innerWidth <= MOBILE_GRID_BREAKPOINT_PX ? 3 : 4;
}

function desktopFavoritesCount(width: number): number {
  const IDEAL_CARD_WIDTH_PX = 150;
  return Math.min(6, Math.max(3, Math.round(width / IDEAL_CARD_WIDTH_PX)));
}

function getFilterOptions(): { value: LibraryFilter; label: string }[] {
  return [
    { value: "all", label: t("common.all") },
    { value: "movies", label: t("library.filterMovies") },
    { value: "shows", label: t("library.filterShows") },
    { value: "favorites", label: t("nav.favorites") },
  ];
}

function getSortOptions(): { value: LibrarySortField; label: string }[] {
  return [
    { value: "recent", label: t("library.sortRecent") },
    { value: "title", label: t("library.sortTitle") },
    { value: "rating", label: t("library.sortRating") },
    { value: "watchCount", label: t("library.sortWatchCount") },
    { value: "year", label: t("library.sortYear") },
    { value: "runtime", label: t("library.sortRuntime") },
  ];
}

export class LibraryView extends ItemView {
  private plugin: MediaVaultPlugin;
  private query: LibraryQuery = { ...DEFAULT_LIBRARY_QUERY };
  private viewMode: ViewMode = "grid";
  private filterCriteria: FilterCriteria = createDefaultFilterCriteria();
  private filterPanelOpen = false;

  private contentEl2!: HTMLElement;
  private viewRoot!: HTMLElement;
  private collapseMinHeightHandler: (() => void) | null = null;
  private toolbarEl!: HTMLElement;
  private toolbarSearchEl!: HTMLElement;
  private toolbarActionsEl!: HTMLElement;
  private statsEl!: HTMLElement;
  private statsBar = new StatsBar();
  private parentEl!: HTMLElement;
  private favoritesEl!: HTMLElement;
  private tabsEl!: HTMLElement;
  private filtersEl!: HTMLElement;
  private filterToggleBtn!: HTMLButtonElement;
  private searchDebounce: number | null = null;

  private favoritesTab: "movies" | "shows" = "movies";
  private customListsRefreshToken = 0;
  private customListsEl!: HTMLElement;

  private screenTier: ScreenTier = "desktop";
  private resizeObserver?: ResizeObserver;
  private viewToggleEl!: HTMLElement;

  private favoritesVisibleCount = 4;
  private lastAllMedia: MediaItem[] = [];
  private showCarousels = true;

  constructor(leaf: WorkspaceLeaf, plugin: MediaVaultPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.viewMode = plugin.storage.settings.get().defaultView;
    const settings = plugin.storage.settings.get();
    this.query = {
      ...DEFAULT_LIBRARY_QUERY,
      sortField: settings.defaultSort,
      sortDirection: settings.defaultSortDirection,
    };
  }

  getViewType(): string {
    return VIEW_TYPE_LIBRARY;
  }

  getDisplayText(): string {
    return "Mediavault library";
  }

  getIcon(): string {
    return "clapperboard";
  }

  async onOpen(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("mediavault-library-root");
    this.viewRoot = root;

    this.statsEl = root.createDiv({ cls: "mediavault-stats-container" });
    this.parentEl = root.createDiv({ cls: "mediavault-parent-container" });
    this.favoritesEl = this.parentEl.createDiv({
      cls: "mediavault-favorites-container",
    });
    this.customListsEl = this.parentEl.createDiv({
      cls: "mediavault-custom-lists-container",
    });
    this.tabsEl = root.createDiv({ cls: "mediavault-tabs-container" });

    this.screenTier = screenTierForWidth(root.clientWidth);
    this.viewMode = this.defaultViewModeForTier(this.screenTier);

    this.renderToolbar(root);
    this.filtersEl = root.createDiv({ cls: "mediavault-filters-container" });
    this.contentEl2 = root.createDiv({ cls: "mediavault-library-content" });

    this.favoritesVisibleCount = Platform.isMobile
      ? mobileGridColumnCount()
      : desktopFavoritesCount(root.clientWidth);
    this.renderViewToggle();

    this.resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? root.clientWidth;

      this.updateToolbarWrapState();

      const nextFavoritesCount = Platform.isMobile
        ? mobileGridColumnCount()
        : desktopFavoritesCount(this.favoritesEl.clientWidth || width);
      const favoritesCountChanged =
        nextFavoritesCount !== this.favoritesVisibleCount;
      if (favoritesCountChanged) {
        this.favoritesVisibleCount = nextFavoritesCount;
      }

      const nextTier = screenTierForWidth(width);
      if (nextTier === this.screenTier) {
        if (favoritesCountChanged && this.showCarousels)
          void this.refreshFavorites(this.lastAllMedia);
        return;
      }

      this.screenTier = nextTier;
      this.viewMode = this.defaultViewModeForTier(nextTier);
      this.renderViewToggle();
      void this.refresh();
    });
    this.resizeObserver.observe(root);

    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.resizeObserver?.disconnect();
    this.clearPendingMinHeightCollapse();
  }

  private defaultViewModeForTier(tier: ScreenTier): ViewMode {
    if (tier === "mobile") return "grid";
    return this.plugin.storage.settings.get().defaultView;
  }

  async refresh(): Promise<void> {
    const all = await this.plugin.storage.media.getAll();
    this.lastAllMedia = all;
    const filterCtx = await buildFilterContext(this.plugin.storage);
    const universallyFiltered = applyUniversalFilter(
      all,
      this.filterCriteria,
      filterCtx,
    );

    this.renderTabs(universallyFiltered);
    this.renderFilterPanel(all);

    const result = runLibraryQuery(universallyFiltered, this.query);
    this.renderContent(
      result.items,
      result.total,
      result.page,
      Math.ceil(result.total / result.pageSize) || 1,
    );

    this.applyCarouselVisibility();

    const carouselRefreshes = this.showCarousels
      ? [this.refreshFavorites(all), this.refreshCustomLists(all)]
      : [];

    await Promise.all([this.refreshStats(), ...carouselRefreshes]);
  }

  private applyCarouselVisibility(): void {
    const show = this.plugin.storage.settings.get().showLibraryCarousels;
    this.showCarousels = show;
    this.parentEl.toggleClass("mediavault-carousels-hidden", !show);
    if (!show) {
      this.favoritesEl.empty();
      this.customListsEl.empty();
    }
  }

  private async refreshStats(): Promise<void> {
    const stats = await this.plugin.statistics.getAll();

    this.statsBar.update(this.statsEl, stats, this.screenTier === "mobile");
  }

  private async refreshFavorites(all: MediaItem[]): Promise<void> {
    this.favoritesEl.empty();

    if (Platform.isMobile) {
      this.favoritesVisibleCount = mobileGridColumnCount();
    }

    await renderFavoritesSection(
      this.favoritesEl,
      this.plugin.storage,
      all,
      this.favoritesTab,
      (tab) => {
        this.favoritesTab = tab;
        void this.refreshFavorites(all);
      },
      () => {
        this.query.filter = this.favoritesTab === "movies" ? "movies" : "shows";
        this.filterCriteria.favoritesOnly = true;
        this.query.page = 1;
        void (async () => {
          await this.refresh();
          this.contentEl2.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        })();
      },
      (item) => this.openDetail(item),
      {
        visibleCount: this.favoritesVisibleCount,
        fillPlaceholders: Platform.isMobile,
      },
      (tab) => {
        void this.openFavoriteList(tab);
      },
    );
  }

  private async openFavoriteList(tab: "movies" | "shows"): Promise<void> {
    const allForLists = await this.plugin.storage.media.getAll();
    const [movieList, tvList] = getSystemFavoriteLists(
      allForLists,
      this.plugin.storage.settings.get(),
    );

    new ListDetailModal(
      this.app,
      this.plugin,
      tab === "movies" ? movieList : tvList,
    ).open();
  }

  private async refreshCustomLists(all: MediaItem[]): Promise<void> {
    const token = ++this.customListsRefreshToken;

    const lists = await this.plugin.storage.customLists.getAll();

    if (token !== this.customListsRefreshToken) return;

    this.customListsEl.empty();

    await renderCustomListsCarousel(
      this.customListsEl,
      all,
      lists,
      (list) => {
        new ListDetailModal(this.app, this.plugin, list).open();
      },
      () => {
        void this.plugin.activateListsView();
      },
    );
  }

  private renderTabs(all: MediaItem[]): void {
    const barEl: HTMLElement =
      this.tabsEl.querySelector<HTMLElement>(".mediavault-progress-tabs") ??
      this.tabsEl.createDiv({ cls: "mediavault-progress-tabs" });

    const existingButtons = Array.from(
      barEl.querySelectorAll<HTMLButtonElement>(".mediavault-progress-tab"),
    );

    const progressTabs = getProgressTabs();
    progressTabs.forEach((tab, i) => {
      const count =
        tab.value === "all"
          ? all.length
          : applyProgressTab(all, tab.value).length;
      const isActive = this.query.progressTab === tab.value;

      let btn = existingButtons[i];
      if (!btn) {
        btn = barEl.createEl("button", { cls: "mediavault-progress-tab" });
        btn.addEventListener("click", () => {
          if (this.query.progressTab === tab.value) return;
          this.query.progressTab = tab.value;
          this.query.page = 1;
          void this.refresh();
        });
      }
      btn.setText(`${tab.label} (${count})`);
      btn.toggleClass("is-active", isActive);
    });

    for (let i = progressTabs.length; i < existingButtons.length; i++) {
      existingButtons[i].remove();
    }
  }

  private renderFilterPanel(all: MediaItem[]): void {
    const active = hasActiveFilters(this.filterCriteria);
    this.filterToggleBtn.toggleClass("is-active", active);

    this.filtersEl.empty();
    if (!this.filterPanelOpen) return;

    const options = collectFilterOptions(all);
    const panel = this.filtersEl.createDiv({ cls: "mediavault-filter-panel" });

    if (this.screenTier === "mobile") {
      const mobileControlsRow = panel.createDiv({
        cls: "mediavault-filter-row mediavault-filter-sort-size-row",
      });
      this.renderSortControls(mobileControlsRow);
      this.renderPageSizeControl(mobileControlsRow);
    }

    const applyAndRefresh = () => {
      this.query.page = 1;
      void this.refresh();
    };

    this.renderGenreSelector(panel, options.genres, all, applyAndRefresh);
    this.renderMultiCheckGroup(
      panel,
      t("library.tags"),
      options.tags,
      this.filterCriteria.tags,
      applyAndRefresh,
    );

    this.renderTagInput(
      panel,
      t("library.actor"),
      options.actors,
      this.filterCriteria.actors,
      applyAndRefresh,
    );
    this.renderTagInput(
      panel,
      t("library.director"),
      options.directors,
      this.filterCriteria.directors,
      applyAndRefresh,
    );
    this.renderTagInput(
      panel,
      t("library.studio"),
      options.studios,
      this.filterCriteria.studios,
      applyAndRefresh,
    );

    const yearRow = panel.createDiv({ cls: "mediavault-filter-row" });
    yearRow.createSpan({
      cls: "mediavault-filter-label",
      text: t("library.releaseYear"),
    });
    const yearGroup = yearRow.createDiv({
      cls: "mediavault-filter-controls-group",
    });
    const yearMin = yearGroup.createEl("input", {
      cls: "mediavault-filter-number-input",
      type: "number",
      attr: { placeholder: t("library.min") },
    });
    yearMin.value = this.filterCriteria.yearMin?.toString() ?? "";
    yearMin.addEventListener("change", () => {
      this.filterCriteria.yearMin = yearMin.value
        ? parseInt(yearMin.value, 10)
        : undefined;
      applyAndRefresh();
    });
    yearGroup.createSpan({ cls: "mediavault-filter-range-sep", text: "–" });
    const yearMax = yearGroup.createEl("input", {
      cls: "mediavault-filter-number-input",
      type: "number",
      attr: { placeholder: t("library.max") },
    });
    yearMax.value = this.filterCriteria.yearMax?.toString() ?? "";
    yearMax.addEventListener("change", () => {
      this.filterCriteria.yearMax = yearMax.value
        ? parseInt(yearMax.value, 10)
        : undefined;
      applyAndRefresh();
    });

    const runtimeRow = panel.createDiv({ cls: "mediavault-filter-row" });
    runtimeRow.createSpan({
      cls: "mediavault-filter-label",
      text: t("library.runtime"),
    });
    const runtimeModeSelect = runtimeRow.createEl("select");
    (
      [
        { value: "movie", label: t("library.movieRuntime") },
        { value: "episode", label: t("library.episodeRuntime") },
        { value: "total", label: t("library.totalSeriesRuntime") },
      ] as { value: RuntimeMode; label: string }[]
    ).forEach((opt) => {
      runtimeModeSelect.createEl("option", {
        value: opt.value,
        text: opt.label,
      });
    });
    runtimeModeSelect.value = this.filterCriteria.runtimeMode;
    runtimeModeSelect.addEventListener("change", () => {
      this.filterCriteria.runtimeMode = runtimeModeSelect.value as RuntimeMode;
      applyAndRefresh();
    });
    const runtimeGroup = runtimeRow.createDiv({
      cls: "mediavault-filter-controls-group",
    });
    const runtimeMin = runtimeGroup.createEl("input", {
      cls: "mediavault-filter-number-input mediavault-filter-runtime-input",
      type: "number",
      attr: { min: "0", step: "5", placeholder: t("library.min") },
    });
    runtimeMin.value = this.filterCriteria.runtimeMin?.toString() ?? "";

    runtimeMin.addEventListener("change", () => {
      const parsed = parseInt(runtimeMin.value, 10);
      const v = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
      this.filterCriteria.runtimeMin = v;
      runtimeMin.value = v?.toString() ?? "";
      applyAndRefresh();
    });
    runtimeGroup.createSpan({ cls: "mediavault-filter-range-sep", text: "–" });
    const runtimeMax = runtimeGroup.createEl("input", {
      cls: "mediavault-filter-number-input mediavault-filter-runtime-input",
      type: "number",
      attr: { min: "0", step: "5", placeholder: t("library.max") },
    });
    runtimeMax.value = this.filterCriteria.runtimeMax?.toString() ?? "";

    runtimeMax.addEventListener("change", () => {
      const parsed = parseInt(runtimeMax.value, 10);
      const v = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
      this.filterCriteria.runtimeMax = v;
      runtimeMax.value = v?.toString() ?? "";
      applyAndRefresh();
    });

    this.renderMinSlider(
      panel,
      t("library.rating"),
      0,
      10,
      0.5,
      this.filterCriteria.ratingMin,
      (v) => {
        this.filterCriteria.ratingMin = v;
        applyAndRefresh();
      },
    );

    const favRow = panel.createDiv({
      cls: "mediavault-filter-row mediavault-filter-checkbox-row",
    });
    const favLabel = favRow.createEl("label", {
      cls: "mediavault-filter-checkbox-label",
    });
    const favCheckbox = favLabel.createEl("input", { type: "checkbox" });
    favLabel.createSpan({ text: t("library.favoriteOnly") });
    favCheckbox.checked = this.filterCriteria.favoritesOnly;
    favCheckbox.addEventListener("change", () => {
      this.filterCriteria.favoritesOnly = favCheckbox.checked;
      applyAndRefresh();
    });

    this.renderMinSlider(
      panel,
      t("library.comfortScore"),
      0,
      10,
      1,
      this.filterCriteria.comfortScoreMin,
      (v) => {
        this.filterCriteria.comfortScoreMin = v;
        applyAndRefresh();
      },
    );

    this.renderMinSlider(
      panel,
      t("library.watchCount"),
      0,
      20,
      1,
      this.filterCriteria.watchCountMin,
      (v) => {
        this.filterCriteria.watchCountMin = v;
        applyAndRefresh();
      },
    );

    const resetBtn = panel.createEl("button", {
      cls: "mediavault-filter-reset",
      text: t("library.clearFilters"),
    });
    resetBtn.addEventListener("click", () => {
      this.filterCriteria = createDefaultFilterCriteria();
      applyAndRefresh();
    });
  }

  private renderGenreSelector(
    panel: HTMLElement,
    genres: string[],
    all: MediaItem[],
    onChange: () => void,
  ): void {
    if (genres.length === 0) return;
    const row = panel.createDiv({
      cls: "mediavault-filter-row mediavault-filter-genre-row",
    });
    row.createSpan({
      cls: "mediavault-filter-label",
      text: t("library.genre"),
    });

    const grid = row.createDiv({ cls: "mediavault-genre-grid" });
    const settings = this.plugin.storage.settings.get();
    const cache = settings.genreImageCache;
    const toResolveImages: string[] = [];
    const toResolveLabels: string[] = [];

    genres.forEach((genre) => {
      const card = grid.createDiv({ cls: "mediavault-genre-card" });
      card.toggleClass(
        "is-selected",
        this.filterCriteria.genres.includes(genre),
      );

      const cacheKey = this.genreCacheKey(genre, all);
      const cachedUrl = cache[cacheKey] ?? cache[genre];
      if (cachedUrl) {
        card.style.backgroundImage = `url(${cachedUrl})`;
      } else {
        toResolveImages.push(genre);
      }
      card.createDiv({ cls: "mediavault-genre-card-overlay" });
      const nameEl = card.createDiv({
        cls: "mediavault-genre-card-name",
        text: genre,
      });
      nameEl.dataset.genreKey = genre;
      toResolveLabels.push(genre);

      card.addEventListener("click", () => {
        const idx = this.filterCriteria.genres.indexOf(genre);
        if (idx >= 0) this.filterCriteria.genres.splice(idx, 1);
        else this.filterCriteria.genres.push(genre);
        card.toggleClass(
          "is-selected",
          this.filterCriteria.genres.includes(genre),
        );
        onChange();
      });
    });

    if (toResolveImages.length > 0) {
      void this.resolveGenreImages(toResolveImages, all, grid);
    }
    void this.resolveGenreLabels(toResolveLabels, all, grid);
  }

  private genreCacheKey(genre: string, all: MediaItem[]): string {
    for (const m of all) {
      const idx = m.genres.indexOf(genre);
      if (idx >= 0 && m.genreIds?.[idx] !== undefined) {
        return `id:${m.genreIds[idx]}`;
      }
    }
    return genre;
  }

  private async resolveGenreLabels(
    genresNeeded: string[],
    all: MediaItem[],
    grid: HTMLElement,
  ): Promise<void> {
    const updates: Record<string, string> = {};

    for (const genre of genresNeeded) {
      let genreId: number | undefined;
      let kind: "movie" | "tv" | undefined;
      for (const m of all) {
        const idx = m.genres.indexOf(genre);
        if (idx >= 0 && m.genreIds?.[idx] !== undefined) {
          genreId = m.genreIds[idx];
          kind =
            m.type === MediaType.Movie
              ? "movie"
              : m.type === MediaType.TVShow
                ? "tv"
                : undefined;
          break;
        }
      }
      if (genreId === undefined || !kind) continue;

      const localized = await getLocalizedGenreName(
        this.plugin.tmdb,
        kind,
        genreId,
        genre,
      );
      if (localized !== genre) updates[genre] = localized;
    }

    if (Object.keys(updates).length === 0) return;

    grid
      .querySelectorAll<HTMLElement>(".mediavault-genre-card-name")
      .forEach((nameEl) => {
        const key = nameEl.dataset.genreKey;
        if (key && updates[key]) nameEl.setText(updates[key]);
      });
  }

  private async resolveGenreImages(
    genresNeeded: string[],
    all: MediaItem[],
    grid: HTMLElement,
  ): Promise<void> {
    const updates: Record<string, string> = {};
    const keyByGenre: Record<string, string> = {};
    for (const genre of genresNeeded) {
      const source = all.find(
        (m) => m.genres.includes(genre) && (m.backdropPath || m.posterPath),
      );
      if (!source) continue;
      const url = resolveMediaImageSrc(
        source.backdropPath ?? source.posterPath,
        (p) => tmdbImageUrl(p, "w500"),
      );
      if (!url) continue;
      const key = this.genreCacheKey(genre, all);
      updates[key] = url;
      keyByGenre[genre] = key;
    }
    if (Object.keys(updates).length === 0) return;

    const current = this.plugin.storage.settings.get().genreImageCache;
    await this.plugin.storage.settings.update({
      genreImageCache: { ...current, ...updates },
    });

    const cards = Array.from(
      grid.querySelectorAll<HTMLElement>(".mediavault-genre-card"),
    );
    cards.forEach((card) => {
      const name = card.querySelector<HTMLElement>(
        ".mediavault-genre-card-name",
      )?.dataset.genreKey;
      const key = name ? keyByGenre[name] : undefined;
      if (key && updates[key])
        card.style.backgroundImage = `url(${updates[key]})`;
    });
  }

  private renderMultiCheckGroup(
    panel: HTMLElement,
    label: string,
    options: string[],
    selected: string[],
    onChange: () => void,
  ): void {
    if (options.length === 0) return;
    const row = panel.createDiv({
      cls: "mediavault-filter-row mediavault-filter-checkgroup",
    });
    row.createSpan({ cls: "mediavault-filter-label", text: label });
    const list = row.createDiv({ cls: "mediavault-filter-checklist" });
    options.forEach((opt) => {
      const optLabel = list.createEl("label", {
        cls: "mediavault-filter-checkitem",
      });
      const checkbox = optLabel.createEl("input", { type: "checkbox" });
      checkbox.checked = selected.includes(opt);
      optLabel.createSpan({ text: opt });
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          if (!selected.includes(opt)) selected.push(opt);
        } else {
          const idx = selected.indexOf(opt);
          if (idx >= 0) selected.splice(idx, 1);
        }
        onChange();
      });
    });
  }

  private renderTagInput(
    panel: HTMLElement,
    label: string,
    options: string[],
    selected: string[],
    onChange: () => void,
  ): void {
    if (options.length === 0) return;
    const row = panel.createDiv({ cls: "mediavault-filter-row" });
    row.createSpan({ cls: "mediavault-filter-label", text: label });

    if (selected.length > 0) {
      const chips = row.createDiv({ cls: "mediavault-filter-chips" });
      selected.forEach((name) => {
        const chip = chips.createDiv({
          cls: "mediavault-filter-chip",
          text: name,
        });
        const remove = chip.createSpan({
          cls: "mediavault-filter-chip-remove",
          text: " ×",
        });
        remove.addEventListener("click", () => {
          const idx = selected.indexOf(name);
          if (idx >= 0) selected.splice(idx, 1);
          onChange();
        });
      });
    }

    const commitValue = (value: string) => {
      const trimmed = value.trim();
      if (trimmed && options.includes(trimmed) && !selected.includes(trimmed)) {
        selected.push(trimmed);
        onChange();
        return true;
      }
      return false;
    };

    const isTurkish = navigator.language.toLowerCase().startsWith("tr"); // TODO: fix later direkt "tr" olmasin
    const toLowerCase = isTurkish
      ? (s: string) => s
      : (s: string) => s.toLowerCase();

    if (isAndroidDevice()) {
      const wrap = row.createDiv({ cls: "mediavault-autocomplete-wrap" });
      const input = wrap.createEl("input", {
        type: "text",
        attr: {
          placeholder: t("library.addTagPlaceholder", {
            label: toLowerCase(label),
          }),
        },
      });
      makeClearable(input);
      const suggestionsEl = wrap.createDiv({
        cls: "mediavault-autocomplete-list is-hidden",
      });

      const renderSuggestions = () => {
        const query = input.value.trim().toLowerCase();
        suggestionsEl.empty();
        if (!query) {
          suggestionsEl.addClass("is-hidden");
          return;
        }
        const matches = options
          .filter(
            (opt) =>
              opt.toLowerCase().includes(query) && !selected.includes(opt),
          )
          .slice(0, 8);
        if (matches.length === 0) {
          suggestionsEl.addClass("is-hidden");
          return;
        }
        matches.forEach((opt) => {
          const item = suggestionsEl.createDiv({
            cls: "mediavault-autocomplete-item",
            text: opt,
          });

          item.addEventListener("mousedown", (evt) => {
            evt.preventDefault();
            commitValue(opt);
            input.value = "";
            suggestionsEl.addClass("is-hidden");
          });
        });
        suggestionsEl.removeClass("is-hidden");
      };

      input.addEventListener("input", renderSuggestions);
      input.addEventListener("focus", renderSuggestions);
      input.addEventListener("blur", () =>
        window.setTimeout(() => suggestionsEl.addClass("is-hidden"), 150),
      );
      input.addEventListener("change", () => {
        if (commitValue(input.value)) input.value = "";
      });
    } else {
      const datalistId = `mediavault-filter-datalist-${toLowerCase(label)}`;
      const input = row.createEl("input", {
        type: "text",
        attr: {
          placeholder: t("library.addTagPlaceholder", {
            label: toLowerCase(label),
          }),
          list: datalistId,
        },
      });
      makeClearable(input);
      const datalist = row.createEl("datalist", { attr: { id: datalistId } });
      options.forEach((opt) => datalist.createEl("option", { value: opt }));

      input.addEventListener("change", () => {
        if (commitValue(input.value)) input.value = "";
      });
    }
  }

  private renderMinSlider(
    panel: HTMLElement,
    label: string,
    min: number,
    max: number,
    step: number,
    value: number | undefined,
    onChange: (v: number | undefined) => void,
  ): void {
    const row = panel.createDiv({ cls: "mediavault-filter-row" });
    row.createSpan({
      cls: "mediavault-filter-label",
      text: t("library.minSuffix", { label }),
    });
    const slider = row.createEl("input", {
      cls: "mediavault-filter-slider",
      type: "range",
      attr: { min: String(min), max: String(max), step: String(step) },
    });
    slider.value = String(value ?? min);
    const valueLabel = row.createSpan({
      cls: "mediavault-filter-slider-value",
      text: String(value ?? min),
    });
    slider.addEventListener("input", () => valueLabel.setText(slider.value));
    slider.addEventListener("change", () => {
      const v = parseFloat(slider.value);
      onChange(v > min ? v : undefined);
    });
  }

  private renderToolbar(root: HTMLElement): void {
    const toolbar = root.createDiv({ cls: "mediavault-library-toolbar" });
    this.toolbarEl = toolbar;

    const searchInput = toolbar.createEl("input", {
      type: "text",
      placeholder: t("library.searchLibraryPlaceholder"),
      cls: "mediavault-library-search",
    });
    this.toolbarSearchEl = searchInput;
    makeClearable(searchInput);
    searchInput.addEventListener("input", () => {
      if (this.searchDebounce) window.clearTimeout(this.searchDebounce);
      this.searchDebounce = window.setTimeout(() => {
        this.query.searchText = searchInput.value;
        this.query.page = 1;
        void this.refresh();
      }, 250);
    });

    const actions = toolbar.createDiv({
      cls: "mediavault-library-toolbar-actions",
    });
    this.toolbarActionsEl = actions;

    if (this.screenTier !== "mobile") {
      this.renderSortControls(actions);
      this.renderPageSizeControl(actions);
    }

    const filterGroup = actions.createDiv({
      cls: "mediavault-library-toolbar-filter-group",
    });
    const filterSelect = filterGroup.createEl("select", {
      cls: "mediavault-library-filter",
    });
    getFilterOptions().forEach((opt) => {
      filterSelect.createEl("option", { value: opt.value, text: opt.label });
    });
    filterSelect.value = this.query.filter;
    filterSelect.addEventListener("change", () => {
      this.query.filter = filterSelect.value as LibraryFilter;
      this.filterCriteria.favoritesOnly = false;
      this.query.page = 1;
      void this.refresh();
    });

    this.filterToggleBtn = filterGroup.createEl("button", {
      cls: "clickable-icon mediavault-filters-toggle",
    });
    setIcon(this.filterToggleBtn, "sliders-horizontal");
    this.filterToggleBtn.setAttr("aria-label", t("library.filters"));
    this.filterToggleBtn.addEventListener("click", () => {
      this.filterPanelOpen = !this.filterPanelOpen;
      void this.refresh();
    });

    this.viewToggleEl = actions.createDiv({
      cls: "mediavault-library-view-toggle",
    });
    this.renderViewToggle();

    window.requestAnimationFrame(() => this.updateToolbarWrapState());
  }

  private updateToolbarWrapState(): void {
    if (!this.toolbarSearchEl || !this.toolbarActionsEl || !this.viewRoot)
      return;
    const searchTop = this.toolbarSearchEl.getBoundingClientRect().top;
    const actionsTop = this.toolbarActionsEl.getBoundingClientRect().top;
    const wrapped = Math.round(actionsTop) > Math.round(searchTop) + 1;
    this.viewRoot.toggleClass("mediavault-toolbar-wrapped", wrapped);
  }

  private renderSortControls(container: HTMLElement): void {
    const sortGroup = container.createDiv({
      cls: "mediavault-library-sort-group",
    });

    const sortSelect = sortGroup.createEl("select", {
      cls: "mediavault-library-sort",
    });
    getSortOptions().forEach((opt) => {
      sortSelect.createEl("option", {
        value: opt.value,
        text: opt.label,
      });
    });
    sortSelect.value = this.query.sortField;
    sortSelect.addEventListener("change", () => {
      this.query.sortField = sortSelect.value as LibrarySortField;
      void this.plugin.storage.settings.update({
        defaultSort: this.query.sortField,
      });
      void this.refresh();
    });

    const dirBtn = sortGroup.createEl("button", {
      cls: "clickable-icon mediavault-library-sort-dir",
    });
    setIcon(
      dirBtn,
      this.query.sortDirection === "asc" ? "arrow-up" : "arrow-down",
    );
    dirBtn.setAttr(
      "aria-label",
      this.query.sortDirection === "asc"
        ? t("library.ascending")
        : t("library.descending"),
    );
    dirBtn.addEventListener("click", () => {
      this.query.sortDirection =
        this.query.sortDirection === "asc" ? "desc" : "asc";
      setIcon(
        dirBtn,
        this.query.sortDirection === "asc" ? "arrow-up" : "arrow-down",
      );
      dirBtn.setAttr(
        "aria-label",
        this.query.sortDirection === "asc"
          ? t("library.ascending")
          : t("library.descending"),
      );
      void this.plugin.storage.settings.update({
        defaultSortDirection: this.query.sortDirection,
      });
      void this.refresh();
    });
  }

  private renderPageSizeControl(container: HTMLElement): void {
    const pageSizeSelect = container.createEl("select", {
      cls: "mediavault-library-page-size",
    });
    [
      { value: "24", label: t("library.pageSize", { n: 24 }) },
      { value: "100", label: t("library.pageSize", { n: 100 }) },
      { value: "1000", label: t("library.pageSize", { n: 1000 }) },
      { value: "999999", label: t("library.showAll") },
    ].forEach((opt) =>
      pageSizeSelect.createEl("option", { value: opt.value, text: opt.label }),
    );
    pageSizeSelect.value = String(this.query.pageSize);
    pageSizeSelect.addEventListener("change", () => {
      this.query.pageSize = parseInt(pageSizeSelect.value, 10);
      this.query.page = 1;
      void this.refresh();
    });
  }

  private renderViewToggle(): void {
    this.viewToggleEl.empty();
    if (this.screenTier === "mobile") return;
    const viewModeIcons: Record<ViewMode, string> = {
      grid: "layout-grid",
      list: "rows-3",
      table: "table",
    };
    const availableModes: ViewMode[] = ["grid", "list", "table"];

    availableModes.forEach((mode) => {
      const btn = this.viewToggleEl.createEl("button", {
        cls:
          "clickable-icon mediavault-view-toggle-btn" +
          (mode === this.viewMode ? " is-active" : ""),
      });
      setIcon(btn, viewModeIcons[mode]);
      btn.setAttr(
        "aria-label",
        mode === "grid"
          ? t("library.viewGrid")
          : mode === "list"
            ? t("library.viewList")
            : t("library.viewTable"),
      );
      btn.addEventListener("click", () => {
        this.viewMode = mode;
        this.viewToggleEl
          .querySelectorAll("button")
          .forEach((b) => b.removeClass("is-active"));
        btn.addClass("is-active");
        void this.plugin.storage.settings.update({ defaultView: mode });
        void this.refresh();
      });
    });
  }

  private renderContent(
    items: MediaItem[],
    total: number,
    page: number,
    totalPages: number,
  ): void {
    const prevHeight = this.contentEl2.getBoundingClientRect().height;
    this.clearPendingMinHeightCollapse();

    this.contentEl2.empty();

    if (total === 0) {
      this.contentEl2.createDiv({
        cls: "mediavault-library-empty",
        text: t("library.emptyBody"),
      });
      this.applyMinHeightReservation(prevHeight);
      return;
    }

    if (this.viewMode === "grid") {
      this.renderGrid(items);
    } else if (this.viewMode === "list") {
      this.renderList(items);
    } else {
      this.renderTable(items);
    }

    this.renderPagination(page, totalPages, total);
    this.applyMinHeightReservation(prevHeight);
  }

  private applyMinHeightReservation(prevHeight: number): void {
    if (prevHeight <= 0) return;
    this.contentEl2.setCssStyles({ minHeight: `${prevHeight}px` });

    const collapse = () => this.clearPendingMinHeightCollapse();
    this.collapseMinHeightHandler = collapse;
    this.viewRoot?.addEventListener("scroll", collapse, { passive: true });
  }

  private clearPendingMinHeightCollapse(): void {
    this.contentEl2.setCssStyles({ minHeight: "" });
    if (this.collapseMinHeightHandler) {
      this.viewRoot?.removeEventListener(
        "scroll",
        this.collapseMinHeightHandler,
      );
      this.collapseMinHeightHandler = null;
    }
  }

  private renderGrid(items: MediaItem[]): void {
    const grid = this.contentEl2.createDiv({ cls: "mediavault-grid" });
    items.forEach((item) => {
      const card = grid.createDiv({ cls: "mediavault-card" });
      card.addEventListener("click", () => this.openDetail(item));
      const poster = card.createDiv({ cls: "mediavault-card-poster" });
      renderPoster(poster, item, "w200");

      void getMediaPercentWatched(this.plugin.storage, item).then((percent) => {
        if (percent === null) return;
        renderProgressOverlay(poster, percent, item.status);
      });
    });
  }

  private listCleanup: (() => void) | null = null;

  private renderList(items: MediaItem[]): void {
    if (this.listCleanup) this.listCleanup();

    const list = this.contentEl2.createDiv({ cls: "mediavault-list" });

    this.listCleanup = renderVirtualList({
      container: list,
      items,
      rowHeight: 76,
      threshold: 100,
      renderRow: (item) => this.buildListRow(item),
    });
  }

  private buildListRow(item: MediaItem): HTMLElement {
    const row = createDiv();
    row.addClass("mediavault-list-row");
    row.addEventListener("click", () => this.openDetail(item));
    const poster = row.createDiv({ cls: "mediavault-list-poster" });
    renderPoster(poster, item, "w200");

    void getMediaPercentWatched(this.plugin.storage, item).then((percent) => {
      if (percent === null) return;
      renderProgressOverlay(
        poster,
        percent,
        item.status,
        "mediavault-list-poster-progress",
      );
    });

    const info = row.createDiv({ cls: "mediavault-list-info" });
    info.createDiv({ cls: "mediavault-list-title", text: item.title });
    const meta = info.createDiv({
      cls: "mediavault-list-meta",
      text: [item.year, item.genres.join(", "), formatRuntime(item.runtime)]
        .filter(Boolean)
        .join(" · "),
    });
    void getLocalizedGenreNames(this.plugin.tmdb, item).then((names) => {
      meta.setText(
        [item.year, names.join(", "), formatRuntime(item.runtime)]
          .filter(Boolean)
          .join(" · "),
      );
    });

    row.createDiv({
      cls: "mediavault-list-status",
      text: statusLabel(item.status),
    });
    row.createDiv({
      cls: "mediavault-list-rating",
      text:
        item.averageRating !== null
          ? `★ ${formatRating(item.averageRating)}`
          : "—",
    });

    return row;
  }

  private renderTable(items: MediaItem[]): void {
    const table = this.contentEl2.createEl("table", {
      cls: "mediavault-table",
    });
    const thead = table.createEl("thead");
    const headRow = thead.createEl("tr");
    [
      t("library.sortTitle"),
      t("library.releaseYear"),
      t("library.type"),
      t("library.status"),
      t("library.progress"),
      t("library.rating"),
      t("library.watchCount"),
      t("library.runtime"),
    ].forEach((h) => {
      headRow.createEl("th", { text: h });
    });

    const tbody = table.createEl("tbody");
    items.forEach((item) => {
      const row = tbody.createEl("tr");
      row.addEventListener("click", () => this.openDetail(item));
      row.createEl("td", { text: item.title });
      row.createEl("td", { text: item.year ? String(item.year) : "—" });
      row.createEl("td", { text: item.type });
      row.createEl("td", { text: statusLabel(item.status) });

      const progressCell = row.createEl("td");
      void getMediaPercentWatched(this.plugin.storage, item).then((percent) => {
        if (percent === null) {
          progressCell.setText("\u2014");
          return;
        }
        const track = progressCell.createDiv({
          cls: "mediavault-table-progress",
        });
        track.createDiv({
          cls: progressFillClasses(
            "mediavault-card-progress-fill",
            item.status,
          ),
          attr: { style: `width:${Math.round(percent)}%` },
        });
      });

      row.createEl("td", { text: formatRating(item.averageRating) });
      row.createEl("td", { text: String(item.watchCount) });
      row.createEl("td", { text: formatRuntime(item.runtime) });
    });
  }

  private openDetail(item: MediaItem): void {
    new MediaDetailModal(
      this.app,
      this.plugin.storage,
      this.plugin.tmdb,
      item,
      () => {
        this.plugin.refreshLibraryViews();
        this.plugin.refreshListViews();
      },
      this.plugin,
      "episodes",
      this.plugin.trakt,
    ).open();
  }

  private renderPagination(
    page: number,
    totalPages: number,
    total: number,
  ): void {
    if (totalPages <= 1) return;

    const pagination = this.contentEl2.createDiv({
      cls: "mediavault-pagination",
    });

    const prevBtn = pagination.createEl("button", {
      cls: "clickable-icon mediavault-pagination-btn",
    });
    setIcon(prevBtn, "chevron-left");
    prevBtn.setAttr("aria-label", t("common.previous"));
    prevBtn.disabled = page <= 1;
    prevBtn.addEventListener("click", () => {
      this.query.page = page - 1;
      void (async () => {
        await this.refresh();
        this.contentEl2.scrollIntoView({ behavior: "smooth", block: "start" });
      })();
    });

    pagination.createSpan({
      cls: "mediavault-pagination-info",
      text: t("library.paginationSummary", { page, totalPages, total }),
    });

    const nextBtn = pagination.createEl("button", {
      cls: "clickable-icon mediavault-pagination-btn",
    });
    setIcon(nextBtn, "chevron-right");
    nextBtn.setAttr("aria-label", t("common.next"));
    nextBtn.disabled = page >= totalPages;
    nextBtn.addEventListener("click", () => {
      this.query.page = page + 1;
      void (async () => {
        await this.refresh();
        this.contentEl2.scrollIntoView({ behavior: "smooth", block: "start" });
      })();
    });
  }
}
