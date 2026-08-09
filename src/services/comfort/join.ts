import type { StorageService } from "../storage";
import { ComfortableMedia } from "./filter";

export async function getComfortableMedia(
  storage: StorageService,
): Promise<ComfortableMedia[]> {
  const [media, profiles] = await Promise.all([
    storage.media.getAll(),
    storage.comfortProfiles.getAll(),
  ]);
  const profileByMediaId = new Map(profiles.map((p) => [p.mediaId, p]));

  const result: ComfortableMedia[] = [];
  for (const item of media) {
    const profile = profileByMediaId.get(item.id);
    if (profile) result.push({ media: item, profile });
  }
  return result;
}
