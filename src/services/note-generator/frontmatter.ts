export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | number[];
export type FrontmatterData = Record<string, FrontmatterValue | undefined>;

export function mergeFrontmatter(
  generated: FrontmatterData,
  existing: Record<string, unknown> | null | undefined,
  managedKeys: Set<string>,
): FrontmatterData {
  const merged: FrontmatterData = { ...generated };

  if (existing) {
    for (const [key, value] of Object.entries(existing)) {
      if (managedKeys.has(key)) continue;
      if (key === "position") continue; // metadata cache internal field
      merged[key] = value as FrontmatterValue;
    }
  }

  return merged;
}

function needsQuoting(value: string): boolean {
  if (value === "") return true;
  return (
    // eslint-disable-next-line no-control-regex -- control
    /[\u0000-\u001f\u007f\u0085\u2028\u2029]/.test(value) ||
    /^[-?:](\s|$)/.test(value) ||
    /\s#/.test(value) ||
    /:$/.test(value) ||
    /^[-+]?(\d[\d_]*\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(value) ||
    /^0[xob][\da-f]+$/i.test(value) ||
    /^(yes|no|on|off|y|n)$/i.test(value) ||
    /^[<[\]{}#&*!|>'"%@`]/.test(value) ||
    /^(true|false|null|~)$/i.test(value) ||
    /:\s/.test(value) ||
    /^\s|\s$/.test(value) ||
    /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}|$)/.test(value)
  );
}

function escapeDoubleQuoted(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20 || code === 0x7f) {
      out += `\\x${code.toString(16).padStart(2, "0")}`;
    } else if (code === 0x85) out += "\\N";
    else if (code === 0x2028) out += "\\L";
    else if (code === 0x2029) out += "\\P";
    else out += ch;
  }
  return out;
}

function serializeScalar(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (typeof value === "string") {
    if (needsQuoting(value)) {
      return `"${escapeDoubleQuoted(value)}"`;
    }
    return value;
  }

  return serializeScalar(JSON.stringify(value));
}

export function serializeFrontmatter(data: FrontmatterData): string {
  const lines: string[] = ["---"];

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        value.forEach((item) => lines.push(`  - ${serializeScalar(item)}`));
      }
    } else {
      lines.push(`${key}: ${serializeScalar(value)}`);
    }
  }

  lines.push("---");
  return lines.join("\n");
}
