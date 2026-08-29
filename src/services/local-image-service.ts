import type { App } from "obsidian";
import { normalizePath } from "obsidian";

const LOCAL_IMAGE_PREFIX = "local:";
const COVERS_SUBFOLDER = "Covers";

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

let appRef: App | null = null;

export function initLocalImageService(app: App): void {
  appRef = app;
}

export function isLocalImagePath(
  path: string | null | undefined,
): path is string {
  return !!path && path.startsWith(LOCAL_IMAGE_PREFIX);
}

export function localImageVaultPath(path: string): string {
  return path.slice(LOCAL_IMAGE_PREFIX.length);
}

export function resolveMediaImageSrc(
  path: string | null,
  tmdbUrl: (path: string | null) => string | null,
): string | null {
  if (!path) return null;
  if (!isLocalImagePath(path)) return tmdbUrl(path);
  if (!appRef) return null;
  const vaultPath = localImageVaultPath(path);
  try {
    return appRef.vault.adapter.getResourcePath(vaultPath);
  } catch {
    return null;
  }
}

function extensionFromFile(file: File): string | null {
  const mimeExt = EXTENSION_BY_MIME[file.type.toLowerCase()];
  if (mimeExt) return mimeExt;
  const match = /\.([a-zA-Z0-9]+)$/.exec(file.name);
  const ext = match?.[1]?.toLowerCase();
  if (ext && ALLOWED_EXTENSIONS.includes(ext)) {
    return ext === "jpeg" ? "jpg" : ext;
  }
  return null;
}

async function ensureFolderExists(app: App, folderPath: string): Promise<void> {
  const parts = folderPath.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current).catch(() => {
        // Folder already exists
      });
    }
  }
}

async function removeExistingLocalCoverFiles(
  app: App,
  folder: string,
  mediaId: string,
  kind: "poster" | "backdrop",
): Promise<void> {
  for (const ext of new Set(ALLOWED_EXTENSIONS)) {
    const path = normalizePath(`${folder}/${mediaId}-${kind}.${ext}`);
    const existing = app.vault.getAbstractFileByPath(path);
    if (existing) {
      await app.vault.adapter.remove(path).catch(() => {
        // cleanup
      });
    }
  }
}

export interface ImportLocalImageOptions {
  mediaFolderPath: string;
  mediaId: string;
  kind: "poster" | "backdrop";
  file: File;
}

export class UnsupportedImageFormatError extends Error {
  constructor() {
    super("Unsupported image format. Use JPG, PNG, or WebP.");
    this.name = "UnsupportedImageFormatError";
  }
}

export async function importLocalImage(
  options: ImportLocalImageOptions,
): Promise<string> {
  if (!appRef) throw new Error("Local image service not initialized.");
  const ext = extensionFromFile(options.file);
  if (!ext) throw new UnsupportedImageFormatError();

  const folder = normalizePath(
    `${options.mediaFolderPath.replace(/\/+$/, "")}/${COVERS_SUBFOLDER}`,
  );
  await ensureFolderExists(appRef, folder);
  await removeExistingLocalCoverFiles(
    appRef,
    folder,
    options.mediaId,
    options.kind,
  );

  const vaultPath = normalizePath(`${folder}/${options.mediaId}-${options.kind}.${ext}`);
  const data = await options.file.arrayBuffer();
  await appRef.vault.createBinary(vaultPath, data);
  return `${LOCAL_IMAGE_PREFIX}${vaultPath}`;
}

export async function removeLocalImageIfAny(
  path: string | null | undefined,
): Promise<void> {
  if (!appRef || !isLocalImagePath(path)) return;
  const vaultPath = localImageVaultPath(path);
  const file = appRef.vault.getAbstractFileByPath(vaultPath);
  if (file) {
    await appRef.vault.adapter.remove(vaultPath).catch(() => {
      // cleanup
    });
  }
}
