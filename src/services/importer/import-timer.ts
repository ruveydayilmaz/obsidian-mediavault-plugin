export class ImportTimer {
  private totals = new Map<string, number>();
  private counts = new Map<string, number>();
  private start = performance.now();

  async time<T>(stage: string, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      this.add(stage, performance.now() - t0);
    }
  }

  add(stage: string, ms: number): void {
    this.totals.set(stage, (this.totals.get(stage) ?? 0) + ms);
    this.counts.set(stage, (this.counts.get(stage) ?? 0) + 1);
  }

  merge(other: ImportTimer): void {
    for (const [stage, ms] of other.totals) {
      this.totals.set(stage, (this.totals.get(stage) ?? 0) + ms);
    }
    for (const [stage, count] of other.counts) {
      this.counts.set(stage, (this.counts.get(stage) ?? 0) + count);
    }
  }

  totalElapsedMs(): number {
    return performance.now() - this.start;
  }

  breakdown(): { stage: string; ms: number; calls: number }[] {
    const rows = [...this.totals.entries()]
      .map(([stage, ms]) => ({ stage, ms, calls: this.counts.get(stage) ?? 0 }))
      .sort((a, b) => b.ms - a.ms);
    rows.push({ stage: "Total", ms: this.totalElapsedMs(), calls: 0 });
    return rows;
  }

  static formatMs(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)} ms`;
    const totalSeconds = ms / 1000;
    if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.round(totalSeconds % 60);
    return `${minutes}m ${seconds}s`;
  }
}
