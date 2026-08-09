import type { StorageService } from "./storage";
import type { TMDBService } from "../api/tmdb";
import { MediaItem } from "../models/media";
import { NotificationType } from "../models/notification";
import { MediaStatus, MediaType } from "../types/enums";
import { ENDED_TV_STATUSES } from "./status-service";
import { MediaVaultSettings } from "../settings/settings";
import { t } from "../i18n";

const RETURNING_TV_STATUSES: ReadonlySet<string> = new Set([
  "Returning Series",
  "In Production",
  "Planned",
  "Pilot",
]);

const REMINDER_COOLDOWN_DAYS = 14;
const WATCHLIST_STALE_DAYS = 30;
const CONTINUE_WATCHING_STALE_DAYS = 21;

function daysAgo(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function getNotificationBaselineDate(
  settings: Pick<
    MediaVaultSettings,
    "notificationPluginActivationDate" | "notificationDataImportDate"
  >,
): string | null {
  const {
    notificationPluginActivationDate: activation,
    notificationDataImportDate: imported,
  } = settings;
  if (activation && imported)
    return activation > imported ? activation : imported;
  return activation ?? imported ?? null;
}

function laterDateOnly(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

export function shouldRunDailyCheck(
  settings: MediaVaultSettings,
  now: Date = new Date(),
): boolean {
  const today = isoDateOnly(now);
  if (settings.notificationLastCheckedDate === today) return false;

  let localHours = now.getHours();
  let localMinutes = now.getMinutes();
  if (settings.notificationTimezone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: settings.notificationTimezone,
        hour: "numeric",
        minute: "numeric",
        hour12: false,
      }).formatToParts(now);
      localHours = parseInt(
        parts.find((p) => p.type === "hour")?.value ?? "0",
        10,
      );
      localMinutes = parseInt(
        parts.find((p) => p.type === "minute")?.value ?? "0",
        10,
      );
    } catch {
      // Invalid timezone string
    }
  }

  const [targetHour, targetMinute] = settings.notificationTime
    .split(":")
    .map((n) => parseInt(n, 10));
  const nowMinutes = localHours * 60 + localMinutes;
  const targetMinutes = (targetHour || 0) * 60 + (targetMinute || 0);
  return nowMinutes >= targetMinutes;
}

interface PendingNotification {
  type: NotificationType;
  mediaId: string;
  title: string;
  message: string;
}

export async function checkMetadataUpdates(
  storage: StorageService,
  tmdb: TMDBService,
  enabled: MediaVaultSettings["notificationsEnabled"],
  baselineDate: string | null = null,
): Promise<{
  pending: PendingNotification[];
  mediaUpdates: Map<string, Partial<MediaItem>>;
}> {
  const pending: PendingNotification[] = [];
  const mediaUpdates = new Map<string, Partial<MediaItem>>();
  const allMedia = await storage.media.getAll();

  const activeShows = allMedia.filter(
    (m) =>
      m.type === MediaType.TVShow &&
      m.status !== MediaStatus.Dropped &&
      m.status !== MediaStatus.Completed,
  );

  for (const show of activeShows) {
    let details;
    try {
      details = await tmdb.getTV(show.tmdbId);
    } catch {
      continue;
    }

    if (
      enabled.seriesReturned &&
      show.tvStatus &&
      ENDED_TV_STATUSES.has(show.tvStatus) &&
      details.tvStatus &&
      RETURNING_TV_STATUSES.has(details.tvStatus)
    ) {
      pending.push({
        type: "series_returned",
        mediaId: show.id,
        title: show.title,
        message: t("notifications.seriesReturnedMsg", { title: show.title }),
      });
    }

    if (details.tvStatus && details.tvStatus !== show.tvStatus) {
      mediaUpdates.set(show.id, {
        ...mediaUpdates.get(show.id),
        tvStatus: details.tvStatus,
      });
    }

    if ((enabled.newEpisode || enabled.newSeason) && details.seasons) {
      const knownEpisodes = await storage.episodes.findByMediaId(show.id);
      const knownMaxSeason = knownEpisodes.reduce(
        (max, e) => Math.max(max, e.seasonNumber),
        0,
      );

      const trackedSince = show.createdAt.slice(0, 10);
      const effectiveSince =
        laterDateOnly(trackedSince, baselineDate) ?? trackedSince;

      for (const season of details.seasons) {
        if (season.seasonNumber === 0) continue; // specials
        const seasonIsHistorical =
          season.airDate !== null && season.airDate < effectiveSince;
        if (seasonIsHistorical) continue;

        if (enabled.newSeason && season.seasonNumber > knownMaxSeason) {
          pending.push({
            type: "new_season",
            mediaId: show.id,
            title: show.title,
            message: t("notifications.newSeasonMsg", {
              title: show.title,
              season: season.seasonNumber,
            }),
          });
        } else if (
          enabled.newEpisode &&
          season.seasonNumber <= knownMaxSeason &&
          season.episodeCount > 0
        ) {
          const knownInSeason = knownEpisodes.filter(
            (e) => e.seasonNumber === season.seasonNumber,
          ).length;
          if (season.episodeCount > knownInSeason) {
            pending.push({
              type: "new_episode",
              mediaId: show.id,
              title: show.title,
              message: t("notifications.newEpisodeMsg", { title: show.title }),
            });
          }
        }
      }
    }
  }

  if (enabled.movieReleased) {
    const pendingMovies = allMedia.filter(
      (m) =>
        m.type === MediaType.Movie &&
        m.releaseDate !== null &&
        new Date(m.releaseDate).getTime() > Date.now(),
    );
    for (const movie of pendingMovies) {
      let details;
      try {
        details = await tmdb.getMovie(movie.tmdbId);
      } catch {
        continue;
      }
      const releasedNow =
        details.releaseDate &&
        new Date(details.releaseDate).getTime() <= Date.now();

      const releaseIsPreBaseline =
        baselineDate !== null &&
        details.releaseDate !== null &&
        details.releaseDate < baselineDate;
      if (releasedNow && !releaseIsPreBaseline) {
        pending.push({
          type: "movie_released",
          mediaId: movie.id,
          title: movie.title,
          message: t("notifications.movieReleasedMsg", { title: movie.title }),
        });
      }
      if (details.releaseDate && details.releaseDate !== movie.releaseDate) {
        mediaUpdates.set(movie.id, {
          ...mediaUpdates.get(movie.id),
          releaseDate: details.releaseDate,
        });
      }
    }
  }

  return { pending, mediaUpdates };
}

