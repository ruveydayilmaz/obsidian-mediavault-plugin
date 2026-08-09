import { MediaItem } from "../models/media";
import { WatchSession } from "../models/review";
import { Episode, EpisodeProgress } from "../models/episode";
import { MediaType } from "../types/enums";
import type { StorageService } from "./storage";
import { t } from "i18n/i18n-service";
export interface DashboardStatistics {
  movieCount: number;
  movieRuntimeMinutes: number;
  episodeCount: number;
  episodeRuntimeMinutes: number;
}
export interface StatisticsInput {
  media: MediaItem[];
  sessions: WatchSession[];
  episodes: Episode[];
  episodeProgress: EpisodeProgress[];
}

export function computeStatistics(input: StatisticsInput): DashboardStatistics {
  const { media, sessions, episodes, episodeProgress } = input;

  const movieIds = new Set(
    media.filter((m) => m.type === MediaType.Movie).map((m) => m.id),
  );

  const watchedMovieSessions = sessions.filter((s) => movieIds.has(s.mediaId));
  const movieCount = new Set(watchedMovieSessions.map((s) => s.mediaId)).size;

  const movieRuntimeById = new Map(
    media
      .filter((m) => m.type === MediaType.Movie)
      .map((m) => [m.id, m.runtime ?? 0]),
  );
  const movieRuntimeMinutes = watchedMovieSessions.reduce(
    (sum, s) => sum + (movieRuntimeById.get(s.mediaId) ?? 0),
    0,
  );

  const watchedProgress = episodeProgress.filter((p) => p.watched);
  const episodeCount = watchedProgress.length;

  const episodeRuntimeById = new Map(
    episodes.map((e) => [e.id, e.runtime ?? 0]),
  );
  const episodeRuntimeMinutes = watchedProgress.reduce(
    (sum, p) => sum + (episodeRuntimeById.get(p.episodeId) ?? 0),
    0,
  );

  return {
    movieCount,
    movieRuntimeMinutes,
    episodeCount,
    episodeRuntimeMinutes,
  };
}
export class StatisticsService {
  constructor(private storage: StorageService) {}

  private async load(): Promise<StatisticsInput> {
    const [media, sessions, episodes, episodeProgress] = await Promise.all([
      this.storage.media.getAll(),
      this.storage.watchSessions.getAll(),
      this.storage.episodes.getAll(),
      this.storage.episodeProgress.getAll(),
    ]);
    return { media, sessions, episodes, episodeProgress };
  }

  async getAll(): Promise<DashboardStatistics> {
    return computeStatistics(await this.load());
  }

  async getMovieCount(): Promise<number> {
    return (await this.getAll()).movieCount;
  }

  async getMovieRuntime(): Promise<number> {
    return (await this.getAll()).movieRuntimeMinutes;
  }

  async getEpisodeCount(): Promise<number> {
    return (await this.getAll()).episodeCount;
  }

  async getEpisodeRuntime(): Promise<number> {
    return (await this.getAll()).episodeRuntimeMinutes;
  }
}

export function formatWatchTime(totalMinutes: number): string {
  if (totalMinutes <= 0) return `0${t("statistics.minutes")}`;

  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);
  const totalMonths = Math.floor(totalDays / 30.44);
  const totalYears = Math.floor(totalDays / 365.25);

  if (totalYears > 0) {
    const remainingMonths = Math.floor(
      (totalDays - totalYears * 365.25) / 30.44,
    );
    return remainingMonths > 0
      ? `${totalYears}${t("statistics.years")} ${remainingMonths}${t("statistics.months")}`
      : `${totalYears}${t("statistics.years")}`;
  }
  if (totalMonths > 0) {
    const remainingDays = Math.floor(totalDays - totalMonths * 30.44);
    return remainingDays > 0
      ? `${totalMonths}${t("statistics.months")} ${remainingDays}${t("statistics.days")}`
      : `${totalMonths}${t("statistics.months")}`;
  }
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (totalDays > 0)
    return `${totalDays}${t("statistics.days")} ${hours}${t("statistics.hours")}`;
  if (hours > 0)
    return `${hours}${t("statistics.hours")} ${minutes}${t("statistics.minutes")}`;
  return `${minutes}${t("statistics.minutes")}`;
}
