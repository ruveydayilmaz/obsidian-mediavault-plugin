import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type MediaVaultPlugin from "../../main";
import { VIEW_TYPE_EXPLORE } from "../../constants";
import { TMDBSearchResult, TMDBPersonSearchResult } from "../../types/tmdb";
import {
  buildRecommendations,
  RecommendationSet,
} from "../../services/recommendation/engine";
import { Recommendation } from "../../services/recommendation/types";
import { DiscoverFilters } from "../../api/tmdb";
import { MediaType } from "../../types/enums";
import { renderDiscoverCard } from "../components/discover-card";
import { renderPersonCard } from "../components/person-card";
import { t } from "../../i18n";
import { makeClearable } from "../components/clearable-input";

type ExploreTab = "discover" | "browse" | "search";
type SearchCategory = "all" | "movie" | "tv" | "person";

interface ExploreCardData {
  tmdbId: number;
  mediaKind: "movie" | "tv";
  title: string;
  year: number | null;
  posterPath: string | null;
  reason?: string;
}

interface MediaSearchState {
  query: string;
  items: TMDBSearchResult[];
  page: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  generation: number;
}

interface PersonSearchState {
  query: string;
  items: TMDBPersonSearchResult[];
  page: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  generation: number;
}

export class ExploreView extends ItemView {
  private plugin: MediaVaultPlugin;
  private rootEl!: HTMLElement;
  private activeTab: ExploreTab = "discover";
  private ownedKeys: Set<string> = new Set();

  private browseKind: "movie" | "tv" = "movie";
  private browseFilters: DiscoverFilters = {};
  private browseGenres: { id: number; name: string }[] = [];
  private browseGenresLocale: string | null = null;

  private searchQuery = "";
  private searchDebounce: number | null = null;
  private searchCategory: SearchCategory = "all";

  private movieSearchState: MediaSearchState | null = null;
  private tvSearchState: MediaSearchState | null = null;
  private personSearchState: PersonSearchState | null = null;

  private searchGeneration = 0;

  constructor(leaf: WorkspaceLeaf, plugin: MediaVaultPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_EXPLORE;
  }

  getDisplayText(): string {
    return t("explore.displayName");
  }

  getIcon(): string {
    return "compass";
  }

  async onOpen(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("mediavault-explore-root");
    this.rootEl = root;
    await this.refresh();
  }

  async onClose(): Promise<void> {
    // Nothing to clean up
  }

  async refresh(): Promise<void> {
    const allMedia = await this.plugin.storage.media.getAll();
    this.ownedKeys = new Set(
      allMedia.map(
        (m) => `${m.type === MediaType.Movie ? "movie" : "tv"}:${m.tmdbId}`,
      ),
    );

    this.rootEl.empty();
    this.renderTabBar();

    const body = this.rootEl.createDiv({ cls: "mediavault-explore-body" });
    if (!this.plugin.storage.settings.get().tmdbApiKey) {
      body.createEl("p", {
        cls: "mediavault-empty-state",
        text: t("explore.addTmdbKeyHint"),
      });
      return;
    }

    if (this.activeTab === "discover") await this.renderDiscoverTab(body);
    else if (this.activeTab === "browse") await this.renderBrowseTab(body);
    else await this.renderSearchTab(body);
  }

  private renderTabBar(): void {
    const bar = this.rootEl.createDiv({ cls: "mediavault-explore-tabs" });
    (["discover", "browse", "search"] as ExploreTab[]).forEach((tab) => {
      const btn = bar.createEl("button", {
        cls:
          "mediavault-explore-tab" +
          (this.activeTab === tab ? " is-active" : ""),
        text: t(`explore.${tab}`),
      });
      btn.addEventListener("click", () => {
        if (this.activeTab === tab) return;
        this.activeTab = tab;
        void this.refresh();
      });
    });
  }

  private async renderDiscoverTab(body: HTMLElement): Promise<void> {
    const loading = body.createEl("p", {
      cls: "mediavault-empty-state",
      text: t("explore.loading"),
    });

    try {
      const [trendingMovies, trendingTV, popularMovies, popularTV] =
        await Promise.all([
          this.plugin.tmdb.getTrending("movie", "week"),
          this.plugin.tmdb.getTrending("tv", "week"),
          this.plugin.tmdb.getPopular("movie"),
          this.plugin.tmdb.getPopular("tv"),
        ]);
      loading.remove();

      this.renderRow(
        body,
        t("explore.trendingMovies"),
        trendingMovies.items.slice(0, 12).map(fromSearchResult),
      );
      this.renderRow(
        body,
        t("explore.trendingTV"),
        trendingTV.items.slice(0, 12).map(fromSearchResult),
      );

      const popularThisWeek = [
        ...popularMovies.items.slice(0, 6),
        ...popularTV.items.slice(0, 6),
      ].map(fromSearchResult);
      this.renderRow(body, t("explore.popularThisWeek"), popularThisWeek);

      await this.renderRecommendedRow(body);
    } catch (err) {
      loading.setText(
        t("explore.failedToLoad", { error: (err as Error).message }),
      );
    }
  }

