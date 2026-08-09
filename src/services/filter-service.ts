import { MediaItem } from "../models/media";
import type { StorageService } from "./storage";

export type RuntimeMode = "movie" | "episode" | "total";

export interface FilterCriteria {
  genres: string[];
  actors: string[];
  directors: string[];
  studios: string[];
  yearMin?: number;
  yearMax?: number;
  runtimeMode: RuntimeMode;
  runtimeMin?: number;
  runtimeMax?: number;
  ratingMin?: number;
  favoritesOnly: boolean;
  comfortScoreMin?: number;
  watchCountMin?: number;
  tags: string[];
}

export const DEFAULT_FILTER_CRITERIA: FilterCriteria = {
  genres: [],
  actors: [],
  directors: [],
  studios: [],
  runtimeMode: "movie",
  favoritesOnly: false,
  tags: [],
};

export function createDefaultFilterCriteria(): FilterCriteria {
  return {
    ...DEFAULT_FILTER_CRITERIA,
    genres: [],
    actors: [],
    directors: [],
    studios: [],
    tags: [],
  };
}

export function hasActiveFilters(criteria: FilterCriteria): boolean {
  return (
    criteria.genres.length > 0 ||
    criteria.actors.length > 0 ||
    criteria.directors.length > 0 ||
    criteria.studios.length > 0 ||
    criteria.yearMin !== undefined ||
    criteria.yearMax !== undefined ||
    criteria.runtimeMin !== undefined ||
    criteria.runtimeMax !== undefined ||
    criteria.ratingMin !== undefined ||
    criteria.favoritesOnly ||
    criteria.comfortScoreMin !== undefined ||
    criteria.watchCountMin !== undefined ||
    criteria.tags.length > 0
  );
}

export interface FilterContext {
  totalRuntimeByMediaId: Map<string, number>;
  comfortScoreByMediaId: Map<string, number>;
}

export const EMPTY_FILTER_CONTEXT: FilterContext = {
  totalRuntimeByMediaId: new Map(),
  comfortScoreByMediaId: new Map(),
};

export async function buildFilterContext(
  storage: StorageService,
): Promise<FilterContext> {
  const [episodes, comfortProfiles] = await Promise.all([
    storage.episodes.getAll(),
    storage.comfortProfiles.getAll(),
  ]);

  const totalRuntimeByMediaId = new Map<string, number>();
  for (const ep of episodes) {
    if (!ep.runtime) continue;
    totalRuntimeByMediaId.set(
      ep.mediaId,
      (totalRuntimeByMediaId.get(ep.mediaId) ?? 0) + ep.runtime,
    );
  }

  const comfortScoreByMediaId = new Map<string, number>();
  for (const profile of comfortProfiles) {
    comfortScoreByMediaId.set(profile.mediaId, profile.comfortScore);
  }

  return { totalRuntimeByMediaId, comfortScoreByMediaId };
}

function getRuntimeValue(
  item: MediaItem,
  mode: RuntimeMode,
  ctx: FilterContext,
): number | null {
  if (mode === "total") return ctx.totalRuntimeByMediaId.get(item.id) ?? null;
  return item.runtime;
}

export function applyUniversalFilter(
  items: MediaItem[],
  criteria: FilterCriteria,
  ctx: FilterContext = EMPTY_FILTER_CONTEXT,
): MediaItem[] {
  let result = items;

  if (criteria.genres.length > 0) {
    result = result.filter((m) =>
      criteria.genres.some((g) => m.genres.includes(g)),
    );
  }
  if (criteria.actors.length > 0) {
    result = result.filter((m) =>
      criteria.actors.some((a) => m.cast.some((c) => c.name === a)),
    );
  }
  if (criteria.directors.length > 0) {
    result = result.filter((m) =>
      criteria.directors.some((d) =>
        m.crew.some((c) => c.job === "Director" && c.name === d),
      ),
    );
  }
  if (criteria.studios.length > 0) {
    result = result.filter((m) =>
      criteria.studios.some((s) =>
        m.productionCompanies.some((p) => p.name === s),
      ),
    );
  }
  if (criteria.yearMin !== undefined) {
    const min = criteria.yearMin;
    result = result.filter((m) => m.year !== null && m.year >= min);
  }
  if (criteria.yearMax !== undefined) {
    const max = criteria.yearMax;
    result = result.filter((m) => m.year !== null && m.year <= max);
  }
  if (criteria.runtimeMin !== undefined || criteria.runtimeMax !== undefined) {
    result = result.filter((m) => {
      const runtime = getRuntimeValue(m, criteria.runtimeMode, ctx);
      if (runtime === null) return false;
      if (criteria.runtimeMin !== undefined && runtime < criteria.runtimeMin)
        return false;
      if (criteria.runtimeMax !== undefined && runtime > criteria.runtimeMax)
        return false;
      return true;
    });
  }
  if (criteria.ratingMin !== undefined) {
    const min = criteria.ratingMin;
    result = result.filter(
      (m) => m.averageRating !== null && m.averageRating >= min,
    );
  }
  if (criteria.favoritesOnly) {
    result = result.filter((m) => m.isFavorite === true);
  }
  if (criteria.comfortScoreMin !== undefined) {
    const min = criteria.comfortScoreMin;
    result = result.filter(
      (m) => (ctx.comfortScoreByMediaId.get(m.id) ?? -1) >= min,
    );
  }
  if (criteria.watchCountMin !== undefined) {
    const min = criteria.watchCountMin;
    result = result.filter((m) => m.watchCount >= min);
  }
  if (criteria.tags.length > 0) {
    result = result.filter((m) =>
      criteria.tags.some((t) => m.tags.includes(t)),
    );
  }

  return result;
}

export interface FilterOptionLists {
  genres: string[];
  actors: string[];
  directors: string[];
  studios: string[];
  tags: string[];
}

export function collectFilterOptions(items: MediaItem[]): FilterOptionLists {
  const genres = new Set<string>();
  const actors = new Set<string>();
  const directors = new Set<string>();
  const studios = new Set<string>();
  const tags = new Set<string>();

  for (const m of items) {
    m.genres.forEach((g) => genres.add(g));
    m.cast.forEach((c) => actors.add(c.name));
    m.crew.forEach((c) => {
      if (c.job === "Director") directors.add(c.name);
    });
    m.productionCompanies.forEach((p) => studios.add(p.name));
    m.tags.forEach((t) => tags.add(t));
  }

  const sort = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
  return {
    genres: sort(genres),
    actors: sort(actors),
    directors: sort(directors),
    studios: sort(studios),
    tags: sort(tags),
  };
}
