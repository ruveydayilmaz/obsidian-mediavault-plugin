import { App, Modal, Notice } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import type { TMDBService } from "../../api/tmdb";
import { MediaItem } from "../../models/media";
import { MediaType } from "../../types/enums";
import { t } from "../../i18n";

export class PlatformModal extends Modal {
  private customValue: string;

  constructor(
    app: App,
    private storage: StorageService,
    private tmdb: TMDBService,
    private media: MediaItem,
    private onChanged: () => void,
  ) {
    super(app);
    this.customValue = media.platform ?? "";
  }

  onOpen(): void {
    void this.render();
  }

  private async render(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mediavault-platform-modal");
    renderModalHeader(this, contentEl, t("detail.selectPlatform"), "h3");

    const list = contentEl.createDiv({ cls: "mediavault-platform-list" });
    const loadingEl = list.createDiv({
      cls: "mediavault-modal-hint",
      text: t("common.loading"),
    });

    this.renderCustomRow(contentEl);

    let providers: { providerId: number; name: string }[] = [];
    try {
      providers = await this.tmdb.getWatchProviders(
        this.media.tmdbId,
        this.media.type === MediaType.Movie ? "movie" : "tv",
      );
    } catch {
      providers = [];
    }

    loadingEl.remove();

    if (providers.length === 0) {
      list.createDiv({
        cls: "mediavault-modal-hint",
        text: t("detail.noTmdbProviders"),
      });
      return;
    }

    list.createDiv({
      cls: "mediavault-modal-hint mediavault-platform-providers-label",
      text: t("detail.tmdbProviders"),
    });

    providers.forEach((provider) => {
      const row = list.createDiv({
        cls: `mediavault-change-status-row ${
          provider.name === this.media.platform ? "is-selected" : ""
        }`,
      });
      row.setAttr("tabindex", "0");
      row.setAttr("role", "button");
      row.createSpan({ text: provider.name });
      row.addEventListener("click", () => void this.selectPlatform(provider.name));
      row.addEventListener("keydown", (evt: KeyboardEvent) => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          void this.selectPlatform(provider.name);
        }
      });
    });
  }

  private renderCustomRow(contentEl: HTMLElement): void {
    const row = contentEl.createDiv({ cls: "mediavault-platform-custom-row" });
    const input = row.createEl("input", {
      type: "text",
      cls: "mediavault-platform-custom-input",
      attr: { placeholder: t("detail.customPlatformPlaceholder") },
    });
    input.value = this.customValue;
    input.addEventListener("input", () => {
      this.customValue = input.value;
    });

    const saveBtn = row.createEl("button", {
      cls: "mod-cta",
      text: t("common.save"),
    });
    saveBtn.addEventListener("click", () => {
      void this.selectPlatform(this.customValue.trim() || null);
    });

    if (this.media.platform) {
      const clearBtn = row.createEl("button", {
        text: t("detail.clearPlatform"),
      });
      clearBtn.addEventListener("click", () => void this.selectPlatform(null));
    }
  }

  private async selectPlatform(platform: string | null): Promise<void> {
    await this.storage.media.update(this.media.id, { platform });
    this.media.platform = platform;
    new Notice(t("detail.platformUpdated"));
    this.onChanged();
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
