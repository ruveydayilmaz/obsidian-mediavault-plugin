import { markSelfWrite } from "./self-writes";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import type { StorageService } from "./storage";
import {
  DEFAULT_COMFORT_FLAGS,
  type ComfortFlags,
  type ComfortPreset,
} from "../models/comfort";
import {
  mergeFrontmatter,
  serializeFrontmatter,
  type FrontmatterData,
} from "./note-generator/frontmatter";
import {
  applyCustomMarkdown,
  mergeManagedBody,
  MANAGED_START,
  MANAGED_END,
} from "./note-generator/note-content";
import { extractPayloadJson, serializePayload } from "./sync-payload";
import { stripLeadingFrontmatter } from "./list-note-generator";
import { maybeYield } from "./importer/yield";

const PRESET_MANAGED_KEYS = new Set([
  "mediavault_comfort_preset",
  "mediavault_preset_id",
  "mediavault_updated_at",
  "type",
  "title",
  "description",
]);

const SCORE_KEYS = [
  "energyMin",
  "energyMax",
  "attentionMin",
  "attentionMax",
  "emotionalHeavinessMax",
  "comfortScoreMin",
  "rewatchabilityMin",
] as const;

function presetsFolder(baseFolder: string): string {
  return `${baseFolder.replace(/\/+$/, "")}/Comfort Presets`;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "-").trim() || "Preset";
}

function timestamp(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return null;
}

function baseOf(storage: StorageService): string {
  return (storage.settings.get().mediaFolderPath || "MediaVault").replace(/\/+$/, "");
}

export function findPresetNoteFile(
  app: App,
  baseFolder: string,
  presetId: string,
): TFile | null {
  const prefix = `${presetsFolder(baseFolder)}/`;
  for (const f of app.vault.getMarkdownFiles()) {
    if (!f.path.startsWith(prefix)) continue;
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    if (fm?.mediavault_comfort_preset === true && fm.mediavault_preset_id === presetId) {
      return f;
    }
  }
  return null;
}

async function ensureFolder(app: App, folderPath: string): Promise<void> {
  let current = "";
  for (const part of folderPath.split("/").filter(Boolean)) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current).catch(() => undefined);
    }
  }
}

