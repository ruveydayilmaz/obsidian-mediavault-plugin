import { App, Modal, Setting, Notice } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import { WatchSession } from "../../models/review";
import { MediaType, Mood, WatchSource } from "../../types/enums";
import { t } from "../../i18n";
import {
  addWatchSession,
  updateWatchSession,
} from "../../services/watch-session-service";
import { isFutureDate, todayIsoDate } from "../../utils/date-utils";

interface WatchSessionModalOptions {
  mediaId: string;
  mediaTitle: string;
  existingSession?: WatchSession;
  onSaved?: () => void;
}

export class WatchSessionModal extends Modal {
  private storage: StorageService;
  private options: WatchSessionModalOptions;

  private watchDate: string;
  private rating: number | null;
  private review: string;
  private mood: Mood | null;
  private context: string;
  private watchSource: WatchSource | null;
  private supportsRange = false;
  private completedDate = "";
  private completed = true;

  constructor(
    app: App,
    storage: StorageService,
    options: WatchSessionModalOptions,
  ) {
    super(app);
    this.storage = storage;
    this.options = options;

    const existing = options.existingSession;
    this.watchDate =
      existing?.watchDate ?? new Date().toISOString().slice(0, 10);
    this.rating = existing?.rating ?? null;
    this.review = existing?.review ?? "";
    this.mood = existing?.mood ?? null;
    this.context = existing?.context ?? "";
    this.watchSource = existing?.watchSource ?? null;
    this.completedDate = existing?.completedDate ?? "";
    this.completed = existing ? !existing.inProgress : true;
  }

  async onOpen(): Promise<void> {
    const media = await this.storage.media.findById(this.options.mediaId);
    this.supportsRange =
      media?.type === MediaType.TVShow || !!this.options.existingSession?.inProgress;
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mediavault-watch-session-modal");
    const isEdit = !!this.options.existingSession;
    renderModalHeader(
      this,
      contentEl,
      isEdit ? t("watchSession.editReview") : t("watchSession.logWatch"),
    );

    if (!isEdit) {
      contentEl.createEl("p", {
        cls: "mediavault-modal-hint",
        text: t("watchSession.newSessionHint"),
      });
    }

    new Setting(contentEl)
      .setName(
        this.supportsRange
          ? t("watchSession.startDate")
          : t("watchSession.watchDate"),
      )
      .addText((text) => {
      text.setValue(this.watchDate).onChange((value) => {
        this.watchDate = value;
      });
      text.inputEl.setAttribute("type", "date");
      text.inputEl.setAttribute("max", todayIsoDate());
    });

    if (this.supportsRange) {
      let endInput: HTMLInputElement | null = null;
      new Setting(contentEl)
        .setName(t("watchSession.completedToggle"))
        .setDesc(t("watchSession.completedToggleDesc"))
        .addToggle((toggle) =>
          toggle.setValue(this.completed).onChange((value) => {
            this.completed = value;
            if (!value) {
              this.completedDate = "";
              if (endInput) endInput.value = "";
            }
            if (endInput) endInput.disabled = !value;
          }),
        );
      new Setting(contentEl)
        .setName(t("watchSession.endDate"))
        .setDesc(t("watchSession.endDateDesc"))
        .addText((text) => {
          text.setValue(this.completedDate).onChange((value) => {
            this.completedDate = value;
          });
          text.inputEl.setAttribute("type", "date");
          text.inputEl.setAttribute("max", todayIsoDate());
          text.inputEl.disabled = !this.completed;
          endInput = text.inputEl;
        });
    }

    new Setting(contentEl).setName(t("watchSession.rating")).addText((text) =>
      text
        .setPlaceholder(t("watchSession.ratingPlaceholder"))
        .setValue(this.rating !== null ? String(this.rating) : "")
        .onChange((value) => {
          const parsed = parseFloat(value);
          this.rating = value.trim() === "" || isNaN(parsed) ? null : parsed;
        }),
    );

    new Setting(contentEl)
      .setName(t("watchSession.mood"))
      .addDropdown((dropdown) => {
        dropdown.addOption("", "—");
        Object.values(Mood).forEach((m) => {
          dropdown.addOption(m, m.charAt(0).toUpperCase() + m.slice(1));
        });
        dropdown.setValue(this.mood ?? "");
        dropdown.onChange((value) => {
          this.mood = (value as Mood) || null;
        });
      });

    new Setting(contentEl)
      .setName(t("watchSession.watchSource"))
      .addDropdown((dropdown) => {
        dropdown.addOption("", "—");
        Object.values(WatchSource).forEach((s) => {
          dropdown.addOption(
            s,
            s.replace("_", " ").replace(/^./, (c) => c.toUpperCase()),
          );
        });
        dropdown.setValue(this.watchSource ?? "");
        dropdown.onChange((value) => {
          this.watchSource = (value as WatchSource) || null;
        });
      });

    new Setting(contentEl)
      .setName(t("watchSession.context"))
      .setDesc(t("watchSession.contextDesc"))
      .addText((text) =>
        text.setValue(this.context).onChange((value) => {
          this.context = value;
        }),
      );

    new Setting(contentEl)
      .setName(t("watchSession.review"))
      .addTextArea((textarea) => {
        textarea.setValue(this.review).onChange((value) => {
          this.review = value;
        });
        textarea.inputEl.rows = 6;
        textarea.inputEl.addClass("mediavault-review-textarea");
      });

    const buttonRow = contentEl.createDiv({ cls: "mediavault-modal-buttons" });
    contentEl.addClass("mediavault-has-bottom-bar");

    const saveBtn = buttonRow.createEl("button", {
      text: isEdit
        ? t("watchSession.saveChanges")
        : t("watchSession.logWatchBtn"),
      cls: "mod-cta",
    });
    saveBtn.addEventListener("click", () => void this.save());

    const cancelBtn = buttonRow.createEl("button", {
      text: t("common.cancel"),
    });
    cancelBtn.addEventListener("click", () => this.close());
  }

