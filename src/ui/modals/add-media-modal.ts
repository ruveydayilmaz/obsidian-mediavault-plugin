import { App, Notice, SuggestModal } from "obsidian";
import type { TMDBService } from "../../api/tmdb";
import type { StorageService } from "../../services/storage";
import { TMDBSearchResult } from "../../types/tmdb";
import { tmdbImageUrl } from "../../api/tmdb-normalize";
import { addMediaFromTMDB } from "../../services/media-import";
import type { MediaItem } from "../../models/media";
import { t } from "../../i18n";

const DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;

export class AddMediaModal extends SuggestModal<TMDBSearchResult> {
  private tmdb: TMDBService;
  private storage: StorageService;
  private onAdded?: (media: MediaItem) => void;

  private debounceTimer: number | null = null;
  private latestQuery = "";
  private latestResults: TMDBSearchResult[] = [];
  private pendingResolvers: ((results: TMDBSearchResult[]) => void)[] = [];

  constructor(
    app: App,
    tmdb: TMDBService,
    storage: StorageService,
    onAdded?: (media: MediaItem) => void,
  ) {
    super(app);
    this.tmdb = tmdb;
    this.storage = storage;
    this.onAdded = onAdded;
    this.setPlaceholder(t("explore.addMediaSearchPlaceholder"));

    this.emptyStateText = t("explore.emptyStateText");
  }

  getSuggestions(query: string): Promise<TMDBSearchResult[]> {
    this.latestQuery = query;

    if (query.trim().length < MIN_QUERY_LENGTH) {
      return Promise.resolve([]);
    }

    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);

    return new Promise((resolve) => {
      this.pendingResolvers.push(resolve);

      this.debounceTimer = window.setTimeout(() => {
        void (async () => {
          const queryAtFire = this.latestQuery;

          try {
            const result = await this.tmdb.searchMulti(queryAtFire);

            if (queryAtFire === this.latestQuery) {
              this.latestResults = result.items;
            }
          } catch (err) {
            new Notice(
              t("explore.addMediaSearchFailed", {
                error: (err as Error).message,
              }),
            );
            this.latestResults = [];
          }

          const resolvers = this.pendingResolvers;
          this.pendingResolvers = [];
          resolvers.forEach((r) => r(this.latestResults));
        })();
      }, DEBOUNCE_MS);
    });
  }

  renderSuggestion(item: TMDBSearchResult, el: HTMLElement): void {
    el.addClass("mediavault-search-suggestion");

    const posterUrl = tmdbImageUrl(item.posterPath, "w200");
    const poster = el.createDiv({ cls: "mediavault-search-poster" });
    if (posterUrl) {
      poster.createEl("img", { attr: { src: posterUrl, alt: item.title } });
    } else {
      poster.setText("🎬");
    }

    const info = el.createDiv({ cls: "mediavault-search-info" });
    const titleLine = info.createDiv({ cls: "mediavault-search-title" });
    titleLine.createSpan({ text: item.title });
    if (item.year) {
      titleLine.createSpan({
        text: ` (${item.year})`,
        cls: "mediavault-search-year",
      });
    }
    titleLine.createSpan({
      text:
        item.mediaKind === "movie"
          ? t("explore.kindMovie")
          : t("explore.kindTv"),
      cls: "mediavault-search-kind",
    });

    if (item.overview) {
      info.createDiv({
        cls: "mediavault-search-overview",
        text:
          item.overview.length > 160
            ? item.overview.slice(0, 157) + "..."
            : item.overview,
      });
    }
  }

  onChooseSuggestion(item: TMDBSearchResult): void {
    void this.handleChooseSuggestion(item);
  }

  private async handleChooseSuggestion(item: TMDBSearchResult): Promise<void> {
    try {
      const { mediaItem, alreadyExisted } = await addMediaFromTMDB(
        this.storage,
        this.tmdb,
        item.tmdbId,
        item.mediaKind,
      );

      new Notice(
        alreadyExisted
          ? t("notice.alreadyInLibrary", { title: mediaItem.title })
          : t("notice.addedToLibrary", { title: mediaItem.title }),
      );

      if (!alreadyExisted) {
        this.onAdded?.(mediaItem);
      }
    } catch (err) {
      new Notice(
        t("explore.failedToAddMedia", {
          error: (err as Error).message,
        }),
      );
    }
  }
}
