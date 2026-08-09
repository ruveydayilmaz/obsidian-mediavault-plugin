import { ItemView, WorkspaceLeaf } from "obsidian";
import type MediaVaultPlugin from "../../main";
import { VIEW_TYPE_WATCH_NEXT } from "../../constants";
import { Episode, EpisodeProgress } from "../../models/episode";
import { MediaItem } from "../../models/media";
import {
  getNextEpisodes,
  getUpcomingEpisodes,
  getUpcomingMovies,
  NextEpisodeEntry,
} from "../../services/watch-next-service";
import { markEpisodeWatched } from "../../services/episode-status-sync";
import { renderPoster, formatRuntime } from "../components/media-render";
import { t } from "../../i18n";

function groupByMediaId<T extends { mediaId: string }>(
  items: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const bucket = map.get(item.mediaId);
    if (bucket) bucket.push(item);
    else map.set(item.mediaId, [item]);
  }
  return map;
}

export class WatchNextView extends ItemView {
  private plugin: MediaVaultPlugin;
  private rootEl!: HTMLElement;

  private activeTab: "watch-next" | "upcoming" = "watch-next";

  private watchNextBodyEl: HTMLElement | null = null;
  private static readonly ANIMATION_MS = 300;

  constructor(leaf: WorkspaceLeaf, plugin: MediaVaultPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_WATCH_NEXT;
  }

  getDisplayText(): string {
    return t("watchNext.displayName");
  }

  getIcon(): string {
    return "play-circle";
  }

  async onOpen(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("mediavault-watch-next-root");
    this.rootEl = root;
    await this.refresh();
  }

  async onClose(): Promise<void> {
    // Ignore
  }

  async refresh(): Promise<void> {
    this.rootEl.empty();

    const storage = this.plugin.storage;
    const [allMedia, allEpisodes, allProgress] = await Promise.all([
      storage.media.getAll(),
      storage.episodes.getAll(),
      storage.episodeProgress.getAll(),
    ]);
    const episodesByMediaId = groupByMediaId(allEpisodes);
    const progressByMediaId = groupByMediaId(allProgress);

    this.renderTabbedView(allMedia, episodesByMediaId, progressByMediaId);
  }

  private renderTabbedView(
    allMedia: MediaItem[],
    episodesByMediaId: Map<string, Episode[]>,
    progressByMediaId: Map<string, EpisodeProgress[]>,
  ): void {
    const tabs = this.rootEl.createDiv({
      cls: "mediavault-sidebar-tabs",
    });

    const watchTab = tabs.createDiv({
      text: t("watchNext.title"),
      cls:
        "mediavault-sidebar-tab" +
        (this.activeTab === "watch-next" ? " is-active" : ""),
    });

    const upcomingTab = tabs.createDiv({
      text: t("watchNext.upcoming"),
      cls:
        "mediavault-sidebar-tab" +
        (this.activeTab === "upcoming" ? " is-active" : ""),
    });

    const body = this.rootEl.createDiv({
      cls: "mediavault-sidebar-body",
    });

    const renderBody = () => {
      body.empty();

      watchTab.toggleClass("is-active", this.activeTab === "watch-next");
      upcomingTab.toggleClass("is-active", this.activeTab === "upcoming");

      if (this.activeTab === "watch-next") {
        this.renderWatchNextBody(
          body,
          allMedia,
          episodesByMediaId,
          progressByMediaId,
        );
      } else {
        this.renderUpcomingBody(body, allMedia, episodesByMediaId);
      }
    };

    watchTab.addEventListener("click", () => {
      this.activeTab = "watch-next";
      renderBody();
    });

    upcomingTab.addEventListener("click", () => {
      this.activeTab = "upcoming";
      renderBody();
    });

    renderBody();
  }

