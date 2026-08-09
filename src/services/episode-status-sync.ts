import type { StorageService } from "./storage";
import { Episode, EpisodeProgress } from "../models/episode";
import { MediaVaultId } from "../types/common";
import { recalculateAndPersistStatus } from "./status-service";
import { addWatchSession } from "./watch-session-service";
import { touchMediaActivity } from "./activity-service";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function findUnwatchedPrecedingEpisodes(
  allEpisodes: Episode[],
  target: Episode,
  progress: EpisodeProgress[],
): Episode[] {
  const watchedEpisodeIds = new Set(
    progress.filter((p) => p.watched).map((p) => p.episodeId),
  );

  return [...allEpisodes]
    .filter((e) => e.id !== target.id)
    .filter(
      (e) =>
        e.seasonNumber < target.seasonNumber ||
        (e.seasonNumber === target.seasonNumber &&
          e.episodeNumber < target.episodeNumber),
    )
    .filter((e) => !watchedEpisodeIds.has(e.id))
    .sort(
      (a, b) =>
        a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber,
    );
}

export async function markEpisodeWatched(
  storage: StorageService,
  episode: Episode,
  watched: boolean,
  watchedDate?: string,
  options?: { skipWatchRecord?: boolean },
): Promise<EpisodeProgress> {
  const wasSeriesComplete = await isSeriesFullyWatched(
    storage,
    episode.mediaId,
  );
  const wasWatched =
    (await storage.episodeProgress.findByEpisodeId(episode.id))?.watched ??
    false;

  const progress = await storage.episodeProgress.markWatched(
    episode,
    watched,
    watchedDate,
  );

  if (watched && !wasWatched && !options?.skipWatchRecord) {
    await storage.episodeWatches.create({
      mediaId: episode.mediaId,
      episodeId: episode.id,
      watchedAt: watchedDate ?? today(),
      rating: null,
      emotion: null,
      review: null,
      notes: null,
    });
  }

  if (watched) {
    await touchMediaActivity(storage, episode.mediaId);
    const isSeriesCompleteNow = await isSeriesFullyWatched(
      storage,
      episode.mediaId,
    );
    if (isSeriesCompleteNow && !wasSeriesComplete) {
      await addWatchSession(storage, {
        mediaId: episode.mediaId,
        watchDate: watchedDate ?? today(),
      });
    }
  } else if (wasWatched) {
    await deleteLatestEpisodeWatch(storage, episode.id);
  }

  await recalculateAndPersistStatus(storage, episode.mediaId);
  return progress;
}

async function deleteLatestEpisodeWatch(
  storage: StorageService,
  episodeId: MediaVaultId,
): Promise<void> {
  const watches = await storage.episodeWatches.findByEpisodeId(episodeId);
  if (watches.length === 0) return;
  const latest = [...watches].sort((a, b) =>
    a.watchedAt === b.watchedAt
      ? a.createdAt.localeCompare(b.createdAt)
      : a.watchedAt.localeCompare(b.watchedAt),
  )[watches.length - 1];
  await storage.episodeWatches.delete(latest.id);
}

export async function removeOneEpisodeWatch(
  storage: StorageService,
  episode: Episode,
): Promise<void> {
  const watches = await storage.episodeWatches.findByEpisodeId(episode.id);
  if (watches.length <= 1) {
    await markEpisodeWatched(storage, episode, false);
  } else {
    await deleteLatestEpisodeWatch(storage, episode.id);
  }
}

export async function markSeasonWatched(
  storage: StorageService,
  episodes: Episode[],
  watched: boolean,
): Promise<EpisodeProgress[]> {
  const mediaId = episodes.length > 0 ? episodes[0].mediaId : "";
  const wasSeriesComplete =
    episodes.length > 0 ? await isSeriesFullyWatched(storage, mediaId) : false;

  const priorProgress = await storage.episodeProgress.findByMediaId(mediaId);
  const wasWatchedByEpisodeId = new Set(
    priorProgress.filter((p) => p.watched).map((p) => p.episodeId),
  );

  const results = await storage.episodeProgress.markSeasonWatched(
    episodes,
    watched,
  );

  if (watched) {
    const today_ = today();
    for (const episode of episodes) {
      if (!wasWatchedByEpisodeId.has(episode.id)) {
        await storage.episodeWatches.create({
          mediaId: episode.mediaId,
          episodeId: episode.id,
          watchedAt: today_,
          rating: null,
          emotion: null,
          review: null,
          notes: null,
        });
      }
    }
  } else {
    for (const episode of episodes) {
      if (wasWatchedByEpisodeId.has(episode.id)) {
        await deleteLatestEpisodeWatch(storage, episode.id);
      }
    }
  }

  if (watched && episodes.length > 0) {
    await touchMediaActivity(storage, mediaId);
    const isSeriesCompleteNow = await isSeriesFullyWatched(storage, mediaId);
    if (isSeriesCompleteNow && !wasSeriesComplete) {
      await addWatchSession(storage, {
        mediaId,
        watchDate: today(),
      });
    }
  }

  if (episodes.length > 0) {
    await recalculateAndPersistStatus(storage, mediaId);
  }
  return results;
}

export async function addSeasonRewatch(
  storage: StorageService,
  episodes: Episode[],
): Promise<void> {
  if (episodes.length === 0) return;
  const mediaId = episodes[0].mediaId;
  const watchedAt = today();

  for (const episode of episodes) {
    await storage.episodeWatches.create({
      mediaId: episode.mediaId,
      episodeId: episode.id,
      watchedAt,
      rating: null,
      emotion: null,
      review: null,
      notes: null,
    });
    await storage.episodeProgress.markWatched(episode, true, watchedAt);
  }

  await touchMediaActivity(storage, mediaId);
  await recalculateAndPersistStatus(storage, mediaId);
}

export async function removeOneSeasonWatch(
  storage: StorageService,
  episodes: Episode[],
): Promise<void> {
  if (episodes.length === 0) return;
  const mediaId = episodes[0].mediaId;

  for (const episode of episodes) {
    await removeOneEpisodeWatch(storage, episode);
  }

  await recalculateAndPersistStatus(storage, mediaId);
}

export async function isSeriesFullyWatched(
  storage: StorageService,
  mediaId: MediaVaultId,
): Promise<boolean> {
  const [allEpisodes, progress] = await Promise.all([
    storage.episodes.findByMediaId(mediaId),
    storage.episodeProgress.findByMediaId(mediaId),
  ]);
  if (allEpisodes.length === 0) return false;

  const watchedEpisodeIds = new Set(
    progress.filter((p) => p.watched).map((p) => p.episodeId),
  );
  return allEpisodes.every((e) => watchedEpisodeIds.has(e.id));
}
