import { MediaVaultId, ISODateString } from "../types/common";

export type NotificationType =
  | "new_episode"
  | "new_season"
  | "movie_released"
  | "series_returned"
  | "watchlist_reminder"
  | "continue_watching_reminder";

export interface MediaVaultNotification {
  id: MediaVaultId;
  type: NotificationType;
  mediaId: MediaVaultId;
  title: string;
  message: string;
  createdAt: ISODateString;
  read: boolean;
}
