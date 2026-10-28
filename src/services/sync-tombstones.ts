import { markSelfWrite } from "./self-writes";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import type { StorageService } from "./storage";
import type { MediaItem } from "../models/media";
import type { CustomList } from "../models/list";
import {
  serializeFrontmatter,
  type FrontmatterData,
} from "./note-generator/frontmatter";
import { resolveListNotePath } from "./list-note-generator";

export type TombstoneKind = "media" | "list";

export interface Tombstone {
  kind: TombstoneKind;
  id: string;
  deletedAt: string;
  file: TFile;
}

function baseFolder(storage: StorageService): string {
  return (storage.settings.get().mediaFolderPath || "MediaVault").replace(
    /\/+$/,
    "",
  );
}

export function tombstonePath(
  storage: StorageService,
  kind: TombstoneKind,
  id: string,
): string {
  return `${baseFolder(storage)}/Deleted/${kind}-${id}.md`;
}

async function ensureFolder(app: App, folderPath: string): Promise<void> {
  let current = "";
  for (const part of folderPath.split("/").filter(Boolean)) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current).catch(() => {
        // Already exists
      });
    }
  }
}

export async function writeTombstone(
  app: App,
  storage: StorageService,
  kind: TombstoneKind,
  id: string,
  deletedAt: string = new Date().toISOString(),
): Promise<void> {
  const path = tombstonePath(storage, kind, id);
  if (app.vault.getAbstractFileByPath(path)) return;
  await ensureFolder(app, `${baseFolder(storage)}/Deleted`);
  const data: FrontmatterData = {
    mediavault_tombstone: true,
    mediavault_deleted_kind: kind,
    mediavault_deleted_id: id,
    mediavault_deleted_at: deletedAt,
  };
  markSelfWrite(path);
  await app.vault.create(
    path,
    `${serializeFrontmatter(data)}\n\nDeleted MediaVault ${kind}. This marker stops the deletion from being undone by sync; do not edit.\n`,
  );
}

export async function removeTombstone(
  app: App,
  storage: StorageService,
  kind: TombstoneKind,
  id: string,
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(tombstonePath(storage, kind, id));
  if (file instanceof TFile) await app.fileManager.trashFile(file);
}

export async function recordMediaDeletion(
  app: App,
  storage: StorageService,
  media: MediaItem,
): Promise<void> {
  if (!media.notePath) return;
  try {
    await writeTombstone(app, storage, "media", media.id);
  } catch (err) {
    console.warn("MediaVault: could not write deletion marker", err);
  }
}

export async function recordListDeletion(
  app: App,
  storage: StorageService,
  list: CustomList,
): Promise<void> {
  try {
    const path = resolveListNotePath(baseFolder(storage), list);
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (fm && fm.mediavault_list_id !== list.id) return;
    await app.fileManager.trashFile(file);
    await writeTombstone(app, storage, "list", list.id);
  } catch (err) {
    console.warn("MediaVault: could not record list deletion", err);
  }
}
