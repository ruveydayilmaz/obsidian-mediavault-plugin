import type { StorageService } from "../../storage";
import type { TMDBService } from "../../../api/tmdb";
import { MediaItem } from "../../../models/media";
import { Episode } from "../../../models/episode";
import { MediaType, MediaStatus } from "../../../types/enums";
import { buildMediaItemFromTMDB } from "../../media-import";
import { addWatchSession } from "../../watch-session-service";
import { touchMediaActivity } from "../../activity-service";
import { importEpisodesForShow } from "../../episode-import";
import {
  findBestMatch,
  MatchTier,
  EpisodeHistoryEntry,
  CandidateSeasonInfo,
} from "../tmdb-match";
import {
  NormalizedImportBundle,
  WatchImport,
  ReviewImport,
  LikeImport,
  RatingImport,
  ListImport,
  DroppedImport,
  ExternalIds,
  ImportMediaKind,
  MatchMetadata,
} from "./types";
import { recalculateAndPersistStatus } from "../../status-service";
import { isSeriesFullyWatched } from "../../episode-status-sync";
import { ImportTimer } from "../import-timer";
import { mapWithConcurrency } from "../concurrency";
import { maybeYield } from "../yield";

const RESOLVE_CONCURRENCY = 5;
const EPISODE_IMPORT_CONCURRENCY = 4;
const PROGRESS_THROTTLE_MS = 100;

export interface UnmatchedItem {
  kind: ImportMediaKind;
  title: string;
  year: number | null;
  reason: string;
}

export interface MatchLogEntry {
  title: string;
  kind: ImportMediaKind;
  tier: MatchTier;
  score: number;
  queriesTried: string[];
  selected: string | null;
  rejectedCount: number;
  tieBrokenByPopularity: boolean;
  tieBrokenByEpisodeHistory: boolean;
}

export interface ImportReport {
  moviesImported: number;
  showsImported: number;
  episodesUpdated: number;
  episodeWatchesImported: number;
  commentsImported: number;
  likesImported: number;
  favoritesImported: number;
  ratingsImported: number;
  emotionsImported: number;
  listsImported: number;
  builtInListsImported: number;
  customListsImported: number;
  listsDiscovered: number;
  totalListItems: number;
  matchedListItems: number;
  missingListItems: number;
  unmatchedListSKeys: string[];
  droppedRecordsFound: number;
  droppedMoviesFound: number;
  droppedSeriesFound: number;
  droppedImported: number;
  droppedMoviesImported: number;
  droppedSeriesImported: number;
  duplicatesMerged: number;
  skipped: number;
  errors: { reason: string }[];
  unmatched: UnmatchedItem[];
  matchLog: MatchLogEntry[];

  exactMatchCount: number;
  metadataMatchCount: number;
  episodeHistoryMatchCount: number;
  popularityTieBreakCount: number;
  unmatchedMatchCount: number;

  totalRecordsParsed: number;
  matchedMediaCount: number;
  unmatchedMediaCount: number;
  matchedEpisodes: number;
  unmatchedEpisodes: number;
  totalImportedRuntimeSeconds: number;
  skippedByReason: Record<string, number>;
  timing: { stage: string; ms: number; calls: number }[];
}

export function emptyReport(): ImportReport {
  return {
    moviesImported: 0,
    showsImported: 0,
    episodesUpdated: 0,
    episodeWatchesImported: 0,
    commentsImported: 0,
    likesImported: 0,
    favoritesImported: 0,
    ratingsImported: 0,
    emotionsImported: 0,
    listsImported: 0,
    builtInListsImported: 0,
    customListsImported: 0,
    listsDiscovered: 0,
    totalListItems: 0,
    matchedListItems: 0,
    missingListItems: 0,
    unmatchedListSKeys: [],
    droppedRecordsFound: 0,
    droppedMoviesFound: 0,
    droppedSeriesFound: 0,
    droppedImported: 0,
    droppedMoviesImported: 0,
    droppedSeriesImported: 0,
    duplicatesMerged: 0,
    skipped: 0,
    errors: [],
    unmatched: [],
    matchLog: [],
    exactMatchCount: 0,
    metadataMatchCount: 0,
    episodeHistoryMatchCount: 0,
    popularityTieBreakCount: 0,
    unmatchedMatchCount: 0,
    totalRecordsParsed: 0,
    matchedMediaCount: 0,
    unmatchedMediaCount: 0,
    matchedEpisodes: 0,
    unmatchedEpisodes: 0,
    totalImportedRuntimeSeconds: 0,
    skippedByReason: {},
    timing: [],
  };
}

function trackSkip(report: ImportReport, reason: string): void {
  report.skippedByReason[reason] = (report.skippedByReason[reason] ?? 0) + 1;
}

