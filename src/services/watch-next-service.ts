import { MediaItem } from "../models/media";
import { Episode, EpisodeProgress } from "../models/episode";
import { MediaStatus, MediaType } from "../types/enums";
import { isReleased } from "./status-service";

export interface NextEpisodeEntry {
  media: MediaItem;
  episode: Episode;
  isNew: boolean;
}

export interface UpcomingEpisodeEntry {
  media: MediaItem;
  episode: Episode;
  daysUntil: number;
}

export interface UpcomingMovieEntry {
  media: MediaItem;
  daysUntil: number;
}

const NEW_BADGE_WINDOW_DAYS = 7;

const IN_PROGRESS_STATUSES: ReadonlySet<MediaStatus> = new Set([
  MediaStatus.Watching,
  MediaStatus.Rewatching,
  MediaStatus.UpToDate,
  MediaStatus.WaitingForNewSeason,
]);

function daysBetween(a: number, b: number): number {
  return Math.abs(b - a) / (1000 * 60 * 60 * 24);
}

export function getNextEpisodes(
  allMedia: MediaItem[],
  episodesByMediaId: Map<string, Episode[]>,
  progressByMediaId: Map<string, EpisodeProgress[]>,
  now: Date = new Date(),
): NextEpisodeEntry[] {
  const entries: NextEpisodeEntry[] = [];

  for (const media of allMedia) {
    if (media.type !== MediaType.TVShow) continue;
    if (!IN_PROGRESS_STATUSES.has(media.status)) continue;

    const episodes = episodesByMediaId.get(media.id) ?? [];
    const progress = progressByMediaId.get(media.id) ?? [];
    const watchedIds = new Set(
      progress.filter((p) => p.watched).map((p) => p.episodeId),
    );
    if (watchedIds.size === 0) continue;

    const nextUp = episodes
      .filter((e) => isReleased(e, now) && !watchedIds.has(e.id))
      .sort(
        (a, b) =>
          a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber,
      )[0];

    if (!nextUp) continue;

    const isNew =
      nextUp.airDate !== null &&
      daysBetween(new Date(nextUp.airDate).getTime(), now.getTime()) <=
        NEW_BADGE_WINDOW_DAYS;
    entries.push({ media, episode: nextUp, isNew });
  }

  return entries.sort((a, b) => {
    const aTime = a.episode.airDate ? new Date(a.episode.airDate).getTime() : 0;
    const bTime = b.episode.airDate ? new Date(b.episode.airDate).getTime() : 0;
    return aTime - bTime;
  });
}

export function getUpcomingEpisodes(
  allMedia: MediaItem[],
  episodesByMediaId: Map<string, Episode[]>,
  now: Date = new Date(),
): UpcomingEpisodeEntry[] {
  const entries: UpcomingEpisodeEntry[] = [];
  const mediaById = new Map(allMedia.map((m) => [m.id, m]));

  for (const [mediaId, episodes] of episodesByMediaId) {
    const media = mediaById.get(mediaId);
    if (!media || media.status === MediaStatus.Dropped) continue;

    for (const ep of episodes) {
      if (!ep.airDate) continue;
      const airTime = new Date(ep.airDate).getTime();
      if (airTime <= now.getTime()) continue;
      entries.push({
        media,
        episode: ep,
        daysUntil: Math.ceil(daysBetween(airTime, now.getTime())),
      });
    }
  }

  return entries.sort((a, b) => a.daysUntil - b.daysUntil);
}

export function getUpcomingMovies(
  allMedia: MediaItem[],
  now: Date = new Date(),
): UpcomingMovieEntry[] {
  const entries: UpcomingMovieEntry[] = [];

  for (const media of allMedia) {
    if (media.type !== MediaType.Movie) continue;
    if (!media.releaseDate) continue;
    const releaseTime = new Date(media.releaseDate).getTime();
    if (releaseTime <= now.getTime()) continue;
    entries.push({
      media,
      daysUntil: Math.ceil(daysBetween(releaseTime, now.getTime())),
    });
  }

  return entries.sort((a, b) => a.daysUntil - b.daysUntil);
}
