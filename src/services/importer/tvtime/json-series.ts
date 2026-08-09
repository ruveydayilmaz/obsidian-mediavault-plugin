import {
  TVTimeImporter,
  NormalizedImportBundle,
  emptyBundle,
  WatchImport,
  FavoriteImport,
} from "./types";

interface RawTVTimeEpisode {
  id?: { tvdb?: number | null; imdb?: string | null };
  number?: number;
  name?: string;
  special?: boolean;
  is_watched?: boolean;
  watched_at?: string | null;
  rewatch_count?: number;
  watched_count?: number;
}

interface RawTVTimeSeason {
  number?: number;
  is_specials?: boolean;
  episodes?: RawTVTimeEpisode[];
}

interface RawTVTimeSeries {
  uuid?: string;
  id?: { tvdb?: number | null; imdb?: string | null };
  created_at?: string;
  title?: string;
  status?: string;
  is_favorite?: boolean;
  seasons?: RawTVTimeSeason[];
}

function looksLikeSeries(obj: unknown): obj is RawTVTimeSeries {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return typeof o.title === "string" && Array.isArray(o.seasons);
}

function parseOne(raw: RawTVTimeSeries, bundle: NormalizedImportBundle): void {
  if (!raw.title) {
    bundle.warnings.push({ reason: "Series entry missing a title." });
    return;
  }

  const ids = {
    tvdbId: raw.id?.tvdb ?? null,
    imdbId: raw.id?.imdb ?? null,
    tvTimeUuid: raw.uuid ?? null,
  };

  for (const season of raw.seasons ?? []) {
    if (season.number === undefined) continue;
    for (const ep of season.episodes ?? []) {
      if (ep.number === undefined) {
        bundle.warnings.push({
          reason: `Episode in "${raw.title}" season ${season.number} missing an episode number.`,
        });
        continue;
      }
      if (!ep.is_watched) continue;

      const watch: WatchImport = {
        kind: "series",
        ids,
        title: raw.title,
        year: null,
        seasonNumber: season.number,
        episodeNumber: ep.number,
        episodeTitle: ep.name,
        watchedAt: ep.watched_at ?? null,
        rewatchCount: ep.rewatch_count ?? 0,
      };
      bundle.watches.push(watch);
    }
  }

  if (raw.is_favorite) {
    const fav: FavoriteImport = {
      kind: "series",
      ids,
      title: raw.title,
      year: null,
    };
    bundle.favorites.push(fav);
  }
}

export const JsonSeriesImporter: TVTimeImporter = {
  category: "json_series",
  label: "TV Show Export",

  detect(parsed, format) {
    if (format !== "json") return false;
    if (Array.isArray(parsed))
      return parsed.length > 0 && looksLikeSeries(parsed[0]);
    return looksLikeSeries(parsed);
  },

  parse(parsed) {
    const bundle = emptyBundle();
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      if (looksLikeSeries(item)) parseOne(item, bundle);
    }
    return bundle;
  },
};
