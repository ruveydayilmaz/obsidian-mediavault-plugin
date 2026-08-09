import { App, Platform } from "obsidian";
import { t } from "../../i18n";

declare const app: App;

const SWIPE_HINT_SEEN_KEY = "mediavault-carousel-swipe-hint-seen";

function hasSeenSwipeHint(): boolean {
  try {
    return app.loadLocalStorage(SWIPE_HINT_SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

function markSwipeHintSeen(): void {
  try {
    app.saveLocalStorage(SWIPE_HINT_SEEN_KEY, "1");
  } catch {
    // Ignore
  }
}

function playSwipeHint(track: HTMLElement): void {
  if (hasSeenSwipeHint()) return;

  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    markSwipeHintSeen();
    track.removeEventListener("pointerdown", cancel);
    track.removeEventListener("touchstart", cancel);
    track.removeEventListener("wheel", cancel);
    track.removeEventListener("scroll", cancel);
  };

  track.addEventListener("pointerdown", cancel, { passive: true });
  track.addEventListener("touchstart", cancel, { passive: true });
  track.addEventListener("wheel", cancel, { passive: true });
  track.addEventListener("scroll", cancel, { passive: true });

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      if (cancelled) return;
      if (track.scrollWidth <= track.clientWidth + 1) return;

      const nudgeDistance = Math.min(48, track.scrollWidth - track.clientWidth);
      track.scrollBy({ left: nudgeDistance, behavior: "smooth" });
      window.setTimeout(() => {
        if (cancelled) return;
        track.scrollBy({ left: -nudgeDistance, behavior: "smooth" });

        window.setTimeout(() => {
          if (!cancelled) markSwipeHintSeen();
        }, 500);
      }, 450);
    });
  });
}

export function createCarousel(container: HTMLElement): { track: HTMLElement } {
  container.empty();
  container.addClass("mediavault-carousel");

  const track = container.createDiv({ cls: "mediavault-carousel-track" });
  track.setAttr("tabindex", "0");

  if (Platform.isMobile) {
    container.addClass("mediavault-carousel-mobile");
    playSwipeHint(track);
    return { track };
  }

  const prevBtn = container.createEl("button", {
    cls: "mediavault-carousel-nav mediavault-carousel-nav-prev",
    text: "‹",
  });
  prevBtn.setAttr("aria-label", t("carousel.scrollLeft"));
  container.insertBefore(prevBtn, track);

  const nextBtn = container.createEl("button", {
    cls: "mediavault-carousel-nav mediavault-carousel-nav-next",
    text: "›",
  });
  nextBtn.setAttr("aria-label", t("carousel.scrollRight"));

  const scrollByOneItem = (direction: 1 | -1) => {
    const firstItem = track.firstElementChild as HTMLElement | null;
    if (!firstItem) return;
    const style = getComputedStyle(track);
    const gap = parseFloat(style.columnGap || style.gap || "0") || 0;
    const step = firstItem.getBoundingClientRect().width + gap;
    track.scrollBy({ left: direction * step, behavior: "smooth" });
  };

  prevBtn.addEventListener("click", () => scrollByOneItem(-1));
  nextBtn.addEventListener("click", () => scrollByOneItem(1));
  track.addEventListener("keydown", (evt) => {
    if (evt.key === "ArrowRight") {
      evt.preventDefault();
      scrollByOneItem(1);
    } else if (evt.key === "ArrowLeft") {
      evt.preventDefault();
      scrollByOneItem(-1);
    }
  });

  const updateNavVisibility = () => {
    const atStart = track.scrollLeft <= 1;
    const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
    prevBtn.toggleClass("is-disabled", atStart);
    nextBtn.toggleClass(
      "is-disabled",
      atEnd || track.scrollWidth <= track.clientWidth,
    );
  };
  let navVisibilityTicking = false;
  const onTrackScroll = () => {
    if (navVisibilityTicking) return;
    navVisibilityTicking = true;
    window.requestAnimationFrame(() => {
      updateNavVisibility();
      navVisibilityTicking = false;
    });
  };
  track.addEventListener("scroll", onTrackScroll, { passive: true });
  window.requestAnimationFrame(updateNavVisibility);

  return { track };
}
