import { ItemView, WorkspaceLeaf } from "obsidian";
import type { Chart } from "chart.js";
import type MediaVaultPlugin from "../../main";
import { VIEW_TYPE_ANALYTICS } from "../../constants";
import { computeAnalyticsMemoized } from "../../services/analytics/memoized";
import { t, tPlural } from "../../i18n";
import {
  createChart,
  CHART_PALETTE,
  themeColors,
} from "../components/chart-wrapper";
import {
  computeDailyWatchCounts,
  renderCalendarHeatmap,
} from "../components/heatmap";
import { ActorDetailsModal } from "../modals/actor-details-modal";
import type { CountItem } from "../../services/analytics/types";

export class AnalyticsView extends ItemView {
  private plugin: MediaVaultPlugin;
  private activeCharts: Chart[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: MediaVaultPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_ANALYTICS;
  }

  getDisplayText(): string {
    return t("analytics.displayName");
  }

  getIcon(): string {
    return "bar-chart-3";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async onClose(): Promise<void> {
    this.destroyCharts();
  }

  async refresh(): Promise<void> {
    await this.render();
  }

  private destroyCharts(): void {
    this.activeCharts.forEach((c) => c.destroy());
    this.activeCharts = [];
  }

  private async render(): Promise<void> {
    this.destroyCharts();

    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("mediavault-analytics-view");

    const [media, sessions, episodes, episodeProgress] = await Promise.all([
      this.plugin.storage.media.getAll(),
      this.plugin.storage.watchSessions.getAll(),
      this.plugin.storage.episodes.getAll(),
      this.plugin.storage.episodeProgress.getAll(),
    ]);

    const stats = computeAnalyticsMemoized(
      { media, sessions, episodes, episodeProgress },
      this.plugin.storage.getDataVersion(),
    );

    if (media.length === 0) {
      root.createDiv({
        cls: "mediavault-analytics-empty",
        text: t("analytics.emptyState"),
      });
      return;
    }

    const headline = root.createDiv({ cls: "mediavault-analytics-headline" });
    headline.createDiv({
      text: [
        tPlural("analytics.moviesCountLabel", stats.moviesWatchedCount),
        tPlural(
          "analytics.episodesWatchedCountLabel",
          stats.episodesWatchedCount,
        ),
      ].join(" · "),
    });
    headline.createDiv({
      cls: "mediavault-analytics-subline",
      text: t("analytics.totalStatsLine", {
        hours: Math.floor(stats.totalRuntimeMinutes / 60),
        rating: stats.averageRating?.toFixed(1) ?? "—",
        completion: stats.completionRate,
      }),
    });

    const grid = root.createDiv({ cls: "mediavault-analytics-chart-grid" });

    if (stats.topGenres.length > 0) {
      const card = this.chartCard(grid, t("analytics.genreBreakdown"));
      const chart = createChart(
        card,
        "pie",
        {
          labels: stats.topGenres.map((g) => g.label),
          datasets: [
            {
              data: stats.topGenres.map((g) => g.count),
              backgroundColor: CHART_PALETTE,
            },
          ],
        },
        { plugins: { legend: { position: "right" } } },
      );
      this.activeCharts.push(chart);
    }

    if (stats.monthlyWatchTrend.length > 0) {
      const card = this.chartCard(grid, t("analytics.monthlyTrend"));
      const colors = themeColors();
      const recent = stats.monthlyWatchTrend.slice(-12);
      const chart = createChart(
        card,
        "line",
        {
          labels: recent.map((t) => t.period),
          datasets: [
            {
              label: t("analytics.watchesDatasetLabel"),
              data: recent.map((t) => t.count),
              borderColor: colors.accent,
              backgroundColor: colors.accent,
              tension: 0.3,
            },
          ],
        },
        {
          plugins: { legend: { display: false } },
          scales: {
            x: {
              ticks: { color: colors.muted },
              grid: { color: colors.border },
            },
            y: {
              ticks: { color: colors.muted },
              grid: { color: colors.border },
              beginAtZero: true,
            },
          },
        },
      );
      this.activeCharts.push(chart);
    }

    {
      const card = this.chartCard(grid, t("analytics.rewatchFrequency"));
      const colors = themeColors();
      const firstWatches = sessions.filter((s) => s.rewatchNumber === 0).length;
      const chart = createChart(
        card,
        "bar",
        {
          labels: [t("analytics.firstWatchesLabel"), t("analytics.rewatchesLabel")],
          datasets: [
            {
              data: [firstWatches, stats.rewatchCount],
              backgroundColor: [CHART_PALETTE[0], CHART_PALETTE[1]],
            },
          ],
        },
        {
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: colors.muted }, grid: { display: false } },
            y: {
              ticks: { color: colors.muted },
              grid: { color: colors.border },
              beginAtZero: true,
            },
          },
        },
      );
      this.activeCharts.push(chart);
    }

    if (stats.topActors.length > 0) {
      this.renderPeopleChart(
        grid,
        t("analytics.topActorsCard"),
        stats.topActors,
        CHART_PALETTE[2],
      );
    }

    if (stats.topDirectors.length > 0) {
      this.renderPeopleChart(
        grid,
        t("analytics.topDirectors"),
        stats.topDirectors,
        CHART_PALETTE[3],
      );
    }

    if (stats.topProducers.length > 0) {
      this.renderPeopleChart(
        grid,
        t("analytics.topProducers"),
        stats.topProducers,
        CHART_PALETTE[4],
      );
    }

    const heatmapSection = root.createDiv({
      cls: "mediavault-analytics-section",
    });
    heatmapSection.createEl("h3", {
      text: t("analytics.watchActivity", { year: new Date().getFullYear() }),
    });
    const dailyCounts = computeDailyWatchCounts(sessions, episodeProgress);
    renderCalendarHeatmap(
      heatmapSection,
      dailyCounts,
      new Date().getFullYear(),
    );
  }

  private renderPeopleChart(
    grid: HTMLElement,
    title: string,
    items: CountItem[],
    color: string,
  ): void {
    const card = this.chartCard(grid, title);
    card.addClass("mediavault-analytics-clickable-chart");
    const colors = themeColors();
    const chart = createChart(
      card,
      "bar",
      {
        labels: items.map((a) => a.label),
        datasets: [
          {
            data: items.map((a) => a.count),
            backgroundColor: color,
          },
        ],
      },
      {
        indexAxis: "y",
        plugins: { legend: { display: false } },
        scales: {
          x: {
            ticks: { color: colors.muted },
            grid: { color: colors.border },
            beginAtZero: true,
          },
          y: { ticks: { color: colors.muted }, grid: { display: false } },
        },
        onHover: (evt: unknown, elements: unknown[]) => {
          const canvas = (evt as { native?: { target?: HTMLElement } })
            ?.native?.target;
          if (canvas) {
            canvas.style.cursor =
              elements.length > 0 ? "pointer" : "default";
          }
        },
        onClick: (_evt: unknown, elements: { index: number }[]) => {
          if (elements.length === 0) return;
          const item = items[elements[0].index];
          if (!item || !item.tmdbPersonId) return;
          new ActorDetailsModal(
            this.plugin.app,
            this.plugin.storage,
            this.plugin.tmdb,
            item.tmdbPersonId,
          ).open();
        },
      },
    );
    this.activeCharts.push(chart);
  }

  private chartCard(container: HTMLElement, title: string): HTMLElement {
    const card = container.createDiv({ cls: "mediavault-chart-card" });
    card.createEl("h3", { text: title });
    const canvasWrap = card.createDiv({ cls: "mediavault-chart-canvas-wrap" });
    return canvasWrap;
  }
}
