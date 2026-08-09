import { MediaVaultId, ISODateString } from "../types/common";

export interface Episode {
  id: MediaVaultId;
  mediaId: MediaVaultId;

  tmdbEpisodeId: number | null;
  seasonNumber: number;
  episodeNumber: number;

  title: string;
  runtime: number | null;
  airDate: ISODateString | null;
  synopsis: string | null;
  thumbnailPath: string | null;

  tmdbRating: number | null;
}

export interface EpisodeProgress {
  id: MediaVaultId;
  mediaId: MediaVaultId;
  episodeId: MediaVaultId;

  seasonNumber: number;
  episodeNumber: number;

  watched: boolean;
  watchedDate: ISODateString | null;

  rating: number | null;
  review: string | null;

  emotion: string | null;

  isFavorite: boolean;

  liked: boolean;
  likedAt: string | null;

  comfortNote: string | null;

  updatedAt: ISODateString;
}

export interface SeasonProgress {
  seasonNumber: number;
  totalEpisodes: number;
  watchedEpisodes: number;
  percentWatched: number; // 0-100
  totalRuntimeWatched: number; // minutes
}

export interface ShowProgress {
  mediaId: MediaVaultId;
  seasons: SeasonProgress[];
  totalEpisodes: number;
  watchedEpisodes: number;
  remainingEpisodes: number;
  percentWatched: number;
  totalRuntimeWatched: number;
}

export interface EpisodeWatch {
  id: MediaVaultId;
  mediaId: MediaVaultId;
  episodeId: MediaVaultId;

  watchedAt: ISODateString;

  rating: number | null;
  emotion: string | null;
  review: string | null;
  notes: string | null;

  createdAt: ISODateString;
  updatedAt: ISODateString;
}
