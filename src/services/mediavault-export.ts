import type { App } from "obsidian";
import { TFile } from "obsidian";
import type { StorageService } from "./storage";
import type { MediaItem } from "../models/media";
import type { WatchSession } from "../models/review";
import type { Episode, EpisodeProgress, EpisodeWatch } from "../models/episode";
import type { ComfortProfile, ComfortPreset } from "../models/comfort";
import type { CustomList } from "../models/list";
import type { MediaVaultSettings } from "../settings/settings";
import { MediaStatus } from "../types/enums";
import { MediaType } from "../types/enums";
import {
  resolveMediaFolder,
  resolveMediaNotePath,
} from "./note-generator/media-note-generator";
import { syncMediaAggregates } from "./watch-session-service";
import { recalculateAndPersistStatus } from "./status-service";
import { maybeYield } from "./importer/yield";

export const MEDIAVAULT_EXPORT_FORMAT = "mediavault-export";
export const MEDIAVAULT_EXPORT_VERSION = 1;

export interface MediaVaultExportNote {
  relativePath: string;
  content: string;
}

export interface MediaVaultExportItem {
  media: MediaItem;
  watchSessions: WatchSession[];
  episodes: Episode[];
  episodeProgress: EpisodeProgress[];
  episodeWatches: EpisodeWatch[];
  comfortProfile: ComfortProfile | null;
  note: MediaVaultExportNote | null;
}

export const SETTINGS_EXPORT_WHITELIST: (keyof MediaVaultSettings)[] = [
  "language",
  "tmdbLanguage",
  "traktAutoSync",
  "traktSyncIntervalMinutes",
  "mediaFolderPath",
  "autoCreateNotes",
  "defaultView",
  "defaultSort",
  "defaultSortDirection",
  "ratingScale",
  "cacheDurationMinutes",
  "episodeSyncIntervalHours",
  "watchNextSidebarCollapsed",
  "watchNextUpcomingTab",
  "notificationsEnabled",
  "notificationTime",
  "notificationSilent",
  "notificationTimezone",
  "commentsPrimaryLanguage",
  "commentsAdditionalLanguages",
  "showAdultContent",
  "favoriteListSortModes",
  "noteTemplate",
];

export interface MediaVaultSettingsExport {
  type: "mediavault-settings";
  version: 1;
  settings: Partial<MediaVaultSettings>;
}

export function buildSettingsExport(
  storage: StorageService,
): MediaVaultSettingsExport {
  const current = storage.settings.get();
  const settings: Partial<MediaVaultSettings> = {};
  for (const key of SETTINGS_EXPORT_WHITELIST) {
    (settings as Record<string, unknown>)[key] = current[key];
  }
  return { type: "mediavault-settings", version: 1, settings };
}

export async function applySettingsImport(
  storage: StorageService,
  settingsExport: MediaVaultSettingsExport,
): Promise<number> {
  if (settingsExport.version > 1) {
    throw new Error("UNSUPPORTED_EXPORT_VERSION");
  }
  const patch: Partial<MediaVaultSettings> = {};
  let count = 0;
  for (const key of SETTINGS_EXPORT_WHITELIST) {
    const value = settingsExport.settings[key];
    if (value === undefined) continue;
    (patch as Record<string, unknown>)[key] = value;
    count++;
  }
  if (count > 0) await storage.settings.update(patch);
  return count;
}

export interface MediaVaultExportFile {
  mediavault: true;
  mediavault_export_format: string;
  mediavault_export_version: number;
  mediavault_plugin_version?: string;
  exportedAt: string;
  itemCount: number;
  items: MediaVaultExportItem[];

  lists: CustomList[];
  comfortPresets: ComfortPreset[];

  settingsPreferences?: MediaVaultSettingsExport | null;
}

export function isMediaVaultExport(
  data: unknown,
): data is MediaVaultExportFile {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    d.mediavault === true &&
    d.mediavault_export_format === MEDIAVAULT_EXPORT_FORMAT &&
    typeof d.mediavault_export_version === "number" &&
    Array.isArray(d.items)
  );
}

