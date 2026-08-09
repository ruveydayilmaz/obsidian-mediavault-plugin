export interface CountItem {
  label: string;
  count: number;
}

export interface TrendPoint {
  period: string; // "2024-01" for monthly, "2024" for yearly
  count: number;
}

export interface AnalyticsSummary {
  totalRuntimeMinutes: number;

  moviesWatchedCount: number;
  episodesWatchedCount: number;

  averageRating: number | null;

  topGenres: CountItem[];
  topActors: CountItem[];
  topDirectors: CountItem[];
  topStudios: CountItem[];

  rewatchCount: number;

  completionRate: number;

  monthlyWatchTrend: TrendPoint[];
  yearlyWatchTrend: TrendPoint[];
}
