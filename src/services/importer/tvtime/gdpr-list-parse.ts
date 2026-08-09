export interface GoMapListItem {
  type: string | null;
  uuid: string | null;
  tvTimeId: string | null;
  createdAt: string | null;
}

function epochToISODate(raw: string): string | null {
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function parseGoMap(block: string): Record<string, string> {
  const result: Record<string, string> = {};
  const tokens = block.trim().split(/\s+/);
  for (const token of tokens) {
    const colonIdx = token.indexOf(":");
    if (colonIdx <= 0) continue;
    const key = token.slice(0, colonIdx);
    const value = token.slice(colonIdx + 1);
    result[key] = value;
  }
  return result;
}

function parseGoMapArrayLiteral(raw: string): GoMapListItem[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "[]") return [];

  const inner =
    trimmed.startsWith("[") && trimmed.endsWith("]")
      ? trimmed.slice(1, -1).trim()
      : trimmed;

  if (!inner) return [];

  const chunks = inner.split("map[");
  const items: GoMapListItem[] = [];

  for (const chunk of chunks) {
    const cleaned = chunk.trim();
    if (!cleaned) continue;

    const body = cleaned.endsWith("]") ? cleaned.slice(0, -1) : cleaned;
    if (!body.trim()) continue;

    const fields = parseGoMap(body);

    items.push({
      type: fields["type"] || null,
      uuid: fields["uuid"] || null,
      tvTimeId: fields["id"] || null,
      createdAt: fields["created_at"]
        ? epochToISODate(fields["created_at"])
        : null,
    });
  }

  return items;
}

interface RawJsonListObject {
  type?: string | number | null;
  uuid?: string | number | null;
  id?: string | number | null;
  created_at?: string | number | null;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const s = String(value).trim();
  return s || null;
}

function parseJsonObjectsArray(raw: string): GoMapListItem[] | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;

  return data.map((entry) => {
    const obj = (entry ?? {}) as RawJsonListObject; // fix later
    const createdAt = toStringOrNull(obj.created_at);
    return {
      type: toStringOrNull(obj.type),
      uuid: toStringOrNull(obj.uuid),
      tvTimeId: toStringOrNull(obj.id),
      createdAt: createdAt ? epochToISODate(createdAt) : null,
    };
  });
}

export function parseGoMapArray(raw: string): GoMapListItem[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "[]") return [];

  if (trimmed.includes("map[")) {
    return parseGoMapArrayLiteral(trimmed);
  }

  const asJson = parseJsonObjectsArray(trimmed);
  if (asJson) return asJson;

  return parseGoMapArrayLiteral(trimmed);
}

export type GoMapObject = Record<string, string | string[]>;

const LIST_METADATA_KEYS = [
  "created_at",
  "description",
  "fanart",
  "is_public",
  "name",
  "order",
  "posters",
  "s_key",
  "type",
  "updated_at",
  "user_id",
];
const NEXT_KEY_BOUNDARY = new RegExp(`\\s(?:${LIST_METADATA_KEYS.join("|")}):`);

function parseGoMapBody(body: string): GoMapObject {
  const result: GoMapObject = {};
  let i = 0;
  const n = body.length;

  while (i < n) {
    while (i < n && /\s/.test(body[i])) i++;
    if (i >= n) break;

    const colonIdx = body.indexOf(":", i);
    if (colonIdx === -1) break;
    const key = body.slice(i, colonIdx);
    i = colonIdx + 1;

    if (body[i] === "[") {
      let depth = 1;
      i++;
      const start = i;
      while (i < n && depth > 0) {
        if (body[i] === "[") depth++;
        else if (body[i] === "]") depth--;
        if (depth > 0) i++;
      }
      const arrBody = body.slice(start, i);
      i++;
      result[key] = arrBody.trim() ? arrBody.trim().split(/\s+/) : [];
    } else {
      const rest = body.slice(i);
      const boundary = NEXT_KEY_BOUNDARY.exec(rest);
      const valueEnd = boundary ? boundary.index : rest.length;
      const rawValue = rest.slice(0, valueEnd).trim();

      result[key] = rawValue === "<nil>" ? "" : rawValue;
      i += valueEnd;
    }
  }

  return result;
}

function parseGoMapObjectsLiteral(raw: string): GoMapObject[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "[]") return [];

  const inner =
    trimmed.startsWith("[") && trimmed.endsWith("]")
      ? trimmed.slice(1, -1)
      : trimmed;

  const objects: GoMapObject[] = [];
  let i = 0;
  const n = inner.length;

  while (i < n) {
    while (i < n && /\s/.test(inner[i])) i++;
    if (i >= n) break;

    if (inner.startsWith("map[", i)) {
      i += 4;
      let depth = 1;
      const start = i;
      while (i < n && depth > 0) {
        if (inner[i] === "[") depth++;
        else if (inner[i] === "]") depth--;
        if (depth > 0) i++;
      }
      const body = inner.slice(start, i);
      i++;
      objects.push(parseGoMapBody(body));
    } else {
      i++;
    }
  }

  return objects;
}

function parseJsonObjectArray(raw: string): GoMapObject[] | null {
  let data: unknown;

  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(data)) return null;

  return data.map((entry) => {
    const obj =
      entry !== null && typeof entry === "object"
        ? (entry as Record<string, unknown>)
        : {};

    const out: GoMapObject = {};

    for (const [key, value] of Object.entries(obj)) {
      const converted = toGoMapValue(value);

      if (converted !== null) {
        out[key] = converted;
      }
    }

    return out;
  });
}

function toGoMapValue(value: unknown): string | string[] | null {
  if (Array.isArray(value)) {
    return value
      .filter(
        (v): v is string | number | boolean =>
          typeof v === "string" ||
          typeof v === "number" ||
          typeof v === "boolean",
      )
      .map(String);
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  return null;
}

export function parseGoMapObjectsArray(raw: string): GoMapObject[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "[]") return [];

  if (trimmed.includes("map[")) {
    return parseGoMapObjectsLiteral(trimmed);
  }

  const asJson = parseJsonObjectArray(trimmed);
  if (asJson) return asJson;

  return parseGoMapObjectsLiteral(trimmed);
}

function firstString(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value.trim() ? value : null;
}

function stringArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.filter((v) => v.trim().length > 0);
  return value.trim() ? [value] : [];
}

export interface ListMetadata {
  sKey: string | null;
  name: string | null;
  description: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  isPublic: boolean;
  posterUrls: string[];
  fanartUrls: string[];
  type: string | null;
}

export function parseListMetadata(obj: GoMapObject): ListMetadata {
  const createdAtRaw = firstString(obj["created_at"]);
  const updatedAtRaw = firstString(obj["updated_at"]);
  const isPublicRaw = firstString(obj["is_public"]);
  return {
    sKey: firstString(obj["s_key"]),
    name: firstString(obj["name"]),
    description: firstString(obj["description"]),
    createdAt: createdAtRaw ? epochToISODate(createdAtRaw) : null,
    updatedAt: updatedAtRaw ? epochToISODate(updatedAtRaw) : null,
    isPublic: isPublicRaw === "true" || isPublicRaw === "1",
    posterUrls: stringArray(obj["posters"]),
    fanartUrls: stringArray(obj["fanart"]),
    type: firstString(obj["type"]),
  };
}