const EXPORT_YIELD_EVERY = 25;

async function readNoteIfExists(
  app: App,
  storage: StorageService,
  media: MediaItem,
): Promise<MediaVaultExportNote | null> {
  if (!media.notePath) return null;
  const file = app.vault.getAbstractFileByPath(media.notePath);
  if (!(file instanceof TFile)) return null;

  const baseFolder = storage.settings.get().mediaFolderPath || "MediaVault";
  const folder = resolveMediaFolder(baseFolder, media.type);
  const relativePath = media.notePath.startsWith(`${folder}/`)
    ? media.notePath.slice(folder.length + 1)
    : (media.notePath.split("/").pop() ?? media.notePath);

  const content = await app.vault.adapter.read(media.notePath);
  return { relativePath, content };
}

export type ExportProgressCallback = (done: number, total: number) => void;

export interface ExportCategoryOptions {
  includeWatchHistory: boolean;
  includeLists: boolean;
  includeSettings: boolean;
}

const DEFAULT_EXPORT_CATEGORIES: ExportCategoryOptions = {
  includeWatchHistory: true,
  includeLists: true,
  includeSettings: false,
};

export async function buildMediaVaultExport(
  app: App,
  storage: StorageService,
  mediaItems: MediaItem[],
  onProgress?: ExportProgressCallback,
  categories: ExportCategoryOptions = DEFAULT_EXPORT_CATEGORIES,
): Promise<MediaVaultExportFile> {
  const items: MediaVaultExportItem[] = [];

  for (let i = 0; i < mediaItems.length; i++) {
    const media = mediaItems[i];
    const [watchSessions, episodes, episodeProgress, episodeWatches, comfortProfiles, note] =
      categories.includeWatchHistory
        ? await Promise.all([
            storage.watchSessions.findWhere((s) => s.mediaId === media.id),
            storage.episodes.findWhere((e) => e.mediaId === media.id),
            storage.episodeProgress.findWhere((p) => p.mediaId === media.id),
            storage.episodeWatches.findWhere((w) => w.mediaId === media.id),
            storage.comfortProfiles.findWhere((c) => c.mediaId === media.id),
            readNoteIfExists(app, storage, media),
          ])
        : await Promise.all([
            Promise.resolve([] as WatchSession[]),
            storage.episodes.findWhere((e) => e.mediaId === media.id),
            Promise.resolve([] as EpisodeProgress[]),
            Promise.resolve([] as EpisodeWatch[]),
            storage.comfortProfiles.findWhere((c) => c.mediaId === media.id),
            readNoteIfExists(app, storage, media),
          ]);

    items.push({
      media,
      watchSessions,
      episodes,
      episodeProgress,
      episodeWatches,
      comfortProfile: comfortProfiles[0] ?? null,
      note,
    });

    onProgress?.(i + 1, mediaItems.length);
    await maybeYield(i + 1, EXPORT_YIELD_EVERY);
  }

  let lists: CustomList[] = [];
  let comfortPresets: ComfortPreset[] = [];
  if (categories.includeLists) {
    const exportedMediaIds = new Set(mediaItems.map((m) => m.id));
    const allLists = await storage.customLists.getAll();
    lists = allLists.filter((list) =>
      list.mediaIds.some((id) => exportedMediaIds.has(id)),
    );
    const allPresets = await storage.comfortPresets.getAll();
    comfortPresets = allPresets.filter((p) => !p.isBuiltIn);
  }

  const settingsPreferences = categories.includeSettings
    ? buildSettingsExport(storage)
    : null;

  return {
    mediavault: true,
    mediavault_export_format: MEDIAVAULT_EXPORT_FORMAT,
    mediavault_export_version: MEDIAVAULT_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    itemCount: items.length,
    items,
    lists,
    comfortPresets,
    settingsPreferences,
  };
}

