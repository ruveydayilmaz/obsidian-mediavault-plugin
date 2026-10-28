import { App, Notice, TFile, parseYaml } from "obsidian";
import type { StorageService } from "./storage";
import { MediaItem } from "../models/media";
import { CustomList } from "../models/list";
import { MediaStatus } from "../types/enums";
import { parseListMediaIdsFromBody } from "./list-note-generator";
import { t } from "../i18n";

export type ReconcileOutcome = "updated" | "conflict" | "unchanged" | "ignored";

export interface ReconcileOptions {
  silent?: boolean;
  frontmatter?: Record<string, unknown> | null;
  titleIndex?: Map<string, string>;
}

function lenientScalar(raw: string): unknown {
  const v = raw.trim();
  if (v === "" || v === "~" || v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    try {
      return JSON.parse(v) as unknown;
    } catch {
      return v.slice(1, -1);
    }
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) {
    return v.slice(1, -1).replace(/''/g, "'");
  }
  return v;
}

export function parseFrontmatterLeniently(
  block: string,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  const raw: Record<string, string> = {};
  let current: string | null = null;
  for (const line of block.split(/\r?\n/)) {
    const m = /^([A-Za-z_][\w-]*):(?:[ \t]+(.*))?$/.exec(line);
    if (m) {
      current = m[1];
      raw[current] = m[2] ?? "";
    } else if (current !== null && line.trim() !== "") {
      raw[current] = `${raw[current]}\n${line}`;
    }
  }
  for (const [k, v] of Object.entries(raw)) {
    out[k] = v.includes("\n") ? v : lenientScalar(v);
  }
  return Object.keys(out).length > 0 ? out : null;
}

export async function readNoteFrontmatter(
  app: App,
  file: TFile,
): Promise<Record<string, unknown> | null> {
  const cached = app.metadataCache.getFileCache(file)?.frontmatter;
  if (cached) return cached;
  try {
    const content = await app.vault.adapter.read(file.path);
    if (!content.startsWith("---")) return null;
    const end = content.indexOf("\n---", 3);
    if (end === -1) {
      console.warn(`MediaVault: "${file.path}" has an unterminated frontmatter block.`);
      return null;
    }
    const block = content.slice(3, end);
    try {
      const parsed: unknown = parseYaml(block);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : null;
    } catch (err) {
      const repaired = parseFrontmatterLeniently(block);
      const isMediaVault =
        !!repaired &&
        (typeof repaired.mediavault_id === "string" ||
          typeof repaired.mediavault_list_id === "string");
      console.warn(
        `MediaVault: invalid YAML frontmatter in "${file.path}" (${
          err instanceof Error ? err.message : String(err)
        })${isMediaVault ? " recovered; the note will be rewritten with valid properties." : "."}`,
      );
      return isMediaVault ? repaired : null;
    }
  } catch (err) {
    console.warn(`MediaVault: could not read "${file.path}"`, err);
    return null;
  }
}

export { frontmatterTimestamp };

type MediaEditablePatch = Partial<Pick<MediaItem, "status" | "platform">>;

function frontmatterTimestamp(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return null;
}

function extractMediaEditablePatch(
  fm: Record<string, unknown>,
): MediaEditablePatch {
  const patch: MediaEditablePatch = {};
  if (fm.status === "up_to_date") {
    patch.status = MediaStatus.WaitingForNewSeason;
  } else if (
    typeof fm.status === "string" &&
    (Object.values(MediaStatus) as string[]).includes(fm.status)
  ) {
    patch.status = fm.status as MediaItem["status"];
  }
  if ("platform" in fm) {
    patch.platform = typeof fm.platform === "string" ? fm.platform : null;
  }
  return patch;
}

function mediaPatchDiffers(local: MediaItem, patch: MediaEditablePatch): boolean {
  return (Object.keys(patch) as (keyof MediaEditablePatch)[]).some(
    (key) => local[key] !== patch[key],
  );
}

