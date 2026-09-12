import { StorageAdapter } from "./storage-adapter";
import { MediaVaultSettings, DEFAULT_SETTINGS } from "../../settings/settings";

function mergeSettings(
  base: Partial<MediaVaultSettings> | undefined,
): MediaVaultSettings {
  const merged: MediaVaultSettings = {
    ...DEFAULT_SETTINGS,
    ...base,
  };
  merged.noteTemplate = {
    optionalProperties: {
      ...DEFAULT_SETTINGS.noteTemplate.optionalProperties,
      ...base?.noteTemplate?.optionalProperties,
    },
    sections: {
      ...DEFAULT_SETTINGS.noteTemplate.sections,
      ...base?.noteTemplate?.sections,
    },
  };
  merged.noteSyncState = {
    ...DEFAULT_SETTINGS.noteSyncState,
    ...base?.noteSyncState,
  };
  return merged;
}

export class SettingsRepository {
  private adapter: StorageAdapter;

  constructor(adapter: StorageAdapter) {
    this.adapter = adapter;
  }

  get(): MediaVaultSettings {
    const data = this.adapter.getData();
    const merged = mergeSettings(data.settings);
    data.settings = merged;
    return merged;
  }

  async update(
    patch: Partial<MediaVaultSettings>,
  ): Promise<MediaVaultSettings> {
    const data = this.adapter.getData();
    data.settings = mergeSettings({ ...data.settings, ...patch });
    await this.adapter.requestSave();
    return data.settings;
  }
}
