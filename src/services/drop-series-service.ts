import type { StorageService } from "./storage";
import { MediaStatus } from "../types/enums";
import { recalculateAndPersistStatus } from "./status-service";

export async function dropSeries(
  storage: StorageService,
  mediaId: string,
  reason: string | null,
): Promise<void> {
  await storage.media.update(mediaId, {
    status: MediaStatus.Dropped,
    droppedReason: reason && reason.trim() !== "" ? reason.trim() : null,
  });
}

export async function resumeSeries(
  storage: StorageService,
  mediaId: string,
): Promise<void> {
  await storage.media.update(mediaId, { status: MediaStatus.Watching });
  await recalculateAndPersistStatus(storage, mediaId);
}

export async function updateDroppedReason(
  storage: StorageService,
  mediaId: string,
  reason: string | null,
): Promise<void> {
  await storage.media.update(mediaId, {
    droppedReason: reason && reason.trim() !== "" ? reason.trim() : null,
  });
}
