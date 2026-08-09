import { setIcon } from "obsidian";
import { MediaItem } from "../../models/media";
import { StorageService } from "../../services/storage";
import { renderPoster } from "./media-render";
import { createCarousel } from "./carousel";
import {
  getSystemFavoriteLists,
  sortListMedia,
} from "../../services/list-service";
import { t } from "../../i18n";

export interface FavoritesResponsiveOptions {
  visibleCount: number;
  fillPlaceholders: boolean;
}

export async function renderFavoritesSection(
  container: HTMLElement,
  storage: StorageService,
  allMedia: MediaItem[],
  activeTab: "movies" | "shows",
  onTabChange: (tab: "movies" | "shows") => void,
  onViewAll: () => void,
  onOpen: (item: MediaItem) => void,
  responsive: FavoritesResponsiveOptions,
  onArrowClick?: (tab: "movies" | "shows") => void,
): Promise<void> {
  container.empty();

  const [movieList, tvList] = getSystemFavoriteLists(
    allMedia,
    storage.settings.get(),
  );
  const movies = sortListMedia(movieList, allMedia);
  const shows = sortListMedia(tvList, allMedia);

  if (!movies.length && !shows.length) return;

  if (!movies.length) activeTab = "shows";
  if (!shows.length) activeTab = "movies";

  const header = container.createDiv({
    cls: "mediavault-favorites-header",
  });

  const tabs = header.createDiv({
    cls: "mediavault-sidebar-tabs",
  });

  if (movies.length) {
    const tab = tabs.createDiv({
      text: t("favorites.movies"),
      cls:
        "mediavault-sidebar-tab" + (activeTab === "movies" ? " is-active" : ""),
    });

    tab.onclick = () => onTabChange("movies");
  }

  if (shows.length) {
    const tab = tabs.createDiv({
      text: t("favorites.tvSeries"),
      cls:
        "mediavault-sidebar-tab" + (activeTab === "shows" ? " is-active" : ""),
    });

    tab.onclick = () => onTabChange("shows");
  }

  const viewAll = header.createEl("button", {
    cls: "mediavault-favorites-view-all",
    text: t("common.viewAll"),
  });

  viewAll.onclick = onViewAll;

  const mobileArrow = header.createEl("button", {
    cls: "clickable-icon mediavault-section-nav-arrow",
  });
  setIcon(mobileArrow, "chevron-right");
  mobileArrow.setAttr("aria-label", t("favorites.viewAllFavorites"));
  mobileArrow.onclick = () =>
    onArrowClick ? onArrowClick(activeTab) : onViewAll();

  const items = activeTab === "movies" ? movies : shows;

  const carouselContainer = container.createDiv({
    cls: "mediavault-favorites-carousel-container",
  });
  const { track } = createCarousel(carouselContainer);
  track.addClass("mediavault-favorites-track");

  const visibleCount = Math.max(1, responsive.visibleCount);
  const cardWidth = `calc((100% - ${(visibleCount - 1) * 12}px) / ${visibleCount})`;

  for (const item of items) {
    const card = buildFavoriteCard(item, onOpen);
    card.style.width = cardWidth;
    track.appendChild(card);
  }

  if (responsive.fillPlaceholders) {
    for (let i = items.length; i < visibleCount; i++) {
      const placeholder = buildPlaceholderCard();
      placeholder.style.width = cardWidth;
      track.appendChild(placeholder);
    }
  }
}

function buildPlaceholderCard(): HTMLElement {
  const card = createDiv();
  card.addClass(
    "mediavault-favorite-card",
    "mediavault-favorite-card-placeholder",
  );
  card.createDiv({ cls: "mediavault-favorite-poster" });
  return card;
}

function buildFavoriteCard(
  item: MediaItem,
  onOpen: (item: MediaItem) => void,
): HTMLElement {
  const card = createDiv();
  card.addClass("mediavault-favorite-card");

  card.onclick = () => onOpen(item);

  const poster = card.createDiv({
    cls: "mediavault-favorite-poster",
  });

  renderPoster(poster, item, "w200");

  return card;
}
