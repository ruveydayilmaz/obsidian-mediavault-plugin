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
  };
}

function buildListManagedBody(
  list: CustomList,
  mediaTitles: Map<string, string>,
): string {
  const lines: string[] = [MANAGED_START, "", "## Items", ""];

  const dataBlock = serializePayload({ v: 1, mediaIds: list.mediaIds });
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

export function buildMediaTitleIndex(
  media: { id: string; title: string; year: number | null }[],
): Map<string, string> {
  const index = new Map<string, string>();
  for (const m of media) {
    const key = m.year ? `${m.title} (${m.year})` : m.title;
    if (!index.has(key)) index.set(key, m.id);
  }
  return index;
}

export function parseListBody(
  noteContent: string,
  titleIndex: Map<string, string>,
): { mediaIds: string[]; unresolved: number } {
  const payload = extractPayloadJson(noteContent) as {
    mediaIds?: unknown;
  } | null;
  if (payload && Array.isArray(payload.mediaIds)) {
    const ids = payload.mediaIds.filter(
      (x): x is string => typeof x === "string",
    );
    const known = new Set(titleIndex.values());
    const resolved = ids.filter((id) => known.has(id));
    return { mediaIds: resolved, unresolved: ids.length - resolved.length };
  }
  const body = stripCustomBlock(stripLeadingFrontmatter(noteContent));
  const titles = body
    .split("\n")
    .filter((line) => line.trim().startsWith("- [["))
    .map((line) => line.trim().replace(/^- \[\[/, "").replace(/\]\]$/, ""));

  const mediaIds: string[] = [];
  let unresolved = 0;
  for (const title of titles) {
    const id = titleIndex.get(title);
    if (id) mediaIds.push(id);
    else unresolved++;
  }
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
): Promise<{ notePath: string; changed: boolean }> {
  const baseFolder = storage.settings.get().mediaFolderPath || "MediaVault";
  const notePath = existingPath ?? resolveListNotePath(baseFolder, list);
  await ensureFolderExists(app, resolveListsFolder(baseFolder));

  const mediaTitles = new Map<string, string>();
  for (const id of list.mediaIds) {
    const media = await storage.media.findById(id);
    if (media) mediaTitles.set(id, media.year ? `${media.title} (${media.year})` : media.title);
  }

  const frontmatterData = buildListFrontmatterData(list);
  const managedBody = buildListManagedBody(list, mediaTitles);

  const existingFile = app.vault.getAbstractFileByPath(notePath);
  if (existingFile instanceof TFile) {
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
  const content = await app.vault.adapter.read(file.path);
  const index =
    titleIndex ?? buildMediaTitleIndex(await storage.media.getAll());
  const { mediaIds, unresolved } = parseListBody(content, index);
  const raw = fm.mediavault_updated_at;
  const noteUpdatedAt =
    typeof raw === "string" && raw
      ? raw
      : raw instanceof Date && !Number.isNaN(raw.getTime())
        ? raw.toISOString()
        : new Date().toISOString();
  const version = unresolved > 0 ? new Date(0).toISOString() : noteUpdatedAt;

  await storage.customLists.save({
    id: fm.mediavault_list_id as string,
    title: typeof fm.title === "string" ? fm.title : file.basename,
    description: typeof fm.description === "string" ? fm.description : null,
    mediaIds,
    sortMode: (typeof fm.sort_mode === "string"
      ? fm.sort_mode
      : "manual") as CustomList["sortMode"],
    owner: null,
    isImported: true,
    importSource: "note-reconstruction",
    createdAt: noteUpdatedAt,
    updatedAt: version,
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
