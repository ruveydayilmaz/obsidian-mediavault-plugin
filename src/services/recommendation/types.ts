export interface AffinityProfile {
  genre: Map<string, number>;
  actor: Map<string, number>;
  director: Map<string, number>;
}

export type RecommendationCategory =
  | "similar_to_favorites"
  | "hidden_gems"
  | "comfort_rewatch"
  | "high_energy"
  | "low_attention";

export interface Recommendation {
  category: RecommendationCategory;
  tmdbId?: number;
  mediaKind?: "movie" | "tv";
  mediaId?: string;
  title: string;
  year: number | null;
  posterPath: string | null;
  score: number;
  reasons: string[];
}

export interface AffinityScoreBreakdown {
  genreAffinity: number;
  actorAffinity: number;
  directorAffinity: number;
  comfortMatch?: number;
}

export interface ScoreWeights {
  genre: number;
  actor: number;
  director: number;
  comfort: number;
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  genre: 0.35,
  actor: 0.2,
  director: 0.15,
  comfort: 0.3,
};