export async function reconcileMediaNote(
  app: App,
  storage: StorageService,
  file: TFile,
  opts: ReconcileOptions = {},
): Promise<ReconcileOutcome> {
  const fm = opts.frontmatter ?? (await readNoteFrontmatter(app, file));
  if (!fm || typeof fm.mediavault_id !== "string") return "ignored";

  const local = await storage.media.findById(fm.mediavault_id);

  if (!local) return "ignored";

  if (local.notePath !== file.path) return "ignored";

  const noteUpdatedAt = frontmatterTimestamp(fm.mediavault_updated_at);
  if (!noteUpdatedAt) return "ignored";

  if (noteUpdatedAt > local.updatedAt) {
    const patch = extractMediaEditablePatch(fm);
    await storage.media.update(local.id, { ...patch, updatedAt: noteUpdatedAt });
    return "updated";
  }

  if (noteUpdatedAt < local.updatedAt) {
    return "unchanged";
  }

  const patch = extractMediaEditablePatch(fm);
  if (mediaPatchDiffers(local, patch)) {
    console.warn(
      `MediaVault: sync conflict for "${local.title}" (${local.id}) note and cache changed at the same logical version; keeping the local cache.`,
    );
    if (!opts.silent) {
      new Notice(t("noteSync.conflictDetected", { title: local.title }));
    }
    return "conflict";
  }
  return "unchanged";
}

function listPatchDiffers(
  local: CustomList,
  title: string | null,
  description: string | null,
  sortMode: string | null,
  mediaIds: string[],
): boolean {
  if (title !== null && title !== local.title) return true;
  if (description !== local.description) return true;
  if (sortMode !== null && sortMode !== local.sortMode) return true;
  if (mediaIds.length !== local.mediaIds.length) return true;
  return mediaIds.some((id, i) => id !== local.mediaIds[i]);
}

export async function reconcileListNote(
  app: App,
  storage: StorageService,
  file: TFile,
  opts: ReconcileOptions = {},
): Promise<ReconcileOutcome> {
  const fm = opts.frontmatter ?? (await readNoteFrontmatter(app, file));
  if (!fm?.mediavault_list || typeof fm.mediavault_list_id !== "string")
    return "ignored";

  const local = await storage.customLists.findById(fm.mediavault_list_id);
  if (!local) return "ignored";

  const noteUpdatedAt = frontmatterTimestamp(fm.mediavault_updated_at);
  if (!noteUpdatedAt) return "ignored";

  const title = typeof fm.title === "string" ? fm.title : null;
  const description = typeof fm.description === "string" ? fm.description : null;
  const sortMode = typeof fm.sort_mode === "string" ? fm.sort_mode : null;

  if (noteUpdatedAt > local.updatedAt) {
    const content = await app.vault.adapter.read(file.path);
    const mediaIds = await parseListMediaIdsFromBody(
      storage,
      content,
      opts.titleIndex,
    );
    await storage.customLists.update(local.id, {
      title: title ?? local.title,
      description,
      sortMode: (sortMode ?? local.sortMode) as CustomList["sortMode"],
      mediaIds,
      updatedAt: noteUpdatedAt,
    });
    return "updated";
  }

  if (noteUpdatedAt < local.updatedAt) return "unchanged";

  const content = await app.vault.adapter.read(file.path);
  const mediaIds = await parseListMediaIdsFromBody(
    storage,
    content,
    opts.titleIndex,
  );
  if (listPatchDiffers(local, title, description, sortMode, mediaIds)) {
    console.warn(
      `MediaVault: sync conflict for list "${local.title}" (${local.id}) note and cache changed at the same logical version; keeping the local cache.`,
    );
    if (!opts.silent) {
      new Notice(t("noteSync.conflictDetected", { title: local.title }));
    }
    return "conflict";
  }
  return "unchanged";
}

export async function reconcileNoteFile(
  app: App,
  storage: StorageService,
  file: TFile,
  opts: ReconcileOptions = {},
): Promise<ReconcileOutcome> {
  const fm = opts.frontmatter ?? (await readNoteFrontmatter(app, file));
  if (!fm) return "ignored";
  const withFm = { ...opts, frontmatter: fm };
  if (typeof fm.mediavault_id === "string") {
    return reconcileMediaNote(app, storage, file, withFm);
  }
  if (fm.mediavault_list === true) {
    return reconcileListNote(app, storage, file, withFm);
  }
  return "ignored";
}

export async function reconcileAllNotes(
  app: App,
  storage: StorageService,
): Promise<void> {
  for (const file of app.vault.getMarkdownFiles()) {
    try {
      await reconcileNoteFile(app, storage, file);
    } catch (err) {
      console.warn(`MediaVault: note reconciliation failed for "${file.path}"`, err);
    }
  }
}