function resolutionKey(
  ids: ExternalIds,
  title: string,
  year: number | null,
  kind: ImportMediaKind,
  match?: MatchMetadata,
): string {
  return JSON.stringify([
    kind,
    ids.tvdbId ?? null,
    ids.imdbId ?? null,
    ids.tvTimeUuid ?? null,
    ids.tvTimeId ?? null,
    title.toLowerCase().trim(),
    year,
    match?.originalTitle ?? null,
    match?.releaseDate ?? null,
  ]);
}

function normalizeTitleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function fetchCandidateSeasons(
  tmdb: TMDBService,
  tmdbId: number,
): Promise<CandidateSeasonInfo[]> {
  const details = await tmdb.getTV(tmdbId);
  return (details.seasons ?? []).map((s) => ({
    seasonNumber: s.seasonNumber,
    episodeCount: s.episodeCount,
  }));
}

export class MediaResolver {
  private cache = new Map<
    string,
    Promise<{ media: MediaItem | null; isNew: boolean }>
  >();
  private countedKeys = new Set<string>();

  private titleIndex: Map<string, MediaItem[]> | null = null;

  constructor(
    private storage: StorageService,
    private tmdb: TMDBService,
    private report: ImportReport,
    private timer: ImportTimer = new ImportTimer(),
    private episodeHistoryByKey: Map<string, EpisodeHistoryEntry[]> = new Map(),
  ) {}

  private async ensureTitleIndex(): Promise<Map<string, MediaItem[]>> {
    if (!this.titleIndex) {
      const allMedia = await this.storage.media.getAll();
      this.titleIndex = new Map();
      for (const m of allMedia) {
        const key = normalizeTitleKey(m.title);
        const bucket = this.titleIndex.get(key);
        if (bucket) bucket.push(m);
        else this.titleIndex.set(key, [m]);
      }
    }
    return this.titleIndex;
  }

  private indexNewMedia(media: MediaItem): void {
    if (!this.titleIndex) return; // WIP next ensureTitleIndex() call will pick it up fresh
    const key = normalizeTitleKey(media.title);
    const bucket = this.titleIndex.get(key);
    if (bucket) bucket.push(media);
    else this.titleIndex.set(key, [media]);
  }

  async resolve(
    ids: ExternalIds,
    title: string,
    year: number | null,
    kind: ImportMediaKind,
    match?: MatchMetadata,
  ): Promise<MediaItem | null> {
    const key = resolutionKey(ids, title, year, kind, match);
    let pending = this.cache.get(key);
    if (!pending) {
      pending = this.doResolve(
        ids,
        title,
        year,
        kind,
        match,
        this.episodeHistoryByKey.get(key),
      );
      this.cache.set(key, pending);
    }
    const result = await pending;

    if (!this.countedKeys.has(key)) {
      this.countedKeys.add(key);
      if (result.media) this.report.matchedMediaCount++;
      else this.report.unmatchedMediaCount++;
    }

    return result.media;
  }

