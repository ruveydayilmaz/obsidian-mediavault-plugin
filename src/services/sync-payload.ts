import type { StorageService } from "./storage";
import type { MediaItem } from "../models/media";
import type { WatchSession } from "../models/review";
import type {
  Episode,
  EpisodeProgress,
  EpisodeWatch,
} from "../models/episode";
import type { MovieProgress } from "../models/movie-progress";
import { DEFAULT_COMFORT_FLAGS, type ComfortProfile } from "../models/comfort";
import { computeAverageRating } from "./review-logic";

export const PAYLOAD_PREFIX = "<!-- mediavault:data ";
export const PAYLOAD_SUFFIX = " -->";
export const PAYLOAD_VERSION = 1;

export type PayloadEpisode = Pick<
  Episode,
  | "id"
  | "tmdbEpisodeId"
  | "seasonNumber"
  | "episodeNumber"
  | "title"
  | "runtime"
  | "airDate"
  | "thumbnailPath"
>;

export interface MediaSyncPayload {
  v: number;
  user: {
    status: MediaItem["status"];
    platform: string | null;
    isFavorite: boolean;
    liked: boolean;
    likedAt: string | null;
    droppedReason: string | null;
    notes: string;
    tags: string[];
  };
  sessions: WatchSession[];
  episodes: PayloadEpisode[];
  progress: Omit<EpisodeProgress, "mediaId">[];
  episodeWatches: Omit<EpisodeWatch, "mediaId">[];
  movieProgress: Omit<MovieProgress, "mediaId"> | null;
  comfort: Omit<ComfortProfile, "mediaId"> | null;
}

function strip<T extends { mediaId: string }>(
  rec: T,
): Omit<T, "mediaId"> {
  const { mediaId: _unused, ...rest } = rec;
  void _unused;
  return rest;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export async function buildMediaPayload(
  storage: StorageService,
  media: MediaItem,
): Promise<MediaSyncPayload> {
  const sessions = (
    await storage.watchSessions.findWhere((s) => s.mediaId === media.id)
  ).sort(
    (a, b) =>
      cmp(a.watchDate, b.watchDate) ||
      a.rewatchNumber - b.rewatchNumber ||
      cmp(a.id, b.id),
  );

  const progress = (await storage.episodeProgress.findByMediaId(media.id)).sort(
    (a, b) =>
      a.seasonNumber - b.seasonNumber ||
      a.episodeNumber - b.episodeNumber ||
      cmp(a.id, b.id),
  );
  const watches = (await storage.episodeWatches.findByMediaId(media.id)).sort(
    (a, b) =>
      cmp(a.episodeId, b.episodeId) ||
      cmp(a.watchedAt, b.watchedAt) ||
      cmp(a.id, b.id),
  );

  const referenced = new Set<string>();
  progress.forEach((p) => referenced.add(p.episodeId));
  watches.forEach((w) => referenced.add(w.episodeId));
  sessions.forEach((s) => s.episodeId && referenced.add(s.episodeId));
  const episodes = referenced.size
    ? (await storage.episodes.findByMediaId(media.id))
        .filter((e) => referenced.has(e.id))
        .sort(
          (a, b) =>
            a.seasonNumber - b.seasonNumber ||
            a.episodeNumber - b.episodeNumber,
        )
        .map(
          (e): PayloadEpisode => ({
            id: e.id,
            tmdbEpisodeId: e.tmdbEpisodeId,
            seasonNumber: e.seasonNumber,
            episodeNumber: e.episodeNumber,
            title: e.title,
            runtime: e.runtime,
            airDate: e.airDate,
            thumbnailPath: e.thumbnailPath,
          }),
        )
    : [];

  const movieProgress = await storage.movieProgress.findByMediaId(media.id);
  const comfort = await storage.comfortProfiles.findByMediaId(media.id);

  return {
    v: PAYLOAD_VERSION,
    user: {
      status: media.status,
      platform: media.platform,
      isFavorite: media.isFavorite,
      liked: media.liked,
      likedAt: media.likedAt,
      droppedReason: media.droppedReason,
      notes: media.notes,
      tags: media.tags,
    },
    sessions,
    episodes,
    progress: progress.map(strip),
    episodeWatches: watches.map(strip),
    movieProgress: movieProgress ? strip(movieProgress) : null,
    comfort: comfort ? strip(comfort) : null,
  };
}

export function serializePayload(payload: unknown): string {
  const json = JSON.stringify(payload)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
  return `${PAYLOAD_PREFIX}${json}${PAYLOAD_SUFFIX}`;
}

export function extractPayloadJson(content: string): unknown {
  const start = content.indexOf(PAYLOAD_PREFIX);
  if (start === -1) return null;
  const end = content.indexOf(PAYLOAD_SUFFIX, start + PAYLOAD_PREFIX.length);
  if (end === -1) return null;
  try {
    return JSON.parse(content.slice(start + PAYLOAD_PREFIX.length, end));
  } catch {
    return null;
  }
}

function clampScore(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(10, Math.max(1, Math.round(v)));
}

function sanitizeComfort(raw: unknown): MediaSyncPayload["comfort"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== "string" || typeof c.updatedAt !== "string") return null;
  const scores = {
    comfortScore: clampScore(c.comfortScore),
    energyLevel: clampScore(c.energyLevel),
    attentionLevel: clampScore(c.attentionLevel),
    emotionalHeaviness: clampScore(c.emotionalHeaviness),
    plotComplexity: clampScore(c.plotComplexity),
    rewatchability: clampScore(c.rewatchability),
  };
  if (Object.values(scores).some((v) => v === null)) return null;
  const flags = { ...DEFAULT_COMFORT_FLAGS };
  if (c.flags && typeof c.flags === "object" && !Array.isArray(c.flags)) {
    for (const key of Object.keys(flags) as (keyof typeof flags)[]) {
      const v = (c.flags as Record<string, unknown>)[key];
      if (typeof v === "boolean") flags[key] = v;
    }
  }
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    id: c.id,
    updatedAt: c.updatedAt,
    ...(scores as Record<keyof typeof scores, number>),
    flags,
    seasonalTags: strings(c.seasonalTags) as ComfortProfile["seasonalTags"],
    triggerWarnings: strings(c.triggerWarnings) as ComfortProfile["triggerWarnings"],
  };
}

