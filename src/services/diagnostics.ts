import type { DataAdapter } from "obsidian";

const MAX_EVENTS = 150;
const LOW_PRIORITY = new Set(["cache-write", "markdown-write-progress", "backup-reading-notes"]);
const LOW_PRIORITY_WRITE_GAP_MS = 1500;
const GUARDED_OPS = ["folder-sync", "note-sync", "backup:"];

export interface DiagnosticEvent {
  at: string;
  boot: string;
  op?: number;
  stage: string;
  detail?: Record<string, string | number | boolean>;
}

interface DiagnosticFile {
  format: 1;
  suppressStartupSync: boolean;
  events: DiagnosticEvent[];
}

export interface PreviousSession {
  cleanShutdown: boolean;
  openOperations: string[];
  sameProcess: boolean;
}

function newBootId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export class Diagnostics {
  private events: DiagnosticEvent[] = [];
  private suppress = false;
  private writing = false;
  private dirty = false;
  private ready = false;
  private lastWriteAt = 0;
  readonly bootId = newBootId();
  previous: PreviousSession | null = null;

  constructor(
    private adapter: DataAdapter,
    private path: string,
  ) {}

  get startupSyncSuppressed(): boolean {
    return this.suppress;
  }

  async init(): Promise<void> {
    try {
      if (await this.adapter.exists(this.path)) {
        const prior = JSON.parse(
          await this.adapter.read(this.path),
        ) as DiagnosticFile;
        if (prior && Array.isArray(prior.events)) {
          this.events = prior.events.slice(-MAX_EVENTS);
          this.suppress = prior.suppressStartupSync === true;
          this.previous = this.analysePrevious(prior.events);
          if (
            this.previous &&
            !this.previous.cleanShutdown &&
            this.previous.openOperations.some((n) =>
              GUARDED_OPS.some((g) => n.startsWith(g)),
            )
          ) {
            this.suppress = true;
          }
        }
      }
    } catch {
      this.events = [];
    }
    this.ready = true;
    const origin = Math.round(performance.timeOrigin);
    this.record("plugin-load", {
      processStart: origin,
      previousClean: this.previous ? this.previous.cleanShutdown : true,
      previousOpenOps: this.previous ? this.previous.openOperations.length : 0,
      sameProcessAsPrevious: this.previous ? this.previous.sameProcess : false,
      suppressStartupSync: this.suppress,
    });
  }

  private analysePrevious(events: DiagnosticEvent[]): PreviousSession | null {
    if (events.length === 0) return null;
    const lastBoot = events[events.length - 1].boot;
    const session = events.filter((e) => e.boot === lastBoot);
    const open = new Map<number, string>();
    let origin: number | null = null;
    for (const e of session) {
      if (e.stage === "plugin-load" && typeof e.detail?.processStart === "number") {
        origin = e.detail.processStart;
      }
      if (e.op === undefined) continue;
      if (e.stage === "op-start") open.set(e.op, String(e.detail?.name ?? ""));
      if (e.stage === "op-end" || e.stage === "op-fail") open.delete(e.op);
    }
    const last = session[session.length - 1];
    return {
      cleanShutdown: last.stage === "plugin-unload",
      openOperations: [...open.values()],
      sameProcess: origin !== null && origin === Math.round(performance.timeOrigin),
    };
  }

  record(
    stage: string,
    detail?: Record<string, string | number | boolean>,
    op?: number,
  ): void {
    this.events.push({
      at: new Date().toISOString(),
      boot: this.bootId,
      op,
      stage,
      detail,
    });
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }
    if (
      LOW_PRIORITY.has(stage) &&
      Date.now() - this.lastWriteAt < LOW_PRIORITY_WRITE_GAP_MS
    ) {
      return;
    }
    this.schedule();
  }

  markSyncHealthy(): void {
    if (!this.suppress) return;
    this.suppress = false;
    this.record("startup-sync-guard-cleared");
  }

  private schedule(): void {
    if (!this.ready) return;
    if (this.writing) {
      this.dirty = true;
      return;
    }
    void this.write();
  }

  private async write(): Promise<void> {
    this.writing = true;
    this.lastWriteAt = Date.now();
    try {
      do {
        this.dirty = false;
        const body: DiagnosticFile = {
          format: 1,
          suppressStartupSync: this.suppress,
          events: this.events,
        };
        await this.adapter.write(this.path, JSON.stringify(body));
      } while (this.dirty);
    } catch {
      this.dirty = false;
    } finally {
      this.writing = false;
    }
  }

  async flush(): Promise<void> {
    while (this.writing) await new Promise((r) => window.setTimeout(r, 10));
    await this.write();
  }
}