  private async save(): Promise<void> {
    if (!this.watchDate) {
      new Notice(t("notice.setWatchDate"));
      return;
    }
    if (isFutureDate(this.watchDate)) {
      new Notice(t("notice.futureDateNotAllowed"));
      return;
    }
    if (this.rating !== null && (this.rating < 0 || this.rating > 10)) {
      new Notice(t("notice.ratingRange"));
      return;
    }

    let completedDate: string | null = null;
    let inProgress = false;
    if (this.supportsRange) {
      inProgress = !this.completed;
      if (this.completed) {
        completedDate = this.completedDate || null;
        if (!completedDate && this.options.existingSession?.inProgress) {
          completedDate = todayIsoDate();
        }
      }
      if (completedDate) {
        if (isFutureDate(completedDate)) {
          new Notice(t("notice.futureDateNotAllowed"));
          return;
        }
        if (completedDate < this.watchDate) {
          new Notice(t("watchSession.endBeforeStart"));
          return;
        }
      }
    }

    try {
      if (this.options.existingSession) {
        await updateWatchSession(
          this.storage,
          this.options.existingSession.id,
          {
            watchDate: this.watchDate,
            ...(this.supportsRange ? { completedDate, inProgress } : {}),
            rating: this.rating,
            review: this.review,
            mood: this.mood,
            context: this.context || null,
            watchSource: this.watchSource,
          },
        );
        new Notice(t("notice.reviewUpdated"));
      } else {
        await addWatchSession(this.storage, {
          mediaId: this.options.mediaId,
          watchDate: this.watchDate,
          ...(this.supportsRange ? { completedDate, inProgress } : {}),
          rating: this.rating,
          review: this.review,
          mood: this.mood,
          context: this.context || null,
          watchSource: this.watchSource,
        });
        new Notice(t("notice.watchLogged"));
      }
      this.options.onSaved?.();
      this.close();
    } catch (err) {
      new Notice(t("notice.saveFailed", { error: (err as Error).message }));
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
