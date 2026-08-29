import {
  TMDBRawSearchResultItem,
  TMDBRawMovieDetails,
  TMDBRawTVDetails,
  TMDBRawEpisode,
  TMDBSearchResult,
  TMDBNormalizedDetails,
  TMDBNormalizedEpisode,
  TMDBMediaKind,
  TMDBRawPersonSearchItem,
  TMDBPersonSearchResult,
} from "../types/tmdb";
import { TMDB_IMAGE_BASE } from "./tmdb-http-client";

const LATIN_ISH_RE = /^[\x20-\x7E\u00C0-\u024F\u1E00-\u1EFF\s'’.-]+$/;

export function isLatinish(value: string): boolean {
  return LATIN_ISH_RE.test(value);
}

export function pickPersonNames(
  name: string,
  originalName?: string | null,
): { displayName: string; originalName: string | null } {
  if (!originalName || originalName === name) {
    return { displayName: name, originalName: null };
  }

  const nameIsLatin = isLatinish(name);
  const originalIsLatin = isLatinish(originalName);

  if (nameIsLatin && !originalIsLatin) {
    return { displayName: name, originalName };
  }
  if (!nameIsLatin && originalIsLatin) {
    return { displayName: originalName, originalName: name };
  }

  return { displayName: name, originalName };
}

export function tmdbImageUrl(
  path: string | null,
  size: "w200" | "w342" | "w500" | "original" = "w342",
): string | null {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

export function normalizeSearchResult(
  raw: TMDBRawSearchResultItem,
  mediaKind: TMDBMediaKind,
): TMDBSearchResult {
  const title =
    mediaKind === "movie"
      ? (raw.title ?? raw.name ?? "")
      : (raw.name ?? raw.title ?? "");
  const originalTitle = raw.original_title ?? raw.original_name ?? null;
  const dateStr = mediaKind === "movie" ? raw.release_date : raw.first_air_date;

  return {
    tmdbId: raw.id,
    mediaKind,
    title,
    originalTitle,
    year: extractYear(dateStr),
    posterPath: raw.poster_path,
    backdropPath: raw.backdrop_path,
    overview: raw.overview ?? "",
    country: raw.origin_country?.[0] ?? null,
    language: raw.original_language ?? null,
    adult: raw.adult,
    popularity: raw.popularity ?? 0,
  };
}

export function normalizeMovieDetails(
  raw: TMDBRawMovieDetails,
): TMDBNormalizedDetails {
  return {
    tmdbId: raw.id,
    mediaKind: "movie",
    title: raw.title,
    originalTitle: raw.original_title ?? null,
    year: extractYear(raw.release_date),
    releaseDate: raw.release_date ?? null,
    runtime: raw.runtime ?? null,
    genres: (raw.genres ?? []).map((g) => g.name),
    genreIds: (raw.genres ?? []).map((g) => g.id),
    posterPath: raw.poster_path,
    backdropPath: raw.backdrop_path,
    overview: raw.overview ?? "",
    language: raw.original_language ?? null,
    country: raw.origin_country?.[0] ?? null,
    productionCompanies: (raw.production_companies ?? []).map((c) => ({
      tmdbCompanyId: c.id,
      name: c.name,
      logoPath: c.logo_path,
      originCountry: c.origin_country || null,
    })),
    cast: (raw.credits?.cast ?? []).map((c) => {
      const { displayName, originalName } = pickPersonNames(
        c.name,
        c.original_name,
      );
      return {
        tmdbPersonId: c.id,
        name: displayName,
        originalName,
        character: c.character,
        profilePath: c.profile_path,
        order: c.order,
      };
    }),
    crew: (raw.credits?.crew ?? []).map((c) => {
      const { displayName, originalName } = pickPersonNames(
        c.name,
        c.original_name,
      );
      return {
        tmdbPersonId: c.id,
        name: displayName,
        originalName,
        job: c.job,
        department: c.department,
        profilePath: c.profile_path,
      };
    }),
    tmdbRating: raw.vote_average ?? null,
  };
}

export function normalizeTVDetails(
  raw: TMDBRawTVDetails,
): TMDBNormalizedDetails {
  return {
    tmdbId: raw.id,
    mediaKind: "tv",
    title: raw.name,
    originalTitle: raw.original_name ?? null,
    year: extractYear(raw.first_air_date),
    releaseDate: raw.first_air_date ?? null,
    runtime: raw.episode_run_time?.[0] ?? null,
    genres: (raw.genres ?? []).map((g) => g.name),
    genreIds: (raw.genres ?? []).map((g) => g.id),
    posterPath: raw.poster_path,
    backdropPath: raw.backdrop_path,
    overview: raw.overview ?? "",
    language: raw.original_language ?? null,
    country: raw.origin_country?.[0] ?? null,
    productionCompanies: (raw.production_companies ?? []).map((c) => ({
      tmdbCompanyId: c.id,
      name: c.name,
      logoPath: c.logo_path,
      originCountry: c.origin_country || null,
    })),
    cast: (raw.credits?.cast ?? []).map((c) => {
      const { displayName, originalName } = pickPersonNames(
        c.name,
        c.original_name,
      );
      return {
        tmdbPersonId: c.id,
        name: displayName,
        originalName,
        character: c.character,
        profilePath: c.profile_path,
        order: c.order,
      };
    }),
    crew: (raw.credits?.crew ?? []).map((c) => {
      const { displayName, originalName } = pickPersonNames(
        c.name,
        c.original_name,
      );
      return {
        tmdbPersonId: c.id,
        name: displayName,
        originalName,
        job: c.job,
        department: c.department,
        profilePath: c.profile_path,
      };
    }),
    seasons: (raw.seasons ?? [])
      .filter((s) => s.season_number > 0) // exclude "Specials"
      .map((s) => ({
        seasonNumber: s.season_number,
        episodeCount: s.episode_count,
        name: s.name,
        airDate: s.air_date,
      })),
    tvStatus: raw.status,
    tmdbRating: raw.vote_average ?? null,
  };
}

export function normalizeEpisode(raw: TMDBRawEpisode): TMDBNormalizedEpisode {
  return {
    tmdbEpisodeId: raw.id,
    seasonNumber: raw.season_number,
    episodeNumber: raw.episode_number,
    title: raw.name,
    runtime: raw.runtime,
    airDate: raw.air_date,
    synopsis: raw.overview || null,
    thumbnailPath: raw.still_path,
    tmdbRating: raw.vote_average,
  };
}

export const CREW_ROLE_JOBS: Record<string, string[]> = {
  Director: ["Director"],
  Writer: [
    "Writer",
    "Screenplay",
    "Story",
    "Teleplay",
    "Original Film Writer",
    "Novel",
  ],
  Producer: [
    "Producer",
    "Executive Producer",
    "Co-Producer",
    "Co-Executive Producer",
    "Line Producer",
    "Associate Producer",
    "Consulting Producer",
  ],
};

function canonicalCrewRole(job: string): string | null {
  for (const [role, jobs] of Object.entries(CREW_ROLE_JOBS)) {
    if (jobs.includes(job)) return role;
  }
  return null;
}

export function extractKeyCrew(
  crew: { tmdbPersonId: number; name: string; profilePath: string | null; job: string }[],
): { tmdbPersonId: number; name: string; profilePath: string | null; roles: string[] }[] {
  const byPerson = new Map<
    number,
    { tmdbPersonId: number; name: string; profilePath: string | null; roles: string[] }
  >();

  for (const member of crew) {
    const role = canonicalCrewRole(member.job);
    if (!role) continue;
    const existing = byPerson.get(member.tmdbPersonId);
    if (existing) {
      if (!existing.roles.includes(role)) existing.roles.push(role);
    } else {
      byPerson.set(member.tmdbPersonId, {
        tmdbPersonId: member.tmdbPersonId,
        name: member.name,
        profilePath: member.profilePath,
        roles: [role],
      });
    }
  }

  const ROLE_ORDER = ["Director", "Writer", "Producer"];
  return [...byPerson.values()].sort((a, b) => {
    const aRank = Math.min(...a.roles.map((r) => ROLE_ORDER.indexOf(r)));
    const bRank = Math.min(...b.roles.map((r) => ROLE_ORDER.indexOf(r)));
    if (aRank !== bRank) return aRank - bRank;
    return a.name.localeCompare(b.name);
  });
}

function extractYear(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const year = parseInt(dateStr.slice(0, 4), 10);
  return isNaN(year) ? null : year;
}

const YEAR_MIN = 1900;
const YEAR_MAX = 2099;

export function parseYearAwareQuery(rawQuery: string): {
  query: string;
  year: number | null;
} {
  const trimmed = rawQuery.trim();
  const match = /^(.*\S)\s+(\d{4})$/u.exec(trimmed);
  if (!match) return { query: trimmed, year: null };

  const year = parseInt(match[2], 10);
  if (year < YEAR_MIN || year > YEAR_MAX) {
    return { query: trimmed, year: null };
  }

  return { query: match[1], year };
}

export function normalizePersonSearchResult(
  raw: TMDBRawPersonSearchItem,
): TMDBPersonSearchResult {
  return {
    tmdbPersonId: raw.id,
    name: raw.name,
    profilePath: raw.profile_path,
    knownForDepartment: raw.known_for_department ?? null,
    popularity: raw.popularity ?? 0,
  };
}
