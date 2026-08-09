import { MediaItem } from "../../models/media";
import { WatchSession } from "../../models/review";
import { Episode, EpisodeProgress } from "../../models/episode";
import { MediaStatus, MediaType } from "../../types/enums";
import { AnalyticsSummary, CountItem, TrendPoint } from "./types";

function topN(counts: Map<string, number>, n: number): CountItem[] {
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, n);
}

function increment(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function monthKey(dateStr: string): string | null {
  if (!dateStr || dateStr.length < 7) return null;
  return dateStr.slice(0, 7); // "YYYY-MM"
}

function yearKey(dateStr: string): string | null {
  if (!dateStr || dateStr.length < 4) return null;
  return dateStr.slice(0, 4); // "YYYY"
}

function buildTrend(keys: (string | null)[]): TrendPoint[] {
  const counts = new Map<string, number>();
  for (const key of keys) {
    if (key) increment(counts, key);
  }
  return [...counts.entries()]
    .map(([period, count]) => ({ period, count }))
    .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
}

export interface AnalyticsInput {
  media: MediaItem[];
  sessions: WatchSession[];
  episodes: Episode[];
  episodeProgress: EpisodeProgress[];
  topN?: number;
}

export function computeAnalytics(input: AnalyticsInput): AnalyticsSummary {
  const { media, sessions, episodes, episodeProgress } = input;
  const n = input.topN ?? 10;

  const mediaById = new Map(media.map((m) => [m.id, m]));
  const episodeById = new Map(episodes.map((e) => [e.id, e]));

  let totalRuntimeMinutes = 0;

  const moviesWatchedIds = new Set<string>();
  for (const session of sessions) {
    const item = mediaById.get(session.mediaId);
    if (!item) continue;
    if (item.type === MediaType.Movie) {
      moviesWatchedIds.add(item.id);
      totalRuntimeMinutes += item.runtime ?? 0;
    }
  }

  let episodesWatchedCount = 0;
  const watchedProgress = episodeProgress.filter((p) => p.watched);
  for (const progress of watchedProgress) {
    episodesWatchedCount++;
    const episode = episodeById.get(progress.episodeId);
    totalRuntimeMinutes += episode?.runtime ?? 0;
  }

  const ratedValues: number[] = [
    ...sessions.filter((s) => s.rating !== null).map((s) => s.rating as number),
    ...episodeProgress
      .filter((p) => p.rating !== null)
      .map((p) => p.rating as number),
  ];
  const averageRating =
    ratedValues.length === 0
      ? null
      : Math.round(
          (ratedValues.reduce((a, b) => a + b, 0) / ratedValues.length) * 100,
        ) / 100;

  const genreCounts = new Map<string, number>();
  const actorCounts = new Map<string, number>();
  const directorCounts = new Map<string, number>();
  const studioCounts = new Map<string, number>();

  for (const item of media) {
    item.genres.forEach((g) => increment(genreCounts, g));
    item.cast.forEach((c) => increment(actorCounts, c.name));
    item.crew
      .filter((c) => c.job === "Director" || c.job === "Creator")
      .forEach((c) => increment(directorCounts, c.name));
    item.productionCompanies.forEach((p) => increment(studioCounts, p.name));
  }

  const rewatchCount = sessions.filter((s) => s.rewatchNumber > 0).length;

  const completionRate =
    media.length === 0
      ? 0
      : Math.round(
          (media.filter((m) => m.status === MediaStatus.Completed).length /
            media.length) *
            10000,
        ) / 100;

  const eventDates: string[] = [
    ...sessions.map((s) => s.watchDate),
    ...watchedProgress
      .map((p) => p.watchedDate)
      .filter((d): d is string => d !== null),
  ];

  return {
    totalRuntimeMinutes,
    moviesWatchedCount: moviesWatchedIds.size,
    episodesWatchedCount,
    averageRating,
    topGenres: topN(genreCounts, n),
    topActors: topN(actorCounts, n),
    topDirectors: topN(directorCounts, n),
    topStudios: topN(studioCounts, n),
    rewatchCount,
    completionRate,
    monthlyWatchTrend: buildTrend(eventDates.map(monthKey)),
    yearlyWatchTrend: buildTrend(eventDates.map(yearKey)),
  };
}
