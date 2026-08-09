import {
  TVTimeImporter,
  emptyBundle,
  WatchImport,
  ReviewImport,
  LikeImport,
  RatingImport,
  FavoriteImport,
  ImportMediaKind,
} from "./types";
import { RawImportRow } from "../parse";
import { parseFlexibleDate } from "../normalize";
import { parseSeasonEpisodeFromTitle } from "../season-episode-parse";

const TITLE_ALIASES = [
  "title",
  "show",
  "show_name",
  "tv_show_name",
  "movie",
  "movie_name",
  "series",
  "series_name",
];
const SEASON_ALIASES = ["season_number", "season", "episode_season_number"];
const EPISODE_ALIASES = ["episode_number", "episode"];
const EPISODE_TITLE_ALIASES = ["episode_name", "episode_title"];
const COMMENT_ALIASES = [
  "comment",
  "comment_text",
  "text",
  "review",
  "review_text",
];
const CREATED_ALIASES = ["created_at", "commented_at", "date"];
const EDITED_ALIASES = ["edited_at", "updated_at"];
const LIKED_ALIASES = ["liked_at", "like_date"];
const RATING_ALIASES = ["rating", "score", "my_rating"];
const RATED_ALIASES = ["rated_at", "rating_date"];
const WATCHED_DATE_ALIASES = [
  "watched_at",
  "watch_date",
  "watched_date",
  "date",
];
const REWATCH_ALIASES = ["rewatch_count", "cpt"];

function findField(row: RawImportRow, aliases: string[]): string | null {
  const lower: Record<string, string> = {};
  for (const k of Object.keys(row)) lower[k.toLowerCase().trim()] = row[k];
  for (const alias of aliases) {
    const v = lower[alias];
    if (v !== undefined && v.trim() !== "") return v.trim();
  }
  return null;
}

function hasAnyColumn(rows: RawImportRow[], aliases: string[]): boolean {
  if (rows.length === 0) return false;
  const headers = Object.keys(rows[0]).map((h) => h.toLowerCase().trim());
  return aliases.some((a) => headers.includes(a));
}

function kindFor(row: RawImportRow): ImportMediaKind {
  if (
    findField(row, SEASON_ALIASES) !== null ||
    findField(row, EPISODE_ALIASES) !== null
  )
    return "series";

  const title = findField(row, TITLE_ALIASES);
  if (title && parseSeasonEpisodeFromTitle(title) !== null) return "series";

  return "movie";
}

function baseFields(row: RawImportRow) {
  const rawTitle = findField(row, TITLE_ALIASES);
  const seasonRaw = findField(row, SEASON_ALIASES);
  const episodeRaw = findField(row, EPISODE_ALIASES);

  const embedded = rawTitle ? parseSeasonEpisodeFromTitle(rawTitle) : null;
  const usingEmbedded =
    embedded !== null && seasonRaw === null && episodeRaw === null;

  return {
    title: usingEmbedded ? embedded.baseTitle : rawTitle,
    seasonNumber:
      seasonRaw !== null
        ? parseInt(seasonRaw, 10)
        : usingEmbedded
          ? (embedded.season ?? undefined)
          : undefined,
    episodeNumber:
      episodeRaw !== null
        ? parseInt(episodeRaw, 10)
        : usingEmbedded
          ? (embedded.episode ?? undefined)
          : undefined,
    episodeTitle: findField(row, EPISODE_TITLE_ALIASES) ?? undefined,
  };
}

export const CsvCommentsImporter: TVTimeImporter = {
  category: "csv_comments",
  label: "Comments",

  detect(parsed, format) {
    if (format !== "csv") return false;
    return hasAnyColumn(parsed as RawImportRow[], COMMENT_ALIASES);
  },

  parse(parsed) {
    const bundle = emptyBundle();
    (parsed as RawImportRow[]).forEach((row, i) => {
      const { title, seasonNumber, episodeNumber } = baseFields(row);
      const commentText = findField(row, COMMENT_ALIASES);
      if (!title || !commentText) {
        bundle.warnings.push({
          row: i,
          reason: "Comment row missing a title or comment text.",
        });
        return;
      }
      const review: ReviewImport = {
        kind: kindFor(row),
        ids: {},
        title,
        year: null,
        seasonNumber,
        episodeNumber,
        commentText,
        createdAt: parseFlexibleDate(findField(row, CREATED_ALIASES)),
        editedAt: parseFlexibleDate(findField(row, EDITED_ALIASES)),
      };
      bundle.reviews.push(review);
    });
    return bundle;
  },
};

export const CsvLikesImporter: TVTimeImporter = {
  category: "csv_likes",
  label: "Likes",

  detect(parsed, format) {
    if (format !== "csv") return false;
    const rows = parsed as RawImportRow[];
    if (rows.length === 0) return false;
    const headers = Object.keys(rows[0]).map((h) => h.toLowerCase());
    return headers.some((h) => h === "liked" || h === "is_liked");
  },

  parse(parsed) {
    const bundle = emptyBundle();
    (parsed as RawImportRow[]).forEach((row, i) => {
      const { title, seasonNumber, episodeNumber } = baseFields(row);
      if (!title) {
        bundle.warnings.push({ row: i, reason: "Like row missing a title." });
        return;
      }
      const like: LikeImport = {
        kind: kindFor(row),
        ids: {},
        title,
        year: null,
        seasonNumber,
        episodeNumber,
        likedAt: parseFlexibleDate(findField(row, LIKED_ALIASES)),
      };
      bundle.likes.push(like);
    });
    return bundle;
  },
};

