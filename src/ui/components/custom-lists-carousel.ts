import { setIcon } from "obsidian";
import { CustomList } from "../../models/list";
import { MediaItem } from "../../models/media";
import {
  formatRelativeDate,
  getListBannerPosters,
} from "../../services/list-service";
import { renderPoster } from "./media-render";
import { createCarousel } from "./carousel";
import { t } from "../../i18n";

export async function renderCustomListsCarousel(
  container: HTMLElement,
  allMedia: MediaItem[],
  lists: CustomList[],
  onOpenList: (list: CustomList) => void,
  onViewAll: () => void,
): Promise<void> {
  container.empty();

  if (lists.length === 0) {
    container.createEl("p", {
      cls: "mediavault-empty-state",
      text: t("lists.noCustomLists"),
    });
    return;
  }

  const header = container.createDiv({
    cls: "mediavault-lists-carousel-header",
  });

  header.createSpan({
    cls: "mediavault-lists-carousel-title",
    text: t("lists.title"),
  });

  const viewAll = header.createEl("button", {
    cls: "mediavault-lists-view-all",
    text: t("common.viewAll"),
  });
  viewAll.onclick = onViewAll;

  const mobileArrow = header.createEl("button", {
    cls: "clickable-icon mediavault-section-nav-arrow",
  });
  setIcon(mobileArrow, "chevron-right");
  mobileArrow.setAttr("aria-label", t("lists.viewAllLists"));
  mobileArrow.onclick = onViewAll;

  const carouselContainer = container.createDiv({
    cls: "mediavault-lists-carousel-container",
  });
  const { track } = createCarousel(carouselContainer);
  track.addClass("mediavault-lists-track");

  lists.forEach((list) => {
    track.appendChild(buildListTile(list, allMedia, onOpenList));
  });
}

function buildListTile(
  list: CustomList,
  allMedia: MediaItem[],
  onOpenList: (list: CustomList) => void,
): HTMLElement {
  const card = createDiv();
  card.addClass("mediavault-list-tile");
  card.onclick = () => onOpenList(list);

  const bannerPosters = getListBannerPosters(list, allMedia);
  const banner = card.createDiv({ cls: "mediavault-list-tile-banner" });
  for (let i = 0; i < 4; i++) {
    const cell = banner.createDiv({ cls: "mediavault-list-tile-banner-cell" });
    const media = bannerPosters[i];
    if (media) {
      renderPoster(cell, media, "w200");
    } else {
      cell.addClass("is-empty");
    }
  }

  const scrim = banner.createDiv({ cls: "mediavault-list-tile-scrim" });
  scrim.createDiv({ cls: "mediavault-list-tile-title", text: list.title });
  const meta = scrim.createDiv({ cls: "mediavault-list-tile-meta" });
  meta.createSpan({
    text: t("lists.itemCountN", {
      count: list.mediaIds.length,
      plural: list.mediaIds.length === 1 ? "" : "s",
    }),
  });
  meta.createSpan({
    text: t("lists.updated", { date: formatRelativeDate(list.updatedAt) }),
  });
  if (list.isImported) {
    meta.createSpan({
      cls: "mediavault-list-tile-imported",
      text: t("lists.imported"),
    });
  }

  return card;
}