  private renderWatchNextBody(
    container: HTMLElement,
    allMedia: MediaItem[],
    episodesByMediaId: Map<string, Episode[]>,
    progressByMediaId: Map<string, EpisodeProgress[]>,
  ): void {
    this.watchNextBodyEl = container;

    const entries = getNextEpisodes(
      allMedia,
      episodesByMediaId,
      progressByMediaId,
    );

    if (entries.length === 0) {
      this.renderWatchNextEmptyState(container);
      return;
    }

    entries.forEach((entry) => this.renderNextEpisodeCard(container, entry));
  }

  private renderWatchNextEmptyState(container: HTMLElement): void {
    container.createEl("p", {
      cls: "mediavault-empty-state",
      text: t("watchNext.emptyQueue"),
    });
  }

  private renderNextEpisodeCard(
    container: HTMLElement,
    entry: NextEpisodeEntry,
  ): void {
    const card = container.createDiv({
      cls: "mediavault-media-card mediavault-watch-next-card",
    });
    this.populateNextEpisodeCard(card, entry);
  }

  private populateNextEpisodeCard(
    card: HTMLElement,
    entry: NextEpisodeEntry,
  ): void {
    card.empty();
    const { media, episode, isNew } = entry;

    const poster = card.createDiv({ cls: "mediavault-media-card-poster" });
    renderPoster(poster, media, "w200");

    const info = card.createDiv({ cls: "mediavault-media-card-info" });
    info.createDiv({ cls: "mediavault-media-card-title", text: media.title });
    info.createDiv({
      cls: "mediavault-media-card-subtitle",
      text: t("watchNext.episodeLabel", {
        season: episode.seasonNumber,
        episode: episode.episodeNumber,
        title: episode.title,
      }),
    });

    const meta = info.createDiv({ cls: "mediavault-media-card-meta" });
    if (episode.runtime)
      meta.createSpan({ text: formatRuntime(episode.runtime) });
    if (isNew)
      meta.createSpan({
        cls: "mediavault-media-card-new-badge",
        text: t("watchNext.newBadge"),
      });

    const watchedBtn = card.createEl("button", { cls: "mod-cta", text: "✓" });
    watchedBtn.addEventListener("click", (evt) => {
      evt.stopPropagation();
      void this.handleMarkWatched(card, entry);
    });

    card.addEventListener("click", (evt) => {
      if (evt.target === watchedBtn) return;
      this.plugin.openMediaDetail(media, episode);
    });
  }

