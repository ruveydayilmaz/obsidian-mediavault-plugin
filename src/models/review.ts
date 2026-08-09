import { MediaVaultId, ISODateString } from "../types/common";
import { Mood, WatchSource } from "../types/enums";

export interface WatchSession {
  id: MediaVaultId;
  mediaId: MediaVaultId;

  watchDate: ISODateString;
  completedDate: ISODateString | null;

  rating: number | null;

  review: string;

  mood: Mood | null;

  context: string | null;

  rewatchNumber: number;

  watchSource: WatchSource | null;

  tags: string[];

  episodeId: MediaVaultId | null;

  externalSource: "trakt" | null;
  externalRef: string | null;

  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type NewWatchSessionInput = Pick<WatchSession, "mediaId" | "watchDate"> &
  Partial<
    Omit<
      WatchSession,
      | "id"
      | "mediaId"
      | "watchDate"
      | "rewatchNumber"
      | "createdAt"
      | "updatedAt"
    >
  > & {
    activityAt?: string;
  };

export interface RatingEvolutionPoint {
  watchSessionId: MediaVaultId;
  rewatchNumber: number;
  watchDate: ISODateString;
  rating: number | null;
}