  private async renderRecommendedRow(body: HTMLElement): Promise<void> {
    const heading = body.createEl("h3", {
      text: t("explore.recommendedForYou"),
    });
    const rowLoading = body.createEl("p", {
      cls: "mediavault-empty-state",
      text: t("explore.buildingRecommendations"),
    });

    let recs: RecommendationSet;
    try {
      recs = await buildRecommendations(this.plugin.storage, this.plugin.tmdb);
    } catch (err) {
      rowLoading.setText(
        t("explore.couldNotBuildRecs", { error: (err as Error).message }),
      );
      return;
    }

    const combined: Recommendation[] = [
      ...recs.similarToFavorites,
      ...recs.hiddenGems,
    ];
    rowLoading.remove();

    if (combined.length === 0) {
      heading.remove();
      body.createEl("p", {
        cls: "mediavault-empty-state",
        text: t("explore.rateFewWatchesHint"),
      });
      return;
    }

    const cards: ExploreCardData[] = combined
      .filter(
        (
          r,
        ): r is Recommendation & {
          tmdbId: number;
          mediaKind: "movie" | "tv";
        } => r.tmdbId !== undefined && r.mediaKind !== undefined,
      )
      .map((r) => ({
        tmdbId: r.tmdbId,
        mediaKind: r.mediaKind,
        title: r.title,
        year: r.year,
        posterPath: r.posterPath,
        reason: r.reasons[0],
      }));
    this.renderRow(body, null, cards);
  }

