import { MediaItem } from "../models/media";
import { MediaType, MediaStatus } from "../types/enums";
import { PagedResult } from "../types/common";

export type LibraryFilter =
  | "all"
  | "movies"
  | "shows"
  | "favorites"
  | "comfort";

export type ProgressTab =
  | "all"
  | "watching"
  | "up_to_date"
  | "plan_to_watch"
  | "watch_later"
  | "finished"
  | "waiting_for_new_season"
  | "dropped";

import { t } from "../i18n";

export function getProgressTabs(): { value: ProgressTab; label: string }[] {
  return [
    { value: "all", label: t("library.tabAll") },
    { value: "watching", label: t("library.tabWatching") },
    { value: "up_to_date", label: t("library.tabUpToDate") },
    { value: "plan_to_watch", label: t("library.tabPlanToWatch") },
    { value: "finished", label: t("library.tabFinished") },
    { value: "waiting_for_new_season", label: t("library.tabWaiting") },
    { value: "dropped", label: t("library.tabDropped") },
  ];
}

export const PROGRESS_TABS: { value: ProgressTab; label: string }[] = [
  { value: "all", label: t("library.tabAll") },
  { value: "watching", label: t("library.tabWatching") },
  { value: "up_to_date", label: t("library.tabUpToDate") },
  { value: "plan_to_watch", label: t("library.tabPlanToWatch") },
  { value: "finished", label: t("library.tabFinished") },
  { value: "waiting_for_new_season", label: t("library.tabWaiting") },
  { value: "dropped", label: t("library.tabDropped") },
];

const PROGRESS_TAB_STATUSES: Partial<Record<ProgressTab, MediaStatus[]>> = {
  watching: [MediaStatus.Watching, MediaStatus.Rewatching],
  up_to_date: [MediaStatus.UpToDate],
  plan_to_watch: [MediaStatus.PlanToWatch],
  watch_later: [MediaStatus.WatchLater],
  finished: [MediaStatus.Completed],
  waiting_for_new_season: [MediaStatus.WaitingForNewSeason],
  dropped: [MediaStatus.Dropped],
};

export function applyProgressTab(
  items: MediaItem[],
  tab: ProgressTab,
): MediaItem[] {
  if (tab === "all") return items;
  const statuses = PROGRESS_TAB_STATUSES[tab];
  if (!statuses) return items;
  return items.filter((m) => statuses.includes(m.status));
}

export type LibrarySortField =
  | "recent"
  | "title"
  | "rating"
  | "watchCount"
  | "year"
  | "runtime";
export type SortDirection = "asc" | "desc";

export interface LibraryQuery {
  searchText: string;
  filter: LibraryFilter;
  progressTab: ProgressTab;
  sortField: LibrarySortField;
  sortDirection: SortDirection;
  page: number;
  pageSize: number;
}

export const DEFAULT_LIBRARY_QUERY: LibraryQuery = {
  searchText: "",
  filter: "all",
  progressTab: "all",
  sortField: "recent",
  sortDirection: "desc",
  page: 1,
  pageSize: 24,
};

export function recentSortKey(item: MediaItem): string {
  if (item.lastActivityAt) return item.lastActivityAt;

  const raw = item.lastWatchedDate ?? item.createdAt;

  return raw.length <= 10 ? `${raw}T23:59:59.999Z` : raw;
}

export function applyLibraryFilter(
  items: MediaItem[],
  filter: LibraryFilter,
): MediaItem[] {
  switch (filter) {
    case "movies":
      return items.filter((m) => m.type === MediaType.Movie);
    case "shows":
      return items.filter((m) => m.type === MediaType.TVShow);
    case "favorites":
      return items.filter((m) => m.isFavorite === true);
    case "comfort":
      return items.filter((m) => m.status === MediaStatus.ComfortMedia);
    case "all":
    default:
      return items;
  }
}

export function applyLibrarySearch(
  items: MediaItem[],
  searchText: string,
): MediaItem[] {
  const q = searchText.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (m) =>
      m.title.toLowerCase().includes(q) ||
      (m.originalTitle?.toLowerCase().includes(q) ?? false) ||
      m.genres.some((g) => g.toLowerCase().includes(q)) ||
      m.tags.some((t) => t.toLowerCase().includes(q)),
  );
}

export function sortLibrary(
  items: MediaItem[],
  field: LibrarySortField,
  direction: SortDirection,
): MediaItem[] {
  const sorted = [...items].sort((a, b) => {
    let cmp = 0;
    switch (field) {
      case "recent":
        cmp = recentSortKey(a).localeCompare(recentSortKey(b));
        break;
      case "title":
        cmp = a.title.localeCompare(b.title);
        break;
      case "rating":
        cmp = (a.averageRating ?? -1) - (b.averageRating ?? -1);
        break;
      case "watchCount":
        cmp = a.watchCount - b.watchCount;
        break;
      case "year":
        cmp = (a.year ?? 0) - (b.year ?? 0);
        break;
      case "runtime":
        cmp = (a.runtime ?? 0) - (b.runtime ?? 0);
        break;
    }
    return direction === "asc" ? cmp : -cmp;
  });
  return sorted;
}

export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number,
): PagedResult<T> {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const start = (clampedPage - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  return {
    items: pageItems,
    total,
    page: clampedPage,
    pageSize,
  };
}

export function runLibraryQuery(
  allItems: MediaItem[],
  query: LibraryQuery,
): PagedResult<MediaItem> {
  const filtered = applyLibraryFilter(allItems, query.filter);
  const tabbed = applyProgressTab(filtered, query.progressTab);
  const searched = applyLibrarySearch(tabbed, query.searchText);
  const sorted = sortLibrary(searched, query.sortField, query.sortDirection);
  return paginate(sorted, query.page, query.pageSize);
}
