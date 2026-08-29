import type { TMDBService } from "../../api/tmdb";
import { TMDBSearchResult } from "../../types/tmdb";
import { normalizeTitle, stripSubtitle, titleSimilarity } from "./normalize";

export interface TitleLookup {
  kind: "movie" | "tv";
  title: string;
  year: number | null;
  originalTitle?: string | null;
  releaseDate?: string | null;
  runtimeSeconds?: number | null;
  country?: string | null;
  language?: string | null;
  episodeHistory?: EpisodeHistoryEntry[];
}

export interface EpisodeHistoryEntry {
  seasonNumber: number;
  episodeNumber: number;
}

export interface CandidateSeasonInfo {
  seasonNumber: number;
  episodeCount: number;
}

export type EpisodeCatalogFetcher = (
  tmdbId: number,
) => Promise<CandidateSeasonInfo[]>;

export type MatchTier =
  | "exact"
  | "year"
  | "fuzzy"
  | "episode-history"
  | "popularity"
  | "unmatched";

export interface MatchResult {
  candidate: TMDBSearchResult | null;
  tier: MatchTier;
  score: number;
  rejected: TMDBSearchResult[];
  queriesTried: string[];
  tieBrokenByPopularity: boolean;
  tieBrokenByEpisodeHistory: boolean;
}

const STAR_TIERS: Record<MatchTier, string> = {
  exact: "★★★★★",
  year: "★★★★☆",
  fuzzy: "★★★☆☆",
  "episode-history": "★★★★☆",
  popularity: "★★★☆☆",
  unmatched: "☆☆☆☆☆",
};

const TIE_SCORE_EPSILON = 0.03;

const EPISODE_HISTORY_DECISIVE_MARGIN = 0.2;

export function tierStars(tier: MatchTier): string {
  return STAR_TIERS[tier];
}

export function scoreEpisodeHistoryFit(
  seasons: CandidateSeasonInfo[],
  history: EpisodeHistoryEntry[],
): { matched: number; total: number; fit: number } {
  const total = history.length;
  if (total === 0 || seasons.length === 0) return { matched: 0, total, fit: 0 };

  const episodeCountBySeason = new Map<number, number>();
  for (const s of seasons)
    episodeCountBySeason.set(s.seasonNumber, s.episodeCount);

  let matched = 0;
  for (const entry of history) {
    const episodeCount = episodeCountBySeason.get(entry.seasonNumber);
    if (episodeCount !== undefined && entry.episodeNumber <= episodeCount) {
      matched++;
    }
  }

  return { matched, total, fit: matched / total };
}

function scoreCandidate(
  lookup: TitleLookup,
  candidate: TMDBSearchResult,
  comparisonTitles: string[],
): number {
  let titleSim = 0;
  for (const t of comparisonTitles) {
    titleSim = Math.max(
      titleSim,
      titleSimilarity(t, candidate.title),
      candidate.originalTitle ? titleSimilarity(t, candidate.originalTitle) : 0,
    );
  }

  let yearScore = 0.5;
  if (lookup.year !== null) {
    if (candidate.year === null) {
      yearScore = 0.4;
    } else {
      const diff = Math.abs(lookup.year - candidate.year);
      yearScore = diff === 0 ? 1 : diff === 1 ? 0.7 : diff <= 3 ? 0.3 : 0;
    }
  }

  let regionScore = 0.5;
  let regionWeight = 0;
  if (lookup.country) {
    regionWeight = 0.15;
    regionScore = candidate.country
      ? candidate.country.toUpperCase() === lookup.country.toUpperCase()
        ? 1
        : 0.15
      : 0.5;
  } else if (lookup.language) {
    regionWeight = 0.1;
    regionScore = candidate.language
      ? candidate.language.toLowerCase() === lookup.language.toLowerCase()
        ? 1
        : 0.2
      : 0.5;
  }

  const titleWeight = 0.75 - regionWeight * 0.5;
  const yearWeight = 0.25 - regionWeight * 0.5;
  return (
    titleSim * titleWeight + yearScore * yearWeight + regionScore * regionWeight
  );
}