  private async renderBrowseTab(body: HTMLElement): Promise<void> {
    const currentLocale = this.plugin.storage.settings.get().language;
    if (
      this.browseGenres.length === 0 ||
      this.browseGenresLocale !== currentLocale
    ) {
      this.browseGenres = await this.plugin.tmdb.getGenres(this.browseKind);
      this.browseGenresLocale = currentLocale;
    }

    const filterBar = body.createDiv({ cls: "mediavault-explore-filter-bar" });

    const primaryRow = filterBar.createDiv({
      cls: "mediavault-explore-filter-primary",
    });

    const kindSelect = primaryRow.createEl("select");
    [
      { value: "movie", label: t("explore.filterMovies") },
      { value: "tv", label: t("explore.filterTvShows") },
    ].forEach((opt) =>
      kindSelect.createEl("option", { value: opt.value, text: opt.label }),
    );
    kindSelect.value = this.browseKind;
    kindSelect.addEventListener("change", () => {
      this.browseKind = kindSelect.value as "movie" | "tv";
      this.browseGenres = [];
      this.browseFilters = { ...this.browseFilters, genreId: undefined };
      void this.refresh();
    });

    const genreSelect = primaryRow.createEl("select");
    genreSelect.createEl("option", { value: "", text: t("explore.anyGenre") });
    this.browseGenres.forEach((g) =>
      genreSelect.createEl("option", { value: String(g.id), text: g.name }),
    );
    genreSelect.value =
      this.browseFilters.genreId !== undefined
        ? String(this.browseFilters.genreId)
        : "";
    genreSelect.addEventListener("change", () => {
      this.browseFilters.genreId = genreSelect.value
        ? parseInt(genreSelect.value, 10)
        : undefined;
      void this.refreshBrowseResults(body);
    });

    const moreToggle = primaryRow.createEl("button", {
      cls: "clickable-icon mediavault-explore-more-filters-toggle",
    });
    setIcon(moreToggle, "sliders-horizontal");
    moreToggle.setAttr("aria-label", t("explore.moreFilters"));
    const moreFilters = filterBar.createDiv({
      cls: "mediavault-explore-filter-more is-collapsed",
    });
    moreToggle.addEventListener("click", () => {
      moreFilters.toggleClass(
        "is-collapsed",
        !moreFilters.hasClass("is-collapsed"),
      );
      moreToggle.toggleClass(
        "is-active",
        moreFilters.hasClass("is-collapsed") === false,
      );
    });

    const yearMin = moreFilters.createEl("input", {
      type: "number",
      attr: { placeholder: t("explore.yearFromPlaceholder") },
    });
    yearMin.value = this.browseFilters.yearMin?.toString() ?? "";
    yearMin.addEventListener("change", () => {
      this.browseFilters.yearMin = yearMin.value
        ? parseInt(yearMin.value, 10)
        : undefined;
      void this.refreshBrowseResults(body);
    });

    const yearMax = moreFilters.createEl("input", {
      type: "number",
      attr: { placeholder: t("explore.yearToPlaceholder") },
    });
    yearMax.value = this.browseFilters.yearMax?.toString() ?? "";
    yearMax.addEventListener("change", () => {
      this.browseFilters.yearMax = yearMax.value
        ? parseInt(yearMax.value, 10)
        : undefined;
      void this.refreshBrowseResults(body);
    });

    const runtimeMin = moreFilters.createEl("input", {
      type: "number",
      attr: { placeholder: t("explore.runtimeMinPlaceholder") },
    });
    runtimeMin.value = this.browseFilters.runtimeMin?.toString() ?? "";
    runtimeMin.addEventListener("change", () => {
      this.browseFilters.runtimeMin = runtimeMin.value
        ? parseInt(runtimeMin.value, 10)
        : undefined;
      void this.refreshBrowseResults(body);
    });

    const runtimeMax = moreFilters.createEl("input", {
      type: "number",
      attr: { placeholder: t("explore.runtimeMaxPlaceholder") },
    });
    runtimeMax.value = this.browseFilters.runtimeMax?.toString() ?? "";
    runtimeMax.addEventListener("change", () => {
      this.browseFilters.runtimeMax = runtimeMax.value
        ? parseInt(runtimeMax.value, 10)
        : undefined;
      void this.refreshBrowseResults(body);
    });

    const ratingMin = moreFilters.createEl("input", {
      type: "number",
      attr: {
        placeholder: t("explore.ratingMinPlaceholder"),
        step: "0.5",
        min: "0",
        max: "10",
      },
    });
    ratingMin.value = this.browseFilters.ratingMin?.toString() ?? "";
    ratingMin.addEventListener("change", () => {
      this.browseFilters.ratingMin = ratingMin.value
        ? parseFloat(ratingMin.value)
        : undefined;
      void this.refreshBrowseResults(body);
    });

    const langInput = moreFilters.createEl("input", {
      type: "text",
      attr: { placeholder: t("explore.languagePlaceholder"), maxlength: "2" },
    });
    langInput.value = this.browseFilters.language ?? "";
    makeClearable(langInput);
    langInput.addEventListener("change", () => {
      this.browseFilters.language = langInput.value.trim() || undefined;
      void this.refreshBrowseResults(body);
    });

    const resultsEl = body.createDiv({ cls: "mediavault-explore-results" });
    await this.renderBrowseResultsInto(resultsEl);
  }

  private async refreshBrowseResults(body: HTMLElement): Promise<void> {
    const resultsEl = body.querySelector<HTMLElement>(
      ".mediavault-explore-results",
    );
    if (!resultsEl) return;
    resultsEl.empty();
    await this.renderBrowseResultsInto(resultsEl);
  }

  private async renderBrowseResultsInto(resultsEl: HTMLElement): Promise<void> {
    resultsEl.empty();
    const loading = resultsEl.createEl("p", {
      cls: "mediavault-empty-state",
      text: t("explore.loading"),
    });
    try {
      const result = await this.plugin.tmdb.discover(
        this.browseKind,
        this.browseFilters,
      );
      loading.remove();
      if (result.items.length === 0) {
        resultsEl.createEl("p", {
          cls: "mediavault-empty-state",
          text: t("explore.noResultsForFilters"),
        });
        return;
      }
      this.renderGrid(resultsEl, result.items.map(fromSearchResult));
    } catch (err) {
      loading.setText(
        t("explore.browseFailed", { error: (err as Error).message }),
      );
    }
  }