  private async doResolve(
    ids: ExternalIds,
    title: string,
    year: number | null,
    kind: ImportMediaKind,
    match?: MatchMetadata,
    episodeHistory?: EpisodeHistoryEntry[],
  ): Promise<{ media: MediaItem | null; isNew: boolean }> {
    if (ids.tvdbId != null) {
      const existing = await this.storage.media.findByTvdbId(ids.tvdbId);
      if (existing) {
        this.report.duplicatesMerged++;
        return { media: existing, isNew: false };
      }
    }

    if (ids.imdbId) {
      const existing = await this.storage.media.findByImdbId(ids.imdbId);
      if (existing) {
        this.report.duplicatesMerged++;
        return { media: existing, isNew: false };
      }
    }

    if (ids.tvTimeUuid) {
      const existing = await this.storage.media.findByTvTimeUuid(
        ids.tvTimeUuid,
      );
      if (existing) {
        this.report.duplicatesMerged++;
        return { media: existing, isNew: false };
      }
    }

    const titleIndex = await this.ensureTitleIndex();
    const normalizedTitle = normalizeTitleKey(title);
    const candidates = titleIndex.get(normalizedTitle) ?? [];
    const localMatch = candidates.find(
      (m) => year === null || m.year === null || m.year === year,
    );
    if (localMatch) {
      this.report.duplicatesMerged++;
      return { media: localMatch, isNew: false };
    }

    try {
      const tmdbKind = kind === "movie" ? "movie" : "tv";
      const tmdbMatch = await this.timer.time(
        "Media matching (TMDB search)",
        () =>
          findBestMatch(
            this.tmdb,
            {
              kind: tmdbKind,
              title,
              year,
              ...match,
              ...(tmdbKind === "tv" && episodeHistory?.length
                ? { episodeHistory }
                : {}),
            },
            tmdbKind === "tv"
              ? (tmdbId) => fetchCandidateSeasons(this.tmdb, tmdbId)
              : undefined,
          ),
      );

      this.report.matchLog.push({
        title,
        kind,
        tier: tmdbMatch.tier,
        score: tmdbMatch.score,
        queriesTried: tmdbMatch.queriesTried,
        selected: tmdbMatch.candidate
          ? `${tmdbMatch.candidate.title}${tmdbMatch.candidate.year ? ` (${tmdbMatch.candidate.year})` : ""}`
          : null,
        rejectedCount: tmdbMatch.rejected.length,
        tieBrokenByPopularity: tmdbMatch.tieBrokenByPopularity,
        tieBrokenByEpisodeHistory: tmdbMatch.tieBrokenByEpisodeHistory,
      });

      switch (tmdbMatch.tier) {
        case "exact":
          this.report.exactMatchCount++;
          break;
        case "year":
        case "fuzzy":
          this.report.metadataMatchCount++;
          break;
        case "episode-history":
          this.report.episodeHistoryMatchCount++;
          break;
        case "popularity":
          this.report.popularityTieBreakCount++;
          break;
        case "unmatched":
          this.report.unmatchedMatchCount++;
          break;
      }

      if (tmdbMatch.candidate === null) {
        this.report.unmatched.push({
          kind,
          title,
          year,
          reason:
            tmdbMatch.rejected.length > 0
              ? "Multiple possible matches, none confident enough"
              : "No TMDB match found",
        });
        return { media: null, isNew: false };
      }

      const top = tmdbMatch.candidate;
      const details = await this.timer.time(
        "Media matching (TMDB details)",
        () =>
          tmdbKind === "movie"
            ? this.tmdb.getMovie(top.tmdbId)
            : this.tmdb.getTV(top.tmdbId),
      );

      const existingByTmdb = await this.storage.media.findByTmdbId(
        top.tmdbId,
        tmdbKind === "movie" ? MediaType.Movie : MediaType.TVShow,
      );
      if (existingByTmdb) {
        this.report.duplicatesMerged++;
        return { media: existingByTmdb, isNew: false };
      }

      const mediaItem = buildMediaItemFromTMDB(details);
      mediaItem.tvdbId = ids.tvdbId ?? null;
      mediaItem.imdbId = ids.imdbId ?? null;
      mediaItem.tvTimeUuid = ids.tvTimeUuid ?? null;

      const saved = await this.storage.media.save(mediaItem);
      this.indexNewMedia(saved);
      if (kind === "movie") this.report.moviesImported++;
      else this.report.showsImported++;

      return { media: saved, isNew: true };
    } catch (err) {
      this.report.errors.push({
        reason: `"${title}": ${(err as Error).message}`,
      });
      return { media: null, isNew: false };
    }
  }
}

