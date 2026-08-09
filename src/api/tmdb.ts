import { TMDBHttpClient } from "./tmdb-http-client";
import { TTLCache } from "./tmdb-cache";
import {
  normalizeSearchResult,
  normalizeMovieDetails,
  normalizeTVDetails,
  normalizeEpisode,
  isLatinish as isPersonNameLatinish,
} from "./tmdb-normalize";
import {
  TMDBRawSearchResponse,
  TMDBRawMovieDetails,
  TMDBRawTVDetails,
  TMDBRawSeasonDetails,
  TMDBRawGenre,
  TMDBRawImage,
  TMDBRawImagesResponse,
  TMDBImageOptions,
  TMDBSearchResult,
  TMDBNormalizedDetails,
  TMDBNormalizedEpisode,
  TMDBRawCastMember,
  TMDBRawCrewMember,
  TMDBRawPersonDetails,
  TMDBPersonDetails,
  TMDBFilmographyItem,
} from "../types/tmdb";
import { PagedResult } from "../types/common";

export interface TMDBServiceConfig {
  getApiKey: () => string;
  getCacheDurationMinutes: () => number;
  getLanguage?: () => string;
  getRegion?: () => string;
  getShowAdultContent?: () => boolean;
}

const PLUGIN_LOCALE_TO_TMDB_LANGUAGE: Record<string, string> = {
  en: "en-US",
  tr: "tr-TR",
};

export function tmdbLanguageFor(pluginLocale: string): string {
  return PLUGIN_LOCALE_TO_TMDB_LANGUAGE[pluginLocale] ?? "en-US";
}

export class TMDBService {
  private http: TMDBHttpClient;
  private cache: TTLCache<unknown>;
  private config: TMDBServiceConfig;

  constructor(config: TMDBServiceConfig) {
    this.config = config;
    this.http = new TMDBHttpClient(config.getApiKey);
    this.cache = new TTLCache(
      () => config.getCacheDurationMinutes() * 60 * 1000,
    );
  }

  private get language(): string {
    return this.config.getLanguage?.() ?? "en-US";
  }

  private get includeAdult(): "true" | "false" {
    return this.config.getShowAdultContent?.() ? "true" : "false";
  }

