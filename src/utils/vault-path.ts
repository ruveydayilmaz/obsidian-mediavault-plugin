const MAX_PATH_LENGTH = 1024;
const DRIVE_PREFIX = /^[a-zA-Z]:/;

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function safeSegments(raw: string): string[] | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_PATH_LENGTH) return null;
  if (value.startsWith("/") || value.includes("\\")) return null;
  if (DRIVE_PREFIX.test(value) || hasControlChars(value)) return null;
  const segments = value.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  for (const segment of segments) {
    if (segment === "." || segment === ".." || segment.startsWith(".")) {
      return null;
    }
    if (segment !== segment.trim()) return null;
  }
  return segments;
}

export function normalizeSafeFolderPath(raw: string): string | null {
  const segments = safeSegments(raw);
  return segments ? segments.join("/") : null;
}

export function isSafeVaultFilePath(raw: string): boolean {
  return safeSegments(raw) !== null;
}

export function isSafeNotePath(raw: string): boolean {
  return isSafeVaultFilePath(raw) && /\.md$/i.test(raw);
}
