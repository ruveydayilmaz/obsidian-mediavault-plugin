import { ComfortMatch, ComfortFlags } from "../../models/comfort";
import { ComfortableMedia, ComfortCriteria } from "./filter";

export interface ComfortRankWeights {
  comfortScore: number;
  rewatchability: number;
  lowEmotionalHeaviness: number;
  requestedFlagMatch: number;
}

export const DEFAULT_RANK_WEIGHTS: ComfortRankWeights = {
  comfortScore: 0.4,
  rewatchability: 0.25,
  lowEmotionalHeaviness: 0.15,
  requestedFlagMatch: 0.2,
};

function normalize1to10(value: number): number {
  return Math.max(0, Math.min(1, (value - 1) / 9));
}

export function rankComfortMatches(
  items: ComfortableMedia[],
  criteria: ComfortCriteria,
  weights: ComfortRankWeights = DEFAULT_RANK_WEIGHTS,
): ComfortMatch[] {
  const requestedFlags = criteria.requiredFlags ?? [];

  return items
    .map(({ media, profile }) => {
      const matchedFlags = (
        Object.keys(profile.flags) as (keyof ComfortFlags)[]
      ).filter((flag) => profile.flags[flag]);

      const flagMatchRatio =
        requestedFlags.length === 0
          ? 1
          : requestedFlags.filter((f) => profile.flags[f]).length /
            requestedFlags.length;

      const score =
        normalize1to10(profile.comfortScore) * weights.comfortScore +
        normalize1to10(profile.rewatchability) * weights.rewatchability +
        (1 - normalize1to10(profile.emotionalHeaviness)) *
          weights.lowEmotionalHeaviness +
        flagMatchRatio * weights.requestedFlagMatch;

      return {
        mediaId: media.id,
        score: Math.round(score * 1000) / 1000,
        matchedFlags,
      };
    })
    .sort((a, b) => b.score - a.score);
}
