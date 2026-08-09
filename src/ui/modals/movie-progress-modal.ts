import { App, Modal, Setting, Notice } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import { MediaItem } from "../../models/media";
import { setMovieProgress } from "../../services/movie-progress-service";
import { t } from "../../i18n";

export interface MoviePartialWatchModalOptions {
  media: MediaItem;
  existingMinute: number | null;
  onSaved: () => void;
}

export class MoviePartialWatchModal extends Modal {
  private storage: StorageService;
  private options: MoviePartialWatchModalOptions;
  private minute: number | null;

  constructor(
    app: App,
    storage: StorageService,
    options: MoviePartialWatchModalOptions,
  ) {
    super(app);
    this.storage = storage;
    this.options = options;
    this.minute = options.existingMinute;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("mediavault-movie-progress-modal");
    renderModalHeader(this, contentEl, t("movieProgress.title"), "h3");

    new Setting(contentEl)
      .setName(t("movieProgress.minutesIn"))
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "0";
        text
          .setPlaceholder("74")
          .setValue(this.minute !== null ? String(this.minute) : "")
          .onChange((value) => {
            const parsed = parseInt(value, 10);
            this.minute = value.trim() === "" || isNaN(parsed) ? null : parsed;
          });
        text.inputEl.focus();
      });

    const buttons = contentEl.createDiv({ cls: "mediavault-modal-buttons" });
    contentEl.addClass("mediavault-has-bottom-bar");
    buttons
      .createEl("button", { text: t("common.cancel") })
      .addEventListener("click", () => this.close());

    const saveBtn = buttons.createEl("button", {
      cls: "mod-cta",
      text: t("common.save"),
    });
    saveBtn.addEventListener("click", () => {
      void (async () => {
        if (this.minute === null || this.minute < 0) {
          new Notice(t("notice.enterMinutesStopped"));
          return;
        }
        await setMovieProgress(this.storage, this.options.media, this.minute);
        new Notice(t("notice.savedProgress", { minute: this.minute }));
        this.options.onSaved();
        this.close();
      })();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
