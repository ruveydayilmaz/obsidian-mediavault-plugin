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
    /^[<[\]{}#&*!|>'"%@`]/.test(value) ||
    /^(true|false|null|~)$/i.test(value) ||
    /:\s/.test(value) ||
    /^\s|\s$/.test(value)
  );
}

function serializeScalar(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (typeof value === "string") {
    if (needsQuoting(value)) {
      return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
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