  private async renderSearchTab(body: HTMLElement): Promise<void> {
    const input = body.createEl("input", {
      type: "text",
      cls: "mediavault-explore-search-input",
      attr: { placeholder: t("explore.searchPlaceholder") },
    });
    input.value = this.searchQuery;
    makeClearable(input);

    const categoryBar = body.createDiv({ cls: "mediavault-detail-tabs" });
    const resultsEl = body.createDiv({ cls: "mediavault-explore-results" });

    const categories: { id: SearchCategory; label: string }[] = [
      { id: "all", label: t("explore.searchAll") },
      { id: "movie", label: t("explore.filterMovies") },
      { id: "tv", label: t("explore.filterTvShows") },
      { id: "person", label: t("explore.searchPeople") },
    ];
    const renderCategoryBar = (): void => {
      categoryBar.empty();
      categories.forEach((cat) => {
        const btn = categoryBar.createEl("button", {
          cls:
            "mediavault-detail-tab" +
            (this.searchCategory === cat.id ? " is-active" : ""),
          text: cat.label,
        });
        btn.addEventListener("click", () => {
          if (this.searchCategory === cat.id) return;
          this.searchCategory = cat.id;
          renderCategoryBar();
          void this.renderSearchResults(resultsEl);
        });
      });
    };
    renderCategoryBar();

    if (this.searchQuery) {
      await this.renderSearchResults(resultsEl);
    } else {
      resultsEl.createEl("p", {
        cls: "mediavault-empty-state",
        text: t("explore.startTypingToSearch"),
      });
    }

    input.addEventListener("input", () => {
      this.searchQuery = input.value;

      this.movieSearchState = null;
      this.tvSearchState = null;
      this.personSearchState = null;
      if (this.searchDebounce) window.clearTimeout(this.searchDebounce);
      this.searchDebounce = window.setTimeout(
        () => void this.renderSearchResults(resultsEl),
        350,
      );
    });
  }

  private async renderSearchResults(resultsEl: HTMLElement): Promise<void> {
    const query = this.searchQuery;
    resultsEl.empty();
    if (query.trim().length < 2) {
      resultsEl.createEl("p", {
        cls: "mediavault-empty-state",
        text: t("explore.keepTyping"),
      });
      return;
    }

    const category = this.searchCategory;

    if (category === "movie" && this.movieSearchState?.query === query) {
      this.renderCachedMediaResults(resultsEl, "movie", this.movieSearchState);
      return;
    }
    if (category === "tv" && this.tvSearchState?.query === query) {
      this.renderCachedMediaResults(resultsEl, "tv", this.tvSearchState);
      return;
    }
    if (category === "person" && this.personSearchState?.query === query) {
      this.renderCachedPersonResults(resultsEl, this.personSearchState);
      return;
    }

    const loading = resultsEl.createEl("p", {
      cls: "mediavault-empty-state",
      text: t("explore.searching"),
    });

    try {
      if (category === "person") {
        const result = await this.plugin.tmdb.searchPeople(query, 1);
        if (query !== this.searchQuery || this.searchCategory !== category) {
          return;
        }
        loading.remove();
        this.personSearchState = {
          query,
          items: dedupeById(result.items, (p) => String(p.tmdbPersonId)),
          page: 1,
          hasMore: hasMorePages(result),
          isLoadingMore: false,
          generation: ++this.searchGeneration,
        };
        if (this.personSearchState.items.length === 0) {
          resultsEl.createEl("p", {
            cls: "mediavault-empty-state",
            text: t("explore.noPeopleFound"),
          });
          return;
        }
        this.renderCachedPersonResults(resultsEl, this.personSearchState);
        return;
      }

      if (category === "movie" || category === "tv") {
        const result = await this.plugin.tmdb.searchMedia(query, category, 1);
        if (query !== this.searchQuery || this.searchCategory !== category) {
          return;
        }
        loading.remove();
        const state: MediaSearchState = {
          query,
          items: dedupeById(result.items, (m) => `${m.mediaKind}:${m.tmdbId}`),
          page: 1,
          hasMore: hasMorePages(result),
          isLoadingMore: false,
          generation: ++this.searchGeneration,
        };
        if (category === "movie") this.movieSearchState = state;
        else this.tvSearchState = state;

        if (state.items.length === 0) {
          resultsEl.createEl("p", {
            cls: "mediavault-empty-state",
            text: t("explore.noResults"),
          });
          return;
        }
        this.renderCachedMediaResults(resultsEl, category, state);
        return;
      }

      const [media, people] = await Promise.all([
        this.plugin.tmdb.searchMediaMulti(query, 1),
        this.plugin.tmdb.searchPeople(query, 1),
      ]);
      if (query !== this.searchQuery || this.searchCategory !== category) {
        return;
      }
      loading.remove();

      if (media.items.length === 0 && people.items.length === 0) {
        resultsEl.createEl("p", {
          cls: "mediavault-empty-state",
          text: t("explore.noResults"),
        });
        return;
      }

      const mediaCards = media.items.map(fromSearchResult);
      if (mediaCards.length > 0) this.renderGrid(resultsEl, mediaCards);
      if (people.items.length > 0) {
        resultsEl.createEl("h3", { text: t("explore.searchPeople") });
        const peopleGrid = resultsEl.createDiv({ cls: "mediavault-grid" });
        people.items.forEach((person) =>
          renderPersonCard(
            peopleGrid,
            { app: this.app, storage: this.plugin.storage, tmdb: this.plugin.tmdb },
            person,
          ),
        );
      }
    } catch (err) {
      loading.setText(
        t("explore.searchFailed", { error: (err as Error).message }),
      );
    }
  }

