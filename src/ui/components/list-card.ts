import { CustomList } from "../../models/list";
import { MediaItem } from "../../models/media";
import {
  getListBannerPosters,
  formatRelativeDate,
} from "../../services/list-service";
import { renderPoster } from "./media-render";
import { setIcon } from "obsidian";
import { t } from "../../i18n";

export function renderListCard(
  container: HTMLElement,
  list: CustomList,
  allMedia: MediaItem[],
  onClick: (card: HTMLElement) => void,
  opts?: { selected?: boolean },
): HTMLElement {
  const card = container.createDiv({ cls: "mediavault-list-card" });
  card.dataset.listId = String(list.id);

  const banner = card.createDiv({ cls: "mediavault-list-banner" });
  const cells = banner.createDiv({ cls: "mediavault-list-banner-cells" });
  renderListCardBannerCells(cells, list, allMedia);

  const selectedBadge = banner.createDiv({
    cls: "mediavault-list-card-selected-badge",
  });
  setIcon(selectedBadge, "check");

  const scrim = banner.createDiv({ cls: "mediavault-list-card-scrim" });
  scrim.createDiv({ cls: "mediavault-list-card-title", text: list.title });
  if (list.description) {
    scrim.createDiv({
      cls: "mediavault-list-card-description",
      text: list.description,
    });
  }
  const meta = scrim.createDiv({ cls: "mediavault-list-card-meta" });
  meta.createSpan({
    text: t("lists.itemCountN", {
      count: list.mediaIds.length,
      plural: list.mediaIds.length === 1 ? "" : "s",
    }),
  });
  meta.createSpan({
    text: t("lists.updated", { date: formatRelativeDate(list.updatedAt) }),
  });
  meta.createSpan({ text: list.owner ?? t("common.you") });
  if (list.isImported) {
    meta.createSpan({
      cls: "mediavault-list-card-imported",
      text: t("lists.imported"),
    });
  }

  if (opts?.selected) {
    card.addClass("is-selected");
  }

  card.addEventListener("click", () => onClick(card));

  return card;
}

export function renderListCardBannerCells(
  cellsContainer: HTMLElement,
  list: CustomList,
  allMedia: MediaItem[],
): void {
  cellsContainer.empty();
  const bannerPosters = getListBannerPosters(list, allMedia);
  for (let i = 0; i < 4; i++) {
    const cell = cellsContainer.createDiv({
      cls: "mediavault-list-banner-cell",
    });
    const media = bannerPosters[i];
    if (media) {
      renderPoster(cell, media, "w200");
    } else {
      cell.addClass("is-empty");
    }
  }
}

export function updateListCardBanner(
  card: HTMLElement,
  list: CustomList,
  allMedia: MediaItem[],
): void {
  const cells = card.querySelector<HTMLElement>(
    ".mediavault-list-banner-cells",
  );
  if (!cells) return;
  renderListCardBannerCells(cells, list, allMedia);
}

export function setListCardSelected(
  card: HTMLElement,
  selected: boolean,
): void {
  card.toggleClass("is-selected", selected);
}