  private async handleMarkWatched(
    card: HTMLElement,
    entry: NextEpisodeEntry,
  ): Promise<void> {
    const watchedBtn = card.querySelector<HTMLButtonElement>("button.mod-cta");
    if (watchedBtn) watchedBtn.disabled = true;

    card.addClass("is-leaving");

    const [, freshEntries] = await Promise.all([
      this.wait(WatchNextView.ANIMATION_MS),
      (async () => {
        await markEpisodeWatched(this.plugin.storage, entry.episode, true);

        this.plugin.refreshLibraryViews({ skipWatchNext: true });
        this.plugin.refreshListViews();
        const [allMedia, allEpisodes, allProgress] = await Promise.all([
          this.plugin.storage.media.getAll(),
          this.plugin.storage.episodes.getAll(),
          this.plugin.storage.episodeProgress.getAll(),
        ]);
        return getNextEpisodes(
          allMedia,
          groupByMediaId(allEpisodes),
          groupByMediaId(allProgress),
        );
      })(),
    ]);

    const replacement = freshEntries.find((e) => e.media.id === entry.media.id);

    if (replacement) {
      this.populateNextEpisodeCard(card, replacement);
      card.removeClass("is-leaving");
      card.addClass("is-entering");

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => card.removeClass("is-entering"));
      });
      return;
    }

    card.addClass("is-collapsing");
    await this.wait(WatchNextView.ANIMATION_MS);
    card.remove();

    if (this.watchNextBodyEl && this.watchNextBodyEl.childElementCount === 0) {
      this.renderWatchNextEmptyState(this.watchNextBodyEl);
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  private renderUpcomingBody(
    container: HTMLElement,
    allMedia: MediaItem[],
    episodesByMediaId: Map<string, Episode[]>,
  ): void {
    const settings = this.plugin.storage.settings.get();
    const activeTab = settings.watchNextUpcomingTab;

    const tabBar = container.createDiv({
      cls: "mediavault-upcoming-tabs",
    });

    (["episodes", "movies"] as const).forEach((tab) => {
      const btn = tabBar.createEl("button", {
        cls:
          "mediavault-upcoming-tab" + (activeTab === tab ? " is-active" : ""),
        text:
          tab === "episodes"
            ? t("watchNext.tabEpisodes")
            : t("watchNext.tabMovies"),
      });

      btn.addEventListener("click", () => {
        if (activeTab === tab) return;

        void (async () => {
          await this.plugin.storage.settings.update({
            watchNextUpcomingTab: tab,
          });

          container.empty();
          this.renderUpcomingBody(container, allMedia, episodesByMediaId);
        })();
      });
    });

    const body = container.createDiv({
      cls: "mediavault-upcoming-body",
    });

    if (activeTab === "episodes") {
      const entries = getUpcomingEpisodes(allMedia, episodesByMediaId);

      if (entries.length === 0) {
        body.createEl("p", {
          cls: "mediavault-empty-state",
          text: t("watchNext.noUpcomingEpisodes"),
        });
        return;
      }

      entries.forEach(({ media, episode, daysUntil }) => {
        const card = body.createDiv({
          cls: "mediavault-media-card",
        });

        const poster = card.createDiv({
          cls: "mediavault-media-card-poster",
        });

        renderPoster(poster, media, "w200");

        const info = card.createDiv({
          cls: "mediavault-media-card-info",
        });

        info.createDiv({
          cls: "mediavault-media-card-title",
          text: media.title,
        });

        info.createDiv({
          cls: "mediavault-media-card-subtitle",
          text: t("watchNext.episodeLabel", {
            season: episode.seasonNumber,
            episode: episode.episodeNumber,
            title: episode.title,
          }),
        });

        const meta = info.createDiv({
          cls: "mediavault-media-card-meta",
        });

        meta.createSpan({
          text: episode.airDate ?? "",
        });

        meta.createSpan({
          cls: "mediavault-upcoming-countdown",
          text: countdownLabel(daysUntil),
        });

        card.addEventListener("click", () =>
          this.plugin.openMediaDetail(media, episode),
        );
      });
    } else {
      const entries = getUpcomingMovies(allMedia);

      if (entries.length === 0) {
        body.createEl("p", {
          cls: "mediavault-empty-state",
          text: t("watchNext.noUpcomingMovies"),
        });
        return;
      }
      entries.forEach(({ media, daysUntil }) => {
        const card = body.createDiv({
          cls: "mediavault-media-card",
        });

        const poster = card.createDiv({
          cls: "mediavault-media-card-poster",
        });

        renderPoster(poster, media, "w200");

        const info = card.createDiv({
          cls: "mediavault-media-card-info",
        });

        info.createDiv({
          cls: "mediavault-media-card-title",
          text: media.title,
        });

        info.createDiv({
          cls: "mediavault-media-card-subtitle",
          text: media.releaseDate ?? "",
        });

        const meta = info.createDiv({
          cls: "mediavault-media-card-meta",
        });

        meta.createSpan({
          cls: "mediavault-upcoming-countdown",
          text: countdownLabel(daysUntil),
        });

        card.addEventListener("click", () =>
          this.plugin.openMediaDetail(media),
        );
      });
    }
  }
}

function countdownLabel(daysUntil: number): string {
  if (daysUntil === 0) return t("watchNext.today");
  if (daysUntil === 1) return t("watchNext.tomorrow");
  return t("watchNext.inNDays", { n: daysUntil });
}
