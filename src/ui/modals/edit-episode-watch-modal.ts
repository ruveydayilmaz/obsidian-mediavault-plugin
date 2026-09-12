import { App, Modal, Setting, Notice } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import { EpisodeWatch } from "../../models/episode";
import { updateEpisodeWatch } from "../../services/episode-watch-service";
import { t } from "../../i18n";
import { isFutureDate, todayIsoDate } from "../../utils/date-utils";

export interface EditEpisodeWatchModalOptions {
  watch: EpisodeWatch;
  onSaved: () => void;
}

export class EditEpisodeWatchModal extends Modal {
  private watchedAt: string;

  constructor(
    app: App,
    private storage: StorageService,
    private options: EditEpisodeWatchModalOptions,
  ) {
    super(app);
    this.watchedAt = options.watch.watchedAt;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mediavault-edit-episode-watch-modal");
    renderModalHeader(this, contentEl, t("detail.editWatchDate"), "h3");

    new Setting(contentEl).setName(t("watchSession.watchDate")).addText((text) => {
      text.setValue(this.watchedAt).onChange((value) => {
        this.watchedAt = value;
      });
      text.inputEl.setAttribute("type", "date");
      text.inputEl.setAttribute("max", todayIsoDate());
    });

    const buttonRow = contentEl.createDiv({
      cls: "mediavault-modal-buttons",
    });

    const cancelBtn = buttonRow.createEl("button", {
      text: t("common.cancel"),
    });
    cancelBtn.addEventListener("click", () => this.close());

    const saveBtn = buttonRow.createEl("button", {
      cls: "mod-cta",
      text: t("common.save"),
    });
    saveBtn.addEventListener("click", () => void this.handleSave());
  }

  private async handleSave(): Promise<void> {
    if (!this.watchedAt) {
      new Notice(t("notice.setWatchDate"));
      return;
    }
    if (isFutureDate(this.watchedAt)) {
      new Notice(t("notice.futureDateNotAllowed"));
      return;
    }
    await updateEpisodeWatch(this.storage, this.options.watch.id, {
      watchedAt: this.watchedAt,
    });
    this.close();
    this.options.onSaved();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
