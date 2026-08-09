import { App, Modal, Notice } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type { TMDBService } from "../../api/tmdb";
import { tmdbImageUrl } from "../../api/tmdb-normalize";
import { TMDBImageOption } from "../../types/tmdb";
import { t } from "../../i18n";

export type ImagePickerKind = "poster" | "backdrop";

export class ImagePickerModal extends Modal {
  private tmdb: TMDBService;
  private tmdbId: number;
  private mediaKind: "movie" | "tv";
  private imageKind: ImagePickerKind;
  private currentPath: string | null;
  private onSelect: (filePath: string) => void | Promise<void>;

  constructor(
    app: App,
    tmdb: TMDBService,
    tmdbId: number,
    mediaKind: "movie" | "tv",
    imageKind: ImagePickerKind,
    currentPath: string | null,
    onSelect: (filePath: string) => void | Promise<void>,
  ) {
    super(app);
    this.tmdb = tmdb;
    this.tmdbId = tmdbId;
    this.mediaKind = mediaKind;
    this.imageKind = imageKind;
    this.currentPath = currentPath;
    this.onSelect = onSelect;
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
}
