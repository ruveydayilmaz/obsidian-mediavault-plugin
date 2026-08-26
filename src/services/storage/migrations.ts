import {
  VaultData,
  createEmptyVaultData,
  CURRENT_SCHEMA_VERSION,
} from "./schema";

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

const migrations: Record<number, Migration> = {
  1: (data) => ({
    ...data,
    watchSessions: Array.isArray(data.watchSessions)
      ? (data.watchSessions as Record<string, unknown>[]).map((s) => ({
          externalSource: null,
          externalRef: null,
          ...s,
        }))
      : [],
  }),

  2: (data) => ({
    ...data,
    episodeProgress: Array.isArray(data.episodeProgress)
      ? (data.episodeProgress as Record<string, unknown>[]).map((p) => ({
          emotion: null,
          ...p,
        }))
      : [],
  }),

  3: (data) => ({
    ...data,
    media: Array.isArray(data.media)
      ? (data.media as Record<string, unknown>[]).map((m) => ({
          droppedReason: null,
          ...m,
        }))
      : [],
  }),

  4: (data) => {
    const progressMediaIds = new Set(
      Array.isArray(data.movieProgress)
        ? (data.movieProgress as Record<string, unknown>[]).map(
            (p) => p.mediaId,
          )
        : [],
    );
    return {
      ...data,
      media: Array.isArray(data.media)
        ? (data.media as Record<string, unknown>[]).map((m) =>
            m.type === "movie" &&
            m.status === "watching" &&
            progressMediaIds.has(m.id)
              ? { ...m, status: "dropped" }
              : m,
          )
        : [],
    };
  },
};

function withDefaultsApplied(data: Record<string, unknown>): VaultData {
  const empty = createEmptyVaultData();
  return {
    version: typeof data.version === "number" ? data.version : empty.version,
    settings: { ...empty.settings, ...(data.settings as object) },
    media: Array.isArray(data.media)
      ? (data.media as VaultData["media"])
      : empty.media,
    watchSessions: Array.isArray(data.watchSessions)
      ? (data.watchSessions as VaultData["watchSessions"])
      : empty.watchSessions,
    episodes: Array.isArray(data.episodes)
      ? (data.episodes as VaultData["episodes"])
      : empty.episodes,
    episodeProgress: Array.isArray(data.episodeProgress)
      ? (data.episodeProgress as VaultData["episodeProgress"])
      : empty.episodeProgress,
    episodeWatches: Array.isArray(data.episodeWatches)
      ? (data.episodeWatches as VaultData["episodeWatches"])
      : empty.episodeWatches,
    movieProgress: Array.isArray(data.movieProgress)
      ? (data.movieProgress as VaultData["movieProgress"])
      : empty.movieProgress,
    comfortProfiles: Array.isArray(data.comfortProfiles)
      ? (data.comfortProfiles as VaultData["comfortProfiles"])
      : empty.comfortProfiles,
    comfortPresets: Array.isArray(data.comfortPresets)
      ? (data.comfortPresets as VaultData["comfortPresets"])
      : empty.comfortPresets,
    customLists: Array.isArray(data.customLists)
      ? (data.customLists as VaultData["customLists"])
      : empty.customLists,
    notifications: Array.isArray(data.notifications)
      ? (data.notifications as VaultData["notifications"])
      : empty.notifications,
  };
}

export function runMigrations(
  raw: Record<string, unknown> | null | undefined,
): VaultData {
  let data: Record<string, unknown> = raw ?? {};
  let version = typeof data.version === "number" ? data.version : 0;

  while (version < CURRENT_SCHEMA_VERSION) {
    const migrate = migrations[version];
    if (!migrate) {
      break;
    }
    data = migrate(data);
    version += 1;
    data.version = version;
  }

  return withDefaultsApplied(data);
}