  private renderCachedMediaResults(
    resultsEl: HTMLElement,
    category: "movie" | "tv",
    state: MediaSearchState,
  ): void {
    resultsEl.empty();
    const grid = resultsEl.createDiv({ cls: "mediavault-grid" });
    state.items.forEach((item) =>
      this.renderCard(grid, fromSearchResult(item)),
    );
    this.renderLoadMoreControl(resultsEl, grid, () =>
        void this.loadMoreMedia(category, resultsEl, grid),
      state,
    );
  }

  private renderCachedPersonResults(
    resultsEl: HTMLElement,
    state: PersonSearchState,
  ): void {
    resultsEl.empty();
    const grid = resultsEl.createDiv({ cls: "mediavault-grid" });
    state.items.forEach((person) =>
      renderPersonCard(
        grid,
        { app: this.app, storage: this.plugin.storage, tmdb: this.plugin.tmdb },
        person,
      ),
    );
    this.renderLoadMoreControl(
      resultsEl,
      grid,
      () => void this.loadMorePeople(resultsEl, grid),
      state,
    );
  }

  private renderLoadMoreControl(
    resultsEl: HTMLElement,
    grid: HTMLElement,
    onLoadMore: () => void,
    state: { hasMore: boolean; isLoadingMore: boolean },
  ): void {
    resultsEl
      .querySelectorAll(".mediavault-explore-load-more-row")
      .forEach((el) => el.remove());
    if (!state.hasMore) return;

    const row = resultsEl.createDiv({
      cls: "mediavault-explore-load-more-row",
    });
    if (state.isLoadingMore) {
      row.createEl("p", {
        cls: "mediavault-empty-state",
        text: t("explore.loadingMore"),
      });
      return;
    }
    const moreBtn = row.createEl("button", {
      cls: "mediavault-actor-load-more",
      text: t("explore.loadMore"),
    });
    moreBtn.addEventListener("click", onLoadMore);
  }

  private async loadMoreMedia(
    category: "movie" | "tv",
    resultsEl: HTMLElement,
    grid: HTMLElement,
  ): Promise<void> {
    const state =
      category === "movie" ? this.movieSearchState : this.tvSearchState;
    if (!state || state.isLoadingMore || !state.hasMore) return;
    const generation = state.generation;
    state.isLoadingMore = true;
    this.renderLoadMoreControl(
      resultsEl,
      grid,
      () => void this.loadMoreMedia(category, resultsEl, grid),
      state,
    );

    try {
      const nextPage = state.page + 1;
      const result = await this.plugin.tmdb.searchMedia(
        state.query,
        category,
        nextPage,
      );
      const current =
        category === "movie" ? this.movieSearchState : this.tvSearchState;

      if (!current || current.generation !== generation) return;

      const existingIds = new Set(
        current.items.map((m) => `${m.mediaKind}:${m.tmdbId}`),
      );
      const newItems = result.items.filter(
        (m) => !existingIds.has(`${m.mediaKind}:${m.tmdbId}`),
      );
      current.items = [...current.items, ...newItems];
      current.page = nextPage;
      current.hasMore = hasMorePages(result);
      current.isLoadingMore = false;

      newItems.forEach((item) => this.renderCard(grid, fromSearchResult(item)));
      this.renderLoadMoreControl(
        resultsEl,
        grid,
        () => void this.loadMoreMedia(category, resultsEl, grid),
        current,
      );
    } catch (err) {
      const current =
        category === "movie" ? this.movieSearchState : this.tvSearchState;
      if (!current || current.generation !== generation) return;
      current.isLoadingMore = false;
      this.renderLoadMoreControl(
        resultsEl,
        grid,
        () => void this.loadMoreMedia(category, resultsEl, grid),
        current,
      );
      resultsEl.createEl("p", {
        cls: "mediavault-empty-state",
        text: t("explore.searchFailed", { error: (err as Error).message }),
      });
    }
  }

