import type { Diagnostics } from "./diagnostics";

let journal: Diagnostics | null = null;

export function setJournal(d: Diagnostics | null): void {
  journal = d;
}

export function journalEvent(
  stage: string,
  detail?: Record<string, string | number | boolean>,
  op?: number,
): void {
  journal?.record(stage, detail, op);
}

const active = new Map<string, { id: number; startedAt: number }>();
let counter = 0;

export function getActiveOperations(): string[] {
  return [...active.keys()];
}

export function isOperationActive(name: string): boolean {
  return active.has(name);
}

export interface TrackOptions {
  exclusive?: boolean;
}

export async function trackOperation<T>(
  name: string,
  fn: () => Promise<T>,
  opts: TrackOptions = {},
): Promise<{ ran: true; value: T } | { ran: false }> {
  if (active.has(name)) {
    console.warn(`MediaVault: "${name}" requested while already running`);
    journalEvent("op-rejected-duplicate", { name });
    if (opts.exclusive) return { ran: false };
  }
  const isNested = (a: string, b: string): boolean => {
    const parent = (n: string) => n.startsWith("folder-sync") || n.startsWith("note-sync");
    return (a.startsWith("backup:") && parent(b)) || (b.startsWith("backup:") && parent(a));
  };
  const others = [...active.keys()].filter(
    (n) => n !== name && !isNested(name, n),
  );
  if (others.length > 0) {
    console.warn(
      `MediaVault: "${name}" is overlapping with ${others.map((n) => `"${n}"`).join(", ")}`,
    );
  }
  const id = ++counter;
  const startedAt = Date.now();
  active.set(name, { id, startedAt });
  console.debug(`MediaVault: ${name} started`);
  journalEvent("op-start", { name, concurrent: others.length }, id);
  try {
    const value = await fn();
    console.debug(`MediaVault: ${name} finished in ${Date.now() - startedAt}ms`);
    journalEvent("op-end", { name, ms: Date.now() - startedAt }, id);
    return { ran: true, value };
  } catch (err) {
    console.warn(
      `MediaVault: ${name} failed after ${Date.now() - startedAt}ms:`,
      err instanceof Error ? err.message : "unknown error",
    );
    journalEvent(
      "op-fail",
      { name, ms: Date.now() - startedAt, error: err instanceof Error ? err.message.slice(0, 120) : "unknown" },
      id,
    );
    throw err;
  } finally {
    if (active.get(name)?.id === id) active.delete(name);
  }
}
