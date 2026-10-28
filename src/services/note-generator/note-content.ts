import { MediaItem } from "../../models/media";
import { WatchSession } from "../../models/review";
import { sortSessionsChronological } from "../review-logic";
import { NoteTemplateSettings } from "../../settings/settings";
import { CREW_ROLE_JOBS } from "../../api/tmdb-normalize";

export const MANAGED_START = "<!-- mediavault:start -->";
export const MANAGED_END = "<!-- mediavault:end -->";

function slugTag(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function crewNames(media: MediaItem, jobs: readonly string[]): string[] {
  const jobSet = new Set(jobs);
  const names = new Set<string>();
  media.crew
    .filter((c) => jobSet.has(c.job))
    .forEach((c) => names.add(c.name));
  return [...names];
}

export function buildManagedBody(
  media: MediaItem,
  sessions: WatchSession[],
  sections: NoteTemplateSettings["sections"],
  dataBlock?: string,
): string {
  const lines: string[] = [MANAGED_START];

  if (sections.genreTags && media.genres.length > 0) {
    lines.push(
      "",
      `Tags: ${media.genres.map((g) => `#${slugTag(g)}`).join(" ")}`,
    );
  }

  if (sections.synopsis && media.synopsis) {
    lines.push("", "## Synopsis", "", media.synopsis);
  }

  if (sections.cast && media.cast.length > 0) {
    lines.push("", "## Cast", "");
    media.cast.slice(0, 10).forEach((c) => {
      lines.push(`- [[${c.name}]] as ${c.character}`);
    });
  }

  if (sections.directors) {
    const directors = crewNames(media, CREW_ROLE_JOBS.Director);
    if (directors.length > 0) {
      lines.push("", "## Directors", "");
      directors.forEach((name) => lines.push(`- [[${name}]]`));
    }
  }

  if (sections.producers) {
    const producers = crewNames(media, CREW_ROLE_JOBS.Producer);
    if (producers.length > 0) {
      lines.push("", "## Producers", "");
      producers.forEach((name) => lines.push(`- [[${name}]]`));
    }
  }

  if (sections.crew && media.crew.length > 0) {
    lines.push("", "## Crew", "");
    const seen = new Set<string>();
    media.crew.slice(0, 15).forEach((c) => {
      const key = `${c.name}:${c.job}`;
      if (seen.has(key)) return;
      seen.add(key);
      lines.push(`- [[${c.name}]] — ${c.job}`);
    });
  }

  if (sections.watchHistory) {
    lines.push("", "## Watch History", "");
    const sorted = sortSessionsChronological(sessions);
    if (sorted.length === 0) {
      lines.push("_No watches logged yet._");
    } else {
      sorted.forEach((s) => {
        const label =
          s.rewatchNumber === 0
            ? "First watch"
            : `Rewatch #${s.rewatchNumber}`;
        const ratingText = s.rating !== null ? ` — ${s.rating}` : "";
        lines.push(
          `- **${label}** (${s.watchDate})${ratingText}${s.review ? `: ${s.review}` : ""}`,
        );
      });
    }
  }

  if (dataBlock) lines.push("", dataBlock);

  lines.push("", MANAGED_END);
  return lines.join("\n");
}

export function mergeManagedBody(
  existingContent: string,
  newManagedBody: string,
): string {
  const startIdx = existingContent.indexOf(MANAGED_START);
  const endIdx = existingContent.indexOf(MANAGED_END);

  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    const trimmed = existingContent.trimEnd();
    return trimmed.length > 0
      ? `${trimmed}\n\n${newManagedBody}\n`
      : `${newManagedBody}\n`;
  }

  const before = existingContent.slice(0, startIdx);
  const after = existingContent.slice(endIdx + MANAGED_END.length);
  return `${before}${newManagedBody}${after}`;
}

export const CUSTOM_START = "<!-- mediavault:custom:start -->";
export const CUSTOM_END = "<!-- mediavault:custom:end -->";

function normalizeCustom(custom: string): string {
  return custom
    .replace(/\r\n/g, "\n")
    .replace(/^\n+|\s+$/g, "")
    .split("<!-- mediavault:custom")
    .join("<!-- mediavault-custom");
}

export function stripCustomBlock(content: string): string {
  const si = content.indexOf(CUSTOM_START);
  const ei = content.indexOf(CUSTOM_END);
  if (si === -1 || ei < si) return content;
  return content.slice(0, si) + content.slice(ei + CUSTOM_END.length);
}

export function applyCustomMarkdown(body: string, custom: string): string {
  const text = normalizeCustom(custom);
  const si = body.indexOf(CUSTOM_START);
  const ei = body.indexOf(CUSTOM_END);
  const hasBlock = si !== -1 && ei > si;

  if (!text) {
    if (!hasBlock) return body;
    const before = body.slice(0, si).trimEnd();
    const after = body.slice(ei + CUSTOM_END.length).trim();
    return after ? `${before}\n\n${after}\n` : `${before}\n`;
  }

  const block = `${CUSTOM_START}\n${text}\n${CUSTOM_END}`;
  if (hasBlock) {
    return `${body.slice(0, si)}${block}${body.slice(ei + CUSTOM_END.length)}`;
  }
  return `${body.trimEnd()}\n\n${block}\n`;
}