  private async loadMorePeople(
    resultsEl: HTMLElement,
    grid: HTMLElement,
  ): Promise<void> {
    const state = this.personSearchState;
    if (!state || state.isLoadingMore || !state.hasMore) return;
    const generation = state.generation;
    state.isLoadingMore = true;
    this.renderLoadMoreControl(
      resultsEl,
      grid,
      () => void this.loadMorePeople(resultsEl, grid),
      state,
    );

    try {
      const nextPage = state.page + 1;
      const result = await this.plugin.tmdb.searchPeople(
        state.query,
        nextPage,
      );
      const current = this.personSearchState;
      if (!current || current.generation !== generation) return;

      const existingIds = new Set(current.items.map((p) => p.tmdbPersonId));
      const newItems = result.items.filter(
        (p) => !existingIds.has(p.tmdbPersonId),
      );
      current.items = [...current.items, ...newItems];
      current.page = nextPage;
      current.hasMore = hasMorePages(result);
      current.isLoadingMore = false;

      newItems.forEach((person) =>
        renderPersonCard(
          grid,
          { app: this.app, storage: this.plugin.storage, tmdb: this.plugin.tmdb },
          person,
        ),
      );
      this.renderLoadMoreControl(
        resultsEl,
        grid,
        () => void this.loadMorePeople(resultsEl, grid),
        current,
      );
    } catch (err) {
      const current = this.personSearchState;
      if (!current || current.generation !== generation) return;
      current.isLoadingMore = false;
      this.renderLoadMoreControl(
        resultsEl,
        grid,
        () => void this.loadMorePeople(resultsEl, grid),
        current,
      );
      resultsEl.createEl("p", {
        cls: "mediavault-empty-state",
        text: t("explore.searchFailed", { error: (err as Error).message }),
      });
    }
  }

  private renderCard(container: HTMLElement, card: ExploreCardData): void {
    renderDiscoverCard(
      container,
      {
        app: this.app,
        storage: this.plugin.storage,
        tmdb: this.plugin.tmdb,
        plugin: this.plugin,
        layout: "grid",
        isOwned: (c) => this.ownedKeys.has(`${c.mediaKind}:${c.tmdbId}`),
        onAdded: (c) => {
          this.plugin.refreshLibraryViews();
          this.ownedKeys.add(`${c.mediaKind}:${c.tmdbId}`);
        },
      },
      card,
    );
  }

  private renderRow(
    container: HTMLElement,
    heading: string | null,
    cards: ExploreCardData[],
  ): void {
    if (cards.length === 0) return;
    if (heading) container.createEl("h3", { text: heading });
    const row = container.createDiv({ cls: "mediavault-explore-row" });
    cards.forEach((card) =>
      renderDiscoverCard(
        row,
        {
          app: this.app,
          storage: this.plugin.storage,
          tmdb: this.plugin.tmdb,
          plugin: this.plugin,
          isOwned: (c) => this.ownedKeys.has(`${c.mediaKind}:${c.tmdbId}`),
          onAdded: (c) => {
            this.plugin.refreshLibraryViews();
            this.ownedKeys.add(`${c.mediaKind}:${c.tmdbId}`);
          },
        },
        card,
      ),
    );
  }

  private renderGrid(container: HTMLElement, cards: ExploreCardData[]): void {
    const grid = container.createDiv({ cls: "mediavault-grid" });
    cards.forEach((card) =>
      renderDiscoverCard(
        grid,
        {
          app: this.app,
          storage: this.plugin.storage,
          tmdb: this.plugin.tmdb,
          plugin: this.plugin,
          layout: "grid",
          isOwned: (c) => this.ownedKeys.has(`${c.mediaKind}:${c.tmdbId}`),
          onAdded: (c) => {
            this.plugin.refreshLibraryViews();
            this.ownedKeys.add(`${c.mediaKind}:${c.tmdbId}`);
          },
        },
        card,
      ),
    );
  }
}

function hasMorePages(result: {
  total: number;
  page: number;
  pageSize: number;
}): boolean {
  if (result.pageSize === 0) return false;
  return result.page * result.pageSize < result.total;
}

function dedupeById<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function fromSearchResult(item: TMDBSearchResult): ExploreCardData {
  return {
    tmdbId: item.tmdbId,
    mediaKind: item.mediaKind,
    title: item.title,
    year: item.year,
    posterPath: item.posterPath,
  };
}
