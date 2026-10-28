import { markSelfWrite } from "../self-writes";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import type { StorageService } from "../storage";
import { MediaItem } from "../../models/media";
import { MediaType } from "../../types/enums";
import {
  buildMediaFrontmatterData,
  managedFrontmatterKeys,
} from "./media-frontmatter";
import { mergeFrontmatter, serializeFrontmatter } from "./frontmatter";
import {
  applyCustomMarkdown,
  buildManagedBody,
  mergeManagedBody,
} from "./note-content";
import {
  applyMediaPayload,
  buildMediaPayload,
  deriveAggregates,
  parseMediaPayload,
  serializePayload,
} from "../sync-payload";
import { mapWithConcurrency } from "../importer/concurrency";
import { maybeYield } from "../importer/yield";

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "-").trim();
}

export function resolveMediaFolder(
  baseFolderPath: string,
  type: MediaType,
): string {
  const sub = type === MediaType.Movie ? "Movies" : "TV";
  return `${baseFolderPath.replace(/\/+$/, "")}/${sub}`;
}

export function resolveMediaNotePath(
  baseFolderPath: string,
  media: MediaItem,
): string {
  const folder = resolveMediaFolder(baseFolderPath, media.type);
  const filename = sanitizeFilename(
    media.year ? `${media.title} (${media.year})` : media.title,
  );
  return `${folder}/${filename}.md`;
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

export async function generateMediaNote(
  app: App,
  storage: StorageService,
  media: MediaItem,
  opts: { respectNewerNote?: boolean } = {},
): Promise<{ notePath: string; changed: boolean }> {
  const settings = storage.settings.get();
  const baseFolder = settings.mediaFolderPath || "MediaVault";
  const template = settings.noteTemplate;

  const linked = media.notePath
    ? app.vault.getAbstractFileByPath(media.notePath)
    : null;
  const notePath =
    linked instanceof TFile ? linked.path : resolveMediaNotePath(baseFolder, media);

  if (opts.respectNewerNote && linked instanceof TFile) {
    const fm = app.metadataCache.getFileCache(linked)?.frontmatter;
    const ts: unknown = fm?.mediavault_updated_at;
    const noteTs =
      typeof ts === "string"
        ? ts
        : ts instanceof Date
          ? ts.toISOString()
          : null;
    if (noteTs && noteTs > media.updatedAt) {
      return { notePath, changed: false };
    }
  }

  if (linked instanceof TFile && !media.syncVerified) {
    try {
      const existing = parseMediaPayload(
        await app.vault.adapter.read(linked.path),
      );
      if (existing) {
        const stats = await storage.withoutTouch(() =>
          applyMediaPayload(storage, media.id, existing),
        );
        if (stats.unresolved > 0) {
          console.warn("MediaVault: skipped note write (cache not fully hydrated)");
          return { notePath, changed: false };
        }
        const merged = stats.changed;
        if (merged > 0) {
          const aggs = await deriveAggregates(storage, media.id);
          const refreshed = await storage.media.update(media.id, {
            ...aggs,
            updatedAt: media.updatedAt,
          });
          if (refreshed) media = refreshed;
        }
      }
    } catch (err) {
      console.warn("MediaVault: skipped note write (unverified)", err);
      return { notePath, changed: false };
    }
  }

  const sessions = await storage.watchSessions.findWhere(
    (s) => s.mediaId === media.id,
  );
  const comfortProfiles = await storage.comfortProfiles.findWhere(
    (c) => c.mediaId === media.id,
  );
  const comfort = comfortProfiles[0] ?? null;

  const generatedFrontmatterData = buildMediaFrontmatterData(
    media,
    comfort,
    template,
  );
  const dataBlock = serializePayload(await buildMediaPayload(storage, media));
  const managedBody = buildManagedBody(
    media,
    sessions,
    template.sections,
    dataBlock,
  );

  const existingFile = app.vault.getAbstractFileByPath(notePath);
  let finalContent: string;
  let changed = true;

  if (existingFile instanceof TFile) {
    const existingContent = await app.vault.adapter.read(notePath);
    const bodyOnly = stripLeadingFrontmatter(existingContent);
    const mergedBody = applyCustomMarkdown(
      mergeManagedBody(bodyOnly, managedBody),
      settings.noteCustomMarkdown ?? "",
    );

    const existingFrontmatter =
      app.metadataCache.getFileCache(existingFile)?.frontmatter ?? null;
    const mergedFrontmatterData = mergeFrontmatter(
      generatedFrontmatterData,
      existingFrontmatter,
      managedFrontmatterKeys(template),
    );
    const frontmatter = serializeFrontmatter(mergedFrontmatterData);

    finalContent = `${frontmatter}\n\n${mergedBody}`;

    if (finalContent === existingContent) {
      changed = false;
    } else {
      markSelfWrite(notePath);
      await app.vault.adapter.write(notePath, finalContent);
    }
  } else {
    const frontmatter = serializeFrontmatter(generatedFrontmatterData);
    await ensureFolderExists(app, resolveMediaFolder(baseFolder, media.type));
    finalContent = `${frontmatter}\n\n${applyCustomMarkdown(
      `# ${media.title}\n\n${managedBody}\n\n## Notes\n\n`,
      settings.noteCustomMarkdown ?? "",
    )}`;
    markSelfWrite(notePath);
    await app.vault.create(notePath, finalContent);
  }

  if (media.notePath !== notePath || !media.syncVerified) {
    const latest = await storage.media.findById(media.id);
    await storage.media.update(media.id, {
      notePath,
      syncVerified: true,
      updatedAt: latest?.updatedAt ?? media.updatedAt,
    });
  }

  return { notePath, changed };
}

function stripLeadingFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const closingIdx = content.indexOf("\n---", 3);
  if (closingIdx === -1) return content;
  const afterFrontmatter = content.indexOf("\n", closingIdx + 4);
  return afterFrontmatter === -1 ? "" : content.slice(afterFrontmatter + 1);
}

const NOTE_GENERATION_CONCURRENCY = 4;
const NOTE_GENERATION_YIELD_EVERY = 5;
const PROGRESS_THROTTLE_MS = 100;

export type NoteGenerationProgressCallback = (
  done: number,
  total: number,
) => void;

export interface NoteGenerationResult {
  succeeded: number;
  failed: number;
  total: number;
}

export async function generateNotesInBatches(
  app: App,
  storage: StorageService,
  mediaItems: MediaItem[],
  onProgress?: NoteGenerationProgressCallback,
): Promise<NoteGenerationResult> {
  const total = mediaItems.length;
  let done = 0;
  let succeeded = 0;
  let lastProgressAt = 0;

  await mapWithConcurrency(
    mediaItems,
    NOTE_GENERATION_CONCURRENCY,
    async (media) => {
      try {
        await generateMediaNote(app, storage, media);
        succeeded++;
      } catch (err) {
        console.warn(
          `MediaVault: failed to generate note for "${media.title}"`,
          err,
        );
      }

      done++;
      const now = Date.now();
      if (
        onProgress &&
        (done === total || now - lastProgressAt >= PROGRESS_THROTTLE_MS)
      ) {
        lastProgressAt = now;
        onProgress(done, total);
      }
      await maybeYield(done, NOTE_GENERATION_YIELD_EVERY);
    },
  );

  return { succeeded, failed: total - succeeded, total };
}
