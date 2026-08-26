import { StorageAdapter } from "./storage-adapter";
import { MediaVaultSettings, DEFAULT_SETTINGS } from "../../settings/settings";

export class SettingsRepository {
  private adapter: StorageAdapter;

  constructor(adapter: StorageAdapter) {
    this.adapter = adapter;
  }

  get(): MediaVaultSettings {
    const data = this.adapter.getData();
    const merged: MediaVaultSettings = {
      ...DEFAULT_SETTINGS,
      ...data.settings,
    };
    data.settings = merged;
    return merged;
  }

  async update(
    patch: Partial<MediaVaultSettings>,
  ): Promise<MediaVaultSettings> {
    const data = this.adapter.getData();
    data.settings = { ...DEFAULT_SETTINGS, ...data.settings, ...patch };
    await this.adapter.requestSave();
    return data.settings;
  }
}