async function ensureFolderExists(app: App, folderPath: string): Promise<void> {
  const parts = folderPath.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current).catch(() => {
        // Already exists
      });
    }
  }
}

export async function exportMediaToVault(
  app: App,
  storage: StorageService,
  mediaItems: MediaItem[],
  onProgress?: ExportProgressCallback,
  categories: ExportCategoryOptions = DEFAULT_EXPORT_CATEGORIES,
): Promise<string> {
  const data = await buildMediaVaultExport(app, storage, mediaItems, onProgress, categories);
  const baseFolder = storage.settings.get().mediaFolderPath || "MediaVault";
  const exportsFolder = `${baseFolder.replace(/\/+$/, "")}/Exports`;
  await ensureFolderExists(app, exportsFolder);

  const stamp = data.exportedAt.replace(/[:.]/g, "-");
  const path = `${exportsFolder}/mediavault-export-${stamp}.json`;
  await app.vault.create(path, JSON.stringify(data, null, 2));
  return path;
}

export interface ImportSummary {
  mediaCreated: number;
  mediaUpdated: number;
  episodesAdded: number;
  episodesUpdated: number;
  progressAdded: number;
  progressUpdated: number;
  watchSessionsMerged: number;
  episodeWatchesMerged: number;
  notesReconnected: number;
  listsCreated: number;
  listsUpdated: number;
  listMembershipsAdded: number;
  presetsAdded: number;
  settingsApplied: number;
  skipped: number;
  errors: { title: string; message: string }[];
}

function emptySummary(): ImportSummary {
  return {
    mediaCreated: 0,
    mediaUpdated: 0,
    episodesAdded: 0,
    episodesUpdated: 0,
    progressAdded: 0,
    progressUpdated: 0,
    watchSessionsMerged: 0,
    episodeWatchesMerged: 0,
    notesReconnected: 0,
    listsCreated: 0,
    listsUpdated: 0,
    listMembershipsAdded: 0,
    presetsAdded: 0,
    settingsApplied: 0,
    skipped: 0,
    errors: [],
  };
}

function isValidExportItem(item: unknown): item is MediaVaultExportItem {
  if (!item || typeof item !== "object") return false;
  const i = item as Record<string, unknown>;
  const media = i.media as Record<string, unknown> | undefined;
  return (
    !!media &&
    typeof media.id === "string" &&
    media.id.length > 0 &&
    typeof media.tmdbId === "number" &&
    typeof media.type === "string" &&
    typeof media.title === "string" &&
    Array.isArray(i.watchSessions) &&
    Array.isArray(i.episodes) &&
    Array.isArray(i.episodeProgress) &&
    Array.isArray(i.episodeWatches)
  );
}

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "boolean") return v === false;
  return false;
}

function fillMissing<T extends object>(
  existing: T,
  imported: T,
  fields: (keyof T)[],
): Partial<T> {
  const patch: Partial<T> = {};
  for (const f of fields) {
    if (isEmptyValue(existing[f]) && !isEmptyValue(imported[f])) {
      patch[f] = imported[f];
    }
  }
  return patch;
}

const MEDIA_METADATA_FILL_FIELDS: (keyof MediaItem)[] = [
  "tvdbId",
  "imdbId",
  "tvTimeUuid",
  "originalTitle",
  "year",
  "releaseDate",
  "genres",
  "genreIds",
  "runtime",
  "posterPath",
  "backdropPath",
  "cast",
  "crew",
  "productionCompanies",
  "language",
  "country",
  "synopsis",
  "tvStatus",
  "streamingAvailability",
  "droppedReason",
  "platform",
  "notes",
  "tags",
];

function mergeMediaScalars(
  existing: MediaItem,
  imported: MediaItem,
): Partial<MediaItem> {
  const patch = fillMissing(existing, imported, MEDIA_METADATA_FILL_FIELDS);

  if (existing.status === MediaStatus.PlanToWatch && imported.status !== MediaStatus.PlanToWatch) {
    patch.status = imported.status;
  }
  if (!existing.isFavorite && imported.isFavorite) patch.isFavorite = true;
  if (!existing.liked && imported.liked) {
    patch.liked = true;
    if (imported.likedAt) patch.likedAt = imported.likedAt;
  }

  return patch;
}

