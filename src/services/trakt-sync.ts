import { t } from "../i18n";
import type { StorageService } from "./storage";
import type { TMDBService } from "../api/tmdb";
import type { TraktService, TraktHistoryItem } from "../api/trakt";
import { buildMediaItemFromTMDB } from "./media-import";
import {
  addWatchSession,
  findSessionByExternalRef,
} from "./watch-session-service";
import { importEpisodesForShow } from "./episode-import";
import { markEpisodeWatched } from "./episode-status-sync";
import { MediaType } from "../types/enums";
import { WatchSession } from "../models/review";

export interface TraktPullResult {
  moviesAdded: number;
  moviesSkippedExisting: number;
  episodesMarked: number;
  errors: { title: string; reason: string }[];
}

export interface TraktPushResult {
  pushed: number;
  skipped: number;
  errors: { title: string; reason: string }[];
}

export async function pullFromTrakt(
  storage: StorageService,
  tmdb: TMDBService,
  trakt: TraktService,
): Promise<TraktPullResult> {
  const result: TraktPullResult = {
    moviesAdded: 0,
    moviesSkippedExisting: 0,
    episodesMarked: 0,
    errors: [],
  };

  const [movieHistory, episodeHistory, movieRatings] = await Promise.all([
    trakt.getHistory("movies"),
    trakt.getHistory("episodes"),
    trakt.getRatings("movies"),
  ]);

  const ratingByTmdbId = new Map<number, number>();
  movieRatings.forEach((r) => {
    if (r.movie?.ids.tmdb) ratingByTmdbId.set(r.movie.ids.tmdb, r.rating);
  });

  for (const item of movieHistory) {
    try {
      await pullMovieHistoryItem(storage, tmdb, item, ratingByTmdbId, result);
    } catch (err) {
      result.errors.push({
        title: item.movie?.title ?? "Unknown movie",
        reason: (err as Error).message,
      });
    }
  }

  const episodesByShow = new Map<number, TraktHistoryItem[]>();
  for (const item of episodeHistory) {
    const tmdbId = item.show?.ids.tmdb;
    if (!tmdbId) continue;
    if (!episodesByShow.has(tmdbId)) episodesByShow.set(tmdbId, []);
    episodesByShow.get(tmdbId)!.push(item);
  }

  for (const [tmdbId, items] of episodesByShow) {
    try {
      const marked = await pullShowEpisodeHistory(storage, tmdb, tmdbId, items);
      result.episodesMarked += marked;
    } catch (err) {
      result.errors.push({
        title: items[0].show?.title ?? "Unknown show",
        reason: (err as Error).message,
      });
    }
  }

  await storage.settings.update({
    traktLastSyncedAt: new Date().toISOString(),
  });

  return result;
}

async function pullMovieHistoryItem(
  storage: StorageService,
  tmdb: TMDBService,
  item: TraktHistoryItem,
  ratingByTmdbId: Map<number, number>,
  result: TraktPullResult,
): Promise<void> {
  const tmdbId = item.movie?.ids.tmdb;
  if (!tmdbId) return;

  const externalRef = String(item.id);
  const existingSession = await findSessionByExternalRef(
    storage,
    "trakt",
    externalRef,
  );
  if (existingSession) {
    result.moviesSkippedExisting++;
    return;
  }

  const mediaItem = await resolveOrCreateMedia(
    storage,
    tmdb,
    tmdbId,
    MediaType.Movie,
  );

  await addWatchSession(storage, {
    mediaId: mediaItem.id,
    watchDate: item.watchedAt.slice(0, 10),
    rating: ratingByTmdbId.get(tmdbId) ?? null,
    context: t("watchSession.syncedFromTrakt"),
    externalSource: "trakt",
    externalRef,
  });

  result.moviesAdded++;
}

async function pullShowEpisodeHistory(
  storage: StorageService,
  tmdb: TMDBService,
  showTmdbId: number,
  items: TraktHistoryItem[],
): Promise<number> {
  const mediaItem = await resolveOrCreateMedia(
    storage,
    tmdb,
    showTmdbId,
    MediaType.TVShow,
  );
  await importEpisodesForShow(storage, tmdb, mediaItem);

  const episodes = await storage.episodes.findByMediaId(mediaItem.id);
  let marked = 0;

  for (const item of items) {
    if (!item.episode) continue;
    const episode = episodes.find(
      (e) =>
        e.seasonNumber === item.episode!.season &&
        e.episodeNumber === item.episode!.number,
    );
    if (!episode) continue;

    await markEpisodeWatched(
      storage,
      episode,
      true,
      item.watchedAt.slice(0, 10),
    );
    marked++;
  }

  return marked;
}

async function resolveOrCreateMedia(
  storage: StorageService,
  tmdb: TMDBService,
  tmdbId: number,
  type: MediaType,
) {
  const existing = await storage.media.findByTmdbId(tmdbId, type);
  if (existing) return existing;

  const details =
    type === MediaType.Movie
      ? await tmdb.getMovie(tmdbId)
      : await tmdb.getTV(tmdbId);
  const mediaItem = buildMediaItemFromTMDB(details);
  await storage.media.save(mediaItem);
  return mediaItem;
}

export async function pushToTrakt(
  storage: StorageService,
  trakt: TraktService,
): Promise<TraktPushResult> {
  const result: TraktPushResult = { pushed: 0, skipped: 0, errors: [] };

  const allMedia = await storage.media.getAll();
  const movieById = new Map(
    allMedia.filter((m) => m.type === MediaType.Movie).map((m) => [m.id, m]),
  );

  const allSessions = await storage.watchSessions.getAll();
  const unsyncedMovieSessions = allSessions.filter(
    (s: WatchSession) => s.externalSource === null && movieById.has(s.mediaId),
  );

  for (const session of unsyncedMovieSessions) {
    const media = movieById.get(session.mediaId)!;
    try {
      await trakt.addMovieToHistory(
        media.tmdbId,
        `${session.watchDate}T00:00:00.000Z`,
      );
      if (session.rating !== null) {
        await trakt.addMovieRating(
          media.tmdbId,
          session.rating,
          `${session.watchDate}T00:00:00.000Z`,
        );
      }
      await storage.watchSessions.update(session.id, {
        externalSource: "trakt",
        externalRef: `pushed:${session.id}`,
      });
      result.pushed++;
    } catch (err) {
      result.errors.push({
        title: media.title,
        reason: (err as Error).message,
      });
    }
  }

  result.skipped =
    allSessions.length - unsyncedMovieSessions.length - result.pushed;
  return result;
}