export const CsvRatingsImporter: TVTimeImporter = {
  category: "csv_ratings",
  label: "Ratings",

  detect(parsed, format) {
    if (format !== "csv") return false;
    const rows = parsed as RawImportRow[];
    return (
      hasAnyColumn(rows, RATING_ALIASES) && !hasAnyColumn(rows, COMMENT_ALIASES)
    );
  },

  parse(parsed) {
    const bundle = emptyBundle();
    (parsed as RawImportRow[]).forEach((row, i) => {
      const { title, seasonNumber, episodeNumber } = baseFields(row);
      const ratingRaw = findField(row, RATING_ALIASES);
      const rating = ratingRaw !== null ? parseFloat(ratingRaw) : NaN;
      if (!title || isNaN(rating)) {
        bundle.warnings.push({
          row: i,
          reason: "Rating row missing a title or a valid rating.",
        });
        return;
      }
      const ratingImport: RatingImport = {
        kind: kindFor(row),
        ids: {},
        title,
        year: null,
        seasonNumber,
        episodeNumber,
        rating,
        ratedAt: parseFlexibleDate(findField(row, RATED_ALIASES)),
      };
      bundle.ratings.push(ratingImport);
    });
    return bundle;
  },
};

export const CsvFavoritesImporter: TVTimeImporter = {
  category: "csv_favorites",
  label: "Favorites",

  detect(parsed, format) {
    if (format !== "csv") return false;
    const rows = parsed as RawImportRow[];
    if (rows.length === 0) return false;
    const headers = Object.keys(rows[0]).map((h) => h.toLowerCase());
    return headers.some(
      (h) => h === "is_favorite" || h === "favorite" || h === "favorited",
    );
  },

  parse(parsed) {
    const bundle = emptyBundle();
    (parsed as RawImportRow[]).forEach((row, i) => {
      const { title } = baseFields(row);
      if (!title) {
        bundle.warnings.push({
          row: i,
          reason: "Favorite row missing a title.",
        });
        return;
      }
      const fav: FavoriteImport = {
        kind: kindFor(row),
        ids: {},
        title,
        year: null,
      };
      bundle.favorites.push(fav);
    });
    return bundle;
  },
};

export const CsvWatchedEpisodesImporter: TVTimeImporter = {
  category: "csv_watched_episodes",
  label: "Watched Episodes",

  detect(parsed, format) {
    if (format !== "csv") return false;
    const rows = parsed as RawImportRow[];
    return (
      hasAnyColumn(rows, SEASON_ALIASES) &&
      hasAnyColumn(rows, EPISODE_ALIASES) &&
      hasAnyColumn(rows, WATCHED_DATE_ALIASES)
    );
  },

  parse(parsed) {
    const bundle = emptyBundle();
    (parsed as RawImportRow[]).forEach((row, i) => {
      const { title, seasonNumber, episodeNumber, episodeTitle } =
        baseFields(row);
      if (!title || seasonNumber === undefined || episodeNumber === undefined) {
        bundle.warnings.push({
          row: i,
          reason: "Watched-episode row missing title/season/episode.",
        });
        return;
      }
      const watch: WatchImport = {
        kind: "series",
        ids: {},
        title,
        year: null,
        seasonNumber,
        episodeNumber,
        episodeTitle,
        watchedAt: parseFlexibleDate(findField(row, WATCHED_DATE_ALIASES)),
        rewatchCount: parseInt(findField(row, REWATCH_ALIASES) ?? "0", 10) || 0,
      };
      bundle.watches.push(watch);
    });
    return bundle;
  },
};

export const CsvWatchedMoviesImporter: TVTimeImporter = {
  category: "csv_watched_movies",
  label: "Watched Movies",

  detect(parsed, format) {
    if (format !== "csv") return false;
    const rows = parsed as RawImportRow[];
    return (
      hasAnyColumn(rows, TITLE_ALIASES) &&
      hasAnyColumn(rows, WATCHED_DATE_ALIASES) &&
      !hasAnyColumn(rows, SEASON_ALIASES) &&
      !hasAnyColumn(rows, EPISODE_ALIASES)
    );
  },

  parse(parsed) {
    const bundle = emptyBundle();
    (parsed as RawImportRow[]).forEach((row, i) => {
      const { title } = baseFields(row);
      if (!title) {
        bundle.warnings.push({
          row: i,
          reason: "Watched-movie row missing a title.",
        });
        return;
      }
      const watch: WatchImport = {
        kind: "movie",
        ids: {},
        title,
        year: null,
        watchedAt: parseFlexibleDate(findField(row, WATCHED_DATE_ALIASES)),
        rewatchCount: parseInt(findField(row, REWATCH_ALIASES) ?? "0", 10) || 0,
      };
      bundle.watches.push(watch);
    });
    return bundle;
  },
};