const EPISODE_METADATA_FILL_FIELDS: (keyof Episode)[] = [
  "tmdbEpisodeId",
  "title",
  "runtime",
  "airDate",
  "synopsis",
  "thumbnailPath",
  "tmdbRating",
];

function episodeKey(seasonNumber: number, episodeNumber: number): string {
  return `${seasonNumber}:${episodeNumber}`;
}

interface EpisodeReconcileResult {
  idRemap: Map<string, string>;
  added: number;
  updated: number;
}

async function reconcileEpisodes(
  storage: StorageService,
  localMediaId: string,
  importedEpisodes: Episode[],
): Promise<EpisodeReconcileResult> {
  const localEpisodes = await storage.episodes.findWhere(
    (e) => e.mediaId === localMediaId,
  );
  const byKey = new Map<string, Episode>();
  const byTmdbId = new Map<number, Episode>();
  for (const ep of localEpisodes) {
    byKey.set(episodeKey(ep.seasonNumber, ep.episodeNumber), ep);
    if (ep.tmdbEpisodeId !== null) byTmdbId.set(ep.tmdbEpisodeId, ep);
  }

  const idRemap = new Map<string, string>();
  let added = 0;
  let updated = 0;

  for (const imported of importedEpisodes) {
    const match =
      byKey.get(episodeKey(imported.seasonNumber, imported.episodeNumber)) ??
      (imported.tmdbEpisodeId !== null
        ? byTmdbId.get(imported.tmdbEpisodeId)
        : undefined);

    if (match) {
      idRemap.set(imported.id, match.id);
      const patch = fillMissing(match, imported, EPISODE_METADATA_FILL_FIELDS);
      if (Object.keys(patch).length > 0) {
        await storage.episodes.update(match.id, patch);
        updated++;
      }
      continue;
    }

    const created = await storage.episodes.save({
      ...imported,
      mediaId: localMediaId,
    });
    idRemap.set(imported.id, created.id);
    added++;
  }

  return { idRemap, added, updated };
}

const PROGRESS_USER_FIELDS: (keyof EpisodeProgress)[] = [
  "rating",
  "review",
  "emotion",
  "comfortNote",
];

interface ProgressReconcileResult {
  added: number;
  updated: number;
}

async function reconcileEpisodeProgress(
  storage: StorageService,
  localMediaId: string,
  importedProgress: EpisodeProgress[],
  episodeIdRemap: Map<string, string>,
): Promise<ProgressReconcileResult> {
  const localProgress = await storage.episodeProgress.findWhere(
    (p) => p.mediaId === localMediaId,
  );
  const byEpisodeId = new Map(localProgress.map((p) => [p.episodeId, p]));

  let added = 0;
  let updated = 0;

  for (const imported of importedProgress) {
    const localEpisodeId =
      episodeIdRemap.get(imported.episodeId) ?? imported.episodeId;
    const existing = byEpisodeId.get(localEpisodeId);

    if (!existing) {
      await storage.episodeProgress.save({
        ...imported,
        mediaId: localMediaId,
        episodeId: localEpisodeId,
      });
      added++;
      continue;
    }

    const finalWatched = existing.watched || imported.watched;
    const importIsNewer = imported.updatedAt > existing.updatedAt;

    const patch: Partial<EpisodeProgress> = {};
    if (finalWatched !== existing.watched) patch.watched = finalWatched;
    if (finalWatched && !existing.watched && imported.watchedDate) {
      patch.watchedDate = imported.watchedDate;
    }
    if (!finalWatched) {
      patch.watchedDate = null;
    }
    if (!existing.isFavorite && imported.isFavorite) patch.isFavorite = true;
    if (!existing.liked && imported.liked) {
      patch.liked = true;
      if (imported.likedAt) patch.likedAt = imported.likedAt;
    }
    if (importIsNewer) {
      for (const f of PROGRESS_USER_FIELDS) {
        if (!isEmptyValue(imported[f])) (patch as Record<string, unknown>)[f] = imported[f];
      }
    }

    if (Object.keys(patch).length > 0) {
      await storage.episodeProgress.update(existing.id, patch);
      updated++;
    }
  }

  return { added, updated };
}