async function applyWatch(
  storage: StorageService,
  tmdb: TMDBService,
  watch: WatchImport,
  media: MediaItem,
  report: ImportReport,
  episodeIndexes: Map<string, Map<string, Episode>>,
  affectedSeries: Set<string>,
  seriesLatestWatchedDate: Map<string, string>,
  mediaLatestActivityDate: Map<string, string>,
  wasSeriesCompleteBeforeImport: Map<string, boolean>,
  existingWatchDates: Map<string, Set<string>>,
): Promise<void> {
  const bumpActivity = (mediaId: string, at: string | null) => {
    if (!at) return;
    const current = mediaLatestActivityDate.get(mediaId);
    if (!current || at > current) mediaLatestActivityDate.set(mediaId, at);
  };

  if (watch.kind === "movie") {
    const watchedAt = watch.watchedAt ?? new Date().toISOString().slice(0, 10);

    let seenDates = existingWatchDates.get(`movie:${media.id}`);
    if (!seenDates) {
      seenDates = new Set(
        (await storage.watchSessions.findByMediaId(media.id)).map(
          (s) => s.watchDate,
        ),
      );
      existingWatchDates.set(`movie:${media.id}`, seenDates);
    }
    if (seenDates.has(watchedAt)) {
      report.skipped++;
      report.duplicatesMerged++;
      trackSkip(report, "Movie already watched on this date: merged");
      bumpActivity(media.id, watchedAt);
      return;
    }
    seenDates.add(watchedAt);

    await addWatchSession(storage, {
      mediaId: media.id,
      watchDate: watchedAt,
      rating: null,
      review: "",
      activityAt: watch.watchedAt ?? undefined,
    });
    bumpActivity(media.id, watchedAt);
    if (watch.match?.runtimeSeconds)
      report.totalImportedRuntimeSeconds += watch.match.runtimeSeconds;
    return;
  }

  if (watch.seasonNumber === undefined || watch.episodeNumber === undefined) {
    report.skipped++;
    trackSkip(report, "Watch event missing season/episode number");
    return;
  }

  let episodes = episodeIndexes.get(media.id);
  if (!episodes) {
    await importEpisodesForShow(storage, tmdb, media);
    episodes = new Map(
      (await storage.episodes.findByMediaId(media.id)).map((e) => [
        `${e.seasonNumber}:${e.episodeNumber}`,
        e,
      ]),
    );
    episodeIndexes.set(media.id, episodes);
  }
  const episode = episodes.get(`${watch.seasonNumber}:${watch.episodeNumber}`);

  if (!episode) {
    report.skipped++;
    report.unmatchedEpisodes++;
    trackSkip(report, "Episode not found on TMDB for this show");
    report.errors.push({
      reason: `"${watch.title}" S${watch.seasonNumber}E${watch.episodeNumber}: no matching episode found on TMDB: skipped.`,
    });
    return;
  }

  if (!wasSeriesCompleteBeforeImport.has(media.id)) {
    wasSeriesCompleteBeforeImport.set(
      media.id,
      await isSeriesFullyWatched(storage, media.id),
    );
  }

  const watchedAt = watch.watchedAt ?? new Date().toISOString().slice(0, 10);

  let seenDates = existingWatchDates.get(episode.id);
  if (!seenDates) {
    seenDates = new Set(
      (await storage.episodeWatches.findByEpisodeId(episode.id)).map(
        (w) => w.watchedAt,
      ),
    );
    existingWatchDates.set(episode.id, seenDates);
  }
  if (seenDates.has(watchedAt)) {
    report.skipped++;
    report.duplicatesMerged++;
    trackSkip(report, "Episode already watched on this date: merged");
    affectedSeries.add(media.id);
    bumpActivity(media.id, watchedAt);
    const current = seriesLatestWatchedDate.get(media.id);
    if (!current || watchedAt > current)
      seriesLatestWatchedDate.set(media.id, watchedAt);
    return;
  }
  seenDates.add(watchedAt);

  await storage.episodeWatches.create({
    mediaId: episode.mediaId,
    episodeId: episode.id,
    watchedAt,
    rating: null,
    emotion: null,
    review: null,
    notes: null,
  });
  await storage.episodeProgress.markWatched(episode, true, watchedAt);
  affectedSeries.add(media.id);

  const current = seriesLatestWatchedDate.get(media.id);
  if (!current || watchedAt > current)
    seriesLatestWatchedDate.set(media.id, watchedAt);
  bumpActivity(media.id, watchedAt);

  report.episodesUpdated++;
  report.episodeWatchesImported++;
  report.matchedEpisodes++;
  report.totalImportedRuntimeSeconds +=
    watch.match?.runtimeSeconds ?? (episode.runtime ? episode.runtime * 60 : 0);
}

async function applyReview(
  storage: StorageService,
  review: ReviewImport,
  media: MediaItem,
  report: ImportReport,
): Promise<void> {
  if (review.kind === "movie") {
    const sessions = await storage.watchSessions.findByMediaId(media.id);
    const emptyReviewSession = sessions.find((s) => !s.review);

    if (emptyReviewSession) {
      await storage.watchSessions.update(emptyReviewSession.id, {
        review: review.commentText,
      });
    } else if (sessions.length === 0) {
      await addWatchSession(storage, {
        mediaId: media.id,
        watchDate: review.createdAt ?? new Date().toISOString().slice(0, 10),
        rating: null,
        review: review.commentText,
      });
    } else {
      report.skipped++;
      trackSkip(report, "Movie already has a reviewed watch session");
      return;
    }
    report.commentsImported++;
    return;
  }

  if (review.seasonNumber === undefined || review.episodeNumber === undefined) {
    report.skipped++;
    trackSkip(report, "Comment missing season/episode number");
    return;
  }
  const episodes = await storage.episodes.findByMediaId(media.id);
  const episode = episodes.find(
    (e) =>
      e.seasonNumber === review.seasonNumber &&
      e.episodeNumber === review.episodeNumber,
  );
  if (!episode) {
    report.skipped++;
    trackSkip(report, "Episode not found for comment");
    return;
  }
  const progress = await storage.episodeProgress.findByEpisodeId(episode.id);
  if (progress && progress.review) {
    report.skipped++;
    trackSkip(report, "Episode already has a review");
    return;
  }
  if (progress) {
    await storage.episodeProgress.update(progress.id, {
      review: review.commentText,
    });
  } else {
    await storage.episodeProgress.create({
      mediaId: media.id,
      episodeId: episode.id,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      watched: false,
      watchedDate: null,
      rating: null,
      review: review.commentText,
      emotion: null,
      isFavorite: false,
      liked: false,
      likedAt: null,
      comfortNote: null,
    });
  }
  report.commentsImported++;
}

