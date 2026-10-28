export type SyncStage =
  | "queued"
  | "backup"
  | "preparing"
  | "syncing"
  | "finalizing"
  | "completed"
  | "failed"
  | "skipped";

export interface SyncSummary {
  checked: number;
  cache: number;
  folder: number;
  artwork: number;
  conflicts: number;
}

export interface SyncStatusState {
  active: boolean;
  manual: boolean;
  stage: SyncStage | "idle";
  done: number;
  total: number | null;
  failedStage: SyncStage | null;
  errorKey: string | null;
  errorDetail: string | null;
  changesBegun: boolean;
  backupRetained: boolean;
  summary: SyncSummary | null;
  startedAt: number;
}

type Listener = (state: SyncStatusState) => void;

const PROGRESS_EMIT_MS = 120;

function idle(): SyncStatusState {
  return {
    active: false,
    manual: false,
    stage: "idle",
    done: 0,
    total: null,
    failedStage: null,
    errorKey: null,
    errorDetail: null,
    changesBegun: false,
    backupRetained: false,
    summary: null,
    startedAt: 0,
  };
}

class SyncStatusTracker {
  state: SyncStatusState = idle();
  private listeners = new Set<Listener>();
  private lastProgressEmit = 0;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snapshot = { ...this.state };
    this.listeners.forEach((l) => l(snapshot));
  }

  get running(): boolean {
    return this.state.active;
  }

  begin(manual: boolean, queued: boolean): void {
    this.state = {
      ...idle(),
      active: true,
      manual,
      stage: queued ? "queued" : "backup",
      startedAt: Date.now(),
    };
    this.emit();
  }

  adopt(manual: boolean): void {
    if (!this.state.active) this.begin(manual, false);
  }

  setStage(stage: SyncStage, patch: Partial<SyncStatusState> = {}): void {
    if (!this.state.active) return;
    this.state = {
      ...this.state,
      ...patch,
      stage,
      done: 0,
      total: null,
    };
    this.emit();
  }

  progress(done: number, total: number | null): void {
    if (!this.state.active) return;
    this.state = { ...this.state, done, total };
    const now = Date.now();
    if (now - this.lastProgressEmit < PROGRESS_EMIT_MS) return;
    this.lastProgressEmit = now;
    this.emit();
  }

  markBackupRetained(): void {
    if (!this.state.active) return;
    this.state = { ...this.state, backupRetained: true };
    this.emit();
  }

  complete(summary: SyncSummary): void {
    if (!this.state.active) return;
    this.state = {
      ...this.state,
      active: false,
      stage: "completed",
      summary,
      done: 0,
      total: null,
    };
    this.emit();
  }

  fail(errorKey: string, errorDetail: string | null = null): void {
    if (!this.state.active) return;
    const failedStage = this.state.stage as SyncStage;
    this.state = {
      ...this.state,
      active: false,
      stage: "failed",
      failedStage,
      errorKey,
      errorDetail,
    };
    this.emit();
  }

  skip(errorKey: string): void {
    if (!this.state.active) return;
    this.state = {
      ...this.state,
      active: false,
      stage: "skipped",
      errorKey,
      done: 0,
      total: null,
    };
    this.emit();
  }
}

export const syncStatus = new SyncStatusTracker();