const COMFORT_PROFILE_MERGE_FIELDS: (keyof ComfortProfile)[] = [
  "comfortScore",
  "energyLevel",
  "attentionLevel",
  "emotionalHeaviness",
  "plotComplexity",
  "rewatchability",
  "flags",
  "seasonalTags",
  "triggerWarnings",
];

async function reconcileComfortProfile(
  storage: StorageService,
  localMediaId: string,
  imported: ComfortProfile,
): Promise<void> {
  const existing = await storage.comfortProfiles.findByMediaId(localMediaId);
  if (!existing) {
    await storage.comfortProfiles.save({ ...imported, mediaId: localMediaId });
    return;
  }
  if (imported.updatedAt <= existing.updatedAt) return;

  const patch: Partial<ComfortProfile> = {};
  for (const f of COMFORT_PROFILE_MERGE_FIELDS) {
    (patch as Record<string, unknown>)[f] = imported[f];
  }
  await storage.comfortProfiles.update(existing.id, patch);
}

async function mergeAdditiveById<T extends { id: string }>(
  incoming: T[],
  findById: (id: string) => Promise<T | null>,
  save: (record: T) => Promise<T>,
): Promise<number> {
  let addedCount = 0;
  for (const record of incoming) {
    const existing = await findById(record.id);
    if (existing) continue;
    await save(record);
    addedCount++;
  }
  return addedCount;
}

async function reconcileComfortPresets(
  storage: StorageService,
  presets: ComfortPreset[],
): Promise<number> {
  return mergeAdditiveById(
    presets,
    (id) => storage.comfortPresets.findById(id),
    (r) => storage.comfortPresets.save(r),
  );
}

async function reconcileLists(
  storage: StorageService,
  lists: CustomList[],
  mediaIdRemap: Map<string, string>,
): Promise<{ created: number; updated: number; membershipsAdded: number }> {
  let created = 0;
  let updated = 0;
  let membershipsAdded = 0;

  const LIST_METADATA_FILL_FIELDS: (keyof CustomList)[] = [
    "description",
    "posterUrl",
    "bannerUrl",
  ];

  for (const importedList of lists) {
    const remappedMemberIds = importedList.mediaIds
      .map((id) => mediaIdRemap.get(id) ?? id)
      .filter((id, index, arr) => arr.indexOf(id) === index);

    const existing = await storage.customLists.findById(importedList.id);

    if (!existing) {
      const resolvable: string[] = [];
      for (const id of remappedMemberIds) {
        if (await storage.media.findById(id)) resolvable.push(id);
      }
      await storage.customLists.save({
        ...importedList,
        mediaIds: resolvable,
      });
      created++;
      continue;
    }

    const metadataPatch = fillMissing(existing, importedList, LIST_METADATA_FILL_FIELDS);
    const newMemberIds: string[] = [];
    for (const id of remappedMemberIds) {
      if (existing.mediaIds.includes(id)) continue;
      if (await storage.media.findById(id)) newMemberIds.push(id);
    }

    if (newMemberIds.length > 0) {
      metadataPatch.mediaIds = [...existing.mediaIds, ...newMemberIds];
      membershipsAdded += newMemberIds.length;
    }

    if (Object.keys(metadataPatch).length > 0) {
      await storage.customLists.update(existing.id, metadataPatch);
      updated++;
    }
  }

  return { created, updated, membershipsAdded };
}

const IMPORT_YIELD_EVERY = 10;

export interface ImportProgressCallback {
  (done: number, total: number): void;
}

