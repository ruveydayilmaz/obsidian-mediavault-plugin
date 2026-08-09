import type { StorageService } from "./storage";
import type { TMDBService } from "../api/tmdb";
import { Episode } from "../models/episode";
import { MediaItem } from "../models/media";
import { MediaStatus } from "../types/enums";
import { TMDBNormalizedEpisode } from "../types/tmdb";
import { mapWithConcurrency } from "./importer/concurrency";

const SEASON_FETCH_CONCURRENCY = 5;

export function tmdbEpisodeToEpisodeInput(
  mediaId: string,
  ep: TMDBNormalizedEpisode,
): Omit<Episode, "id"> {
  return {
    mediaId,
    tmdbEpisodeId: ep.tmdbEpisodeId,
    seasonNumber: ep.seasonNumber,
    episodeNumber: ep.episodeNumber,
    title: ep.title,
    runtime: ep.runtime,
    airDate: ep.airDate,
    synopsis: ep.synopsis,
    thumbnailPath: ep.thumbnailPath,
    tmdbRating: ep.tmdbRating,
  };
}

export function diffNewEpisodes(
  incoming: Omit<Episode, "id">[],
  existing: Episode[],
): Omit<Episode, "id">[] {
  const existingKeys = new Set(
    existing.map((e) => `${e.seasonNumber}:${e.episodeNumber}`),
  );
  return incoming.filter(
    (e) => !existingKeys.has(`${e.seasonNumber}:${e.episodeNumber}`),
  );
}

export interface EpisodeImportResult {
  seasonsProcessed: number;
  episodesAdded: number;
  episodesSkipped: number;
}

export async function importEpisodesForShow(
  storage: StorageService,
  tmdb: TMDBService,
  media: MediaItem,
): Promise<EpisodeImportResult> {
  const details = await tmdb.getTV(media.tmdbId);
  const seasons = details.seasons ?? [];

  const existing = await storage.episodes.findByMediaId(media.id);

  let episodesAdded = 0;
  let episodesSkipped = 0;

  const seasonEpisodes = await mapWithConcurrency(
    seasons,
    SEASON_FETCH_CONCURRENCY,
    (season) => tmdb.getEpisodes(media.tmdbId, season.seasonNumber),
  );

  const existingKeys = new Set(
    existing.map((e) => `${e.seasonNumber}:${e.episodeNumber}`),
  );

  for (const tmdbEpisodes of seasonEpisodes) {
    const inputs = tmdbEpisodes.map((ep) =>
      tmdbEpisodeToEpisodeInput(media.id, ep),
    );
    const toAdd = inputs.filter(
      (e) => !existingKeys.has(`${e.seasonNumber}:${e.episodeNumber}`),
    );

    for (const input of toAdd) {
      await storage.episodes.create(input);
      existingKeys.add(`${input.seasonNumber}:${input.episodeNumber}`);
      episodesAdded++;
    }
    episodesSkipped += inputs.length - toAdd.length;
  }

  await storage.media.update(media.id, {
    episodesLastSyncedAt: new Date().toISOString(),
  });

  return { seasonsProcessed: seasons.length, episodesAdded, episodesSkipped };
}

const ACTIVELY_WATCHING_STATUSES: ReadonlySet<MediaStatus> = new Set([
  MediaStatus.Watching,
  MediaStatus.Rewatching,
]);

export function needsEpisodeSync(
  media: Pick<MediaItem, "status" | "episodesLastSyncedAt">,
  hasExistingEpisodes: boolean,
  intervalHours: number,
  now: number = Date.now(),
): boolean {
  if (!hasExistingEpisodes) return true;
  if (!ACTIVELY_WATCHING_STATUSES.has(media.status)) return false;
  if (!media.episodesLastSyncedAt) return true;

  const lastSynced = new Date(media.episodesLastSyncedAt).getTime();
  if (Number.isNaN(lastSynced)) return true;

  return now - lastSynced > intervalHours * 60 * 60 * 1000;
}
