import JSZip from "jszip";
import { runImport } from "./manager";
import {
  DetectionResult,
  ImportCategory,
  NormalizedImportBundle,
  emptyBundle,
  mergeBundles,
} from "./types";
import { parseGdprArchive } from "./gdpr";
import { ImportTimer } from "../import-timer";
import { maybeYield } from "../yield";

const FILENAME_COLUMN_RENAMES: Record<string, Record<string, string>> = {
  "seen_episode_latest.csv": { created_at: "watched_at" },
  "rewatched_episode.csv": { created_at: "watched_at" },
};

function renameCsvHeaderColumns(
  content: string,
  renames: Record<string, string>,
): string {
  const nlIndex = content.indexOf("\n");
  const headerLine = nlIndex === -1 ? content : content.slice(0, nlIndex);
  const restContent = nlIndex === -1 ? "" : content.slice(nlIndex + 1);
  const hasTrailingCR = headerLine.endsWith("\r");
  const cleanHeader = hasTrailingCR ? headerLine.slice(0, -1) : headerLine;

  const renamedHeader = cleanHeader
    .split(",")
    .map((h) => renames[h.trim()] ?? h)
    .join(",");

  return (
    renamedHeader +
    (hasTrailingCR ? "\r" : "") +
    (nlIndex === -1 ? "" : "\n" + restContent)
  );
}

export interface ZipFileResult {
  filename: string;
  detection: DetectionResult;
  rowCount: number;
  unsupported: boolean;
  diagnosticLines?: string[];
}

export interface ZipImportResult {
  bundle: NormalizedImportBundle;
  files: ZipFileResult[];
  supportedCount: number;
  unsupportedCount: number;
  timing: { stage: string; ms: number; calls: number }[];
}

const KNOWN_NON_IMPORTABLE = new Set([
  "comment_translation.csv",
  "tracking-deployment-prod-tracks.csv",
  "tracking-prod-count-by-timeframe.csv",
  "recommendations-prod-user-scores.csv",
  "recommendations-prod-user-shows.csv",
  "episode_comment_like.csv",
  "followed_tv_show_source.csv",
  "show_character_episode_vote.csv",
  "emotions-3-prod-episode_votes.csv",
  "emotions-live-votes.csv",
  "emotions-v2-prod-votes.csv",
  "episode_emotion.csv",
  "users-customization-prod-data.csv",
]);

const NON_IMPORTABLE_REASONS: Record<string, string> = {
  "comment_translation.csv":
    "Machine-translated copies of comments already imported from their source file, ignored to avoid duplicates.",
  "tracking-deployment-prod-tracks.csv":
    "App deployment/version tracking, not user watch activity: ignored.",
  "tracking-prod-count-by-timeframe.csv":
    "Pre-aggregated stat counters TV Time computed for its own UI: MediaVault derives the same stats live from imported watch history, so this is ignored.",
  "recommendations-prod-user-scores.csv":
    "TV Time's internal recommendation-engine scores: not user activity, ignored.",
  "recommendations-prod-user-shows.csv":
    "TV Time's internal recommendation-engine inputs: not user activity, ignored.",
  "episode_comment_like.csv":
    "Likes on other users' comments: no corresponding concept in MediaVault, ignored.",
  "followed_tv_show_source.csv":
    "Attribution for how a follow happened (search, notification, etc.). The follow itself is read from followed_tv_show.csv; this file adds no importable data.",
  "show_character_episode_vote.csv":
    "Character popularity votes: no corresponding concept in MediaVault, ignored.",
  "emotions-3-prod-episode_votes.csv":
    "Emotion reactions on episodes: no corresponding concept in MediaVault, ignored.",
  "emotions-live-votes.csv":
    "Emotion reactions on movies: no corresponding concept in MediaVault, ignored.",
  "emotions-v2-prod-votes.csv":
    "Emotion reactions: no corresponding concept in MediaVault, ignored.",
  "episode_emotion.csv":
    "Emotion reactions on episodes: no corresponding concept in MediaVault, ignored.",
  "users-customization-prod-data.csv":
    "TV Time app theme/UI preferences: not importable data, ignored.",
};

