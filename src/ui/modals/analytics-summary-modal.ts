import { App, Modal } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import { computeAnalyticsMemoized } from "../../services/analytics/memoized";
import { CountItem } from "../../services/analytics/types";
import { t, tPlural, i18n } from "../../i18n";
import type { TMDBService } from "../../api/tmdb";
import { ActorDetailsModal } from "./actor-details-modal";

function formatRuntime(minutes: number): string {
  return i18n.formatRuntime(minutes);
}

export class AnalyticsSummaryModal extends Modal {
  private storage: StorageService;
  private tmdb: TMDBService;

  constructor(app: App, storage: StorageService, tmdb: TMDBService) {
    super(app);
    this.storage = storage;
    this.tmdb = tmdb;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mediavault-analytics-modal");
    renderModalHeader(this, contentEl, t("analytics.yourStats"));

    const [media, sessions, episodes, episodeProgress] = await Promise.all([
      this.storage.media.getAll(),
      this.storage.watchSessions.getAll(),
      this.storage.episodes.getAll(),
      this.storage.episodeProgress.getAll(),
    ]);

    const stats = computeAnalyticsMemoized(
      { media, sessions, episodes, episodeProgress },
      this.storage.getDataVersion(),
    );

    const headline = contentEl.createDiv({
      cls: "mediavault-analytics-headline",
    });
    headline.createDiv({
      text: t("analytics.watchedHeadline", {
        runtime: formatRuntime(stats.totalRuntimeMinutes),
      }),
    });
    headline.createDiv({
      cls: "mediavault-analytics-subline",
      text: [
        tPlural("analytics.moviesCountLabel", stats.moviesWatchedCount),
        tPlural("analytics.episodesCountLabel", stats.episodesWatchedCount),
        tPlural("analytics.rewatchesCountLabel", stats.rewatchCount),
      ].join(" · "),
    });

    const grid = contentEl.createDiv({ cls: "mediavault-analytics-grid" });
    this.stat(
      grid,
      t("analytics.averageRating"),
      stats.averageRating !== null
        ? i18n.formatRating(stats.averageRating)
        : "\u2014",
    );
    this.stat(
      grid,
      t("analytics.completionRate"),
      i18n.formatPercent(stats.completionRate / 100),
    );
    this.stat(grid, t("analytics.librarySize"), String(media.length));

    this.renderTopList(contentEl, t("analytics.topGenres"), stats.topGenres);
    this.renderTopList(contentEl, t("analytics.topActorsList"), stats.topActors);
    this.renderTopList(
      contentEl,
      t("analytics.topDirectors"),
      stats.topDirectors,
    );
    this.renderTopList(
      contentEl,
      t("analytics.topProducers"),
      stats.topProducers,
    );
    this.renderTopList(contentEl, t("analytics.topStudios"), stats.topStudios);

    if (stats.monthlyWatchTrend.length > 0) {
      contentEl.createEl("h3", { text: t("analytics.monthlyTrendModal") });
      const trendEl = contentEl.createDiv({
        cls: "mediavault-analytics-trend",
      });
      const maxCount = Math.max(...stats.monthlyWatchTrend.map((t) => t.count));
      stats.monthlyWatchTrend.slice(-12).forEach((t) => {
        const row = trendEl.createDiv({
          cls: "mediavault-analytics-trend-row",
        });
        row.createSpan({
          cls: "mediavault-analytics-trend-label",
          text: t.period,
        });
        const barTrack = row.createDiv({
          cls: "mediavault-analytics-trend-track",
        });
        const bar = barTrack.createDiv({
          cls: "mediavault-analytics-trend-bar",
        });
        bar.style.width = `${(t.count / maxCount) * 100}%`;
        row.createSpan({
          cls: "mediavault-analytics-trend-count",
          text: String(t.count),
        });
      });
    }
  }

  private stat(container: HTMLElement, label: string, value: string): void {
    const box = container.createDiv({ cls: "mediavault-analytics-stat" });
    box.createDiv({ cls: "mediavault-analytics-stat-value", text: value });
    box.createDiv({ cls: "mediavault-analytics-stat-label", text: label });
  }

  private renderTopList(
    container: HTMLElement,
    title: string,
    items: CountItem[],
  ): void {
    if (items.length === 0) return;
    container.createEl("h3", { text: title });
    const list = container.createDiv({ cls: "mediavault-analytics-toplist" });
    items.slice(0, 5).forEach((item) => {
      const row = list.createDiv({ cls: "mediavault-analytics-toplist-row" });
      const labelEl = row.createSpan({ text: item.label });
      if (item.tmdbPersonId) {
        row.addClass("mediavault-analytics-toplist-row-clickable");
        labelEl.addClass("mediavault-analytics-toplist-label-link");
        row.setAttr("tabindex", "0");
        row.setAttr("role", "button");
        const openPerson = (): void => {
          new ActorDetailsModal(
            this.app,
            this.storage,
            this.tmdb,
            item.tmdbPersonId as number,
          ).open();
        };
        row.addEventListener("click", openPerson);
        row.addEventListener("keydown", (evt: KeyboardEvent) => {
          if (evt.key === "Enter" || evt.key === " ") {
            evt.preventDefault();
            openPerson();
          }
        });
      }
      row.createSpan({
        cls: "mediavault-analytics-toplist-count",
        text: String(item.count),
      });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