function sanitizeScore(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.min(10, Math.max(1, Math.round(v)));
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function parsePresetNote(
  content: string,
  fm: Record<string, unknown>,
): ComfortPreset | null {
  const id = fm.mediavault_preset_id;
  if (typeof id !== "string" || !id) return null;
  const payload = extractPayloadJson(content) as { preset?: Record<string, unknown> } | null;
  const raw = payload?.preset;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const name =
    typeof fm.title === "string" && fm.title.trim()
      ? fm.title
      : typeof raw.name === "string" && raw.name.trim()
        ? raw.name
        : null;
  if (!name) return null;
  const flagKeys = Object.keys(DEFAULT_COMFORT_FLAGS);
  const preset: ComfortPreset = {
    id,
    name,
    description:
      typeof fm.description === "string"
        ? fm.description
        : typeof raw.description === "string"
          ? raw.description
          : null,
    requiredFlags: strings(raw.requiredFlags).filter((f) =>
      flagKeys.includes(f),
    ) as (keyof ComfortFlags)[],
    excludedTriggers: strings(raw.excludedTriggers) as ComfortPreset["excludedTriggers"],
    seasonalTags: strings(raw.seasonalTags) as ComfortPreset["seasonalTags"],
    isBuiltIn: false,
  };
  for (const key of SCORE_KEYS) {
    const score = sanitizeScore(raw[key]);
    if (score !== undefined) preset[key] = score;
  }
  const ts = timestamp(fm.mediavault_updated_at);
  if (ts) preset.updatedAt = ts;
  return preset;
}

function fingerprint(p: ComfortPreset): string {
  const scores = SCORE_KEYS.map((k) => `${k}=${p[k] ?? ""}`).join(",");
  return [
    p.name,
    scores,
    [...p.requiredFlags].sort().join(","),
    [...p.excludedTriggers].sort().join(","),
    [...p.seasonalTags].sort().join(","),
  ].join("|");
}

function buildBody(preset: ComfortPreset): string {
  const lines = [MANAGED_START, "", "## Comfort preset", ""];
  if (preset.description) lines.push(preset.description, "");
  for (const key of SCORE_KEYS) {
    if (preset[key] !== undefined) lines.push(`- ${key}: ${preset[key]}`);
  }
  if (preset.requiredFlags.length) lines.push(`- requiredFlags: ${preset.requiredFlags.join(", ")}`);
  if (preset.excludedTriggers.length) lines.push(`- excludedTriggers: ${preset.excludedTriggers.join(", ")}`);
  if (preset.seasonalTags.length) lines.push(`- seasonalTags: ${preset.seasonalTags.join(", ")}`);
  const data: Record<string, unknown> = {
    name: preset.name,
    description: preset.description,
    requiredFlags: preset.requiredFlags,
    excludedTriggers: preset.excludedTriggers,
    seasonalTags: preset.seasonalTags,
  };
  for (const key of SCORE_KEYS) if (preset[key] !== undefined) data[key] = preset[key];
  lines.push("", serializePayload({ v: 1, preset: data }), "", MANAGED_END);
  return lines.join("\n");
}

export async function generatePresetNote(
  app: App,
  storage: StorageService,
  presetIn: ComfortPreset,
  existingPath?: string,
  opts: { respectNewerNote?: boolean } = {},
): Promise<{ notePath: string; changed: boolean }> {
  let preset = presetIn;
  if (!preset.updatedAt) {
    const updated = await storage.comfortPresets.update(preset.id, {
      updatedAt: new Date().toISOString(),
    });
    if (updated) preset = updated;
  }
  const baseFolder = baseOf(storage);
  const folder = presetsFolder(baseFolder);
  await ensureFolder(app, folder);

  let notePath = existingPath;
  if (!notePath) {
    const found = findPresetNoteFile(app, baseFolder, preset.id);
    if (found) {
      notePath = found.path;
    } else {
      const desired = `${folder}/${sanitizeFilename(preset.name)}.md`;
      notePath = app.vault.getAbstractFileByPath(desired)
        ? `${folder}/${sanitizeFilename(preset.name)} (${preset.id.slice(0, 8)}).md`
        : desired;
    }
  }

  const frontmatterData: FrontmatterData = {
    mediavault_comfort_preset: true,
    mediavault_preset_id: preset.id,
    mediavault_updated_at: preset.updatedAt,
    type: "comfort-preset",
    title: preset.name,
    description: preset.description,
  };
  const managedBody = buildBody(preset);
  const custom = storage.settings.get().noteCustomMarkdown ?? "";

  const existing = app.vault.getAbstractFileByPath(notePath);
  if (existing instanceof TFile) {
    const cached = app.metadataCache.getFileCache(existing)?.frontmatter;
    if (opts.respectNewerNote) {
      const ts = timestamp(cached?.mediavault_updated_at);
      if (ts && preset.updatedAt && ts > preset.updatedAt) return { notePath, changed: false };
    }
    const existingContent = await app.vault.adapter.read(notePath);
    const mergedBody = applyCustomMarkdown(
      mergeManagedBody(stripLeadingFrontmatter(existingContent), managedBody),
      custom,
    );
    const merged = mergeFrontmatter(frontmatterData, cached ?? null, PRESET_MANAGED_KEYS);
    const finalContent = `${serializeFrontmatter(merged)}\n\n${mergedBody}`;
    if (finalContent === existingContent) return { notePath, changed: false };
    markSelfWrite(notePath);
    await app.vault.adapter.write(notePath, finalContent);
    return { notePath, changed: true };
  }

  const finalContent = `${serializeFrontmatter(frontmatterData)}\n\n${applyCustomMarkdown(
    `# ${preset.name}\n\n${managedBody}\n`,
    custom,
  )}`;
  markSelfWrite(notePath);
  await app.vault.create(notePath, finalContent);
  return { notePath, changed: true };
}

export async function generateAllPresetNotes(
  app: App,
  storage: StorageService,
): Promise<number> {
  const presets = await storage.comfortPresets.findWhere((p) => !p.isBuiltIn);
  let ok = 0;
  for (let i = 0; i < presets.length; i++) {
    try {
      await generatePresetNote(app, storage, presets[i], undefined, {
        respectNewerNote: true,
      });
      ok++;
    } catch (err) {
      console.warn(`MediaVault: failed to write preset note "${presets[i].name}"`, err);
    }
    await maybeYield(i + 1, 5);
  }
  return ok;
}

export type PresetSyncOutcome = "created" | "updated" | "exported" | "unchanged" | "skipped";

export async function syncPresetNote(
  app: App,
  storage: StorageService,
  file: TFile,
  fm: Record<string, unknown>,
): Promise<PresetSyncOutcome> {
  const id = fm.mediavault_preset_id;
  if (typeof id !== "string" || !id) return "skipped";
  const local = await storage.comfortPresets.findById(id);
  const content = await app.vault.adapter.read(file.path);
  const parsed = parsePresetNote(content, fm);

  if (!local) {
    if (!parsed) return "skipped";
    const twin = (await storage.comfortPresets.findWhere((p) => !p.isBuiltIn)).find(
      (p) => fingerprint(p) === fingerprint(parsed),
    );
    if (twin) return "unchanged";
    await storage.comfortPresets.save({
      ...parsed,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    });
    return "created";
  }
  if (local.isBuiltIn) return "skipped";

  const noteTs = timestamp(fm.mediavault_updated_at);
  const localTs = local.updatedAt ?? "";
  if (parsed && noteTs && noteTs > localTs) {
    await storage.comfortPresets.update(id, { ...parsed, id, updatedAt: noteTs });
    return "updated";
  }
  if (!noteTs || noteTs < localTs) {
    const { changed } = await generatePresetNote(app, storage, local, file.path);
    return changed ? "exported" : "unchanged";
  }
  return "unchanged";
}
