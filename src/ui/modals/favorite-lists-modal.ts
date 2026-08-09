import { App, Modal } from "obsidian";
import { t } from "../../i18n";
import type MediaVaultPlugin from "../../main";
import { CustomList } from "../../models/list";
import { MediaItem } from "../../models/media";
import {
  getListBannerPosters,
  getSystemFavoriteLists,
} from "../../services/list-service";
import { renderPoster } from "../components/media-render";
import { ListDetailModal } from "./list-detail-modal";
import { renderModalHeader } from "./modal-chrome";

export class FavoriteListsModal extends Modal {
  private plugin: MediaVaultPlugin;

  constructor(app: App, plugin: MediaVaultPlugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen(): Promise<void> {
    this.plugin.registerLocaleAwareModal(this);
    await this.render();
  }

  onClose(): void {
    this.plugin.unregisterLocaleAwareModal(this);
    this.contentEl.empty();
  }

  rerenderForLocaleChange(): void {
    void this.render();
  }

  private async render(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mediavault-favorite-lists-modal");
    renderModalHeader(this, contentEl, t("lists.favoriteLists"), "h3");

    const allMedia = await this.plugin.storage.media.getAll();
    const lists = getSystemFavoriteLists(
      allMedia,
      this.plugin.storage.settings.get(),
    );

    const grid = contentEl.createDiv({ cls: "mediavault-lists-grid" });
    lists.forEach((list) => this.renderCard(grid, list, allMedia));
  }

  private renderCard(
    grid: HTMLElement,
    list: CustomList,
    allMedia: MediaItem[],
  ): void {
    const card = grid.createDiv({ cls: "mediavault-list-card" });
    const bannerPosters = getListBannerPosters(list, allMedia);
    const banner = card.createDiv({ cls: "mediavault-list-banner" });
    for (let i = 0; i < 4; i++) {
      const cell = banner.createDiv({ cls: "mediavault-list-banner-cell" });
      const media = bannerPosters[i];
      if (media) {
        renderPoster(cell, media, "w200");
      } else {
        cell.addClass("is-empty");
      }
    }

    const scrim = banner.createDiv({ cls: "mediavault-list-card-scrim" });
    scrim.createDiv({ cls: "mediavault-list-card-title", text: list.title });
    const meta = scrim.createDiv({ cls: "mediavault-list-card-meta" });
    meta.createSpan({
      text: t("lists.itemCountN", {
        count: list.mediaIds.length,
        plural: list.mediaIds.length === 1 ? "" : "s",
      }),
    });

    card.addEventListener("click", () => {
      new ListDetailModal(this.app, this.plugin, list).open();
    });
  }
}
