export interface ExternalIds {
  tvdbId?: number | null;
  imdbId?: string | null;
  tvTimeUuid?: string | null;
  tvTimeId?: string | null;
  tvTimeEpisodeId?: string | null;
}

export interface MatchMetadata {
  originalTitle?: string | null;
  releaseDate?: string | null;
  runtimeSeconds?: number | null;
  country?: string | null;
  language?: string | null;
}

export type ImportMediaKind = "movie" | "series";

export interface WatchImport {
  kind: ImportMediaKind;
  ids: ExternalIds;
  title: string;
  year: number | null;
  match?: MatchMetadata;

  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
  watchedAt: string | null;
  rewatchCount: number;
}

export interface ReviewImport {
  kind: ImportMediaKind;
  ids: ExternalIds;
  title: string;
  year: number | null;
  match?: MatchMetadata;
  seasonNumber?: number;
  episodeNumber?: number;
  commentText: string;
  createdAt: string | null;
  editedAt: string | null;
}

export interface LikeImport {
  kind: ImportMediaKind;
  ids: ExternalIds;
  title: string;
  year: number | null;
  match?: MatchMetadata;
  seasonNumber?: number;
  episodeNumber?: number;
  likedAt: string | null;
}

export interface RatingImport {
  kind: ImportMediaKind;
  ids: ExternalIds;
  title: string;
  year: number | null;
  match?: MatchMetadata;
  seasonNumber?: number;
  episodeNumber?: number;
  rating: number;
  emotion?: string | null;
  ratedAt: string | null;
}

export interface FavoriteImport {
  kind: ImportMediaKind;
  ids: ExternalIds;
  title: string;
  year: number | null;
  match?: MatchMetadata;
}

export interface DroppedImport {
  kind: ImportMediaKind;
  ids: ExternalIds;
  title: string;
  year: number | null;
  match?: MatchMetadata;
}

export interface ListImportItem {
  kind: ImportMediaKind;
  ids: ExternalIds;
  title: string;
  year: number | null;
  match?: MatchMetadata;
}

export type ListBuiltInKind = "movies" | "series" | null;

export interface ListImport {
  name: string;
  description: string | null;
  items: ListImportItem[];
  sourceKey: string;

  createdAt?: string | null;
  updatedAt?: string | null;
  isPublic?: boolean;
  posterUrl?: string | null;
  bannerUrl?: string | null;

  builtIn?: ListBuiltInKind;
}

export interface ListImportDiagnostics {
  listsDiscovered: number;
  unmatchedSKeys: string[];
  listItemRows: number;
  builtInListsDiscovered: number;
  customListsDiscovered: number;
  totalListItemsParsed: number;
  unresolvedMovieUuids: string[];
  perList: {
    name: string;
    items: number;
    resolved: number;
    skipped: number;
  }[];
}

export function emptyListImportDiagnostics(): ListImportDiagnostics {
  return {
    listsDiscovered: 0,
    unmatchedSKeys: [],
    listItemRows: 0,
    builtInListsDiscovered: 0,
    customListsDiscovered: 0,
    totalListItemsParsed: 0,
    unresolvedMovieUuids: [],
    perList: [],
  };
}

export interface DroppedImportDiagnostics {
  archivedRowsFound: number;
  droppedMovies: number;
  droppedSeries: number;
}

export function emptyDroppedImportDiagnostics(): DroppedImportDiagnostics {
  return { archivedRowsFound: 0, droppedMovies: 0, droppedSeries: 0 };
}

export interface NormalizedImportBundle {
  watches: WatchImport[];
  reviews: ReviewImport[];
  likes: LikeImport[];
  ratings: RatingImport[];
  favorites: FavoriteImport[];
  lists: ListImport[];
  dropped: DroppedImport[];
  warnings: { row?: number; reason: string }[];
  listDiagnostics: ListImportDiagnostics;
  droppedDiagnostics: DroppedImportDiagnostics;
}

export function emptyBundle(): NormalizedImportBundle {
  return {
    watches: [],
    reviews: [],
    likes: [],
    ratings: [],
    favorites: [],
    lists: [],
    dropped: [],
    warnings: [],
    listDiagnostics: emptyListImportDiagnostics(),
    droppedDiagnostics: emptyDroppedImportDiagnostics(),
  };
}

export function mergeBundles(
  bundles: NormalizedImportBundle[],
): NormalizedImportBundle {
  const result = emptyBundle();
  for (const b of bundles) {
    result.watches.push(...b.watches);
    result.reviews.push(...b.reviews);
    result.likes.push(...b.likes);
    result.ratings.push(...b.ratings);
    result.favorites.push(...b.favorites);
    result.lists.push(...b.lists);
    result.dropped.push(...b.dropped);
    result.warnings.push(...b.warnings);
    result.listDiagnostics.listsDiscovered += b.listDiagnostics.listsDiscovered;
    result.listDiagnostics.unmatchedSKeys.push(
      ...b.listDiagnostics.unmatchedSKeys,
    );
    result.listDiagnostics.listItemRows += b.listDiagnostics.listItemRows;
    result.listDiagnostics.builtInListsDiscovered +=
      b.listDiagnostics.builtInListsDiscovered;
    result.listDiagnostics.customListsDiscovered +=
      b.listDiagnostics.customListsDiscovered;
    result.listDiagnostics.totalListItemsParsed +=
      b.listDiagnostics.totalListItemsParsed;
    result.listDiagnostics.unresolvedMovieUuids.push(
      ...b.listDiagnostics.unresolvedMovieUuids,
    );
    result.listDiagnostics.perList.push(...b.listDiagnostics.perList);
    result.droppedDiagnostics.archivedRowsFound +=
      b.droppedDiagnostics.archivedRowsFound;
    result.droppedDiagnostics.droppedMovies +=
      b.droppedDiagnostics.droppedMovies;
    result.droppedDiagnostics.droppedSeries +=
      b.droppedDiagnostics.droppedSeries;
  }
  return result;
}

export type ImportCategory =
  | "json_movie"
  | "json_series"
  | "json_list"
  | "csv_followed_shows"
  | "csv_watched_episodes"
  | "csv_watched_movies"
  | "csv_comments"
  | "csv_likes"
  | "csv_ratings"
  | "csv_favorites"
  | "unknown";

export interface DetectionResult {
  format: "json" | "csv";
  category: ImportCategory;
  label: string;
}

export interface TVTimeImporter {
  category: ImportCategory;
  label: string;
  detect(parsed: unknown, format: "json" | "csv"): boolean;
  parse(parsed: unknown): NormalizedImportBundle;
}
