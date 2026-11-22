import { markSelfWrite } from "./self-writes";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import type { StorageService } from "./storage";
import type { CustomList } from "../models/list";
import {
  FrontmatterData,
  mergeFrontmatter,
  serializeFrontmatter,
} from "./note-generator/frontmatter";
import {
  applyCustomMarkdown,
  mergeManagedBody,
  stripCustomBlock,
  MANAGED_START,
  MANAGED_END,
} from "./note-generator/note-content";
import { extractPayloadJson, serializePayload } from "./sync-payload";
import { maybeYield } from "./importer/yield";

const LIST_MANAGED_FRONTMATTER_KEYS = new Set([
  "mediavault_list",
  "mediavault_list_id",
  "mediavault_updated_at",
  "type",
  "title",
  "description",
  "sort_mode",
  "item_count",
  "created_at",
]);

function resolveListsFolder(baseFolder: string): string {
  return `${baseFolder.replace(/\/+$/, "")}/Lists`;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "-").trim();
}

export function resolveListsFolderPath(baseFolder: string): string {
  return resolveListsFolder(baseFolder);
}

export function resolveListNotePath(baseFolder: string, list: CustomList): string {
  return `${resolveListsFolder(baseFolder)}/${sanitizeFilename(list.title)}.md`;
}

export function findListNoteFile(
  app: App,
  baseFolder: string,
  listId: string,
): TFile | null {
  const prefix = `${resolveListsFolder(baseFolder)}/`;
  for (const f of app.vault.getMarkdownFiles()) {
    if (!f.path.startsWith(prefix)) continue;
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    if (fm?.mediavault_list === true && fm.mediavault_list_id === listId) return f;
  }
  return null;
}

function resolveFreeListPath(
  app: App,
  baseFolder: string,
  list: CustomList,
): string {
  const desired = resolveListNotePath(baseFolder, list);
  const occupant = app.vault.getAbstractFileByPath(desired);
  if (!occupant) return desired;
  if (occupant instanceof TFile) {
    const fm = app.metadataCache.getFileCache(occupant)?.frontmatter;
    if (fm?.mediavault_list_id === list.id) return desired;
  }
  return `${resolveListsFolder(baseFolder)}/${sanitizeFilename(list.title)} (${list.id.slice(0, 8)}).md`;
}

function noteTimestamp(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return null;
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

function buildListFrontmatterData(list: CustomList): FrontmatterData {
  return {
    mediavault_list: true,
    mediavault_list_id: list.id,
    mediavault_updated_at: list.updatedAt,
    type: "list",
    title: list.title,
    description: list.description,
    sort_mode: list.sortMode,
    item_count: list.mediaIds.length,
    created_at: list.createdAt,
  };
}

function buildListManagedBody(
  list: CustomList,
  mediaTitles: Map<string, string>,
): string {
  const lines: string[] = [MANAGED_START, "", "## Items", ""];

  const dataBlock = serializePayload({
    v: 1,
    mediaIds: list.mediaIds,
    createdAt: list.createdAt,
    owner: list.owner,
    isImported: list.isImported,
    importSource: list.importSource,
    isPublic: list.isPublic ?? null,
    posterUrl: list.posterUrl ?? null,
    bannerUrl: list.bannerUrl ?? null,
  });
  if (list.mediaIds.length === 0) {
    lines.push("_No items yet._");
  } else {
    list.mediaIds.forEach((id) => {
      const title = mediaTitles.get(id);
      lines.push(title ? `- [[${title}]]` : `- (missing media: ${id})`);
    });
  }
  lines.push("", dataBlock, "", MANAGED_END);
  return lines.join("\n");
}

export function stripLeadingFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const closingIdx = content.indexOf("\n---", 3);
  if (closingIdx === -1) return content;
  const afterFrontmatter = content.indexOf("\n", closingIdx + 4);
  return afterFrontmatter === -1 ? "" : content.slice(afterFrontmatter + 1);
}

