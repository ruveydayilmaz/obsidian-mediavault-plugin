import { App, Modal, Notice } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import { t } from "../../i18n";

export interface FactoryResetModalOptions {
  onConfirm: () => Promise<void>;
}

export class FactoryResetModal extends Modal {
  private options: FactoryResetModalOptions;
  private resetting = false;

  constructor(app: App, options: FactoryResetModalOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("mediavault-factory-reset-modal");
    renderModalHeader(this, contentEl, t("factoryReset.title"), "h3");

    contentEl.createDiv({
      cls: "mediavault-modal-hint",
      text: t("factoryReset.body"),
    });
    contentEl.createDiv({
      cls: "mediavault-modal-hint",
      text: t("factoryReset.preserves"),
    });
    contentEl.createDiv({
      cls: "mediavault-modal-hint mediavault-factory-reset-warning",
      text: t("factoryReset.irreversible"),
    });

    const buttons = contentEl.createDiv({ cls: "mediavault-modal-buttons" });
    contentEl.addClass("mediavault-has-bottom-bar");
    const cancelBtn = buttons.createEl("button", { text: t("common.cancel") });
    cancelBtn.addEventListener("click", () => this.close());

    const confirmBtn = buttons.createEl("button", {
      cls: "mod-warning",
      text: t("factoryReset.confirmButton"),
    });
    confirmBtn.addEventListener("click", () => {
      void (async () => {
        if (this.resetting) return;
        this.resetting = true;
        cancelBtn.setAttr("disabled", "true");
        confirmBtn.setAttr("disabled", "true");
        confirmBtn.setText(t("factoryReset.resetting"));
        try {
          await this.options.onConfirm();
          this.close();
        } catch (err) {
          new Notice(
            t("factoryReset.failed", { error: (err as Error).message }),
          );
          this.resetting = false;
          cancelBtn.removeAttribute("disabled");
          confirmBtn.removeAttribute("disabled");
          confirmBtn.setText(t("factoryReset.confirmButton"));
        }
      })();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