async function applyLike(
  storage: StorageService,
  like: LikeImport,
  media: MediaItem,
  report: ImportReport,
): Promise<void> {
  if (like.seasonNumber === undefined || like.episodeNumber === undefined) {
    await storage.media.update(media.id, {
      liked: true,
      likedAt: like.likedAt,
    });
    report.likesImported++;
    return;
  }

  const episodes = await storage.episodes.findByMediaId(media.id);
  const episode = episodes.find(
    (e) =>
      e.seasonNumber === like.seasonNumber &&
      e.episodeNumber === like.episodeNumber,
  );
  if (!episode) {
    report.skipped++;
    trackSkip(report, "Episode not found for like");
    return;
  }
  const progress = await storage.episodeProgress.findByEpisodeId(episode.id);
  if (progress) {
    await storage.episodeProgress.update(progress.id, {
      liked: true,
      likedAt: like.likedAt,
    });
  } else {
    await storage.episodeProgress.create({
      mediaId: media.id,
      episodeId: episode.id,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      watched: false,
      watchedDate: null,
      rating: null,
      review: null,
      emotion: null,
      isFavorite: false,
      liked: true,
      likedAt: like.likedAt,
      comfortNote: null,
    });
  }
  report.likesImported++;
}

async function applyRating(
  storage: StorageService,
  rating: RatingImport,
  media: MediaItem,
  report: ImportReport,
): Promise<void> {
  const isEmotion = !!rating.emotion;

  if (rating.seasonNumber === undefined || rating.episodeNumber === undefined) {
    if (isEmotion) {
      report.skipped++;
      trackSkip(report, "Movie-level emoji reaction not supported");
      return;
    }
    const sessions = await storage.watchSessions.findByMediaId(media.id);
    const unratedSession = sessions.find((s) => s.rating === null);

    if (unratedSession) {
      await storage.watchSessions.update(unratedSession.id, {
        rating: rating.rating,
      });
    } else if (sessions.length === 0) {
      await addWatchSession(storage, {
        mediaId: media.id,
        watchDate: rating.ratedAt ?? new Date().toISOString().slice(0, 10),
        rating: rating.rating,
        review: "",
      });
    } else {
      report.skipped++;
      trackSkip(report, "Movie already fully rated");
      return;
    }
    report.ratingsImported++;
    return;
  }

  const episodes = await storage.episodes.findByMediaId(media.id);
  const episode = episodes.find(
    (e) =>
      e.seasonNumber === rating.seasonNumber &&
      e.episodeNumber === rating.episodeNumber,
  );
  if (!episode) {
    report.skipped++;
    trackSkip(report, "Episode not found for rating");
    return;
  }
  const progress = await storage.episodeProgress.findByEpisodeId(episode.id);

  if (isEmotion) {
    if (progress && progress.emotion) {
      report.skipped++;
      trackSkip(report, "Episode already has a reaction");
      return;
    }
    if (progress) {
      await storage.episodeProgress.update(progress.id, {
        emotion: rating.emotion,
      });
    } else {
      await storage.episodeProgress.create({
        mediaId: media.id,
        episodeId: episode.id,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        watched: false,
        watchedDate: null,
        rating: null,
        review: null,
        emotion: rating.emotion!,
        isFavorite: false,
        liked: false,
        likedAt: null,
        comfortNote: null,
      });
    }
    report.emotionsImported++;
    return;
  }

  if (progress && progress.rating !== null) {
    report.skipped++;
    trackSkip(report, "Episode already rated");
    return;
  }
  if (progress) {
    await storage.episodeProgress.update(progress.id, {
      rating: rating.rating,
    });
  } else {
    await storage.episodeProgress.create({
      mediaId: media.id,
      episodeId: episode.id,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      watched: false,
      watchedDate: null,
      rating: rating.rating,
      review: null,
      emotion: null,
      isFavorite: false,
      liked: false,
      likedAt: null,
      comfortNote: null,
    });
  }
  report.ratingsImported++;
}

async function applyFavorite(
  storage: StorageService,
  media: MediaItem,
  report: ImportReport,
): Promise<void> {
  await storage.media.update(media.id, { isFavorite: true });
  report.favoritesImported++;
}

async function applyDropped(
  storage: StorageService,
  dropped: DroppedImport,
  media: MediaItem,
  report: ImportReport,
): Promise<void> {
  await storage.media.update(media.id, { status: MediaStatus.Dropped });
  report.droppedImported++;
  if (dropped.kind === "movie") report.droppedMoviesImported++;
  else report.droppedSeriesImported++;
}

