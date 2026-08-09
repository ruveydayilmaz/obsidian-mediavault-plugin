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

async function syncMediaAggregates(
  storage: StorageService,
  mediaId: string,
  activityAt?: string,
): Promise<void> {
  const sessions = await storage.watchSessions.findWhere(
    (s) => s.mediaId === mediaId,
  );
  await storage.media.update(mediaId, {
    averageRating: computeAverageRating(sessions),
    watchCount: sessions.length,
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
