import type { TMDBService } from "../api/tmdb";
import { MediaItem } from "../models/media";
import { MediaType } from "../types/enums";

function tmdbKindFor(type: MediaType): "movie" | "tv" | null {
  if (type === MediaType.Movie) return "movie";
  if (type === MediaType.TVShow) return "tv";
  return null;
}

export async function getLocalizedGenreNames(
  tmdb: TMDBService,
  media: Pick<MediaItem, "type" | "genres" | "genreIds">,
): Promise<string[]> {
  const kind = tmdbKindFor(media.type);
  const ids = media.genreIds ?? [];

  if (!kind || ids.length === 0) return media.genres;

  try {
    const map = await tmdb.getGenreMap(kind);
    return ids.map((id, i) => map.get(id) ?? media.genres[i] ?? "");
  } catch {
    return media.genres;
  }
}

export async function getLocalizedGenreName(
  tmdb: TMDBService,
  kind: "movie" | "tv",
  genreId: number,
  fallbackName: string,
): Promise<string> {
  try {
    const map = await tmdb.getGenreMap(kind);
    return map.get(genreId) ?? fallbackName;
  } catch {
    return fallbackName;
  }
}
