import {
  ComfortProfile,
  ComfortFlags,
  ComfortPreset,
} from "../../models/comfort";
import { MediaItem } from "../../models/media";
import { Season, TriggerWarning } from "../../types/enums";

export interface ComfortCriteria {
  energyMin?: number;
  energyMax?: number;
  attentionMin?: number;
  attentionMax?: number;
  emotionalHeavinessMax?: number;
  comfortScoreMin?: number;
  rewatchabilityMin?: number;
  plotComplexityMax?: number;
  requiredFlags?: (keyof ComfortFlags)[];
  excludedTriggers?: TriggerWarning[];
  seasonalTags?: Season[];
}

export interface ComfortableMedia {
  media: MediaItem;
  profile: ComfortProfile;
}

export function filterByComfortCriteria(
  items: ComfortableMedia[],
  criteria: ComfortCriteria,
): ComfortableMedia[] {
  return items.filter(({ profile }) => {
    if (
      criteria.energyMin !== undefined &&
      profile.energyLevel < criteria.energyMin
    )
      return false;
    if (
      criteria.energyMax !== undefined &&
      profile.energyLevel > criteria.energyMax
    )
      return false;
    if (
      criteria.attentionMin !== undefined &&
      profile.attentionLevel < criteria.attentionMin
    )
      return false;
    if (
      criteria.attentionMax !== undefined &&
      profile.attentionLevel > criteria.attentionMax
    )
      return false;
    if (
      criteria.emotionalHeavinessMax !== undefined &&
      profile.emotionalHeaviness > criteria.emotionalHeavinessMax
    )
      return false;
    if (
      criteria.comfortScoreMin !== undefined &&
      profile.comfortScore < criteria.comfortScoreMin
    )
      return false;
    if (
      criteria.rewatchabilityMin !== undefined &&
      profile.rewatchability < criteria.rewatchabilityMin
    )
      return false;
    if (
      criteria.plotComplexityMax !== undefined &&
      profile.plotComplexity > criteria.plotComplexityMax
    )
      return false;

    if (criteria.requiredFlags && criteria.requiredFlags.length > 0) {
      if (!criteria.requiredFlags.every((flag) => profile.flags[flag]))
        return false;
    }

    if (criteria.excludedTriggers && criteria.excludedTriggers.length > 0) {
      if (
        criteria.excludedTriggers.some((t) =>
          profile.triggerWarnings.includes(t),
        )
      )
        return false;
    }

    if (criteria.seasonalTags && criteria.seasonalTags.length > 0) {
      if (!criteria.seasonalTags.some((s) => profile.seasonalTags.includes(s)))
        return false;
    }

    return true;
  });
}

export function presetToCriteria(preset: ComfortPreset): ComfortCriteria {
  return {
    energyMin: preset.energyMin,
    energyMax: preset.energyMax,
    attentionMin: preset.attentionMin,
    attentionMax: preset.attentionMax,
    emotionalHeavinessMax: preset.emotionalHeavinessMax,
    comfortScoreMin: preset.comfortScoreMin,
    rewatchabilityMin: preset.rewatchabilityMin,
    requiredFlags: preset.requiredFlags,
    excludedTriggers: preset.excludedTriggers,
    seasonalTags: preset.seasonalTags,
  };
}
