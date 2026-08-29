export type TMDBMediaKind = "movie" | "tv";

export interface TMDBRawSearchResultItem {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string;
  genre_ids?: number[];
  media_type?: string;
  origin_country?: string[];
  original_language?: string;
  adult?: boolean;
  popularity?: number;
}

export interface TMDBRawPersonSearchItem {
  id: number;
  name: string;
  profile_path: string | null;
  known_for_department?: string | null;
  popularity?: number;
}

export interface TMDBRawPersonSearchResponse {
  page: number;
  total_pages: number;
  total_results: number;
  results: TMDBRawPersonSearchItem[];
}

export interface TMDBPersonSearchResult {
  tmdbPersonId: number;
  name: string;
  profilePath: string | null;
  knownForDepartment: string | null;
  popularity: number;
}

export interface TMDBRawSearchResponse {
  page: number;
  total_pages: number;
  total_results: number;
  results: TMDBRawSearchResultItem[];
}

export interface TMDBRawGenre {
  id: number;
  name: string;
}

export interface TMDBRawProductionCompany {
  id: number;
  name: string;
  logo_path: string | null;
  origin_country: string;
}

export interface TMDBRawCastMember {
  id: number;
  name: string;
  original_name?: string;
  character: string;
  profile_path: string | null;
  order: number;
}

export interface TMDBRawCrewMember {
  id: number;
  name: string;
  original_name?: string;
  job: string;
  department: string;
  profile_path: string | null;
}

export interface TMDBRawCredits {
  cast: TMDBRawCastMember[];
  crew: TMDBRawCrewMember[];
}

export interface TMDBRawMovieDetails {
  id: number;
  title: string;
  original_title: string;
  release_date: string | null;
  runtime: number | null;
  genres: TMDBRawGenre[];
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string;
  production_companies: TMDBRawProductionCompany[];
  original_language: string | null;
  origin_country?: string[];
  credits?: TMDBRawCredits;
  vote_average?: number | null;
}

export interface TMDBRawTVDetails {
  id: number;
  name: string;
  original_name: string;
  first_air_date: string | null;
  episode_run_time: number[];
  genres: TMDBRawGenre[];
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string;
  production_companies: TMDBRawProductionCompany[];
  original_language: string | null;
  origin_country?: string[];
  number_of_seasons: number;
  number_of_episodes: number;
  status?: string;
  credits?: TMDBRawCredits;
  seasons?: TMDBRawSeasonSummary[];
  vote_average?: number | null;
}

export interface TMDBRawSeasonSummary {
  season_number: number;
  episode_count: number;
  name: string;
  air_date: string | null;
}

export interface TMDBRawEpisode {
  id: number;
  season_number: number;
  episode_number: number;
  name: string;
  runtime: number | null;
  air_date: string | null;
  overview: string;
  still_path: string | null;
  vote_average: number | null;
}

export interface TMDBRawSeasonDetails {
  season_number: number;
  episodes: TMDBRawEpisode[];
}

export interface TMDBSearchResult {
  tmdbId: number;
  mediaKind: TMDBMediaKind;
  title: string;
  originalTitle: string | null;
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string;
  country: string | null;
  language: string | null;
  adult: boolean | undefined;
  popularity: number;
}

export interface TMDBNormalizedDetails {
  tmdbId: number;
  mediaKind: TMDBMediaKind;
  title: string;
  originalTitle: string | null;
  year: number | null;
  releaseDate: string | null;
  runtime: number | null;
  genres: string[];
  genreIds: number[];
  posterPath: string | null;
  backdropPath: string | null;
  overview: string;
  language: string | null;
  country: string | null;
  productionCompanies: {
    tmdbCompanyId: number;
    name: string;
    logoPath: string | null;
    originCountry: string | null;
  }[];
  cast: {
    tmdbPersonId: number;
    name: string;
    originalName: string | null;
    character: string;
    profilePath: string | null;
    order: number;
  }[];
  crew: {
    tmdbPersonId: number;
    name: string;
    originalName: string | null;
    job: string;
    department: string;
    profilePath: string | null;
  }[];
  seasons?: {
    seasonNumber: number;
    episodeCount: number;
    name: string;
    airDate: string | null;
  }[];
  tvStatus?: string;
  tmdbRating: number | null;
}

export interface TMDBNormalizedEpisode {
  tmdbEpisodeId: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  runtime: number | null;
  airDate: string | null;
  synopsis: string | null;
  thumbnailPath: string | null;
  tmdbRating: number | null;
}

export interface TMDBRawImage {
  file_path: string;
  width: number;
  height: number;
  aspect_ratio: number;
  vote_average?: number;
  iso_639_1?: string | null;
}

export interface TMDBRawImagesResponse {
  id: number;
  posters: TMDBRawImage[];
  backdrops: TMDBRawImage[];
}

export interface TMDBImageOption {
  filePath: string;
  width: number;
  height: number;
  languageCode?: string | null;
}

export interface TMDBImageOptions {
  posters: TMDBImageOption[];
  backdrops: TMDBImageOption[];
}

export interface TMDBRawCombinedCreditItem {
  id: number;
  media_type: string;
  title?: string;
  name?: string;
  poster_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  character?: string;
  job?: string;
  department?: string;
  popularity?: number;
  genre_ids?: number[];
}

export interface TMDBRawPersonDetails {
  id: number;
  name: string;
  biography: string;
  profile_path?: string | null;
  birthday?: string | null;
  deathday?: string | null;
  place_of_birth?: string | null;
  also_known_as?: string[];
  known_for_department?: string | null;
  combined_credits?: {
    cast?: TMDBRawCombinedCreditItem[];
    crew?: TMDBRawCombinedCreditItem[];
  };
  external_ids?: {
    imdb_id?: string | null;
  };
}

export interface TMDBFilmographyItem {
  tmdbId: number;
  mediaKind: "movie" | "tv";
  category: "movie" | "tv_series" | "tv_program";
  title: string;
  posterPath: string | null;
  year: string | null;
  releaseDate: string | null;
  department: string;
  character: string | null;
  jobs: string[];
  popularity: number;
}

export interface TMDBPersonDetails {
  tmdbPersonId: number;
  name: string;
  originalName: string | null;
  biography: string;
  profilePath: string | null;
  birthday: string | null;
  deathday: string | null;
  placeOfBirth: string | null;
  knownForDepartment: string | null;
  alsoKnownAs: string[];
  imdbId: string | null;
  credits: TMDBFilmographyItem[];
  knownFor: TMDBFilmographyItem[];
}