async function gatherCandidates(
  tmdb: TMDBService,
  lookup: TitleLookup,
): Promise<{
  candidates: TMDBSearchResult[];
  queriesTried: string[];
  comparisonTitles: string[];
}> {
  const searchFn =
    lookup.kind === "movie"
      ? tmdb.searchMovies.bind(tmdb)
      : tmdb.searchShows.bind(tmdb);
  const tried = new Set<string>();
  const queriesTried: string[] = [];
  const pool = new Map<number, TMDBSearchResult>();

  async function tryQuery(query: string, year: number | null): Promise<void> {
    const trimmed = query.trim();
    const dedupeKey = `${trimmed.toLowerCase()}::${year ?? ""}`;
    if (!trimmed || tried.has(dedupeKey)) return;
    tried.add(dedupeKey);
    queriesTried.push(year !== null ? `${trimmed} (${year})` : trimmed);

    try {
      const result = await searchFn(trimmed, 1, year, { language: null });
      for (const item of result.items) pool.set(item.tmdbId, item);
    } catch {
      // Ignore
    }
  }

  async function tryQueryPair(query: string): Promise<void> {
    await Promise.all([
      lookup.year !== null ? tryQuery(query, lookup.year) : Promise.resolve(),
      tryQuery(query, null),
    ]);
  }

  const normalized = normalizeTitle(lookup.title);
  const stripped = stripSubtitle(lookup.title);
  const originalTitle = lookup.originalTitle?.trim() ?? "";
  const comparisonTitles = [
    lookup.title,
    normalized,
    ...(stripped ? [stripped] : []),
    ...(originalTitle ? [originalTitle] : []),
  ];

  function alreadyConfident(): boolean {
    if (pool.size !== 1) return false;
    const [only] = pool.values();
    const norm = normalizeTitle(only.title);
    const normOriginal = only.originalTitle
      ? normalizeTitle(only.originalTitle)
      : null;
    const titleOk = comparisonTitles.some(
      (t) => normalizeTitle(t) === norm || normalizeTitle(t) === normOriginal,
    );
    const yearOk =
      lookup.year === null || only.year === null || only.year === lookup.year;
    return titleOk && yearOk;
  }

  await tryQueryPair(lookup.title);
  if (!alreadyConfident() && normalized !== lookup.title.trim().toLowerCase()) {
    await tryQueryPair(normalized);
  }

  if (stripped && !alreadyConfident()) {
    await tryQueryPair(stripped);
  }

  if (originalTitle && !alreadyConfident()) {
    await tryQueryPair(originalTitle);
  }

  return { candidates: [...pool.values()], queriesTried, comparisonTitles };
}

export async function findBestMatch(
  tmdb: TMDBService,
  lookup: TitleLookup,
  episodeCatalogFetcher?: EpisodeCatalogFetcher,
): Promise<MatchResult> {
  const { candidates, queriesTried, comparisonTitles } = await gatherCandidates(
    tmdb,
    lookup,
  );

  if (candidates.length === 0) {
    return {
      candidate: null,
      tier: "unmatched",
      score: 0,
      rejected: [],
      queriesTried,
      tieBrokenByPopularity: false,
      tieBrokenByEpisodeHistory: false,
    };
  }

  const ranked = candidates
    .map((c) => ({
      candidate: c,
      score: scoreCandidate(lookup, c, comparisonTitles),
    }))
    .sort((a, b) => b.score - a.score);

  const [best] = ranked;

  const normComparisons = comparisonTitles.map(normalizeTitle);
  const normCandidateTitles = [
    normalizeTitle(best.candidate.title),
    ...(best.candidate.originalTitle
      ? [normalizeTitle(best.candidate.originalTitle)]
      : []),
  ];
  const exactTitle = normCandidateTitles.some((ct) =>
    normComparisons.includes(ct),
  );
  const yearMatches =
    lookup.year === null ||
    best.candidate.year === null ||
    best.candidate.year === lookup.year;

  let tier: MatchTier;
  if (exactTitle && yearMatches) {
    tier = "exact";
  } else if (exactTitle || best.score >= 0.75) {
    tier = "year";
  } else if (best.score >= 0.55) {
    tier = "fuzzy";
  } else {
    return {
      candidate: null,
      tier: "unmatched",
      score: best.score,
      rejected: ranked.map((r) => r.candidate),
      queriesTried,
      tieBrokenByPopularity: false,
      tieBrokenByEpisodeHistory: false,
    };
  }

  const tieGroup = ranked.filter(
    (r) => best.score - r.score <= TIE_SCORE_EPSILON,
  );

  let winner = best;
  let finalTier: MatchTier = tier;
  let tieBrokenByPopularity = false;
  let tieBrokenByEpisodeHistory = false;

  if (tieGroup.length > 1) {
    let resolvedByHistory = false;

    if (
      lookup.kind === "tv" &&
      lookup.episodeHistory &&
      lookup.episodeHistory.length > 0 &&
      episodeCatalogFetcher
    ) {
      const fits = await Promise.all(
        tieGroup.map(async (entry) => {
          let seasons: CandidateSeasonInfo[] = [];
          try {
            seasons = await episodeCatalogFetcher(entry.candidate.tmdbId);
          } catch {
            // Ignore
          }
          return {
            entry,
            fit: scoreEpisodeHistoryFit(seasons, lookup.episodeHistory!),
          };
        }),
      );

      fits.sort(
        (a, b) => b.fit.fit - a.fit.fit || b.fit.matched - a.fit.matched,
      );
      const [topFit, secondFit] = fits;

      const decisive =
        topFit.fit.total > 0 &&
        topFit.fit.fit > 0 &&
        (!secondFit ||
          topFit.fit.fit - secondFit.fit.fit >=
            EPISODE_HISTORY_DECISIVE_MARGIN);

      if (decisive) {
        winner = topFit.entry;
        finalTier = "episode-history";
        tieBrokenByEpisodeHistory = true;
        resolvedByHistory = true;
      }
    }

    if (!resolvedByHistory) {
      const byPopularity = [...tieGroup].sort(
        (a, b) => (b.candidate.popularity ?? 0) - (a.candidate.popularity ?? 0),
      );
      winner = byPopularity[0];
      finalTier = "popularity";
      tieBrokenByPopularity = true;
    }
  }

  const rejected = ranked
    .filter((r) => r.candidate.tmdbId !== winner.candidate.tmdbId)
    .map((r) => r.candidate);

  return {
    candidate: winner.candidate,
    tier: finalTier,
    score: winner.score,
    rejected,
    queriesTried,
    tieBrokenByPopularity,
    tieBrokenByEpisodeHistory,
  };
}