export function parseMediaPayload(content: string): MediaSyncPayload | null {
  const raw = extractPayloadJson(content) as Partial<MediaSyncPayload> | null;
  if (!raw || typeof raw !== "object" || typeof raw.v !== "number") return null;
  if (!raw.user || typeof raw.user !== "object" || Array.isArray(raw.user)) {
    return null;
  }
  return {
    v: raw.v,
    user: raw.user,
    sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
    episodes: Array.isArray(raw.episodes) ? raw.episodes : [],
    progress: Array.isArray(raw.progress) ? raw.progress : [],
    episodeWatches: Array.isArray(raw.episodeWatches) ? raw.episodeWatches : [],
    movieProgress: raw.movieProgress ?? null,
    comfort: sanitizeComfort(raw.comfort),
  };
}

export interface PayloadApplyStats {
  changed: number;
  inserted: number;
  updated: number;
  adopted: number;
  unresolved: number;
}

export function syncDebug(label: string, data: unknown): void {
  try {
    if (window.localStorage.getItem("mediavault-debug-sync") === "1") {
      console.debug(`[MediaVault Sync] ${label}`, data);
    }
  } catch {
    // Storage unavailable
  }
}

const sessionPrint = (s: WatchSession, episodeId: string | null): string =>
  [episodeId ?? "", s.watchDate, s.rewatchNumber, s.rating ?? "", s.review ?? ""].join("|");

const watchPrint = (w: Omit<EpisodeWatch, "mediaId">, episodeId: string): string =>
  [episodeId, w.watchedAt, w.rating ?? "", w.emotion ?? "", w.review ?? "", w.notes ?? ""].join("|");

