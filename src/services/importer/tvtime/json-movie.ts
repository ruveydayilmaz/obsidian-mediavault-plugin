import {
  TVTimeImporter,
  NormalizedImportBundle,
  emptyBundle,
  WatchImport,
  FavoriteImport,
} from "./types";

interface RawTVTimeMovie {
  id?: { tvdb?: number | null; imdb?: string | null };
  uuid?: string;
  created_at?: string;
  title?: string;
  year?: number;
  watched_at?: string | null;
  is_watched?: boolean;
  is_favorite?: boolean;
  rewatch_count?: number;
}

function looksLikeMovie(obj: unknown): obj is RawTVTimeMovie {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.title === "string" &&
    !("seasons" in o) &&
    ("is_watched" in o || "watched_at" in o || "year" in o)
  );
}

function parseOne(raw: RawTVTimeMovie, bundle: NormalizedImportBundle): void {
  if (!raw.title) {
    bundle.warnings.push({ reason: "Movie entry missing a title." });
    return;
  }

  const ids = {
    tvdbId: raw.id?.tvdb ?? null,
    imdbId: raw.id?.imdb ?? null,
    tvTimeUuid: raw.uuid ?? null,
  };

  if (raw.is_watched) {
    const watch: WatchImport = {
      kind: "movie",
      ids,
      title: raw.title,
      year: raw.year ?? null,
      watchedAt: raw.watched_at ?? raw.created_at ?? null,
      rewatchCount: raw.rewatch_count ?? 0,
    };
    bundle.watches.push(watch);
  }

  if (raw.is_favorite) {
    const fav: FavoriteImport = {
      kind: "movie",
      ids,
      title: raw.title,
      year: raw.year ?? null,
    };
    bundle.favorites.push(fav);
  }
}

export const JsonMovieImporter: TVTimeImporter = {
  category: "json_movie",
  label: "Movie Export",

  detect(parsed, format) {
    if (format !== "json") return false;
    if (Array.isArray(parsed))
      return parsed.length > 0 && looksLikeMovie(parsed[0]);
    return looksLikeMovie(parsed);
  },

  parse(parsed) {
    const bundle = emptyBundle();
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      if (looksLikeMovie(item)) parseOne(item, bundle);
    }
    return bundle;
  },
};
