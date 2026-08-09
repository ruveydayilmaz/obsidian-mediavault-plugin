import {
  DashboardStatistics,
  formatWatchTime,
} from "../../services/statistics-service";
import { t } from "../../i18n";

interface StatCardRefs {
  valueEl: HTMLElement;
}

interface MobileStatRefs {
  movieTime: HTMLElement;
  tvTime: HTMLElement;
  movieCount: HTMLElement;
  episodeCount: HTMLElement;
}
export class StatsBar {
  private barEl: HTMLElement | null = null;
  private cards: StatCardRefs[] = [];
  private mobileRefs: MobileStatRefs | null = null;

  mount(container: HTMLElement, mobile = false): void {
    if (this.barEl && this.barEl.isConnected) return;

    container.empty();
    this.barEl = container.createDiv({
      cls: mobile
        ? "mediavault-stats-bar mediavault-stats-mobile"
        : "mediavault-stats-bar",
    });

    if (mobile) {
      this.createMobileCard(this.barEl);
      return;
    }

    this.cards = [
      this.createCard(this.barEl, t("stats.moviesWatched")),
      this.createCard(this.barEl, t("stats.movieWatchTime")),
      this.createCard(this.barEl, t("stats.episodesWatched")),
      this.createCard(this.barEl, t("stats.tvWatchTime")),
    ];
  }

  update(
    container: HTMLElement,
    stats: DashboardStatistics,
    mobile = false,
  ): void {
    this.mount(container, mobile);

    if (mobile && this.mobileRefs) {
      this.mobileRefs.movieTime.setText(
        formatWatchTime(stats.movieRuntimeMinutes),
      );
      this.mobileRefs.tvTime.setText(
        formatWatchTime(stats.episodeRuntimeMinutes),
      );

      this.mobileRefs.movieCount.setText(
        t("stats.moviesWatchedLabel", { count: stats.movieCount.toLocaleString() }),
      );

      this.mobileRefs.episodeCount.setText(
        t("stats.episodesWatchedLabel", {
          count: stats.episodeCount.toLocaleString(),
        }),
      );

      return;
    }

    const values = [
      String(stats.movieCount),
      formatWatchTime(stats.movieRuntimeMinutes),
      String(stats.episodeCount),
      formatWatchTime(stats.episodeRuntimeMinutes),
    ];

    this.cards.forEach((card, i) => card.valueEl.setText(values[i]));
  }

  private createCard(container: HTMLElement, label: string): StatCardRefs {
    const card = container.createDiv({ cls: "mediavault-stat-card" });
    const valueEl = card.createDiv({
      cls: "mediavault-stat-card-value",
      text: "—",
    });
    card.createDiv({ cls: "mediavault-stat-card-label", text: label });
    return { valueEl };
  }

  private createMobileCard(container: HTMLElement): void {
    const card = container.createDiv({
      cls: "mediavault-stat-mobile-card",
    });

    const columns = card.createDiv({
      cls: "mediavault-stat-mobile-columns",
    });

    const movie = columns.createDiv({
      cls: "mediavault-stat-mobile-column",
    });

    const tv = columns.createDiv({
      cls: "mediavault-stat-mobile-column",
    });

    this.mobileRefs = {
      movieTime: movie.createDiv({
        cls: "mediavault-stat-mobile-value",
        text: "—",
      }),
      movieCount: movie.createDiv({
        cls: "mediavault-stat-mobile-label",
        text: t("library.filterMovies"),
      }),
      tvTime: tv.createDiv({
        cls: "mediavault-stat-mobile-value",
        text: "—",
      }),
      episodeCount: tv.createDiv({
        cls: "mediavault-stat-mobile-label",
        text: t("mediaType.tv"),
      }),
    };
  }
}
