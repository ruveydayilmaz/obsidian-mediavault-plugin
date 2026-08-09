import { WatchSession, RatingEvolutionPoint } from "../models/review";

export function nextRewatchNumber(existingSessions: WatchSession[]): number {
  return existingSessions.length;
}

export function computeAverageRating(sessions: WatchSession[]): number | null {
  const rated = sessions.filter(
    (s): s is WatchSession & { rating: number } => s.rating !== null,
  );
  if (rated.length === 0) return null;
  const sum = rated.reduce((acc, s) => acc + s.rating, 0);
  return sum / rated.length;
}

export function getRatingEvolution(
  sessions: WatchSession[],
): RatingEvolutionPoint[] {
  return [...sessions]
    .sort((a, b) => {
      const dateCmp = a.watchDate.localeCompare(b.watchDate);
      return dateCmp !== 0 ? dateCmp : a.rewatchNumber - b.rewatchNumber;
    })
    .map((s) => ({
      watchSessionId: s.id,
      rewatchNumber: s.rewatchNumber,
      watchDate: s.watchDate,
      rating: s.rating,
    }));
}

export function sortSessionsChronological(
  sessions: WatchSession[],
): WatchSession[] {
  return [...sessions].sort((a, b) => {
    const dateCmp = a.watchDate.localeCompare(b.watchDate);
    return dateCmp !== 0 ? dateCmp : a.rewatchNumber - b.rewatchNumber;
  });
}

export function getLatestSession(
  sessions: WatchSession[],
): WatchSession | null {
  const sorted = sortSessionsChronological(sessions);
  return sorted.length > 0 ? sorted[sorted.length - 1] : null;
}

export function getFirstSession(sessions: WatchSession[]): WatchSession | null {
  const sorted = sortSessionsChronological(sessions);
  return sorted.length > 0 ? sorted[0] : null;
}
