import type { App } from "obsidian";
import { t } from "../i18n";
import type { StorageService } from "./storage";
import { MediaItem } from "../models/media";
import { MediaType } from "../types/enums";
import { MediaVaultId } from "../types/common";
import { removeLocalImageIfAny } from "./local-image-service";

export interface MediaDeletionSummary {
  mediaTitle: string;
  watchSessions: number;
  episodes: number;
  episodeProgress: number;
  episodeWatches: number;
  comfortProfileRemoved: boolean;
  listsAffected: number;
  noteDeleted: boolean;
  notifications: number;
}

export async function deleteMedia(
  app: App,
  storage: StorageService,
  mediaId: MediaVaultId,
): Promise<MediaDeletionSummary | null> {
  const media = await storage.media.findById(mediaId);
  if (!media) return null;

  const watchSessions = await storage.watchSessions.deleteByMediaId(mediaId);

  let episodes = 0;
  let episodeProgress = 0;
  let episodeWatches = 0;
  if (media.type === MediaType.TVShow) {
    episodes = await storage.episodes.deleteByMediaId(mediaId);
    episodeProgress = await storage.episodeProgress.deleteByMediaId(mediaId);
    episodeWatches = await storage.episodeWatches.deleteByMediaId(mediaId);
  }

  const comfortProfileRemoved =
    await storage.comfortProfiles.deleteByMediaId(mediaId);
  const notifications = await storage.notifications.deleteByMediaId(mediaId);
  const listsAffected =
    await storage.customLists.removeMediaEverywhere(mediaId);
  const noteDeleted = await deleteMediaNote(app, media);
  if (media.type === MediaType.Movie) {
    await storage.movieProgress.deleteByMediaId(mediaId);
  }
  await removeLocalImageIfAny(media.posterPath);
  await removeLocalImageIfAny(media.backdropPath);

  await storage.media.delete(mediaId);

  return {
    mediaTitle: media.title,
    watchSessions,
    episodes,
    episodeProgress,
    episodeWatches,
    comfortProfileRemoved,
    listsAffected,
    noteDeleted,
    notifications,
  };
}

async function deleteMediaNote(app: App, media: MediaItem): Promise<boolean> {
  if (!media.notePath) return false;
  const file = app.vault.getAbstractFileByPath(media.notePath);
  if (!file) return false;
  try {
    await app.fileManager.trashFile(file);
    return true;
  } catch (err) {
    console.warn(`MediaVault: failed to delete note for "${media.title}"`, err);
    return false;
  }
}

export function describeDeletionScope(media: MediaItem): string[] {
  const lines = [
    t("detail.deletionScopeWatchHistory"),
    t("detail.deletionScopeReviews"),
    t("detail.deletionScopeRatings"),
  ];
  if (media.type === MediaType.TVShow) {
    lines.push(t("detail.deletionScopeEpisodeProgress"));
    lines.push(t("detail.deletionScopeEpisodeWatchHistory"));
  }
  if (media.type === MediaType.Movie) {
    lines.push(t("detail.deletionScopePartialWatchProgress"));
  }
  lines.push(t("detail.deletionScopeFavoritesStatus"));
  if (media.notePath) lines.push(t("detail.deletionScopeGeneratedNote"));
  lines.push(t("detail.deletionScopeListReferences"));
  return lines;
}
