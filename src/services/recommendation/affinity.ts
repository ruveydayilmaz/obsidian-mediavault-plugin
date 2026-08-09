import { MediaItem } from "../../models/media";
import { WatchSession } from "../../models/review";
import { AffinityProfile } from "./types";

export function buildAffinityProfile(
  media: MediaItem[],
  sessions: WatchSession[],
): AffinityProfile {
  const mediaById = new Map(media.map((m) => [m.id, m]));

  const genreWeights = new Map<string, number>();
  const actorWeights = new Map<string, number>();
  const directorWeights = new Map<string, number>();

  for (const session of sessions) {
    if (session.rating === null || session.rating <= 0) continue;
    const item = mediaById.get(session.mediaId);
    if (!item) continue;

    const weight = session.rating;

    for (const genre of item.genres) {
      genreWeights.set(genre, (genreWeights.get(genre) ?? 0) + weight);
    }

    for (const cast of item.cast.slice(0, 5)) {
      actorWeights.set(cast.name, (actorWeights.get(cast.name) ?? 0) + weight);
    }

    for (const crew of item.crew) {
      if (crew.job !== "Director" && crew.job !== "Creator") continue;
      directorWeights.set(
        crew.name,
        (directorWeights.get(crew.name) ?? 0) + weight,
      );
    }
  }

  return {
    genre: normalize(genreWeights),
    actor: normalize(actorWeights),
    director: normalize(directorWeights),
  };
}

function normalize(weights: Map<string, number>): Map<string, number> {
  const max = Math.max(0, ...weights.values());
  if (max === 0) return new Map();
  const normalized = new Map<string, number>();
  for (const [key, value] of weights.entries()) {
    normalized.set(key, value / max);
  }
  return normalized;
}
