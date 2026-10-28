const TTL_MS = 60000;
const recent = new Map<string, number>();

export function markSelfWrite(path: string): void {
  const now = Date.now();
  recent.set(path, now + TTL_MS);
  if (recent.size > 2000) {
    for (const [p, until] of recent) if (until < now) recent.delete(p);
  }
}

export function isRecentSelfWrite(path: string): boolean {
  const until = recent.get(path);
  if (until === undefined) return false;
  if (until < Date.now()) {
    recent.delete(path);
    return false;
  }
  return true;
}
