import {
  TVTimeImporter,
  NormalizedImportBundle,
  emptyBundle,
  ImportMediaKind,
} from "./types";

interface RawTVTimeListItem {
  type?: string;
  tvdb_id?: number;
  name?: string;
  custom_order?: number;
}

interface RawTVTimeList {
  id?: string;
  name?: string;
  description?: string | null;
  items?: RawTVTimeListItem[];
}

function looksLikeList(obj: unknown): obj is RawTVTimeList {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.name === "string" && Array.isArray(o.items) && !("seasons" in o)
  );
}

function toMediaKind(rawType: string | undefined): ImportMediaKind {
  return rawType === "series" ? "series" : "movie";
}

export const JsonListImporter: TVTimeImporter = {
  category: "json_list",
  label: "Custom List",

  detect(parsed, format) {
    if (format !== "json") return false;
    if (Array.isArray(parsed))
      return parsed.length > 0 && looksLikeList(parsed[0]);
    return looksLikeList(parsed);
  },

  parse(parsed: unknown): NormalizedImportBundle {
    const bundle = emptyBundle();
    const rawLists: RawTVTimeList[] = Array.isArray(parsed)
      ? parsed.filter(looksLikeList)
      : looksLikeList(parsed)
        ? [parsed]
        : [];

    for (const raw of rawLists) {
      if (!raw.name) continue;
      bundle.lists.push({
        name: raw.name,
        description: raw.description ?? null,
        sourceKey: raw.id ? `id:${raw.id}` : `name:${raw.name.toLowerCase()}`,
        items: (raw.items ?? [])
          .filter((item) => typeof item.name === "string")
          .map((item) => ({
            kind: toMediaKind(item.type),
            ids: { tvdbId: item.tvdb_id ?? null },
            title: item.name as string,
            year: null,
          })),
      });
    }

    return bundle;
  },
};