async function applyList(
  storage: StorageService,
  list: ListImport,
  mediaIds: string[],
  report: ImportReport,
): Promise<void> {
  if (list.builtIn) {
    for (const mediaId of mediaIds) {
      await storage.media.update(mediaId, { isFavorite: true });
    }
    report.favoritesImported += mediaIds.length;
    report.listsImported++;
    report.builtInListsImported++;
    return;
  }

  const existingLists = await storage.customLists.getAll();
  const existing = existingLists.find(
    (l) => l.isImported && l.importSource === list.sourceKey,
  );

  if (existing) {
    const missing = mediaIds.filter((id) => !existing.mediaIds.includes(id));
    const patch: Partial<typeof existing> = {};
    if (missing.length > 0) patch.mediaIds = [...existing.mediaIds, ...missing];
    if (existing.title !== list.name) patch.title = list.name;
    if ((existing.description ?? null) !== (list.description ?? null))
      patch.description = list.description;
    if ((existing.isPublic ?? false) !== (list.isPublic ?? false))
      patch.isPublic = list.isPublic;
    if ((existing.posterUrl ?? null) !== (list.posterUrl ?? null))
      patch.posterUrl = list.posterUrl;
    if ((existing.bannerUrl ?? null) !== (list.bannerUrl ?? null))
      patch.bannerUrl = list.bannerUrl;
    if (Object.keys(patch).length > 0) {
      await storage.customLists.update(existing.id, patch);
    }
  } else {
    await storage.customLists.create({
      title: list.name,
      description: list.description,
      mediaIds,
      isImported: true,
      importSource: list.sourceKey,
      isPublic: list.isPublic,
      posterUrl: list.posterUrl,
      bannerUrl: list.bannerUrl,
      ...(list.createdAt ? { createdAt: list.createdAt } : {}),
      ...(list.updatedAt ? { updatedAt: list.updatedAt } : {}),
    });
  }
  report.listsImported++;
  report.customListsImported++;
}

export type ImportProgressCallback = (
  done: number,
  total: number,
  stage: string,
) => void;

interface DistinctResolution {
  ids: ExternalIds;
  title: string;
  year: number | null;
  kind: ImportMediaKind;
  match?: MatchMetadata;
}

function collectDistinctResolutions(bundle: NormalizedImportBundle): {
  resolutions: DistinctResolution[];
  episodeHistoryByKey: Map<string, EpisodeHistoryEntry[]>;
} {
  const seen = new Set<string>();
  const out: DistinctResolution[] = [];
  const episodeHistoryByKey = new Map<string, EpisodeHistoryEntry[]>();
  const consider = (
    ids: ExternalIds,
    title: string,
    year: number | null,
    kind: ImportMediaKind,
    match?: MatchMetadata,
  ) => {
    const key = resolutionKey(ids, title, year, kind, match);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ids, title, year, kind, match });
  };

  for (const w of bundle.watches) {
    consider(w.ids, w.title, w.year, w.kind, w.match);
    if (
      w.kind === "series" &&
      w.seasonNumber !== undefined &&
      w.episodeNumber !== undefined
    ) {
      const key = resolutionKey(w.ids, w.title, w.year, w.kind, w.match);
      const list = episodeHistoryByKey.get(key) ?? [];
      list.push({
        seasonNumber: w.seasonNumber,
        episodeNumber: w.episodeNumber,
      });
      episodeHistoryByKey.set(key, list);
    }
  }
  for (const r of bundle.reviews)
    consider(r.ids, r.title, r.year, r.kind, r.match);
  for (const l of bundle.likes)
    consider(l.ids, l.title, l.year, l.kind, l.match);
  for (const r of bundle.ratings)
    consider(r.ids, r.title, r.year, r.kind, r.match);
  for (const f of bundle.favorites)
    consider(f.ids, f.title, f.year, f.kind, f.match);
  for (const d of bundle.dropped)
    consider(d.ids, d.title, d.year, d.kind, d.match);
  for (const list of bundle.lists)
    for (const item of list.items)
      consider(item.ids, item.title, item.year, item.kind, item.match);

  return { resolutions: out, episodeHistoryByKey };
}

