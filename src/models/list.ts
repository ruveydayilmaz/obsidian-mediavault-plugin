import { MediaVaultId, ISODateString } from "../types/common";

export type ListSortMode =
  | "manual"
  | "recent"
  | "title"
  | "dateAdded"
  | "rating"
  | "year"
  | "runtime";

export interface CustomList {
  id: MediaVaultId;

  title: string;
  description: string | null;

  mediaIds: MediaVaultId[];

  sortMode: ListSortMode;

  owner: string | null;

  isImported: boolean;
  importSource: string | null;

  createdAt: ISODateString;
  updatedAt: ISODateString;

  isSystem?: boolean;

  isPublic?: boolean;
  posterUrl?: string | null;
  bannerUrl?: string | null;
}

export type NewCustomListInput = Pick<CustomList, "title"> &
  Partial<Omit<CustomList, "id" | "title" | "createdAt" | "updatedAt">>;
