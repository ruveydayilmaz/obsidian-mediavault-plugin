import type { App } from "obsidian";
import { TFile } from "obsidian";
import type { StorageService } from "./storage";
import type { CustomList } from "../models/list";
import {
  FrontmatterData,
  mergeFrontmatter,
  serializeFrontmatter,
} from "./note-generator/frontmatter";
import { mergeManagedBody, MANAGED_START, MANAGED_END } from "./note-generator/note-content";
import { maybeYield } from "./importer/yield";

const LIST_MANAGED_FRONTMATTER_KEYS = new Set([
  "mediavault_list",
  "mediavault_list_id",
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
  if (list.mediaIds.length === 0) {
    lines.push("_No items yet._");
  } else {
    list.mediaIds.forEach((id) => {
      const title = mediaTitles.get(id);
      lines.push(title ? `- [[${title}]]` : `- (missing media: ${id})`);
    });
  }
  lines.push("", MANAGED_END);
  return lines.join("\n");
}

function stripLeadingFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const closingIdx = content.indexOf("\n---", 3);
  if (closingIdx === -1) return content;
  const afterFrontmatter = content.indexOf("\n", closingIdx + 4);
  return afterFrontmatter === -1 ? "" : content.slice(afterFrontmatter + 1);
}

export async function generateListNote(
  app: App,
  storage: StorageService,
  list: CustomList,
): Promise<{ notePath: string; changed: boolean }> {
  const baseFolder = storage.settings.get().mediaFolderPath || "MediaVault";
  const notePath = resolveListNotePath(baseFolder, list);
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
    const mergedBody = mergeManagedBody(bodyOnly, managedBody);

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
    await app.vault.adapter.write(notePath, finalContent);
    return { notePath, changed: true };
  }

  const finalContent = `${serializeFrontmatter(frontmatterData)}\n\n# ${list.title}\n\n${managedBody}\n`;
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

    const content = await app.vault.adapter.read(file.path);
    const body = stripLeadingFrontmatter(content);
    const itemLines = body
      .split("\n")
      .filter((line) => line.trim().startsWith("- [["));
    const titles = itemLines.map((line) =>
      line.trim().replace(/^- \[\[/, "").replace(/\]\]$/, ""),
    );

    const mediaIds: string[] = [];
    for (const title of titles) {
      const match = await storage.media.findWhere(
        (m) => (m.year ? `${m.title} (${m.year})` : m.title) === title,
      );
      if (match[0]) mediaIds.push(match[0].id);
    }

    await storage.customLists.save({
      id: listId,
      title: typeof fm.title === "string" ? fm.title : file.basename,
      description: typeof fm.description === "string" ? fm.description : null,
      mediaIds,
      sortMode: (typeof fm.sort_mode === "string" ? fm.sort_mode : "manual") as CustomList["sortMode"],
      owner: null,
      isImported: true,
      importSource: "note-reconstruction",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    reconstructed++;
  }

  return reconstructed;
}