export interface ImportCategoryOptions {
  includeMovies: boolean;
  includeTVShows: boolean;
  includeWatchHistory: boolean;
  includeLists: boolean;
  includeSettings: boolean;
}

export const DEFAULT_IMPORT_CATEGORIES: ImportCategoryOptions = {
  includeMovies: true,
  includeTVShows: true,
  includeWatchHistory: true,
  includeLists: true,
  includeSettings: false,
};

export interface ExportContents {
  hasMovies: boolean;
  hasTVShows: boolean;
  hasWatchHistory: boolean;
  hasLists: boolean;
  hasSettings: boolean;
  movieCount: number;
  tvCount: number;
}

export function describeExportContents(
  data: MediaVaultExportFile,
): ExportContents {
  const movieCount = data.items.filter((i) => i.media?.type === MediaType.Movie).length;
  const tvCount = data.items.filter((i) => i.media?.type === MediaType.TVShow).length;
  const hasWatchHistory = data.items.some(
    (i) => i.watchSessions?.length > 0 || i.episodeWatches?.length > 0,
  );
  return {
    hasMovies: movieCount > 0,
    hasTVShows: tvCount > 0,
    hasWatchHistory,
    hasLists: (data.lists?.length ?? 0) > 0 || (data.comfortPresets?.length ?? 0) > 0,
    hasSettings: !!data.settingsPreferences,
    movieCount,
    tvCount,
  };
}