const GDPR_RELATIONAL_FILES = new Set([
  // Watch history
  "tracking-prod-records-v2.csv",
  "tracking-prod-records.csv",
  "rewatched_episode.csv",
  "show_seen_episode_latest.csv",
  "seen_episode_latest.csv",
  // Ratings / reactions
  "ratings-3-prod-episode_votes.csv",
  "ratings-v2-prod-votes.csv",
  "ratings-prod-episode_votes.csv",
  "ratings-live-votes.csv",
  // Comments / reviews
  "comments-prod-comments.csv",
  "episode_comment.csv",
  "show_comment.csv",
  // Status / favorites
  "user_show_special_status.csv",
  "user_tv_show_data.csv",
  "followed_tv_show.csv",
  // Custom lists
  "lists-prod-lists.csv",
]);

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1];
}

export async function runZipImport(
  zipData: ArrayBuffer,
  onProgress?: (done: number, total: number, stage: string) => void,
): Promise<ZipImportResult> {
  const timer = new ImportTimer();

  onProgress?.(0, 1, "Reading ZIP");

  let zip: JSZip;
  try {
    zip = await timer.time("ZIP extraction", () => JSZip.loadAsync(zipData));
  } catch (err) {
    throw new Error(
      `Couldn't open this ZIP file, it may be corrupted. (${(err as Error).message})`,
    );
  }

  const entries = Object.values(zip.files).filter(
    (entry) => !entry.dir && /\.(csv|json)$/i.test(entry.name),
  );

  onProgress?.(0, Math.max(entries.length, 1), "Extracting files");

  const bundles: NormalizedImportBundle[] = [];
  const files: ZipFileResult[] = [];
  let done = 0;

  const contents = new Map<string, string>();
  for (const entry of entries) {
    const name = basename(entry.name);

    if (KNOWN_NON_IMPORTABLE.has(name.toLowerCase())) {
      files.push({
        filename: name,
        detection: {
          format: "csv",
          category: "unknown",
          label:
            NON_IMPORTABLE_REASONS[name.toLowerCase()] ??
            "Not user activity data, ignored.",
        },
        rowCount: 0,
        unsupported: true,
      });
      done++;
      onProgress?.(done, entries.length, "Extracting files");
      await maybeYield(done, 5);
      continue;
    }

    try {
      let content = await timer.time("ZIP extraction", () =>
        entry.async("text"),
      );
      contents.set(name.toLowerCase(), content);

      if (GDPR_RELATIONAL_FILES.has(name.toLowerCase())) {
        files.push({
          filename: name,
          detection: {
            format: "csv",
            category: "unknown",
            label: "TV Time GDPR data",
          },
          rowCount: 0,
          unsupported: false,
        });
        done++;
        onProgress?.(done, entries.length, "Extracting files");
        await maybeYield(done, 5);
        continue;
      }

      const renames = FILENAME_COLUMN_RENAMES[name.toLowerCase()];
      if (renames && !/\.json$/i.test(name)) {
        content = renameCsvHeaderColumns(content, renames);
      }

      onProgress?.(done, entries.length, "Parsing CSVs");
      const result = await timer.time("CSV/JSON parsing", async () =>
        runImport(content),
      );
      bundles.push(result.bundle);
      files.push({
        filename: name,
        detection: result.detection,
        rowCount:
          result.bundle.watches.length +
          result.bundle.reviews.length +
          result.bundle.likes.length +
          result.bundle.ratings.length +
          result.bundle.favorites.length +
          result.bundle.lists.length,
        unsupported: result.unsupported,
      });
    } catch (err) {
      files.push({
        filename: name,
        detection: {
          format: "csv",
          category: "unknown",
          label: `Couldn't read this file (${(err as Error).message})`,
        },
        rowCount: 0,
        unsupported: true,
      });
    }

    done++;
    onProgress?.(done, entries.length, "Extracting files");
    await maybeYield(done, 5);
  }

  const gdprBundles = await timer.time("CSV/JSON parsing", () =>
    parseGdprArchive(contents, (gdone, gtotal, stage) => {
      onProgress?.(gdone, gtotal, stage);
    }),
  );
  for (const [filename, bundle] of gdprBundles) {
    const file = files.find((f) => f.filename.toLowerCase() === filename);
    if (file) {
      file.detection = {
        format: "csv",
        category: gdprCategory(filename),
        label: gdprLabel(filename),
      };
      file.rowCount =
        bundle.watches.length +
        bundle.reviews.length +
        bundle.ratings.length +
        bundle.favorites.length +
        bundle.lists.length +
        bundle.dropped.length;
      file.unsupported = false;

      if (filename === "lists-prod-lists.csv") {
        const d = bundle.listDiagnostics;
        file.diagnosticLines = [
          `Collection entries: ${d.listsDiscovered}`,
          `Custom lists: ${d.customListsDiscovered}`,
          `Built-in lists: ${d.builtInListsDiscovered}`,
          `List item rows: ${d.listItemRows}`,
          `Total list items: ${d.totalListItemsParsed}`,
          ...(d.unresolvedMovieUuids.length > 0
            ? [`Unresolved movie UUIDs: ${d.unresolvedMovieUuids.length}`]
            : []),
          "",
          ...d.perList.flatMap((l) => [
            `${l.name}`,
            `  Items: ${l.items}  Resolved: ${l.resolved}  Skipped: ${l.skipped}`,
          ]),
        ];
      }

      if (filename === "tracking-prod-records-v2.csv") {
        const dd = bundle.droppedDiagnostics;
        if (dd.archivedRowsFound > 0) {
          file.diagnosticLines = [
            ...(file.diagnosticLines ?? []),
            `Dropped records found: ${dd.archivedRowsFound}`,
            `Dropped movies: ${dd.droppedMovies}`,
            `Dropped TV series: ${dd.droppedSeries}`,
          ];
        }
      }
    }
    bundles.push(bundle);
  }

  onProgress?.(1, 1, "Finalizing");

  const bundle = bundles.length > 0 ? mergeBundles(bundles) : emptyBundle();
  const supportedCount = files.filter((f) => !f.unsupported).length;

  return {
    bundle,
    files,
    supportedCount,
    unsupportedCount: files.length - supportedCount,
    timing: timer.breakdown(),
  };
}

