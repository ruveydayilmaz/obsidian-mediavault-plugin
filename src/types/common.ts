export type MediaVaultId = string;
export type ISODateString = string;

export interface CastMember {
  tmdbPersonId: number;
  name: string;
  originalName: string | null;
  character: string;
  profilePath: string | null;
  order: number;
}

export interface CrewMember {
  tmdbPersonId: number;
  name: string;
  originalName: string | null;
  job: string;
  department: string;
  profilePath: string | null;
}

export interface ProductionCompany {
  tmdbCompanyId: number;
  name: string;
  logoPath: string | null;
  originCountry: string | null;
}

export type Score1to10 = number;

export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
