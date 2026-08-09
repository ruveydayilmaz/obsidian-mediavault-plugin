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

export function calculateMediaStatus(
  media: Pick<MediaItem, "type" | "status" | "tvStatus">,
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

  const releasedEpisodes = ctx.episodes.filter((e) => isReleased(e, now));
  const progressByEpisodeId = new Map(
    ctx.episodeProgress.map((p) => [p.episodeId, p]),
  );
  const watchedReleasedCount = releasedEpisodes.filter(
    (e) => progressByEpisodeId.get(e.id)?.watched,
  ).length;

  if (watchedReleasedCount === 0) {
    return MediaStatus.PlanToWatch;
  }

  const allReleasedWatched = watchedReleasedCount >= releasedEpisodes.length;

  if (!allReleasedWatched) {
    return MediaStatus.Watching;
  }

  if (media.tvStatus && ENDED_TV_STATUSES.has(media.tvStatus)) {
    return MediaStatus.Completed;
  }
  if (!media.tvStatus) {
    return MediaStatus.Completed;
  }

  const hasScheduledFutureEpisode = ctx.episodes.some(
    (e) => e.airDate !== null && new Date(e.airDate).getTime() > now.getTime(),
  );
  return hasScheduledFutureEpisode
    ? MediaStatus.UpToDate
    : MediaStatus.WaitingForNewSeason;
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