export async function commitBundle(
  storage: StorageService,
  tmdb: TMDBService,
  bundle: NormalizedImportBundle,
  onProgress?: ImportProgressCallback,
): Promise<ImportReport> {
  const report = emptyReport();
  const timer = new ImportTimer();
  const { resolutions: distinctResolutions, episodeHistoryByKey } =
    collectDistinctResolutions(bundle);
  const resolver = new MediaResolver(
    storage,
    tmdb,
    report,
    timer,
    episodeHistoryByKey,
  );
  const episodeIndexes = new Map<string, Map<string, Episode>>();
  const affectedSeries = new Set<string>();
  const seriesLatestWatchedDate = new Map<string, string>();
  const mediaLatestActivityDate = new Map<string, string>();
  const wasSeriesCompleteBeforeImport = new Map<string, boolean>();
  const existingWatchDates = new Map<string, Set<string>>();

  const total =
    bundle.watches.length +
    bundle.reviews.length +
    bundle.likes.length +
    bundle.ratings.length +
    bundle.favorites.length +
    bundle.lists.length +
    bundle.dropped.length;
  report.totalRecordsParsed = total + bundle.warnings.length;
  let done = 0;
  let lastProgressAt = 0;
  const tick = (stage: string, force = false) => {
    done++;
    if (!onProgress) return;

    const now = Date.now();
    if (
      force ||
      done === total ||
      now - lastProgressAt >= PROGRESS_THROTTLE_MS
    ) {
      lastProgressAt = now;
      onProgress(done, total, stage);
    }
  };

  onProgress?.(0, 1, "Matching movies & TV series");

  await timer.time("Media matching (total)", async () => {
    let matchDone = 0;
    let lastMatchProgressAt = 0;
    const matchTotal = Math.max(distinctResolutions.length, 1);
    await mapWithConcurrency(
      distinctResolutions,
      RESOLVE_CONCURRENCY,
      async (item) => {
        const result = await resolver.resolve(
          item.ids,
          item.title,
          item.year,
          item.kind,
          item.match,
        );
        matchDone++;
        const now = Date.now();
        if (
          matchDone === distinctResolutions.length ||
          now - lastMatchProgressAt >= PROGRESS_THROTTLE_MS
        ) {
          lastMatchProgressAt = now;
          onProgress?.(
            matchDone,
            matchTotal,
            item.kind === "movie" ? "Matching movies" : "Matching TV series",
          );
        }
        await maybeYield(matchDone, 25);
        return result;
      },
    );
  });

  onProgress?.(0, 1, "Building lookup tables");

  await timer.time("Episode importing (catalogue fetch)", async () => {
    const distinctShows = new Map<string, MediaItem>();
    let lookupDone = 0;
    for (const watch of bundle.watches) {
      if (
        watch.kind !== "series" ||
        watch.seasonNumber === undefined ||
        watch.episodeNumber === undefined
      )
        continue;
      const media = await resolver.resolve(
        watch.ids,
        watch.title,
        watch.year,
        watch.kind,
        watch.match,
      );
      if (media && !distinctShows.has(media.id))
        distinctShows.set(media.id, media);
      lookupDone++;
      if (lookupDone % 25 === 0) {
        onProgress?.(
          lookupDone,
          bundle.watches.length,
          "Building lookup tables",
        );
        await maybeYield(lookupDone, 25);
      }
    }

    const showList = [...distinctShows.values()];
    let episodesDone = 0;
    let lastEpisodeProgressAt = 0;
    const episodeTotal = Math.max(showList.length, 1);
    onProgress?.(0, episodeTotal, "Matching episodes");
    await mapWithConcurrency(
      showList,
      EPISODE_IMPORT_CONCURRENCY,
      async (media) => {
        await importEpisodesForShow(storage, tmdb, media);
        const episodes = new Map(
          (await storage.episodes.findByMediaId(media.id)).map((e) => [
            `${e.seasonNumber}:${e.episodeNumber}`,
            e,
          ]),
        );
        episodeIndexes.set(media.id, episodes);
        episodesDone++;
        const now = Date.now();
        if (
          episodesDone === showList.length ||
          now - lastEpisodeProgressAt >= PROGRESS_THROTTLE_MS
        ) {
          lastEpisodeProgressAt = now;
          onProgress?.(episodesDone, episodeTotal, "Matching episodes");
        }
        await maybeYield(episodesDone, 5);
      },
    );
  });

  await timer.time("Applying watch history", async () => {
    for (const watch of bundle.watches) {
      const media = await resolver.resolve(
        watch.ids,
        watch.title,
        watch.year,
        watch.kind,
        watch.match,
      );
      if (!media) {
        report.skipped++;
        trackSkip(report, "No media match: watch not imported");
      } else {
        await applyWatch(
          storage,
          tmdb,
          watch,
          media,
          report,
          episodeIndexes,
          affectedSeries,
          seriesLatestWatchedDate,
          mediaLatestActivityDate,
          wasSeriesCompleteBeforeImport,
          existingWatchDates,
        );
      }
      tick("Importing watch history");
      await maybeYield(done, 25);
    }
  });

  await timer.time("Applying comments", async () => {
    for (const review of bundle.reviews) {
      const media = await resolver.resolve(
        review.ids,
        review.title,
        review.year,
        review.kind,
        review.match,
      );
      if (!media) {
        report.skipped++;
        trackSkip(report, "No media match: comment not imported");
      } else {
        await applyReview(storage, review, media, report);
      }
      tick("Importing comments");
      await maybeYield(done, 25);
    }
  });

  await timer.time("Applying likes", async () => {
    for (const like of bundle.likes) {
      const media = await resolver.resolve(
        like.ids,
        like.title,
        like.year,
        like.kind,
        like.match,
      );
      if (!media) {
        report.skipped++;
        trackSkip(report, "No media match: like not imported");
      } else {
        await applyLike(storage, like, media, report);
      }
      tick("Importing likes");
      await maybeYield(done, 25);
    }
  });

  await timer.time("Applying ratings", async () => {
    for (const rating of bundle.ratings) {
      const media = await resolver.resolve(
        rating.ids,
        rating.title,
        rating.year,
        rating.kind,
        rating.match,
      );
      if (!media) {
        report.skipped++;
        trackSkip(report, "No media match: rating not imported");
      } else {
        await applyRating(storage, rating, media, report);
      }
      tick("Importing ratings");
      await maybeYield(done, 25);
    }
  });

  await timer.time("Applying favorites", async () => {
    for (const fav of bundle.favorites) {
      const media = await resolver.resolve(
        fav.ids,
        fav.title,
        fav.year,
        fav.kind,
        fav.match,
      );
      if (!media) {
        report.skipped++;
        trackSkip(report, "No media match: favorite not imported");
      } else {
        await applyFavorite(storage, media, report);
      }
      tick("Importing favorites");
      await maybeYield(done, 25);
    }
  });

  await timer.time("Applying custom lists", async () => {
    for (const list of bundle.lists) {
      const mediaIds: string[] = [];
      report.totalListItems += list.items.length;
      for (const item of list.items) {
        const media = await resolver.resolve(
          item.ids,
          item.title,
          item.year,
          item.kind,
          item.match,
        );
        if (media) {
          mediaIds.push(media.id);
          report.matchedListItems++;
        } else {
          report.missingListItems++;
          report.skipped++;
          trackSkip(report, "No media match: list item not imported");
        }
      }
      await applyList(storage, list, mediaIds, report);
      tick("Importing lists");
      await maybeYield(done, 5);
    }
  });

  report.listsDiscovered = bundle.listDiagnostics.listsDiscovered;
  report.unmatchedListSKeys = [...bundle.listDiagnostics.unmatchedSKeys];
  report.droppedRecordsFound = bundle.droppedDiagnostics.archivedRowsFound;
  report.droppedMoviesFound = bundle.droppedDiagnostics.droppedMovies;
  report.droppedSeriesFound = bundle.droppedDiagnostics.droppedSeries;

  await timer.time("Applying dropped status", async () => {
    for (const dropped of bundle.dropped) {
      const media = await resolver.resolve(
        dropped.ids,
        dropped.title,
        dropped.year,
        dropped.kind,
        dropped.match,
      );
      if (!media) {
        report.skipped++;
        trackSkip(report, "No media match: dropped status not imported");
      } else {
        await applyDropped(storage, dropped, media, report);
      }
      tick("Importing dropped status");
      await maybeYield(done, 25);
    }
  });

  onProgress?.(0, 1, "Saving data");

  await timer.time("Status recalculation", async () => {
    let statusDone = 0;
    for (const mediaId of affectedSeries) {
      await recalculateAndPersistStatus(storage, mediaId);
      statusDone++;
      await maybeYield(statusDone, 25);
    }
  });

  let rewatchDone = 0;
  for (const mediaId of affectedSeries) {
    const wasComplete = wasSeriesCompleteBeforeImport.get(mediaId) ?? false;
    if (wasComplete) continue;
    const isCompleteNow = await isSeriesFullyWatched(storage, mediaId);
    if (!isCompleteNow) continue;
    const completionDate =
      seriesLatestWatchedDate.get(mediaId) ??
      new Date().toISOString().slice(0, 10);
    await addWatchSession(storage, {
      mediaId,
      watchDate: completionDate,
      activityAt: seriesLatestWatchedDate.get(mediaId),
    });
    rewatchDone++;
    onProgress?.(rewatchDone, affectedSeries.size, "Importing rewatches");
    await maybeYield(rewatchDone, 25);
  }

  await timer.time("Recent activity sync", async () => {
    let syncDone = 0;
    for (const [mediaId, at] of mediaLatestActivityDate) {
      await touchMediaActivity(storage, mediaId, at);
      syncDone++;
      onProgress?.(syncDone, mediaLatestActivityDate.size, "Saving data");
      await maybeYield(syncDone, 25);
    }
  });

  onProgress?.(1, 1, "Finalizing");

  for (const warning of bundle.warnings) {
    report.skipped++;
    trackSkip(report, warning.reason);
  }

  report.timing = timer.breakdown();
  return report;
}