function gdprCategory(filename: string): ImportCategory {
  if (
    filename.includes("tracking") ||
    filename.includes("rewatched") ||
    filename.includes("seen_episode") ||
    filename.includes("special_status")
  )
    return "csv_watched_episodes";
  if (filename.includes("ratings")) return "csv_ratings";
  if (filename.includes("comment")) return "csv_comments";
  if (filename.includes("lists")) return "json_list";
  if (filename.includes("user_tv_show_data")) return "csv_favorites";
  if (filename.includes("followed_tv_show")) return "csv_favorites";
  return "unknown";
}

function gdprLabel(filename: string): string {
  if (filename.includes("tracking-prod-records"))
    return "TV Time Tracking History";
  if (filename.includes("rewatched")) return "TV Time Rewatched Episodes";
  if (filename.includes("seen_episode")) return "TV Time Episode Progress";
  if (filename.includes("ratings")) return "TV Time Reactions";
  if (filename.includes("comments-prod")) return "TV Time Comments";
  if (filename.includes("episode_comment")) return "TV Time Episode Comments";
  if (filename.includes("show_comment")) return "TV Time Show Comments";
  if (filename.includes("special_status"))
    return "TV Time Watch Later / Favorites";
  if (filename.includes("user_tv_show_data")) return "TV Time Show Favorites";
  if (filename.includes("followed_tv_show")) return "TV Time Followed Shows";
  if (filename.includes("lists")) return "TV Time Custom Lists";
  return "TV Time GDPR Data";
}
