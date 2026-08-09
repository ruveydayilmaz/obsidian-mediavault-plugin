import {
  MediaVaultId,
  ISODateString,
  CastMember,
  CrewMember,
  ProductionCompany,
} from "../types/common";
import { MediaType, MediaStatus } from "../types/enums";

export interface MediaItem {
  id: MediaVaultId;

  tmdbId: number;

  tvdbId?: number | null;
  imdbId?: string | null;
  tvTimeUuid?: string | null;

  type: MediaType;

  title: string;
  originalTitle: string | null;

  year: number | null;

  releaseDate: string | null;

  genres: string[];
  genreIds: number[];

  runtime: number | null;

  posterPath: string | null;
  backdropPath: string | null;

  cast: CastMember[];
  crew: CrewMember[];
  productionCompanies: ProductionCompany[];

  language: string | null;
  country: string | null;

  streamingAvailability?: string[];

  synopsis: string | null;

  status: MediaStatus;

  droppedReason: string | null;

  isFavorite: boolean;

  liked: boolean;
  likedAt: string | null;

  tvStatus: string | null;

  notes: string;

  tags: string[];

  averageRating: number | null;

  watchCount: number;

  lastWatchedDate: ISODateString | null;

  lastActivityAt: ISODateString | null;

  notePath: string | null;

  episodesLastSyncedAt: ISODateString | null;

  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type NewMediaItemInput = Pick<MediaItem, "tmdbId" | "type" | "title"> &
  Partial<
    Omit<
      MediaItem,
      "id" | "tmdbId" | "type" | "title" | "createdAt" | "updatedAt"
    >
  >;
