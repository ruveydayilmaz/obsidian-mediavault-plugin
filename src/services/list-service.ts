import { MediaItem } from "../models/media";
import { MediaType } from "../types/enums";
import { CustomList } from "../models/list";
import { recentSortKey } from "./library-query";
import { MediaVaultSettings } from "../settings/settings";
import { i18n, t } from "../i18n";

export const SYSTEM_FAVORITE_MOVIES_ID = "system:favorite-movies";
export const SYSTEM_FAVORITE_TV_ID = "system:favorite-tv";

export function isSystemListId(id: string): boolean {
  return id === SYSTEM_FAVORITE_MOVIES_ID || id === SYSTEM_FAVORITE_TV_ID;
}

function applyManualOrder(
  currentIds: string[],
  savedOrder: string[],
): string[] {
  const currentSet = new Set(currentIds);
  const ordered = savedOrder.filter((id) => currentSet.has(id));
  const known = new Set(ordered);
  for (const id of currentIds) {
    if (!known.has(id)) ordered.push(id);
  }
  return ordered;
}

export function getSystemFavoriteLists(
  allMedia: MediaItem[],
  settings: MediaVaultSettings,
): CustomList[] {
  const now = new Date().toISOString();
  const favorites = allMedia.filter((m) => m.isFavorite);
  const movieIds = favorites
    .filter((m) => m.type === MediaType.Movie)
    .map((m) => m.id);
  const tvIds = favorites
    .filter((m) => m.type === MediaType.TVShow)
    .map((m) => m.id);

  const movieSort = settings.favoriteListSortModes.movies;
  const tvSort = settings.favoriteListSortModes.tv;

  return [
    {
      id: SYSTEM_FAVORITE_MOVIES_ID,
      title: t("favorites.movies"),
      description: t("favorites.moviesDescription"),
      mediaIds:
        movieSort === "manual"
          ? applyManualOrder(movieIds, settings.favoriteListManualOrder.movies)
          : movieIds,
      sortMode: movieSort,
      owner: null,
      isImported: false,
      importSource: null,
      createdAt: now,
      updatedAt: now,
      isSystem: true,
    },
    {
      id: SYSTEM_FAVORITE_TV_ID,
      title: t("favorites.tvSeries"),
      description: t("favorites.tvDescription"),
      mediaIds:
        tvSort === "manual"
          ? applyManualOrder(tvIds, settings.favoriteListManualOrder.tv)
          : tvIds,
      sortMode: tvSort,
      owner: null,
      isImported: false,
      importSource: null,
      createdAt: now,
      updatedAt: now,
      isSystem: true,
    },
  ];
}

export function formatRelativeDate(iso: string): string {
  return i18n.formatRelativeTime(iso);
}

export function resolveListMedia(
  list: CustomList,
  allMedia: MediaItem[],
): MediaItem[] {
  const byId = new Map(allMedia.map((m) => [m.id, m]));
  const resolved: MediaItem[] = [];
  for (const mediaId of list.mediaIds) {
    const media = byId.get(mediaId);
    if (media) resolved.push(media);
  }
  return resolved;
}

export function sortListMedia(
  list: CustomList,
  allMedia: MediaItem[],
): MediaItem[] {
  const media = resolveListMedia(list, allMedia);

  switch (list.sortMode) {
    case "recent":
      return [...media].sort((a, b) =>
        recentSortKey(b).localeCompare(recentSortKey(a)),
      );
    case "title":
      return [...media].sort((a, b) => a.title.localeCompare(b.title));
    case "rating":
      return [...media].sort(
        (a, b) => (b.averageRating ?? -1) - (a.averageRating ?? -1),
      );
    case "year":
      return [...media].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    case "runtime":
      return [...media].sort((a, b) => (b.runtime ?? 0) - (a.runtime ?? 0));
    case "dateAdded":
      return media;
    case "manual":
    default:
      return media;
  }
}

export function getListBannerPosters(
  list: CustomList,
  allMedia: MediaItem[],
): MediaItem[] {
  return sortListMedia(list, allMedia).slice(0, 4);
}
