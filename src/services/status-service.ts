import { MediaItem } from "../models/media";
import { MediaStatus, MediaType } from "../types/enums";
import { WatchSession } from "../models/review";
import { Episode, EpisodeProgress } from "../models/episode";
import type { StorageService } from "./storage";

const MANUAL_OVERRIDE_STATUSES: ReadonlySet<MediaStatus> = new Set([
  MediaStatus.Dropped,
  MediaStatus.OnHold,
  MediaStatus.WatchLater,
]);

export const ENDED_TV_STATUSES: ReadonlySet<string> = new Set([
  "Ended",
  "Canceled",
]);

export interface StatusCalculationContext {
  sessions: WatchSession[];
  episodes: Episode[];
  episodeProgress: EpisodeProgress[];
}

export function isReleased(episode: Episode, now: Date): boolean {
  if (!episode.airDate) return false;
  return new Date(episode.airDate).getTime() <= now.getTime();
}

const episodeOrderKey = (e: Pick<Episode, "seasonNumber" | "episodeNumber">) =>
  e.seasonNumber * 100000 + e.episodeNumber;

export function getReleasedWatchableEpisodes(
  episodes: Episode[],
  now: Date,
): Episode[] {
  const regular = episodes.filter((e) => e.seasonNumber > 0);
  let lastAiredKey = -1;
  for (const e of regular) {
    if (isReleased(e, now)) {
      lastAiredKey = Math.max(lastAiredKey, episodeOrderKey(e));
    }
  }
  return regular.filter(
    (e) =>
      isReleased(e, now) || (!e.airDate && episodeOrderKey(e) < lastAiredKey),
  );
}

export function calculateMediaStatus(
  media: Pick<MediaItem, "type" | "status" | "tvStatus"> &
    Partial<Pick<MediaItem, "episodesLastSyncedAt">>,
  ctx: StatusCalculationContext,
  now: Date = new Date(),
): MediaStatus {
  if (MANUAL_OVERRIDE_STATUSES.has(media.status)) {
    return media.status;
  }

  if (media.type === MediaType.Movie) {
    if (ctx.sessions.length > 0) return MediaStatus.Completed;
    return MediaStatus.PlanToWatch;
  }

  const watchedEpisodeIds = new Set(
    ctx.episodeProgress.filter((p) => p.watched).map((p) => p.episodeId),
  );
  const releasedEpisodes = getReleasedWatchableEpisodes(ctx.episodes, now);
  const watchedReleasedCount = releasedEpisodes.filter((e) =>
    watchedEpisodeIds.has(e.id),
  ).length;
  const anyWatched = ctx.episodes.some(
    (e) => e.seasonNumber > 0 && watchedEpisodeIds.has(e.id),
  );

  if (watchedReleasedCount === 0) {
    return anyWatched ? MediaStatus.Watching : MediaStatus.PlanToWatch;
  }

  if (watchedReleasedCount < releasedEpisodes.length) {
    return MediaStatus.Watching;
  }

  if (!media.episodesLastSyncedAt) {
    return MediaStatus.Watching;
  }

  if (!media.tvStatus || ENDED_TV_STATUSES.has(media.tvStatus)) {
    return MediaStatus.Completed;
  }
  return MediaStatus.WaitingForNewSeason;
}

export async function recalculateAndPersistStatus(
  storage: StorageService,
  mediaId: string,
  now: Date = new Date(),
): Promise<MediaStatus | null> {
  const media = await storage.media.findById(mediaId);
  if (!media) return null;

  const [sessions, episodes, episodeProgress] = await Promise.all([
    storage.watchSessions.findByMediaId(mediaId),
    storage.episodes.findByMediaId(mediaId),
    storage.episodeProgress.findByMediaId(mediaId),
  ]);

  const newStatus = calculateMediaStatus(
    media,
    { sessions, episodes, episodeProgress },
    now,
  );

  if (newStatus !== media.status) {
    await storage.media.update(mediaId, { status: newStatus });
  }

  return newStatus;
}