export class TitleIndex extends Map<string, string> {
  keyById = new Map<string, string>();
}

export function buildMediaTitleIndex(
  media: { id: string; title: string; year: number | null }[],
): TitleIndex {
  const index = new TitleIndex();
  for (const m of media) {
    const key = m.year ? `${m.title} (${m.year})` : m.title;
    if (!index.has(key)) index.set(key, m.id);
    index.keyById.set(m.id, key);
  }
  return index;
}

export interface ListNoteExtras {
  createdAt?: string;
  owner?: string | null;
  isImported?: boolean;
  importSource?: string | null;
  isPublic?: boolean;
  posterUrl?: string | null;
  bannerUrl?: string | null;
}

export interface ParsedListNote {
  mediaIds: string[];
  unresolved: number;
  extras: ListNoteExtras;
}

const MISSING_TOKEN = "missing:";

function visibleListTokens(noteContent: string): string[] {
  let body = stripCustomBlock(stripLeadingFrontmatter(noteContent));
  const start = body.indexOf(MANAGED_START);
  if (start !== -1) {
    const end = body.indexOf(MANAGED_END, start);
    body = body.slice(start, end === -1 ? undefined : end);
  }
  const tokens: string[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    const link = /^[-*]\s+\[\[([^\]]+)\]\]/.exec(line);
    if (link) {
      tokens.push(link[1].split("|")[0].trim());
      continue;
    }
    const missing = /^[-*]\s+\(missing media:\s*([^)\s]+)\s*\)/.exec(line);
    if (missing) tokens.push(`${MISSING_TOKEN}${missing[1]}`);
  }
  return tokens;
}

function resolveVisibleTokens(
  tokens: string[],
  titleIndex: Map<string, string>,
): { mediaIds: string[]; unresolved: number } {
  const mediaIds: string[] = [];
  const seen = new Set<string>();
  let unresolved = 0;
  for (const token of tokens) {
    const id = token.startsWith(MISSING_TOKEN)
      ? token.slice(MISSING_TOKEN.length)
      : titleIndex.get(token);
    if (!id) {
      unresolved++;
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    mediaIds.push(id);
  }
  return { mediaIds, unresolved };
}

function keyForId(titleIndex: Map<string, string>, id: string): string | null {
  if (titleIndex instanceof TitleIndex) return titleIndex.keyById.get(id) ?? null;
  for (const [key, value] of titleIndex) if (value === id) return key;
  return null;
}

function parseExtras(payload: Record<string, unknown>): ListNoteExtras {
  const extras: ListNoteExtras = {};
  if (typeof payload.createdAt === "string" && payload.createdAt)
    extras.createdAt = payload.createdAt;
  if (typeof payload.owner === "string" || payload.owner === null)
    extras.owner = payload.owner;
  if (typeof payload.isImported === "boolean") extras.isImported = payload.isImported;
  if (typeof payload.importSource === "string" || payload.importSource === null)
    extras.importSource = payload.importSource;
  if (typeof payload.isPublic === "boolean") extras.isPublic = payload.isPublic;
  if (typeof payload.posterUrl === "string" || payload.posterUrl === null)
    extras.posterUrl = payload.posterUrl;
  if (typeof payload.bannerUrl === "string" || payload.bannerUrl === null)
    extras.bannerUrl = payload.bannerUrl;
  return extras;
}

export function parseListNote(
  noteContent: string,
  titleIndex: Map<string, string>,
): ParsedListNote {
  const payload = extractPayloadJson(noteContent) as Record<string, unknown> | null;
  const tokens = visibleListTokens(noteContent);
  if (payload && Array.isArray(payload.mediaIds)) {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const x of payload.mediaIds) {
      if (typeof x === "string" && x && !seen.has(x)) {
        seen.add(x);
        ids.push(x);
      }
    }
    const extras = parseExtras(payload);
    const expected = ids.map(
      (id) => keyForId(titleIndex, id) ?? `${MISSING_TOKEN}${id}`,
    );
    const visibleEdited =
      tokens.length !== expected.length || tokens.some((tk, i) => tk !== expected[i]);
    const hasVisibleList = tokens.length > 0 || ids.length === 0;
    if (!visibleEdited || !hasVisibleList) {
      return { mediaIds: ids, unresolved: 0, extras };
    }
    return { ...resolveVisibleTokens(tokens, titleIndex), extras };
  }
  return { ...resolveVisibleTokens(tokens, titleIndex), extras: {} };
}

