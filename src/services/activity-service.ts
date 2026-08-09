import type { StorageService } from "./storage";

export async function touchMediaActivity(
  storage: StorageService,
  mediaId: string,
  at?: string,
): Promise<void> {
  if (at) {
    const media = await storage.media.findById(mediaId);
    if (media?.lastActivityAt && media.lastActivityAt >= at) return;
    await storage.media.update(mediaId, { lastActivityAt: at });
    return;
  }
  await storage.media.update(mediaId, {
    lastActivityAt: new Date().toISOString(),
  });
}
