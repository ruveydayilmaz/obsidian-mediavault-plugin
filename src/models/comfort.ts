import { MediaVaultId, ISODateString, Score1to10 } from "../types/common";
import { Season, TriggerWarning } from "../types/enums";

export interface ComfortProfile {
  id: MediaVaultId;
  mediaId: MediaVaultId;

  comfortScore: Score1to10;
  energyLevel: Score1to10;
  attentionLevel: Score1to10;
  emotionalHeaviness: Score1to10;
  plotComplexity: Score1to10;
  rewatchability: Score1to10;

  flags: ComfortFlags;

  seasonalTags: Season[];
  triggerWarnings: TriggerWarning[];

  updatedAt: ISODateString;
}

export interface ComfortFlags {
  safeWhenAnxious: boolean;
  safeWhenDepressed: boolean;
  goodForBackgroundNoise: boolean;
  goodWhileCleaning: boolean;
  goodBeforeSleep: boolean;
  cozy: boolean;
  funny: boolean;
  noMajorCharacterDeath: boolean;
  lowConflict: boolean;
  familiarFavorite: boolean;
}

export const DEFAULT_COMFORT_FLAGS: ComfortFlags = {
  safeWhenAnxious: false,
  safeWhenDepressed: false,
  goodForBackgroundNoise: false,
  goodWhileCleaning: false,
  goodBeforeSleep: false,
  cozy: false,
  funny: false,
  noMajorCharacterDeath: false,
  lowConflict: false,
  familiarFavorite: false,
};

export interface ComfortPreset {
  id: MediaVaultId;
  name: string;
  description: string | null;

  energyMin?: Score1to10;
  energyMax?: Score1to10;
  attentionMin?: Score1to10;
  attentionMax?: Score1to10;
  emotionalHeavinessMax?: Score1to10;
  comfortScoreMin?: Score1to10;
  rewatchabilityMin?: Score1to10;

  requiredFlags: (keyof ComfortFlags)[];
  excludedTriggers: TriggerWarning[];
  seasonalTags: Season[];

  isBuiltIn: boolean;
}

export interface ComfortMatch {
  mediaId: MediaVaultId;
  score: number;
  matchedFlags: (keyof ComfortFlags)[];
}