export function parseListBody(
  noteContent: string,
  titleIndex: Map<string, string>,
): { mediaIds: string[]; unresolved: number } {
  const { mediaIds, unresolved } = parseListNote(noteContent, titleIndex);
  return { mediaIds, unresolved };
}

export async function parseListMediaIdsFromBody(
  storage: StorageService,
  noteContent: string,
  titleIndex?: Map<string, string>,
): Promise<string[]> {
  const index =
    titleIndex ?? buildMediaTitleIndex(await storage.media.getAll());
  return parseListBody(noteContent, index).mediaIds;
}

export async function generateListNote(
  app: App,
  storage: StorageService,
  list: CustomList,
  existingPath?: string,
  opts: { respectNewerNote?: boolean } = {},
): Promise<{ notePath: string; changed: boolean }> {
  const baseFolder = (storage.settings.get().mediaFolderPath || "MediaVault").replace(/\/+$/, "");
  await ensureFolderExists(app, resolveListsFolder(baseFolder));

  let notePath = existingPath;
  if (!notePath) {
    const found = findListNoteFile(app, baseFolder, list.id);
    if (found) {
      notePath = found.path;
      const desired = resolveListNotePath(baseFolder, list);
      if (
        desired !== found.path &&
        !app.vault.getAbstractFileByPath(desired) &&
        found.path.startsWith(`${resolveListsFolder(baseFolder)}/`) &&
        !found.path.slice(resolveListsFolder(baseFolder).length + 1).includes("/")
      ) {
        try {
          markSelfWrite(found.path);
          markSelfWrite(desired);
          await app.fileManager.renameFile(found, desired);
          notePath = desired;
        } catch {
          notePath = found.path;
        }
      }
    } else {
      notePath = resolveFreeListPath(app, baseFolder, list);
    }
  }

  const mediaTitles = new Map<string, string>();
  for (const id of list.mediaIds) {
    const media = await storage.media.findById(id);
    if (media) mediaTitles.set(id, media.year ? `${media.title} (${media.year})` : media.title);
  }

  const frontmatterData = buildListFrontmatterData(list);
  const managedBody = buildListManagedBody(list, mediaTitles);

  const existingFile = app.vault.getAbstractFileByPath(notePath);
  if (existingFile instanceof TFile) {
    if (opts.respectNewerNote) {
      const ts = noteTimestamp(
        app.metadataCache.getFileCache(existingFile)?.frontmatter?.mediavault_updated_at,
      );
      if (ts && ts > list.updatedAt) return { notePath, changed: false };
    }
    const existingContent = await app.vault.adapter.read(notePath);
    const bodyOnly = stripLeadingFrontmatter(existingContent);
    const mergedBody = applyCustomMarkdown(
      mergeManagedBody(bodyOnly, managedBody),
      storage.settings.get().noteCustomMarkdown ?? "",
    );

    const existingFrontmatter =
      app.metadataCache.getFileCache(existingFile)?.frontmatter ?? null;
    const merged = mergeFrontmatter(
      frontmatterData,
      existingFrontmatter,
      LIST_MANAGED_FRONTMATTER_KEYS,
    );
    const finalContent = `${serializeFrontmatter(merged)}\n\n${mergedBody}`;

    if (finalContent === existingContent) {
      return { notePath, changed: false };
    }
    markSelfWrite(notePath);
    await app.vault.adapter.write(notePath, finalContent);
    return { notePath, changed: true };
  }

  const finalContent = `${serializeFrontmatter(frontmatterData)}\n\n${applyCustomMarkdown(
    `# ${list.title}\n\n${managedBody}\n`,
    storage.settings.get().noteCustomMarkdown ?? "",
  )}`;
  markSelfWrite(notePath);
  await app.vault.create(notePath, finalContent);
  return { notePath, changed: true };
}

const LIST_YIELD_EVERY = 5;

export async function generateAllListNotes(
  app: App,
  storage: StorageService,
  onProgress?: (done: number, total: number) => void,
): Promise<{ succeeded: number; failed: number; total: number }> {
  const lists = await storage.customLists.getAll();
  let succeeded = 0;
  for (let i = 0; i < lists.length; i++) {
    try {
      await generateListNote(app, storage, lists[i]);
      succeeded++;
    } catch (err) {
      console.warn(
        `MediaVault: failed to generate note for list "${lists[i].title}"`,
        err,
      );
    }
    onProgress?.(i + 1, lists.length);
    await maybeYield(i + 1, LIST_YIELD_EVERY);
  }
  return { succeeded, failed: lists.length - succeeded, total: lists.length };
}

export async function restoreListFromNote(
  app: App,
  storage: StorageService,
  file: TFile,
  fm: Record<string, unknown>,
  titleIndex?: Map<string, string>,
): Promise<void> {
  const listId = fm.mediavault_list_id;
  if (typeof listId !== "string" || !listId) return;
  const content = await app.vault.adapter.read(file.path);
  const index =
    titleIndex ?? buildMediaTitleIndex(await storage.media.getAll());
  const { mediaIds, unresolved, extras } = parseListNote(content, index);
  const noteUpdatedAt = noteTimestamp(fm.mediavault_updated_at) ?? new Date().toISOString();
  const createdAt =
    extras.createdAt ?? noteTimestamp(fm.created_at) ?? noteUpdatedAt;
  const version = unresolved > 0 ? new Date(0).toISOString() : noteUpdatedAt;

  await storage.customLists.save({
    id: listId,
    title: typeof fm.title === "string" && fm.title ? fm.title : file.basename,
    description: typeof fm.description === "string" ? fm.description : null,
    mediaIds,
    sortMode: (typeof fm.sort_mode === "string"
      ? fm.sort_mode
      : "manual") as CustomList["sortMode"],
    owner: extras.owner ?? null,
    isImported: extras.isImported ?? true,
    importSource: extras.importSource ?? "note-reconstruction",
    createdAt,
    updatedAt: version,
    ...(extras.isPublic !== undefined ? { isPublic: extras.isPublic } : {}),
    ...(extras.posterUrl !== undefined ? { posterUrl: extras.posterUrl } : {}),
    ...(extras.bannerUrl !== undefined ? { bannerUrl: extras.bannerUrl } : {}),
  });
}

export async function reconstructListsFromNotes(
  app: App,
  storage: StorageService,
): Promise<number> {
  const baseFolder = storage.settings.get().mediaFolderPath || "MediaVault";
  const listsFolder = resolveListsFolder(baseFolder);
  const folder = app.vault.getAbstractFileByPath(listsFolder);
  if (!folder) return 0;

  const files = app.vault
    .getMarkdownFiles()
    .filter((f) => f.path.startsWith(`${listsFolder}/`));

  let reconstructed = 0;
  for (const file of files) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    const rawListId: unknown = fm?.mediavault_list_id;
    if (!fm?.mediavault_list || typeof rawListId !== "string") continue;
    const listId: string = rawListId;

    const existing = await storage.customLists.findById(listId);
    if (existing) continue;

    await restoreListFromNote(app, storage, file, fm);
    reconstructed++;
  }

  return reconstructed;
}
