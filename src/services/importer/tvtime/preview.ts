import type { StorageService } from "../../storage";
import { NormalizedImportBundle, ExternalIds } from "./types";

export interface ImportPreviewSummary {
  watchCount: number;
  reviewCount: number;
  likeCount: number;
  ratingCount: number;
  favoriteCount: number;
  listCount: number;
  warningCount: number;
  existingTitles: number;
  newTitles: number;
}

function titleKey(ids: ExternalIds, title: string): string {
  return ids.tvdbId != null
    ? `tvdb:${ids.tvdbId}`
    : ids.imdbId
      ? `imdb:${ids.imdbId}`
      : ids.tvTimeUuid
        ? `uuid:${ids.tvTimeUuid}`
        : `title:${title.toLowerCase().trim()}`;
}

export async function previewBundle(
  storage: StorageService,
  bundle: NormalizedImportBundle,
): Promise<ImportPreviewSummary> {
  const allMedia = await storage.media.getAll();
  const tvdbSet = new Set(
    allMedia.filter((m) => m.tvdbId != null).map((m) => m.tvdbId),
  );
  const imdbSet = new Set(
    allMedia.filter((m) => m.imdbId).map((m) => m.imdbId),
  );
  const uuidSet = new Set(
    allMedia.filter((m) => m.tvTimeUuid).map((m) => m.tvTimeUuid),
  );
  const titleSet = new Set(
    allMedia.map((m) => m.title.toLowerCase().replace(/[^a-z0-9]/g, "")),
  );

  function existsLocally(ids: ExternalIds, title: string): boolean {
    if (ids.tvdbId != null && tvdbSet.has(ids.tvdbId)) return true;
    if (ids.imdbId && imdbSet.has(ids.imdbId)) return true;
    if (ids.tvTimeUuid && uuidSet.has(ids.tvTimeUuid)) return true;
    return titleSet.has(title.toLowerCase().replace(/[^a-z0-9]/g, ""));
  }

  const allItems = [
    ...bundle.watches,
    ...bundle.reviews,
    ...bundle.likes,
    ...bundle.ratings,
    ...bundle.favorites,
    ...bundle.lists.flatMap((l) => l.items),
  ];
  const distinctKeys = new Map<string, { ids: ExternalIds; title: string }>();
  for (const item of allItems) {
    const key = titleKey(item.ids, item.title);
    if (!distinctKeys.has(key))
      distinctKeys.set(key, { ids: item.ids, title: item.title });
  }

  let existingTitles = 0;
  let newTitles = 0;
  for (const { ids, title } of distinctKeys.values()) {
    if (existsLocally(ids, title)) existingTitles++;
    else newTitles++;
  }

  return {
    watchCount: bundle.watches.length,
    reviewCount: bundle.reviews.length,
    likeCount: bundle.likes.length,
    ratingCount: bundle.ratings.length,
    favoriteCount: bundle.favorites.length,
    listCount: bundle.lists.length,
    warningCount: bundle.warnings.length,
    existingTitles,
    newTitles,
  };
}
