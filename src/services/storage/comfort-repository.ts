import { BaseRepository, generateId } from "./base-repository";
import { StorageAdapter } from "./storage-adapter";
import {
  ComfortProfile,
  ComfortPreset,
  DEFAULT_COMFORT_FLAGS,
} from "../../models/comfort";
import { MediaVaultId } from "../../types/common";
import { t } from "../../i18n";

export class ComfortRepository extends BaseRepository<ComfortProfile> {
  private mediaIndexCache = {
    version: -1,
    map: new Map<MediaVaultId, ComfortProfile[]>(),
  };

  constructor(adapter: StorageAdapter) {
    super(adapter, "comfortProfiles");
  }

  async create(
    mediaId: MediaVaultId,
    input: Partial<Omit<ComfortProfile, "id" | "mediaId">> = {},
  ): Promise<ComfortProfile> {
    const profile: ComfortProfile = {
      id: generateId(),
      mediaId,
      comfortScore: 5,
      energyLevel: 5,
      attentionLevel: 5,
      emotionalHeaviness: 5,
      plotComplexity: 5,
      rewatchability: 5,
      flags: { ...DEFAULT_COMFORT_FLAGS },
      seasonalTags: [],
      triggerWarnings: [],
      ...input,
      updatedAt: new Date().toISOString(),
    };
    return this.save(profile);
  }

  async update(
    id: MediaVaultId,
    patch: Partial<ComfortProfile>,
  ): Promise<ComfortProfile | null> {
    return super.update(id, { ...patch, updatedAt: new Date().toISOString() });
  }

  async findByMediaId(mediaId: MediaVaultId): Promise<ComfortProfile | null> {
    const index = this.buildIndex((p) => p.mediaId, this.mediaIndexCache);
    return index.get(mediaId)?.[0] ?? null;
  }

  async getOrCreate(mediaId: MediaVaultId): Promise<ComfortProfile> {
    const existing = await this.findByMediaId(mediaId);
    if (existing) return existing;
    return this.create(mediaId);
  }

  async deleteByMediaId(mediaId: MediaVaultId): Promise<boolean> {
    const existing = await this.findByMediaId(mediaId);
    if (!existing) return false;
    return this.delete(existing.id);
  }
}

export class ComfortPresetRepository extends BaseRepository<ComfortPreset> {
  constructor(adapter: StorageAdapter) {
    super(adapter, "comfortPresets");
  }

  async create(
    input: Omit<ComfortPreset, "id" | "isBuiltIn">,
  ): Promise<ComfortPreset> {
    return this.save({ id: generateId(), isBuiltIn: false, ...input });
  }
}

export const BUILT_IN_COMFORT_PRESETS: Omit<ComfortPreset, "id">[] = [
  {
    name: t("comfort.bedTime"),
    description: t("comfort.bedTimeDescription"),
    energyMax: 4,
    attentionMax: 4,
    emotionalHeavinessMax: 3,
    comfortScoreMin: 6,
    requiredFlags: ["goodBeforeSleep"],
    excludedTriggers: [],
    seasonalTags: [],
    isBuiltIn: true,
  },
  {
    name: t("comfort.backgroundNoise"),
    description: t("comfort.backgroundNoiseDescription"),
    attentionMax: 4,
    requiredFlags: ["goodForBackgroundNoise"],
    excludedTriggers: [],
    seasonalTags: [],
    isBuiltIn: true,
  },
  {
    name: t("comfort.emotionalRecovery"),
    description: t("comfort.emotionalRecoveryDescription"),
    emotionalHeavinessMax: 3,
    comfortScoreMin: 7,
    requiredFlags: ["safeWhenAnxious", "lowConflict"],
    excludedTriggers: [],
    seasonalTags: [],
    isBuiltIn: true,
  },
  {
    name: t("comfort.cozyWinter"),
    description: t("comfort.cozyWinterDescription"),
    rewatchabilityMin: 7,
    requiredFlags: ["cozy"],
    excludedTriggers: [],
    seasonalTags: [],
    isBuiltIn: true,
  },
];
