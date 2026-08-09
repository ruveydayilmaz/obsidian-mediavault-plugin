import { RatingScale } from "../types/enums";
import { ListSortMode } from "../models/list";

export type { RatingScale };

export interface MediaVaultSettings {
  dataVersion: number;

  language: "en" | "tr";

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
  favoriteListSortModes: { movies: ListSortMode; tv: ListSortMode };
  favoriteListManualOrder: { movies: string[]; tv: string[] };
  genreImageCache: Record<string, string>;
}

export const DEFAULT_SETTINGS: MediaVaultSettings = {
  dataVersion: 1,
  language: "en",
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
  favoriteListSortModes: { movies: "recent", tv: "recent" },
  favoriteListManualOrder: { movies: [], tv: [] },
  genreImageCache: {},
};
