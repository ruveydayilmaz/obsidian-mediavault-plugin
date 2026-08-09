import { parseImportFile, detectFormat, parseCSV, parseJSON } from "../parse";
import {
  TVTimeImporter,
  DetectionResult,
  NormalizedImportBundle,
  emptyBundle,
} from "./types";
import { JsonSeriesImporter } from "./json-series";
import { JsonMovieImporter } from "./json-movie";
import { JsonListImporter } from "./json-list";
import { CsvFollowedShowsImporter } from "./csv-followed-shows";
import {
  CsvCommentsImporter,
  CsvLikesImporter,
  CsvRatingsImporter,
  CsvFavoritesImporter,
  CsvWatchedEpisodesImporter,
  CsvWatchedMoviesImporter,
} from "./csv-generic";

const IMPORTERS: TVTimeImporter[] = [
  JsonSeriesImporter,
  JsonMovieImporter,
  JsonListImporter,
  CsvFollowedShowsImporter,
  CsvCommentsImporter,
  CsvLikesImporter,
  CsvRatingsImporter,
  CsvFavoritesImporter,
  CsvWatchedEpisodesImporter,
  CsvWatchedMoviesImporter,
];

export interface ImportManagerResult {
  detection: DetectionResult;
  bundle: NormalizedImportBundle;
  unsupported: boolean;
}

export function runImport(fileContent: string): ImportManagerResult {
  const format = detectFormat(fileContent);
  const parsed: unknown =
    format === "json" ? parseJSON(fileContent) : parseCSV(fileContent);

  for (const importer of IMPORTERS) {
    if (importer.detect(parsed, format)) {
      const bundle = importer.parse(parsed);
      return {
        detection: {
          format,
          category: importer.category,
          label: importer.label,
        },
        bundle,
        unsupported: false,
      };
    }
  }

  return {
    detection: { format, category: "unknown", label: "Unrecognized format" },
    bundle: emptyBundle(),
    unsupported: true,
  };
}

export { parseImportFile };
