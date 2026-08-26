import { MediaItem } from "../../models/media";
import { WatchSession } from "../../models/review";
import { Episode, EpisodeProgress, EpisodeWatch } from "../../models/episode";
import { MovieProgress } from "../../models/movie-progress";
import { ComfortProfile, ComfortPreset } from "../../models/comfort";
import { CustomList } from "../../models/list";
import { MediaVaultNotification } from "../../models/notification";
import { MediaVaultSettings, DEFAULT_SETTINGS } from "../../settings/settings";
import { DEFAULT_DATA_VERSION } from "../../constants";

export interface VaultData {
  version: number;

  settings: MediaVaultSettings;

  media: MediaItem[];
  watchSessions: WatchSession[];
  episodes: Episode[];
  episodeProgress: EpisodeProgress[];
  episodeWatches: EpisodeWatch[];
  movieProgress: MovieProgress[];
  comfortProfiles: ComfortProfile[];
  comfortPresets: ComfortPreset[];
  customLists: CustomList[];
  notifications: MediaVaultNotification[];
}

export const CURRENT_SCHEMA_VERSION = DEFAULT_DATA_VERSION;

export function createEmptyVaultData(): VaultData {
  return {
    version: CURRENT_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    media: [],
    watchSessions: [],
    episodes: [],
    episodeProgress: [],
    episodeWatches: [],
    movieProgress: [],
    comfortProfiles: [],
    comfortPresets: [],
    customLists: [],
    notifications: [],
  };
}
