import { RatingScale } from "../types/enums";
import { ListSortMode } from "../models/list";
import type { Locale } from "../i18n/types";

export type { RatingScale };

export type NoteTemplateOptionalPropertyKey =
  | "genres"
  | "status"
  | "rating_avg"
  | "watch_count"
  | "synopsis"
  | "platform"
  | "release_date"
  | "runtime"
  | "cast"
  | "director"
  | "producer"
  | "studios"
  | "country"
  | "language"
  | "poster"
  | "backdrop"
  | "tmdb_url";

export type NoteTemplateSectionKey =
  | "genreTags"
  | "cast"
  | "watchHistory"
  | "synopsis"
  | "crew"
  | "directors"
  | "producers";

export interface NoteTemplateSettings {
  optionalProperties: Record<NoteTemplateOptionalPropertyKey, boolean>;
  sections: Record<NoteTemplateSectionKey, boolean>;
}

export type NoteSyncStatus =
  | "idle"
  | "syncing"
  | "completed"
  | "interrupted"
  | "failed";

export interface NoteSyncState {
  createdAt: string;
  status: NoteSyncStatus;
  lastSuccessfulSyncAt: string | null;
  lastSyncStartedAt: string | null;
  lastSyncCompletedAt: string | null;
  totalItems: number;
  completedItems: number;
  pendingMediaIds: string[];
  failedMediaIds: string[];
}

export interface MediaVaultSettings {
  dataVersion: number;

  language: Locale;

  tmdbLanguage: string;

  tmdbApiKey: string;

  traktClientId: string;
  traktClientSecret: string;
  traktAccessToken: string | null;
  traktRefreshToken: string | null;
  traktTokenExpiresAt: number | null;

  traktAutoSync: "manual" | "on_startup" | "interval";
  traktSyncIntervalMinutes: number;
  traktLastSyncedAt: string | null;
  traktHistoryNotePath: string;

  mediaFolderPath: string;
  autoCreateNotes: boolean;

  defaultView: "grid" | "list" | "table";

  defaultSort:
    | "recent"
    | "title"
    | "rating"
    | "watchCount"
    | "year"
    | "runtime";
  defaultSortDirection: "asc" | "desc";

  ratingScale: RatingScale;

  cacheDurationMinutes: number;
  episodeSyncIntervalHours: number;

  watchNextSidebarCollapsed: boolean;
  watchNextUpcomingTab: "episodes" | "movies";

  notificationsEnabled: {
    newEpisode: boolean;
    newSeason: boolean;
    movieReleased: boolean;
    seriesReturned: boolean;
    watchlistReminder: boolean;
    continueWatchingReminder: boolean;
  };
  notificationTime: string;
  notificationSilent: boolean;
  notificationTimezone: string;
  notificationLastCheckedDate: string | null;
  notificationPluginActivationDate: string | null;
  notificationDataImportDate: string | null;
  commentsPrimaryLanguage: string;
  commentsAdditionalLanguages: string[];
  showAdultContent: boolean;
  showLibraryCarousels: boolean;
  favoriteListSortModes: { movies: ListSortMode; tv: ListSortMode };
  favoriteListManualOrder: { movies: string[]; tv: string[] };
  genreImageCache: Record<string, string>;

  noteTemplate: NoteTemplateSettings;

  noteSyncState: NoteSyncState;
}

export const DEFAULT_SETTINGS: MediaVaultSettings = {
  dataVersion: 1,
  language: "en",
  tmdbLanguage: "",
  tmdbApiKey: "",
  traktClientId: "",
  traktClientSecret: "",
  traktAccessToken: null,
  traktRefreshToken: null,
  traktTokenExpiresAt: null,
  traktAutoSync: "manual",
  traktSyncIntervalMinutes: 60,
  traktLastSyncedAt: null,
  traktHistoryNotePath: "MediaVault/Trakt Rating History.md",
  mediaFolderPath: "MediaVault",
  autoCreateNotes: false,
  defaultView: "grid",
  defaultSort: "recent",
  defaultSortDirection: "desc",
  ratingScale: RatingScale.TenPoint,
  cacheDurationMinutes: 60 * 24,
  episodeSyncIntervalHours: 24,
  watchNextSidebarCollapsed: false,
  watchNextUpcomingTab: "episodes",
  notificationsEnabled: {
    newEpisode: true,
    newSeason: true,
    movieReleased: true,
    seriesReturned: true,
    watchlistReminder: false,
    continueWatchingReminder: false,
  },
  notificationTime: "09:00",
  notificationSilent: false,
  notificationTimezone: "",
  notificationLastCheckedDate: null,
  notificationPluginActivationDate: null,
  notificationDataImportDate: null,
  commentsPrimaryLanguage: "en",
  commentsAdditionalLanguages: [],
  showAdultContent: false,
  showLibraryCarousels: true,
  favoriteListSortModes: { movies: "recent", tv: "recent" },
  favoriteListManualOrder: { movies: [], tv: [] },
  genreImageCache: {},

  noteTemplate: {
    optionalProperties: {
      genres: true,
      status: true,
      rating_avg: true,
      watch_count: true,
      synopsis: false,
      platform: false,
      release_date: false,
      runtime: false,
      cast: false,
      director: false,
      producer: false,
      studios: false,
      country: false,
      language: false,
      poster: false,
      backdrop: false,
      tmdb_url: false,
    },
    sections: {
      genreTags: true,
      cast: true,
      watchHistory: true,
      synopsis: false,
      crew: false,
      directors: false,
      producers: false,
    },
  },

  noteSyncState: {
    createdAt: new Date(0).toISOString(),
    status: "idle",
    lastSuccessfulSyncAt: null,
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    totalItems: 0,
    completedItems: 0,
    pendingMediaIds: [],
    failedMediaIds: [],
  },
};
