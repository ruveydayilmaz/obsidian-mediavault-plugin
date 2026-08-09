import { MediaVaultId, ISODateString } from "../types/common";

export interface MovieProgress {
  id: MediaVaultId;
  mediaId: MediaVaultId;
  currentMinute: number;
  totalRuntime: number;
  lastUpdated: ISODateString;
}
