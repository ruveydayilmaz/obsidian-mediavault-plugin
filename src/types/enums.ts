export enum MediaType {
  Movie = "movie",
  TVShow = "tv",
  Book = "book",
  Game = "game",
  Anime = "anime",
}

export enum MediaStatus {
  Watching = "watching",
  Completed = "completed",
  OnHold = "on_hold",
  Dropped = "dropped",
  PlanToWatch = "plan_to_watch",
  WatchLater = "watch_later",
  Rewatching = "rewatching",
  ComfortMedia = "comfort_media",
  Favorite = "favorite",
  WaitingForNewSeason = "waiting_for_new_season",
  UpToDate = "up_to_date",
}

export enum WatchSource {
  Cinema = "cinema",
  Streaming = "streaming",
  PhysicalMedia = "physical_media",
  Download = "download",
  Broadcast = "broadcast",
  Other = "other",
}

export enum Mood {
  Happy = "happy",
  Sad = "sad",
  Anxious = "anxious",
  Excited = "excited",
  Bored = "bored",
  Nostalgic = "nostalgic",
  Relaxed = "relaxed",
  Stressed = "stressed",
  Neutral = "neutral",
}

export enum Season {
  Winter = "winter",
  Spring = "spring",
  Summer = "summer",
  Autumn = "autumn",
  Halloween = "halloween",
  Christmas = "christmas",
  RainyDay = "rainy_day",
  LateNight = "late_night",
}

export enum TriggerWarning {
  Death = "death",
  Violence = "violence",
  Anxiety = "anxiety",
  Horror = "horror",
  Betrayal = "betrayal",
  Grief = "grief",
  PanicThemes = "panic_themes",
  SelfHarm = "self_harm",
  SubstanceAbuse = "substance_abuse",
  DomesticAbuse = "domestic_abuse",
}

export enum RatingScale {
  FiveStar = "5-star",
  TenPoint = "10-point",
  HundredPoint = "100-point",
}

export enum ImportSource {
  TVTime = "tv_time",
  Trakt = "trakt",
  Manual = "manual",
  TMDBSearch = "tmdb_search",
}
