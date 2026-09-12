import { App, Modal, Notice } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type { TMDBService } from "../../api/tmdb";
import { tmdbImageUrl } from "../../api/tmdb-normalize";
import { TMDBImageOption } from "../../types/tmdb";
import { t } from "../../i18n";
import {
  importLocalImage,
  isLocalImagePath,
  isRemoteImageUrl,
  UnsupportedImageFormatError,
} from "../../services/local-image-service";

export type ImagePickerKind = "poster" | "backdrop";

export class ImagePickerModal extends Modal {
  private tmdb: TMDBService;
  private tmdbId: number;
  private mediaKind: "movie" | "tv";
  private imageKind: ImagePickerKind;
  private currentPath: string | null;
  private mediaId: string;
  private mediaFolderPath: string;
  private onSelect: (filePath: string) => void | Promise<void>;

  constructor(
    app: App,
    tmdb: TMDBService,
    tmdbId: number,
    mediaKind: "movie" | "tv",
    imageKind: ImagePickerKind,
    currentPath: string | null,
    onSelect: (filePath: string) => void | Promise<void>,
    mediaId: string,
    mediaFolderPath: string,
  ) {
    super(app);
    this.tmdb = tmdb;
    this.tmdbId = tmdbId;
    this.mediaKind = mediaKind;
    this.imageKind = imageKind;
    this.currentPath = currentPath;
    this.onSelect = onSelect;
    this.mediaId = mediaId;
    this.mediaFolderPath = mediaFolderPath;
  }

  onOpen(): void {
    void this.render();
  }

  private async render(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mediavault-image-picker-modal");
    renderModalHeader(
      this,
      contentEl,
      this.imageKind === "poster"
        ? t("detail.choosePoster")
        : t("detail.chooseBanner"),
      "h3",
    );

    this.renderDeviceImportRow(contentEl);
    this.renderUrlImportRow(contentEl);

    const loading = contentEl.createDiv({
      cls: "mediavault-modal-hint",
      text: t("detail.loadingImages"),
    });

    let options: TMDBImageOption[];
    try {
      const images = await this.tmdb.getImages(this.tmdbId, this.mediaKind);
      options = this.imageKind === "poster" ? images.posters : images.backdrops;
    } catch {
      loading.setText(t("detail.couldNotLoadImages"));
      return;
    }

    loading.remove();

    if (options.length === 0) {
      contentEl.createDiv({
        cls: "mediavault-modal-hint",
        text: t("detail.noImagesAvailable"),
      });
      return;
    }

    const grid = contentEl.createDiv({ cls: "mediavault-image-picker-grid" });
    grid.addClass(
      this.imageKind === "poster" ? "is-poster-grid" : "is-backdrop-grid",
    );

    options.forEach((option) => {
      const tile = grid.createDiv({
        cls: `mediavault-image-picker-tile ${option.filePath === this.currentPath ? "is-selected" : ""}`,
      });
      const url = tmdbImageUrl(option.filePath, "w342");
      if (url) {
        tile.createEl("img", { attr: { src: url, loading: "lazy" } });
      }
      if (option.filePath === this.currentPath) {
        tile.createDiv({
          cls: "mediavault-image-picker-current-badge",
          text: t("common.currentBadge"),
        });
      }
      tile.addEventListener("click", () => {
        void (async () => {
          await this.onSelect(option.filePath);
          new Notice(
            this.imageKind === "poster"
              ? t("detail.posterUpdated")
              : t("detail.bannerUpdated"),
          );
          this.close();
        })();
      });
    });
  }

  private renderUrlImportRow(contentEl: HTMLElement): void {
    const row = contentEl.createDiv({ cls: "mediavault-image-picker-url" });
    const input = row.createEl("input", {
      cls: "mediavault-image-picker-url-input",
      type: "text",
      attr: { placeholder: t("detail.imageUrlPlaceholder") },
    });
    if (isRemoteImageUrl(this.currentPath)) {
      input.value = this.currentPath;
    }
    const button = row.createEl("button", {
      cls: "mod-cta",
      text:
        this.imageKind === "poster"
          ? t("detail.usePosterUrl")
          : t("detail.useBannerUrl"),
    });
    button.addEventListener("click", () => {
      void this.handleUrlSubmitted(input.value.trim());
    });
  }

  private async handleUrlSubmitted(url: string): Promise<void> {
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      new Notice(t("detail.invalidImageUrl"));
      return;
    }
    const loads = await new Promise<boolean>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
    if (!loads) {
      new Notice(t("detail.invalidImageUrl"));
      return;
    }
    await this.onSelect(url);
    new Notice(
      this.imageKind === "poster"
        ? t("detail.posterUpdated")
        : t("detail.bannerUpdated"),
    );
    this.close();
  }

  private renderDeviceImportRow(contentEl: HTMLElement): void {
    const row = contentEl.createDiv({ cls: "mediavault-image-picker-device" });
    const button = row.createEl("button", {
      cls: "mod-cta",
      text: t("detail.importFromDevice"),
    });
    const isCurrentlyLocal = isLocalImagePath(this.currentPath);
    if (isCurrentlyLocal) {
      row.createDiv({
        cls: "mediavault-modal-hint",
        text: t("detail.currentlyUsingLocalImage"),
      });
    }

    const fileInput = row.createEl("input", {
      cls: "mediavault-visually-hidden",
      type: "file",
      attr: { accept: "image/jpeg,image/jpg,image/png,image/webp" },
    });
    fileInput.addEventListener("change", () => {
      void this.handleDeviceFileSelected(fileInput);
    });
    button.addEventListener("click", () => fileInput.click());
  }

  private async handleDeviceFileSelected(
    fileInput: HTMLInputElement,
  ): Promise<void> {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const storedPath = await importLocalImage({
        mediaFolderPath: this.mediaFolderPath,
        mediaId: this.mediaId,
        kind: this.imageKind,
        file,
      });
      await this.onSelect(storedPath);
      new Notice(
        this.imageKind === "poster"
          ? t("detail.posterUpdated")
          : t("detail.bannerUpdated"),
      );
      this.close();
    } catch (err) {
      if (err instanceof UnsupportedImageFormatError) {
        new Notice(t("detail.unsupportedImageFormat"));
      } else {
        new Notice(
          t("detail.couldNotImportImage", { error: (err as Error).message }),
        );
      }
    } finally {
      fileInput.value = "";
    }
  }
}
