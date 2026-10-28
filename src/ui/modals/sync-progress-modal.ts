import { App, Modal } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import { t } from "../../i18n";
import { syncStatus, SyncStage, SyncStatusState } from "../../services/sync-status";

const STAGE_KEYS: Record<SyncStage, [string, string]> = {
  queued: ["syncProgress.stageQueued", "syncProgress.descQueued"],
  backup: ["syncProgress.stageBackup", "syncProgress.descBackup"],
  preparing: ["syncProgress.stagePreparing", "syncProgress.descPreparing"],
  syncing: ["syncProgress.stageSyncing", "syncProgress.descSyncing"],
  finalizing: ["syncProgress.stageFinalizing", "syncProgress.descFinalizing"],
  completed: ["syncProgress.titleDone", "syncProgress.descDone"],
  failed: ["syncProgress.titleFailed", "syncProgress.titleFailed"],
  skipped: ["syncProgress.notRun", "syncProgress.notRun"],
};

export class SyncProgressModal extends Modal {
  private unsubscribe: (() => void) | null = null;
  private onRetry: () => void;
  private headingEl!: HTMLElement;
  private stageEl!: HTMLElement;
  private descEl!: HTMLElement;
  private barEl!: HTMLElement;
  private fillEl!: HTMLElement;
  private countEl!: HTMLElement;
  private warningEl!: HTMLElement;
  private detailEl!: HTMLElement;
  private buttonsEl!: HTMLElement;

  constructor(app: App, onRetry: () => void) {
    super(app);
    this.onRetry = onRetry;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mediavault-sync-progress");
    const header = renderModalHeader(this, contentEl, t("syncProgress.title"));
    this.headingEl = header.querySelector("h2") as HTMLElement;
    this.stageEl = contentEl.createDiv({ cls: "mediavault-sync-progress-stage" });
    this.descEl = contentEl.createDiv({ cls: "mediavault-sync-progress-desc" });
    this.barEl = contentEl.createDiv({ cls: "mediavault-sync-progress-bar" });
    this.fillEl = this.barEl.createDiv({ cls: "mediavault-sync-progress-fill" });
    this.countEl = contentEl.createDiv({ cls: "mediavault-sync-progress-count" });
    this.warningEl = contentEl.createDiv({
      cls: "mediavault-sync-progress-warning",
      text: t("syncProgress.warning"),
    });
    this.detailEl = contentEl.createDiv({ cls: "mediavault-sync-progress-detail" });
    this.buttonsEl = contentEl.createDiv({ cls: "mediavault-modal-buttons" });
    this.unsubscribe = syncStatus.subscribe((state) => this.render(state));
    this.render(syncStatus.state);
  }

  onClose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.contentEl.empty();
  }

  private stageLabel(stage: SyncStage): string {
    return t(STAGE_KEYS[stage][0]);
  }

  private render(state: SyncStatusState): void {
    if (state.stage === "idle") return;
    const stage = state.stage;
    const finished = stage === "completed" || stage === "failed" || stage === "skipped";

    this.headingEl.setText(
      stage === "completed"
        ? t("syncProgress.titleDone")
        : stage === "failed" || stage === "skipped"
          ? t("syncProgress.titleFailed")
          : t("syncProgress.title"),
    );
    this.stageEl.setText(
      stage === "completed" || stage === "failed" || stage === "skipped"
        ? ""
        : this.stageLabel(stage),
    );
    this.descEl.setText(
      stage === "failed"
        ? t(state.errorKey ?? "folderSync.syncFailed")
        : stage === "skipped"
          ? t(state.errorKey ?? "syncProgress.notRun")
          : t(STAGE_KEYS[stage][1]),
    );

    const measurable =
      !finished &&
      state.total !== null &&
      state.total > 0 &&
      (stage === "backup" || stage === "preparing" || stage === "syncing");
    this.barEl.toggleClass("is-indeterminate", !finished && !measurable);
    this.barEl.toggleClass("is-error", stage === "failed" || stage === "skipped");
    if (stage === "completed") {
      this.fillEl.setCssProps({ "--mediavault-sync-pct": "100%" });
    } else if (measurable && state.total) {
      const pct = Math.min(99, Math.floor((state.done / state.total) * 100));
      this.fillEl.setCssProps({ "--mediavault-sync-pct": `${pct}%` });
    } else {
      this.fillEl.setCssProps({ "--mediavault-sync-pct": "0%" });
    }
    this.countEl.setText(
      measurable && state.total
        ? t("syncProgress.progressCount", { done: state.done, total: state.total })
        : "",
    );

    this.warningEl.toggleClass("is-hidden", finished);

    this.detailEl.empty();
    if (stage === "completed" && state.summary) {
      this.detailEl.createDiv({
        text: t("folderSync.summary", {
          checked: state.summary.checked,
          cache: state.summary.cache,
          folder: state.summary.folder,
          artwork: state.summary.artwork,
          conflicts: state.summary.conflicts,
        }),
      });
    }
    if (stage === "failed") {
      if (state.failedStage) {
        this.detailEl.createDiv({
          text: t("syncProgress.failedDuring", {
            stage: this.stageLabel(state.failedStage),
          }),
        });
      }
      if (state.errorDetail) {
        this.detailEl.createDiv({
          cls: "mediavault-sync-progress-muted",
          text: state.errorDetail,
        });
      }
      if (state.failedStage !== "backup") {
        this.detailEl.createDiv({
          text: state.changesBegun
            ? t("syncProgress.failedAfterChanges")
            : t("syncProgress.abortedBeforeChanges"),
        });
        this.detailEl.createDiv({
          text: state.backupRetained
            ? t("syncProgress.backupKept")
            : t("syncProgress.noBackupMade"),
        });
      }
    }

    this.buttonsEl.empty();
    const closeBtn = this.buttonsEl.createEl("button", {
      text: finished ? t("syncProgress.close") : t("syncProgress.runInBackground"),
    });
    closeBtn.addEventListener("click", () => this.close());
    if (stage === "failed" || stage === "skipped") {
      const retryBtn = this.buttonsEl.createEl("button", {
        cls: "mod-cta",
        text: t("syncProgress.retry"),
      });
      retryBtn.addEventListener("click", () => {
        this.close();
        this.onRetry();
      });
    }
  }
}
