import type { StorageService } from "./storage";
import { MediaItem } from "../models/media";
import { MediaStatus } from "../types/enums";
import { MovieProgress } from "../models/movie-progress";
import { addWatchSession } from "./watch-session-service";
import { touchMediaActivity } from "./activity-service";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function setMovieProgress(
  storage: StorageService,
  media: MediaItem,
  currentMinute: number,
): Promise<MovieProgress> {
  const totalRuntime = media.runtime ?? 0;
  const clamped = Math.max(
    0,
    totalRuntime > 0 ? Math.min(currentMinute, totalRuntime) : currentMinute,
  );

  const existing = await storage.movieProgress.findByMediaId(media.id);
  const result = existing
    ? await storage.movieProgress.update(existing.id, {
        currentMinute: clamped,
        totalRuntime,
        lastUpdated: today(),
      })
    : await storage.movieProgress.create({
        mediaId: media.id,
        currentMinute: clamped,
        totalRuntime,
        lastUpdated: today(),
      });

  await storage.media.update(media.id, { status: MediaStatus.Dropped });
  await touchMediaActivity(storage, media.id);
  return result as MovieProgress;
}

export async function clearMovieProgress(
  storage: StorageService,
  mediaId: string,
): Promise<void> {
  await storage.movieProgress.deleteByMediaId(mediaId);
}

export async function resumeMovie(
  storage: StorageService,
  mediaId: string,
): Promise<void> {
  await storage.media.update(mediaId, { status: MediaStatus.Watching });
}

export async function completeMovieFromProgress(
  storage: StorageService,
  mediaId: string,
): Promise<void> {
  await storage.media.update(mediaId, { status: MediaStatus.Watching });
  await storage.movieProgress.deleteByMediaId(mediaId);
  await addWatchSession(storage, { mediaId, watchDate: today() });
}