export async function importMediaVaultExport(
  app: App,
  storage: StorageService,
  raw: string,
  onProgress?: ImportProgressCallback,
  categories: ImportCategoryOptions = DEFAULT_IMPORT_CATEGORIES,
): Promise<ImportSummary> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!isMediaVaultExport(parsed)) {
    throw new Error("NOT_MEDIAVAULT_EXPORT");
  }

  if (parsed.mediavault_export_version > MEDIAVAULT_EXPORT_VERSION) {
    throw new Error("UNSUPPORTED_EXPORT_VERSION");
  }

  const summary = emptySummary();
  const baseFolder = storage.settings.get().mediaFolderPath || "MediaVault";
  const itemsToProcess = parsed.items.filter((item) => {
    const type = item?.media?.type;
    if (type === MediaType.Movie) return categories.includeMovies;
    if (type === MediaType.TVShow) return categories.includeTVShows;
    return true;
  });
  const total = itemsToProcess.length;
  const mediaIdRemap = new Map<string, string>();

  for (let i = 0; i < itemsToProcess.length; i++) {
    const item = itemsToProcess[i];

    if (!isValidExportItem(item)) {
      summary.skipped++;
      summary.errors.push({
        title: "(unknown)",
        message: "Missing required fields (media id, tmdb id, type, title, or sub-record arrays).",
      });
      onProgress?.(i + 1, total);
      continue;
    }

    try {
      const existing =
        (await storage.media.findById(item.media.id)) ??
        (
          await storage.media.findWhere(
            (m) => m.tmdbId === item.media.tmdbId && m.type === item.media.type,
          )
        )[0] ??
        null;

      if (existing) {
        mediaIdRemap.set(item.media.id, existing.id);

        const scalarPatch = mergeMediaScalars(existing, item.media);
        if (Object.keys(scalarPatch).length > 0) {
          await storage.media.update(existing.id, scalarPatch);
          summary.mediaUpdated++;
        }

        const { idRemap, added: epAdded, updated: epUpdated } =
          await reconcileEpisodes(storage, existing.id, item.episodes);
        summary.episodesAdded += epAdded;
        summary.episodesUpdated += epUpdated;

        let progAdded = 0;
        let progUpdated = 0;
        let sessionsMergedThisItem = 0;
        let watchesMergedThisItem = 0;

        if (categories.includeWatchHistory) {
          const progResult = await reconcileEpisodeProgress(
            storage,
            existing.id,
            item.episodeProgress,
            idRemap,
          );
          progAdded = progResult.added;
          progUpdated = progResult.updated;
          summary.progressAdded += progAdded;
          summary.progressUpdated += progUpdated;

          const remappedWatches = item.episodeWatches.map((w) => ({
            ...w,
            mediaId: existing.id,
            episodeId: idRemap.get(w.episodeId) ?? w.episodeId,
          }));
          watchesMergedThisItem = await mergeAdditiveById(
            remappedWatches,
            (id) => storage.episodeWatches.findById(id),
            (r) => storage.episodeWatches.save(r),
          );
          summary.episodeWatchesMerged += watchesMergedThisItem;

          const remappedSessions = item.watchSessions.map((s) => ({
            ...s,
            mediaId: existing.id,
            episodeId: s.episodeId ? (idRemap.get(s.episodeId) ?? s.episodeId) : null,
          }));
          sessionsMergedThisItem = await mergeAdditiveById(
            remappedSessions,
            (id) => storage.watchSessions.findById(id),
            (r) => storage.watchSessions.save(r),
          );
          summary.watchSessionsMerged += sessionsMergedThisItem;
        }

        if (sessionsMergedThisItem > 0 || progAdded + progUpdated > 0) {
          await syncMediaAggregates(storage, existing.id);
          await recalculateAndPersistStatus(storage, existing.id);
        }

        if (item.comfortProfile) {
          await reconcileComfortProfile(storage, existing.id, item.comfortProfile);
        }

        if (!existing.notePath && item.note) {
          const notePath = resolveMediaNotePath(baseFolder, existing);
          await ensureFolderExists(app, resolveMediaFolder(baseFolder, existing.type));
          if (!app.vault.getAbstractFileByPath(notePath)) {
            await app.vault.create(notePath, item.note.content);
            await storage.media.update(existing.id, { notePath });
            summary.notesReconnected++;
          }
        }

        onProgress?.(i + 1, total);
        await maybeYield(i + 1, IMPORT_YIELD_EVERY);
        continue;
      }

      await storage.media.save(item.media);
      await Promise.all([
        ...item.episodes.map((e) => storage.episodes.save(e)),
        ...(categories.includeWatchHistory
          ? [
              ...item.episodeProgress.map((p) => storage.episodeProgress.save(p)),
              ...item.watchSessions.map((s) => storage.watchSessions.save(s)),
              ...item.episodeWatches.map((w) => storage.episodeWatches.save(w)),
            ]
          : []),
        ...(item.comfortProfile ? [storage.comfortProfiles.save(item.comfortProfile)] : []),
      ]);

      if (item.note) {
        const notePath = resolveMediaNotePath(baseFolder, item.media);
        await ensureFolderExists(app, resolveMediaFolder(baseFolder, item.media.type));
        if (!app.vault.getAbstractFileByPath(notePath)) {
          await app.vault.create(notePath, item.note.content);
          await storage.media.update(item.media.id, { notePath });
        }
      }

      mediaIdRemap.set(item.media.id, item.media.id);
      summary.mediaCreated++;
    } catch (err) {
      summary.skipped++;
      summary.errors.push({
        title: item.media?.title ?? "(unknown)",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    onProgress?.(i + 1, total);
    await maybeYield(i + 1, IMPORT_YIELD_EVERY);
  }

  if (categories.includeLists) {
    summary.presetsAdded = await reconcileComfortPresets(
      storage,
      parsed.comfortPresets ?? [],
    );
    const listResult = await reconcileLists(
      storage,
      parsed.lists ?? [],
      mediaIdRemap,
    );
    summary.listsCreated = listResult.created;
    summary.listsUpdated = listResult.updated;
    summary.listMembershipsAdded = listResult.membershipsAdded;
  }

  if (categories.includeSettings && parsed.settingsPreferences) {
    try {
      summary.settingsApplied = await applySettingsImport(
        storage,
        parsed.settingsPreferences,
      );
    } catch (err) {
      summary.errors.push({
        title: "Settings Preferences",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}