export async function applyMediaPayload(
  storage: StorageService,
  mediaId: string,
  payload: MediaSyncPayload,
  opts: { updatesOnly?: boolean } = {},
): Promise<PayloadApplyStats> {
  const stats: PayloadApplyStats = {
    changed: 0,
    inserted: 0,
    updated: 0,
    adopted: 0,
    unresolved: 0,
  };

  const adds = !opts.updatesOnly;
  const countBefore = {
    sessions: 0,
    progress: 0,
    watches: 0,
  };

  const existingEpisodes = await storage.episodes.findByMediaId(mediaId);
  const bySE = new Map(
    existingEpisodes.map((e) => [`${e.seasonNumber}:${e.episodeNumber}`, e]),
  );
  const idMap = new Map<string, string>();
  for (const pe of payload.episodes) {
    const hit = bySE.get(`${pe.seasonNumber}:${pe.episodeNumber}`);
    if (hit) {
      idMap.set(pe.id, hit.id);
      continue;
    }
    if (!adds) continue;
    const ep: Episode = {
      id: pe.id,
      mediaId,
      tmdbEpisodeId: pe.tmdbEpisodeId ?? null,
      seasonNumber: pe.seasonNumber,
      episodeNumber: pe.episodeNumber,
      title: pe.title ?? "",
      runtime: pe.runtime ?? null,
      airDate: pe.airDate ?? null,
      synopsis: null,
      thumbnailPath: pe.thumbnailPath ?? null,
      tmdbRating: null,
    };
    if (await storage.episodes.upsertRaw(ep)) {
      stats.changed++;
      stats.inserted++;
    }
    bySE.set(`${pe.seasonNumber}:${pe.episodeNumber}`, ep);
    idMap.set(pe.id, pe.id);
  }
  const mapEp = (id: string): string => idMap.get(id) ?? id;

  const sessions = await storage.watchSessions.findWhere(
    (s) => s.mediaId === mediaId,
  );
  countBefore.sessions = sessions.length;
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const incomingSessionIds = new Set(payload.sessions.map((s) => s.id));
  const claimedSessions = new Set<string>();
  for (const incoming of payload.sessions) {
    const episodeId = incoming.episodeId ? mapEp(incoming.episodeId) : null;
    const rec: WatchSession = { ...incoming, mediaId, episodeId };
    const local = sessionById.get(incoming.id);
    let action = "skip";
    if (local) {
      claimedSessions.add(local.id);
      if (incoming.updatedAt > local.updatedAt) {
        if (await storage.watchSessions.upsertRaw(rec)) {
          stats.changed++;
          stats.updated++;
          action = "update";
        }
      }
    } else if (adds) {
      const print = sessionPrint(rec, episodeId);
      const twin = sessions.find(
        (s) =>
          !incomingSessionIds.has(s.id) &&
          !claimedSessions.has(s.id) &&
          sessionPrint(s, s.episodeId) === print,
      );
      if (twin) {
        claimedSessions.add(twin.id);
        const keep = twin.updatedAt > incoming.updatedAt ? twin : rec;
        await storage.watchSessions.delete(twin.id);
        await storage.watchSessions.upsertRaw({ ...keep, id: incoming.id, mediaId, episodeId });
        stats.changed++;
        stats.adopted++;
        action = "adopt";
      } else {
        await storage.watchSessions.upsertRaw(rec);
        stats.changed++;
        stats.inserted++;
        action = "insert";
      }
    }
    syncDebug("session", { mediaId, event: incoming.id, episodeId, date: incoming.watchDate, existing: !!local, action });
  }

  const progress = await storage.episodeProgress.findByMediaId(mediaId);
  countBefore.progress = progress.length;
  const progressByEp = new Map(progress.map((p) => [p.episodeId, p]));
  for (const incoming of payload.progress) {
    const episodeId = mapEp(incoming.episodeId);
    const local = progressByEp.get(episodeId);
    let action = "skip";
    if (!local && adds) {
      await storage.episodeProgress.upsertRaw({ ...incoming, mediaId, episodeId });
      stats.changed++;
      stats.inserted++;
      action = "insert";
    } else if (local && incoming.updatedAt > local.updatedAt) {
      await storage.episodeProgress.upsertRaw({
        ...incoming,
        id: local.id,
        mediaId,
        episodeId,
      });
      stats.changed++;
      stats.updated++;
      action = "update";
    }
    syncDebug("episode-progress", { mediaId, episodeId, s: incoming.seasonNumber, e: incoming.episodeNumber, watched: incoming.watched, existing: !!local, action });
  }

  const watches = await storage.episodeWatches.findByMediaId(mediaId);
  countBefore.watches = watches.length;
  const watchById = new Map(watches.map((w) => [w.id, w]));
  const incomingWatchIds = new Set(payload.episodeWatches.map((w) => w.id));
  const claimedWatches = new Set<string>();
  for (const incoming of payload.episodeWatches) {
    const episodeId = mapEp(incoming.episodeId);
    const rec: EpisodeWatch = { ...incoming, mediaId, episodeId };
    const local = watchById.get(incoming.id);
    let action = "skip";
    if (local) {
      claimedWatches.add(local.id);
      if (incoming.updatedAt > local.updatedAt) {
        if (await storage.episodeWatches.upsertRaw(rec)) {
          stats.changed++;
          stats.updated++;
          action = "update";
        }
      }
    } else if (adds) {
      const print = watchPrint(incoming, episodeId);
      const twin = watches.find(
        (w) =>
          !incomingWatchIds.has(w.id) &&
          !claimedWatches.has(w.id) &&
          watchPrint(w, w.episodeId) === print,
      );
      if (twin) {
        claimedWatches.add(twin.id);
        const keep = twin.updatedAt > incoming.updatedAt ? twin : rec;
        await storage.episodeWatches.delete(twin.id);
        await storage.episodeWatches.upsertRaw({ ...keep, id: incoming.id, mediaId, episodeId });
        stats.changed++;
        stats.adopted++;
        action = "adopt";
      } else {
        await storage.episodeWatches.upsertRaw(rec);
        stats.changed++;
        stats.inserted++;
        action = "insert";
      }
    }
    syncDebug("episode-watch", { mediaId, event: incoming.id, episodeId, date: incoming.watchedAt, existing: !!local, action });
  }

  if (payload.movieProgress) {
    const local = await storage.movieProgress.findByMediaId(mediaId);
    if (
      (!local && adds) ||
      (local && payload.movieProgress.lastUpdated > local.lastUpdated)
    ) {
      const rec: MovieProgress = {
        ...payload.movieProgress,
        id: local?.id ?? payload.movieProgress.id,
        mediaId,
      };
      if (await storage.movieProgress.upsertRaw(rec)) stats.changed++;
    }
  }
  if (payload.comfort) {
    const local = await storage.comfortProfiles.findByMediaId(mediaId);
    if (
      (!local && adds) ||
      (local && payload.comfort.updatedAt > local.updatedAt)
    ) {
      const rec: ComfortProfile = {
        ...payload.comfort,
        id: local?.id ?? payload.comfort.id,
        mediaId,
      };
      if (await storage.comfortProfiles.upsertRaw(rec)) stats.changed++;
    }
  }

  if (adds) {
    const nowSessions = new Set(
      (await storage.watchSessions.findWhere((s) => s.mediaId === mediaId)).map((s) => s.id),
    );
    const nowWatches = new Set(
      (await storage.episodeWatches.findByMediaId(mediaId)).map((w) => w.id),
    );
    const nowProgress = new Set(
      (await storage.episodeProgress.findByMediaId(mediaId)).map((p) => p.episodeId),
    );
    for (const s of payload.sessions) if (!nowSessions.has(s.id)) stats.unresolved++;
    for (const w of payload.episodeWatches) if (!nowWatches.has(w.id)) stats.unresolved++;
    for (const p of payload.progress) if (!nowProgress.has(mapEp(p.episodeId))) stats.unresolved++;
  }

  syncDebug("media summary", {
    mediaId,
    folder: {
      sessions: payload.sessions.length,
      progress: payload.progress.length,
      watches: payload.episodeWatches.length,
      episodes: payload.episodes.length,
    },
    cacheBefore: countBefore,
    ...stats,
    hydrationComplete: stats.unresolved === 0,
  });
  return stats;
}

export async function deriveAggregates(
  storage: StorageService,
  mediaId: string,
): Promise<
  Pick<MediaItem, "averageRating" | "watchCount" | "lastWatchedDate">
> {
  const sessions = await storage.watchSessions.findWhere(
    (s) => s.mediaId === mediaId,
  );
  let last: string | null = null;
  for (const s of sessions) {
    if (!last || s.watchDate > last) last = s.watchDate;
  }
  return {
    averageRating: computeAverageRating(sessions),
    watchCount: sessions.length,
    lastWatchedDate: last,
  };
}

export async function noteMatchesCache(
  storage: StorageService,
  media: MediaItem,
  content: string,
): Promise<boolean> {
  const expected = serializePayload(await buildMediaPayload(storage, media));
  return content.includes(expected);
}
