import { App, Modal, Notice } from "obsidian";
import type MediaVaultPlugin from "../../main";
import type { BackupMeta } from "../../services/backup-service";
import { ConfirmModal } from "./confirm-modal";
import { renderModalHeader } from "./modal-chrome";
import { t } from "../../i18n";

const REASON_KEYS: Record<BackupMeta["reason"], string> = {
  manual: "backup.reasonManual",
  startup: "backup.reasonStartup",
  watcher: "backup.reasonWatcher",
  "note-sync": "backup.reasonNoteSync",
  "pre-restore": "backup.reasonPreRestore",
};

export class BackupsModal extends Modal {
  private busy = false;

  constructor(
    app: App,
    private plugin: MediaVaultPlugin,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.addClass("mediavault-backups-modal");
    void this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async render(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    renderModalHeader(this, contentEl, t("backup.title"), "h3");
    contentEl.createDiv({
      cls: "mediavault-modal-hint",
      text: t("backup.location", { path: this.plugin.backup.dir }),
    });

    const backups = await this.plugin.backup.list();
    if (backups.length === 0) {
      contentEl.createDiv({
        cls: "mediavault-modal-hint",
        text: t("backup.empty"),
      });
      return;
    }

    const list = contentEl.createDiv({ cls: "mediavault-backups-list" });
    for (const meta of backups) {
      const row = list.createDiv({ cls: "mediavault-backups-row" });
      const info = row.createDiv({ cls: "mediavault-backups-info" });
      info.createDiv({
        cls: "mediavault-backups-date",
        text: new Date(meta.createdAt).toLocaleString(),
      });
      info.createDiv({
        cls: "mediavault-backups-detail",
        text: `${t(REASON_KEYS[meta.reason])} · ${t("backup.counts", {
          media: meta.counts.media ?? 0,
          lists: meta.counts.customLists ?? 0,
          notes: meta.counts.notes ?? 0,
        })}`,
      });
      const btn = row.createEl("button", { text: t("backup.restore") });
      btn.addEventListener("click", () => this.confirmRestore(meta));
    }
  }

  private confirmRestore(meta: BackupMeta): void {
    if (this.busy) return;
    if (this.plugin.folderSync.isRunning()) {
      new Notice(t("backup.syncBusy"));
      return;
    }
    new ConfirmModal(
      this.app,
      t("backup.restoreConfirm", {
        date: new Date(meta.createdAt).toLocaleString(),
      }),
      (confirmed) => {
        if (confirmed) void this.restore(meta);
      },
      t("backup.restore"),
      t("backup.cancel"),
    ).open();
  }

  private async restore(meta: BackupMeta): Promise<void> {
    if (this.plugin.storage.pipelineBusy) {
      new Notice(t("backup.syncBusy"));
      return;
    }
    this.busy = true;
    const releasePipeline = this.plugin.storage.acquirePipeline();
    try {
      const result = await this.plugin.backup.restore(meta.id);
      this.plugin.refreshLibraryViews();
      this.plugin.refreshListViews();
      this.plugin.refreshExploreViews();
      new Notice(
        t("backup.restoreDone", {
          records: result.records,
          notes: result.notes,
        }),
      );
      await this.render();
    } catch (err) {
      console.error("MediaVault: restore failed", err);
      new Notice(
        t("backup.restoreFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      releasePipeline();
      this.busy = false;
    }
  }
}
