import { TVTimeImporter, emptyBundle, FavoriteImport } from "./types";
import { RawImportRow } from "../parse";

const REQUIRED_COLUMNS = ["tv_show_name", "tv_show_id", "is_favorited"];

function hasColumns(rows: RawImportRow[]): boolean {
  if (rows.length === 0) return false;
  const headers = Object.keys(rows[0]).map((h) => h.toLowerCase());
  return REQUIRED_COLUMNS.every((col) => headers.includes(col));
}

export const CsvFollowedShowsImporter: TVTimeImporter = {
  category: "csv_followed_shows",
  label: "Followed / Favorited Shows",

  detect(parsed, format) {
    if (format !== "csv") return false;
    return hasColumns(parsed as RawImportRow[]);
  },

  parse(parsed) {
    const bundle = emptyBundle();
    const rows = parsed as RawImportRow[];

    rows.forEach((row, i) => {
      const title = row["tv_show_name"]?.trim();
      if (!title) {
        bundle.warnings.push({ row: i, reason: "Row missing tv_show_name." });
        return;
      }

      const tvShowId = parseInt(row["tv_show_id"], 10);
      const isFavorited = row["is_favorited"]?.trim() === "1";
      const episodesSeen = parseInt(row["nb_episodes_seen"], 10) || 0;

      if (isFavorited) {
        const fav: FavoriteImport = {
          kind: "series",
          ids: { tvdbId: isNaN(tvShowId) ? null : tvShowId },
          title,
          year: null,
        };
        bundle.favorites.push(fav);
      }

      if (episodesSeen > 0) {
        bundle.warnings.push({
          row: i,
          reason: `"${title}": TV Time reports ${episodesSeen} episode(s) seen, but this export doesn't say which, import episode-level watch history separately (JSON export or per-episode CSV) to get accurate progress.`,
        });
      }
    });

    return bundle;
  },
};