  private async cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key) as T | undefined;
    if (hit !== undefined) return hit;
    const value = await fetcher();
    this.cache.set(key, value);
    return value;
  }

  clearCache(): void {
    this.cache.clear();
  }

  async searchMovies(
    query: string,
    page = 1,
    year: number | null = null,
  ): Promise<PagedResult<TMDBSearchResult>> {
    const key = `search:movie:${query}:${page}:${year ?? ""}:${this.language}`;
    return this.cached(key, async () => {
      const raw = await this.http.get<TMDBRawSearchResponse>("/search/movie", {
        params: {
          query,
          page,
          language: this.language,
          include_adult: this.includeAdult,
          ...(year !== null ? { primary_release_year: year } : {}),
        },
      });
      return {
        items: raw.results.map((r) => normalizeSearchResult(r, "movie")),
        total: raw.total_results,
        page: raw.page,
        pageSize: raw.results.length,
      };
    });
  }

  async searchShows(
    query: string,
    page = 1,
    year: number | null = null,
  ): Promise<PagedResult<TMDBSearchResult>> {
    const key = `search:tv:${query}:${page}:${year ?? ""}:${this.language}`;
    return this.cached(key, async () => {
      const raw = await this.http.get<TMDBRawSearchResponse>("/search/tv", {
        params: {
          query,
          page,
          language: this.language,
          include_adult: this.includeAdult,
          ...(year !== null ? { first_air_date_year: year } : {}),
        },
      });
      return {
        items: raw.results.map((r) => normalizeSearchResult(r, "tv")),
        total: raw.total_results,
        page: raw.page,
        pageSize: raw.results.length,
      };
    });
  }

  async searchMulti(
    query: string,
    page = 1,
  ): Promise<PagedResult<TMDBSearchResult>> {
    const key = `search:multi:${query}:${page}:${this.language}`;
    return this.cached(key, async () => {
      const raw = await this.http.get<TMDBRawSearchResponse>("/search/multi", {
        params: {
          query,
          page,
          language: this.language,
          include_adult: this.includeAdult,
        },
      });
      const items = raw.results
        .filter((r) => r.media_type === "movie" || r.media_type === "tv")
        .map((r) => normalizeSearchResult(r, r.media_type as "movie" | "tv"));
      return {
        items,
        total: raw.total_results,
        page: raw.page,
        pageSize: items.length,
      };
    });
  }

  async getMovie(tmdbId: number): Promise<TMDBNormalizedDetails> {
    const key = `movie:${tmdbId}:${this.language}`;
    return this.cached(key, async () => {
      const raw = await this.http.get<TMDBRawMovieDetails>(`/movie/${tmdbId}`, {
        params: { language: this.language, append_to_response: "credits" },
      });
      return normalizeMovieDetails(raw);
    });
  }

  async getTV(tmdbId: number): Promise<TMDBNormalizedDetails> {
    const key = `tv:${tmdbId}:${this.language}`;
    return this.cached(key, async () => {
      const raw = await this.http.get<TMDBRawTVDetails>(`/tv/${tmdbId}`, {
        params: { language: this.language, append_to_response: "credits" },
      });
      return normalizeTVDetails(raw);
    });
  }

  async getCredits(
    tmdbId: number,
    kind: "movie" | "tv",
  ): Promise<TMDBNormalizedDetails["cast"]> {
    const details =
      kind === "movie" ? await this.getMovie(tmdbId) : await this.getTV(tmdbId);
    return details.cast;
  }

  async getPersonDetails(personId: number): Promise<TMDBPersonDetails> {
    const key = `person:${personId}:${this.language}`;
    return this.cached(key, async () => {
      const raw = await this.http.get<TMDBRawPersonDetails>(
        `/person/${personId}`,
        {
          params: {
            language: this.language,
            append_to_response: "combined_credits",
          },
        },
      );

      let biography = raw.biography ?? "";
      if (!biography && this.language !== "en-US") {
        const englishKey = `person:${personId}:en-US:biography`;
        biography = await this.cached(englishKey, async () => {
          const englishRaw = await this.http.get<TMDBRawPersonDetails>(
            `/person/${personId}`,
            { params: { language: "en-US" } },
          );
          return englishRaw.biography ?? "";
        });
      }

      let displayName = raw.name;
      let originalName: string | null = null;
      if (!isPersonNameLatinish(raw.name)) {
        const romanizedAlt = (raw.also_known_as ?? []).find((alt) =>
          isPersonNameLatinish(alt),
        );
        if (romanizedAlt) {
          displayName = romanizedAlt;
          originalName = raw.name;
        }
      }

      const TV_PROGRAM_GENRE_IDS = new Set([10767, 10764, 99, 10763]);

      const filmography = (raw.combined_credits?.cast ?? [])
        .filter((c) => c.media_type === "movie" || c.media_type === "tv")
        .map((c) => {
          const mediaKind = c.media_type as "movie" | "tv";
          const isProgram =
            mediaKind === "tv" &&
            (c.genre_ids ?? []).some((g) => TV_PROGRAM_GENRE_IDS.has(g));
          const category: TMDBFilmographyItem["category"] =
            mediaKind === "movie"
              ? "movie"
              : isProgram
                ? "tv_program"
                : "tv_series";
          return {
            tmdbId: c.id,
            mediaKind,
            category,
            title: c.title ?? c.name ?? "Untitled",
            posterPath: c.poster_path ?? null,
            year:
              (c.release_date || c.first_air_date || "").slice(0, 4) || null,
            character: c.character ?? null,
            popularity: c.popularity ?? 0,
          };
        })
        .sort(
          (a, b) =>
            (b.year ?? "").localeCompare(a.year ?? "") ||
            b.popularity - a.popularity,
        );

      return {
        tmdbPersonId: raw.id,
        name: displayName,
        originalName,
        profilePath: raw.profile_path ?? null,
        birthday: raw.birthday ?? null,
        deathday: raw.deathday ?? null,
        placeOfBirth: raw.place_of_birth ?? null,
        biography,
        filmography,
      };
    });
  }

  async getEpisodes(
    tmdbShowId: number,
    seasonNumber: number,
  ): Promise<TMDBNormalizedEpisode[]> {
    const key = `episodes:${tmdbShowId}:${seasonNumber}:${this.language}`;
    return this.cached(key, async () => {
      const raw = await this.http.get<TMDBRawSeasonDetails>(
        `/tv/${tmdbShowId}/season/${seasonNumber}`,
        { params: { language: this.language } },
      );
      return (raw.episodes ?? []).map(normalizeEpisode);
    });
  }

  async getEpisodeCredits(
    tmdbShowId: number,
    seasonNumber: number,
    episodeNumber: number,
  ): Promise<{
    guestCast: { name: string; character: string }[];
    crew: { name: string; job: string }[];
  }> {
    const key = `episode-credits:${tmdbShowId}:${seasonNumber}:${episodeNumber}:${this.language}`;
    return this.cached(key, async () => {
      const raw = await this.http.get<{
        guest_stars?: TMDBRawCastMember[];
        crew?: TMDBRawCrewMember[];
      }>(
        `/tv/${tmdbShowId}/season/${seasonNumber}/episode/${episodeNumber}/credits`,
        {
          params: { language: this.language },
        },
      );
      return {
        guestCast: (raw.guest_stars ?? []).map((c) => ({
          name: c.name,
          character: c.character,
        })),
        crew: (raw.crew ?? [])
          .filter((c) => c.job === "Director" || c.job === "Writer")
          .map((c) => ({ name: c.name, job: c.job })),
      };
    });
  }

  async getRecommendations(
    tmdbId: number,
    kind: "movie" | "tv",
    page = 1,
  ): Promise<PagedResult<TMDBSearchResult>> {
    const key = `recs:${kind}:${tmdbId}:${page}:${this.language}:${this.includeAdult}`;
    return this.cached(key, async () => {
      const raw = await this.http.get<TMDBRawSearchResponse>(
        `/${kind}/${tmdbId}/recommendations`,
        { params: { page, language: this.language } },
      );

      const items = raw.results
        .map((r) => normalizeSearchResult(r, kind))
        .filter((r) => this.includeAdult === "true" || !r.adult);
      return {
        items,
        total: raw.total_results,
        page: raw.page,
        pageSize: items.length,
      };
    });
  }

  async getSimilar(
    tmdbId: number,
    kind: "movie" | "tv",
    page = 1,
  ): Promise<PagedResult<TMDBSearchResult>> {
    const key = `similar:${kind}:${tmdbId}:${page}:${this.language}:${this.includeAdult}`;
    return this.cached(key, async () => {
      const raw = await this.http.get<TMDBRawSearchResponse>(
        `/${kind}/${tmdbId}/similar`,
        {
          params: { page, language: this.language },
        },
      );
      const items = raw.results
        .map((r) => normalizeSearchResult(r, kind))
        .filter((r) => this.includeAdult === "true" || !r.adult);
      return {
        items,
        total: raw.total_results,
        page: raw.page,
        pageSize: items.length,
      };
    });
  }

  async getTrending(
    kind: "movie" | "tv",
    window: "day" | "week" = "week",
    page = 1,
  ): Promise<PagedResult<TMDBSearchResult>> {
    const key = `trending:${kind}:${window}:${page}:${this.language}:${this.includeAdult}`;
    return this.cached(key, async () => {
      const raw = await this.http.get<TMDBRawSearchResponse>(
        `/trending/${kind}/${window}`,
        {
          params: {
            page,
            language: this.language,
            include_adult: this.includeAdult,
          },
        },
      );
      return {
        items: raw.results.map((r) => normalizeSearchResult(r, kind)),
        total: raw.total_results,
        page: raw.page,
        pageSize: raw.results.length,
      };
    });
  }

  async getPopular(
    kind: "movie" | "tv",
    page = 1,
  ): Promise<PagedResult<TMDBSearchResult>> {
    const key = `popular:${kind}:${page}:${this.language}:${this.includeAdult}`;
    return this.cached(key, async () => {
      const raw = await this.http.get<TMDBRawSearchResponse>(
        `/${kind}/popular`,
        {
          params: {
            page,
            language: this.language,
            include_adult: this.includeAdult,
          },
        },
      );
      return {
        items: raw.results.map((r) => normalizeSearchResult(r, kind)),
        total: raw.total_results,
        page: raw.page,
        pageSize: raw.results.length,
      };
    });
  }

  async getGenres(
    kind: "movie" | "tv",
  ): Promise<{ id: number; name: string }[]> {
    const key = `genres:${kind}:${this.language}`;
    return this.cached(key, async () => {
      const raw = await this.http.get<{ genres: TMDBRawGenre[] }>(
        `/genre/${kind}/list`,
        {
          params: { language: this.language },
        },
      );
      return raw.genres;
    });
  }

  async getGenreMap(kind: "movie" | "tv"): Promise<Map<number, string>> {
    const localized = await this.getGenres(kind);
    const map = new Map<number, string>();
    for (const g of localized) map.set(g.id, g.name);

    if (this.language !== "en-US") {
      const hasGaps = localized.some((g) => !g.name);
      if (hasGaps || localized.length === 0) {
        const key = `genres:${kind}:en-US`;
        const english = await this.cached(key, async () => {
          const raw = await this.http.get<{ genres: TMDBRawGenre[] }>(
            `/genre/${kind}/list`,
            { params: { language: "en-US" } },
          );
          return raw.genres;
        });
        for (const g of english) if (!map.has(g.id)) map.set(g.id, g.name);
      }
    }

    return map;
  }

  async getImages(
    tmdbId: number,
    kind: "movie" | "tv",
  ): Promise<TMDBImageOptions> {
    const key = `images:${kind}:${tmdbId}`;
    return this.cached(key, async () => {
      const raw = await this.http.get<TMDBRawImagesResponse>(
        `/${kind}/${tmdbId}/images`,
        {
          params: {
            include_image_language: `${this.language.split("-")[0]},null`,
          },
        },
      );
      const byVoteDesc = (a: TMDBRawImage, b: TMDBRawImage) =>
        (b.vote_average ?? 0) - (a.vote_average ?? 0);
      return {
        posters: [...raw.posters].sort(byVoteDesc).map((p) => ({
          filePath: p.file_path,
          width: p.width,
          height: p.height,
        })),
        backdrops: [...raw.backdrops].sort(byVoteDesc).map((b) => ({
          filePath: b.file_path,
          width: b.width,
          height: b.height,
        })),
      };
    });
  }

  async discover(
    kind: "movie" | "tv",
    filters: DiscoverFilters,
    page = 1,
  ): Promise<PagedResult<TMDBSearchResult>> {
    const params: Record<string, string | number> = {
      page,
      language: this.language,
      include_adult: this.includeAdult,
    };
    if (filters.genreId !== undefined) params.with_genres = filters.genreId;
    if (filters.yearMin !== undefined || filters.yearMax !== undefined) {
      const dateField =
        kind === "movie" ? "primary_release_date" : "first_air_date";
      if (filters.yearMin !== undefined)
        params[`${dateField}.gte`] = `${filters.yearMin}-01-01`;
      if (filters.yearMax !== undefined)
        params[`${dateField}.lte`] = `${filters.yearMax}-12-31`;
    }
    if (filters.runtimeMin !== undefined)
      params["with_runtime.gte"] = filters.runtimeMin;
    if (filters.runtimeMax !== undefined)
      params["with_runtime.lte"] = filters.runtimeMax;
    if (filters.ratingMin !== undefined)
      params["vote_average.gte"] = filters.ratingMin;
    if (filters.language) params.with_original_language = filters.language;
    params.sort_by = filters.sortBy ?? "popularity.desc";

    const key = `discover:${kind}:${JSON.stringify(params)}`;
    return this.cached(key, async () => {
      const raw = await this.http.get<TMDBRawSearchResponse>(
        `/discover/${kind}`,
        { params },
      );
      return {
        items: raw.results.map((r) => normalizeSearchResult(r, kind)),
        total: raw.total_results,
        page: raw.page,
        pageSize: raw.results.length,
      };
    });
  }
}

export interface DiscoverFilters {
  genreId?: number;
  yearMin?: number;
  yearMax?: number;
  runtimeMin?: number;
  runtimeMax?: number;
  ratingMin?: number;
  language?: string;
  sortBy?: string;
}
