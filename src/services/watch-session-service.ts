import type { StorageService } from "./storage";
import { generateId } from "./storage/base-repository";
import { WatchSession, NewWatchSessionInput } from "../models/review";
import { nextRewatchNumber, computeAverageRating } from "./review-logic";
import { recalculateAndPersistStatus } from "./status-service";
import { touchMediaActivity } from "./activity-service";

export async function addWatchSession(
  storage: StorageService,
  input: NewWatchSessionInput,
): Promise<WatchSession> {
  const existing = await storage.watchSessions.findWhere(
    (s) => s.mediaId === input.mediaId,
  );
  const now = new Date().toISOString();

  const session: WatchSession = {
    id: generateId(),
    mediaId: input.mediaId,
    watchDate: input.watchDate,
    completedDate: input.completedDate ?? null,
    ...(input.inProgress ? { inProgress: true } : {}),
    rating: input.rating ?? null,
    review: input.review ?? "",
    mood: input.mood ?? null,
    context: input.context ?? null,
    rewatchNumber: nextRewatchNumber(existing),
    watchSource: input.watchSource ?? null,
    tags: input.tags ?? [],
    externalSource: input.externalSource ?? null,
    externalRef: input.externalRef ?? null,
    episodeId: input.episodeId ?? null,
    createdAt: now,
    updatedAt: now,
  };

  await storage.watchSessions.save(session);
  await syncMediaAggregates(storage, input.mediaId, input.activityAt);
  await recalculateAndPersistStatus(storage, input.mediaId);

  return session;
}

export async function updateWatchSession(
  storage: StorageService,
  sessionId: string,
  patch: Partial<
    Pick<
      WatchSession,
      | "watchDate"
      | "completedDate"
      | "inProgress"
      | "rating"
      | "review"
      | "mood"
      | "context"
      | "watchSource"
      | "tags"
    >
  >,
): Promise<WatchSession | null> {
  const updated = await storage.watchSessions.update(sessionId, {
    ...patch,
    updatedAt: new Date().toISOString(),
  });
  if (!updated) return null;

  await syncMediaAggregates(storage, updated.mediaId);
  await recalculateAndPersistStatus(storage, updated.mediaId);
  return updated;
}

export async function deleteWatchSession(
  storage: StorageService,
  sessionId: string,
): Promise<boolean> {
  const session = await storage.watchSessions.findById(sessionId);
  if (!session) return false;

  const deleted = await storage.watchSessions.delete(sessionId);
  if (deleted) {
    await syncMediaAggregates(storage, session.mediaId);
    await recalculateAndPersistStatus(storage, session.mediaId);
  }
  return deleted;
}

export async function findSessionByExternalRef(
  storage: StorageService,
  source: "trakt",
  ref: string,
): Promise<WatchSession | null> {
  const matches = await storage.watchSessions.findWhere(
    (s) => s.externalSource === source && s.externalRef === ref,
  );
  return matches[0] ?? null;
}

export async function syncMediaAggregates(
  storage: StorageService,
  mediaId: string,
  activityAt?: string,
): Promise<void> {
  const sessions = await storage.watchSessions.findWhere(
    (s) => s.mediaId === mediaId,
  );

  const completed = sessions.filter((s) => !s.inProgress);
  await storage.media.update(mediaId, {
    averageRating: computeAverageRating(sessions),
    watchCount: completed.length,
    lastWatchedDate:
      sessions.length > 0
        ? sessions.reduce(
            (max, s) => (s.watchDate > max ? s.watchDate : max),
            sessions[0].watchDate,
          )
        : null,
  });
  await touchMediaActivity(storage, mediaId, activityAt);
}

type SeriesCompletedListener = (session: WatchSession) => void;
const seriesCompletedListeners = new Set<SeriesCompletedListener>();

export function onSeriesWatchCompleted(
  listener: SeriesCompletedListener,
): () => void {
  seriesCompletedListeners.add(listener);
  return () => seriesCompletedListeners.delete(listener);
}

function emitSeriesCompleted(session: WatchSession): void {
  seriesCompletedListeners.forEach((l) => {
    try {
      l(session);
    } catch (err) {
      console.warn("MediaVault: series-completed listener failed", err);
    }
  });
}

export async function ensureSeriesWatchStarted(
  storage: StorageService,
  mediaId: string,
  watchedDate: string,
): Promise<void> {
  const existing = await storage.watchSessions.findWhere(
    (s) => s.mediaId === mediaId && s.episodeId === null,
  );
  if (existing.length > 0) return;

  const watched = (await storage.episodeProgress.findByMediaId(mediaId))
    .filter((p) => p.watched && p.watchedDate)
    .map((p) => p.watchedDate as string);
  const start = [watchedDate, ...watched].reduce((a, b) => (b < a ? b : a));

  await addWatchSession(storage, {
    mediaId,
    watchDate: start.slice(0, 10),
    inProgress: true,
    completedDate: null,
  });
}

export async function completeSeriesWatch(
  storage: StorageService,
  mediaId: string,
  endDate: string,
  opts: { silent?: boolean } = {},
): Promise<WatchSession | null> {
  const sessions = await storage.watchSessions.findWhere(
    (s) => s.mediaId === mediaId && s.episodeId === null,
  );
  const open = sessions
    .filter((s) => s.inProgress)
    .sort((a, b) => a.watchDate.localeCompare(b.watchDate))
    .pop();
  const end = endDate.slice(0, 10);

  let result: WatchSession | null = null;
  if (open) {
    const start = open.watchDate;
    result = await updateWatchSession(storage, open.id, {
      completedDate: end < start ? start : end,
      inProgress: false,
    });
  } else if (sessions.length === 0) {
    const watched = (await storage.episodeProgress.findByMediaId(mediaId))
      .filter((p) => p.watched && p.watchedDate)
      .map((p) => p.watchedDate as string);
    const start = [end, ...watched].reduce((a, b) => (b < a ? b : a));
    result = await addWatchSession(storage, {
      mediaId,
      watchDate: start.slice(0, 10),
      completedDate: end,
    });
  }
  if (result && !opts.silent) emitSeriesCompleted(result);
  return result;
}
