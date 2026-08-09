import { App, Modal, Notice } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import { dropSeries } from "../../services/drop-series-service";
import { t } from "../../i18n";
import { makeClearable } from "../components/clearable-input";

export interface DropSeriesModalOptions {
  mediaId: string;
  mediaTitle: string;
  onDropped: () => void;
}

export class DropSeriesModal extends Modal {
  private storage: StorageService;
  private options: DropSeriesModalOptions;
  private reason = "";

  constructor(
    app: App,
    storage: StorageService,
    options: DropSeriesModalOptions,
  ) {
    super(app);
    this.storage = storage;
    this.options = options;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("mediavault-drop-series-modal");
    renderModalHeader(this, contentEl, t("dropSeries.title"), "h3");
    contentEl.createDiv({
      cls: "mediavault-modal-hint",
      text: t("dropSeries.hint", { title: this.options.mediaTitle }),
    });

    const textarea = contentEl.createEl("textarea", {
      cls: "mediavault-episode-notes-input",
      attr: { placeholder: t("dropSeries.placeholder") },
    });
    makeClearable(textarea);
    textarea.addEventListener("input", () => {
      this.reason = textarea.value;
    });

    const buttons = contentEl.createDiv({ cls: "mediavault-modal-buttons" });
    contentEl.addClass("mediavault-has-bottom-bar");
    buttons
      .createEl("button", { text: t("common.cancel") })
      .addEventListener("click", () => this.close());

    const dropBtn = buttons.createEl("button", {
      cls: "mod-warning",
      text: t("dropSeries.dropSeries"),
    });
    dropBtn.addEventListener("click", () => {
      void (async () => {
        await dropSeries(this.storage, this.options.mediaId, this.reason);
        new Notice(
          t("notice.markedDropped", { title: this.options.mediaTitle }),
        );
        this.options.onDropped();
        this.close();
      })();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