export function checkReminders(
  allMedia: MediaItem[],
  enabled: MediaVaultSettings["notificationsEnabled"],
  now: Date = new Date(),
): PendingNotification[] {
  const pending: PendingNotification[] = [];

  if (enabled.watchlistReminder) {
    for (const m of allMedia) {
      if (
        m.status !== MediaStatus.PlanToWatch &&
        m.status !== MediaStatus.WatchLater
      )
        continue;
      if (daysAgo(m.createdAt, now) < WATCHLIST_STALE_DAYS) continue;
      pending.push({
        type: "watchlist_reminder",
        mediaId: m.id,
        title: m.title,
        message: t("notifications.watchlistReminderMsg", { title: m.title }),
      });
    }
  }

  if (enabled.continueWatchingReminder) {
    for (const m of allMedia) {
      if (m.status !== MediaStatus.Watching) continue;
      if (daysAgo(m.updatedAt, now) < CONTINUE_WATCHING_STALE_DAYS) continue;
      pending.push({
        type: "continue_watching_reminder",
        mediaId: m.id,
        title: m.title,
        message: t("notifications.continueWatchingReminderMsg", {
          title: m.title,
        }),
      });
    }
  }

  return pending;
}

const RECURRING_TYPES: ReadonlySet<NotificationType> = new Set([
  "watchlist_reminder",
  "continue_watching_reminder",
]);

export async function runNotificationCheck(
  storage: StorageService,
  tmdb: TMDBService,
  settings: MediaVaultSettings,
  now: Date = new Date(),
): Promise<PendingNotification[]> {
  const baselineDate = getNotificationBaselineDate(settings);

  const { pending: metadataPending, mediaUpdates } = await checkMetadataUpdates(
    storage,
    tmdb,
    settings.notificationsEnabled,
    baselineDate,
  );

  for (const [mediaId, patch] of mediaUpdates) {
    await storage.media.update(mediaId, patch);
  }

  const allMedia = await storage.media.getAll();
  const reminderPending = checkReminders(
    allMedia,
    settings.notificationsEnabled,
    now,
  );

  const toFire: PendingNotification[] = [];
  const cooldownSince = new Date(
    now.getTime() - REMINDER_COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  for (const n of [...metadataPending, ...reminderPending]) {
    const isDuplicate = RECURRING_TYPES.has(n.type)
      ? await storage.notifications.notifiedSince(
          n.type,
          n.mediaId,
          cooldownSince,
        )
      : await storage.notifications.alreadyNotified(n.type, n.mediaId);
    if (isDuplicate) continue;
    await storage.notifications.record(n.type, n.mediaId, n.title, n.message);
    toFire.push(n);
  }

  return toFire;
}
