import { Platform, type Plugin } from "obsidian";

const MODAL_SELECTOR = ".modal.mediavault-modal-shell, .modal.mediavault-detail-modal";
const EDITABLE_SELECTOR =
  'textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]), [contenteditable="true"]';
const OPEN_CLASS = "mediavault-keyboard-open";
const BAR_SELECTOR = ".mediavault-modal-buttons, .mediavault-detail-actions";
const MARGIN = 8;
const SETTLE_DELAYS_MS = [60, 180, 400, 700];
const ESTIMATE_DELAY_MS = 450;
const ESTIMATE_FRACTION = 0.45;

interface CapacitorKeyboardEvent extends Event {
  keyboardHeight?: number;
}

function isEditable(el: Element | null): el is HTMLElement {
  return !!el && el.matches(EDITABLE_SELECTOR);
}

function findScroller(el: HTMLElement, modal: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== modal.parentElement) {
    const oy = getComputedStyle(node).overflowY;
    if ((oy === "auto" || oy === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return modal.querySelector<HTMLElement>(".modal-content") ?? modal;
}

export function setupMobileKeyboardSupport(plugin: Plugin): void {
  const vv = window.visualViewport;
  if (!Platform.isMobile || !vv) return;

  let activeModal: HTMLElement | null = null;
  let frame = 0;
  let timers: number[] = [];
  let nativeKbHeight = 0;
  let estimatedKbHeight = 0;
  let baselineInnerHeight = window.innerHeight;

  const keyboardClosed = (): boolean =>
    nativeKbHeight === 0 && estimatedKbHeight === 0 && !isEditable(document.activeElement);

  const clearTimers = (): void => {
    timers.forEach((id) => window.clearTimeout(id));
    timers = [];
  };

  const clear = (): void => {
    clearTimers();
    estimatedKbHeight = 0;
    if (!activeModal) return;
    activeModal.removeClass(OPEN_CLASS);
    activeModal.style.removeProperty("--mediavault-kb-overlap");
    activeModal.style.removeProperty("--mediavault-vv-height");
    activeModal = null;
  };

  const sync = (): void => {
    const modal = activeModal;
    if (!modal || !modal.isConnected) {
      clear();
      return;
    }
    const el = document.activeElement;
    if (!isEditable(el) || !modal.contains(el)) return;

    if (Platform.isIosApp && (window.scrollY !== 0 || window.scrollX !== 0)) {
      window.scrollTo(0, 0);
    }

    const scroller = findScroller(el, modal);
    const visTop = vv.offsetTop;
    let visBottom = vv.offsetTop + vv.height;
    const kb = nativeKbHeight || estimatedKbHeight;
    if (kb > 0) {
      const layoutShrink = Math.max(0, baselineInnerHeight - window.innerHeight);
      visBottom = Math.min(visBottom, window.innerHeight - Math.max(0, kb - layoutShrink));
    }

    const overlap = Math.max(
      0,
      Math.ceil(scroller.getBoundingClientRect().bottom - visBottom),
    );
    modal.style.setProperty("--mediavault-kb-overlap", `${overlap}px`);
    modal.style.setProperty(
      "--mediavault-vv-height",
      `${Math.max(0, visBottom - visTop)}px`,
    );

    const bar = modal.querySelector<HTMLElement>(BAR_SELECTOR);
    let barH = 0;
    if (bar) {
      const barRect = bar.getBoundingClientRect();
      barH = Math.max(0, visBottom - barRect.top);
      barH = Math.min(barH, bar.offsetHeight);
    }
    const rect = el.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const top = Math.max(visTop, scrollerRect.top) + MARGIN;
    const bottom = Math.min(visBottom, scrollerRect.bottom) - barH - MARGIN;

    let delta = 0;
    if (rect.height > bottom - top || rect.top < top) delta = rect.top - top;
    else if (rect.bottom > bottom) delta = rect.bottom - bottom;
    if (Math.abs(delta) >= 1) scroller.scrollTop += delta;
  };

  const schedule = (): void => {
    if (frame) window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      sync();
    });
  };

  plugin.registerDomEvent(document, "focusin", (evt) => {
    const target = evt.target;
    if (!(target instanceof Element) || !isEditable(target)) return;
    const modal = target.closest<HTMLElement>(MODAL_SELECTOR);
    if (!modal) return;
    if (activeModal && activeModal !== modal) clear();
    clearTimers();
    activeModal = modal;
    modal.addClass(OPEN_CLASS);
    schedule();
    timers = SETTLE_DELAYS_MS.map((ms) => window.setTimeout(schedule, ms));
    if (Platform.isPhone) {
      timers.push(
        window.setTimeout(() => {
          const shrunk = baselineInnerHeight - window.innerHeight > 0 || vv.height < window.innerHeight;
          if (nativeKbHeight === 0 && !shrunk && isEditable(document.activeElement)) {
            estimatedKbHeight = Math.round(window.innerHeight * ESTIMATE_FRACTION);
            schedule();
          }
        }, ESTIMATE_DELAY_MS),
      );
    }
  });

  plugin.registerDomEvent(document, "focusout", () => {
    window.setTimeout(() => {
      if (!isEditable(document.activeElement)) clear();
    }, 80);
  });

  plugin.registerDomEvent(document, "input", (evt) => {
    if (activeModal && evt.target instanceof Element && activeModal.contains(evt.target)) {
      schedule();
    }
  });

  const onKeyboardShow = (evt: Event): void => {
    const h = (evt as CapacitorKeyboardEvent).keyboardHeight;
    if (typeof h === "number" && h > 0) {
      nativeKbHeight = h;
      estimatedKbHeight = 0;
    }
    schedule();
  };
  const onKeyboardHide = (): void => {
    nativeKbHeight = 0;
    estimatedKbHeight = 0;
    baselineInnerHeight = window.innerHeight;
    if (isEditable(document.activeElement)) schedule();
    else clear();
  };
  plugin.registerDomEvent(window, "keyboardWillShow" as keyof WindowEventMap, onKeyboardShow);
  plugin.registerDomEvent(window, "keyboardDidShow" as keyof WindowEventMap, onKeyboardShow);
  plugin.registerDomEvent(window, "keyboardWillHide" as keyof WindowEventMap, onKeyboardHide);
  plugin.registerDomEvent(window, "keyboardDidHide" as keyof WindowEventMap, onKeyboardHide);

  plugin.registerDomEvent(window, "resize", () => {
    if (keyboardClosed()) baselineInnerHeight = window.innerHeight;
    schedule();
  });

  vv.addEventListener("resize", schedule);
  vv.addEventListener("scroll", schedule);
  plugin.register(() => {
    vv.removeEventListener("resize", schedule);
    vv.removeEventListener("scroll", schedule);
    if (frame) window.cancelAnimationFrame(frame);
    clear();
  });
}
