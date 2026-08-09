import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type MediaVaultPlugin from "../../main";
import { VIEW_TYPE_EXPLORE } from "../../constants";
import { TMDBSearchResult } from "../../types/tmdb";
import {
  buildRecommendations,
  RecommendationSet,
} from "../../services/recommendation/engine";
import { Recommendation } from "../../services/recommendation/types";
import { DiscoverFilters } from "../../api/tmdb";
import { MediaType } from "../../types/enums";
import { renderDiscoverCard } from "../components/discover-card";
import { t } from "../../i18n";
import { makeClearable } from "../components/clearable-input";

type ExploreTab = "discover" | "browse" | "search";

interface ExploreCardData {
  tmdbId: number;
  mediaKind: "movie" | "tv";
  title: string;
  year: number | null;
  posterPath: string | null;
  reason?: string;
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
    const resultsEl = body.createDiv({ cls: "mediavault-explore-results" });

    if (this.searchQuery) {
      await this.runSearch(this.searchQuery, resultsEl);
    } else {
      resultsEl.createEl("p", {
        cls: "mediavault-empty-state",
        text: t("explore.startTypingToSearch"),
      });
    }

    input.addEventListener("input", () => {
      this.searchQuery = input.value;
      if (this.searchDebounce) window.clearTimeout(this.searchDebounce);
      this.searchDebounce = window.setTimeout(
        () => void this.runSearch(this.searchQuery, resultsEl),
        350,
      );
    });
  }

  private async runSearch(
    query: string,
    resultsEl: HTMLElement,
  ): Promise<void> {
    resultsEl.empty();
    if (query.trim().length < 2) {
      resultsEl.createEl("p", {
        cls: "mediavault-empty-state",
        text: t("explore.keepTyping"),
      });
      return;
    }
    const loading = resultsEl.createEl("p", {
      cls: "mediavault-empty-state",
      text: t("explore.searching"),
    });
    try {
      const result = await this.plugin.tmdb.searchMulti(query);
      loading.remove();
      if (result.items.length === 0) {
        resultsEl.createEl("p", {
          cls: "mediavault-empty-state",
          text: t("explore.noResults"),
        });
        return;
      }
      this.renderGrid(resultsEl, result.items.map(fromSearchResult));
    } catch (err) {
      loading.setText(
        t("explore.searchFailed", { error: (err as Error).message }),
      );
    }
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

function fromSearchResult(item: TMDBSearchResult): ExploreCardData {
  return {
    tmdbId: item.tmdbId,
    mediaKind: item.mediaKind,
    title: item.title,
    year: item.year,
    posterPath: item.posterPath,
  };
}
