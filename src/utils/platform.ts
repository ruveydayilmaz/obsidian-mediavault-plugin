import { App, Platform } from "obsidian";

export function isAndroidDevice(): boolean {
  return Platform.isAndroidApp;
}

export function applyAndroidBodyClass(): void {
  document.body.classList.toggle("mediavault-android", isAndroidDevice());
}

let androidSafeAreaCleanup: (() => void) | null = null;

function measureAndroidSystemInset(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  const layoutHeight = window.innerHeight;
  const rawInset = layoutHeight - vv.height - vv.offsetTop;
  const inset = Math.max(0, Math.round(rawInset));

  return Math.min(inset, 64);
}

const MAX_OBSTRUCTION_CANDIDATE_HEIGHT = 160;
const BOTTOM_DOCK_TOLERANCE = 6;
const ANDROID_EXTRA_BOTTOM_PADDING = 50;

function isPluginOwnElement(el: HTMLElement): boolean {
  return !!el.closest(
    [
      ".mediavault-library-root",
      ".mediavault-modal-shell",
      ".modal-content",
      ".mediavault-detail-modal",
    ].join(","),
  );
}

function isVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (parseFloat(style.opacity || "1") === 0) return false;
  return true;
}

function findBottomDockedObstructions(): HTMLElement[] {
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const candidates = new Set<HTMLElement>();

  for (const child of Array.from(document.body.children)) {
    const el = child as HTMLElement;
    candidates.add(el);
    for (const grandchild of Array.from(el.children)) {
      candidates.add(grandchild as HTMLElement);
    }
  }

  const results: HTMLElement[] = [];
  for (const el of candidates) {
    if (isPluginOwnElement(el)) continue;
    if (!isVisible(el)) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (rect.height > MAX_OBSTRUCTION_CANDIDATE_HEIGHT) continue;
    if (rect.top <= 0) continue;
    if (Math.abs(viewportHeight - rect.bottom) > BOTTOM_DOCK_TOLERANCE)
      continue;

    results.push(el);
  }

  return results;
}

interface ToolbarObstructionResult {
  el: HTMLElement | null;
  rect: DOMRect | null;
  obstruction: number;
}

function measureObsidianToolbarObstruction(): ToolbarObstructionResult {
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const obstructions = findBottomDockedObstructions();
  if (obstructions.length === 0) {
    return { el: null, rect: null, obstruction: 0 };
  }

  let winner = obstructions[0];
  let winnerRect = winner.getBoundingClientRect();
  for (const el of obstructions.slice(1)) {
    const rect = el.getBoundingClientRect();
    if (rect.top < winnerRect.top) {
      winner = el;
      winnerRect = rect;
    }
  }

  const obstruction = Math.max(0, Math.round(viewportHeight - winnerRect.top));
  return { el: winner, rect: winnerRect, obstruction };
}

export function getAndroidBottomObstruction(): number {
  const systemInset = measureAndroidSystemInset();
  const { obstruction: toolbarInset } = measureObsidianToolbarObstruction();
  return systemInset + toolbarInset;
}

export function setupAndroidSafeArea(app?: App): void {
  if (!isAndroidDevice() || androidSafeAreaCleanup) return;

  let toolbarEl: HTMLElement | null = null;
  let toolbarResizeObserver: ResizeObserver | null = null;
  let rafHandle: number | null = null;

  const attachToolbarObserver = (el: HTMLElement): void => {
    toolbarResizeObserver?.disconnect();
    toolbarResizeObserver = new ResizeObserver(() => updateAll());
    toolbarResizeObserver.observe(el);
  };

  const updateAll = (): void => {
    const systemInset = measureAndroidSystemInset();
    const toolbarResult = measureObsidianToolbarObstruction();

    const finalInset =
      systemInset + toolbarResult.obstruction + ANDROID_EXTRA_BOTTOM_PADDING;

    document.body.style.setProperty(
      "--mediavault-android-bottom-inset",
      `${finalInset}px`,
    );

    document.body.style.setProperty(
      "--mediavault-android-toolbar-inset",
      `${toolbarResult.obstruction}px`,
    );

    if (toolbarResult.el !== toolbarEl) {
      toolbarEl = toolbarResult.el;

      if (toolbarEl) {
        attachToolbarObserver(toolbarEl);
      } else {
        toolbarResizeObserver?.disconnect();
      }
    }
  };

  const scheduleUpdate = (): void => {
    if (rafHandle !== null) return;
    rafHandle = window.requestAnimationFrame(() => {
      rafHandle = null;
      updateAll();
    });
  };

  const bodyObserver = new MutationObserver(scheduleUpdate);
  bodyObserver.observe(document.body, { childList: true, subtree: false });

  const childObservers: MutationObserver[] = [];
  for (const child of Array.from(document.body.children)) {
    const obs = new MutationObserver(scheduleUpdate);
    obs.observe(child, { childList: true, subtree: false });
    childObservers.push(obs);
  }

  updateAll();

  const vv = window.visualViewport;
  vv?.addEventListener("resize", scheduleUpdate);
  window.addEventListener("orientationchange", scheduleUpdate);
  window.addEventListener("resize", scheduleUpdate);

  const workspace = app?.workspace;
  workspace?.on("layout-change", scheduleUpdate);
  workspace?.on("active-leaf-change", scheduleUpdate);
  workspace?.on("resize", scheduleUpdate);

  androidSafeAreaCleanup = () => {
    if (rafHandle !== null) window.cancelAnimationFrame(rafHandle);
    vv?.removeEventListener("resize", scheduleUpdate);
    window.removeEventListener("orientationchange", scheduleUpdate);
    window.removeEventListener("resize", scheduleUpdate);
    workspace?.off("layout-change", scheduleUpdate);
    workspace?.off("active-leaf-change", scheduleUpdate);
    workspace?.off("resize", scheduleUpdate);
    bodyObserver.disconnect();
    for (const obs of childObservers) obs.disconnect();
    toolbarResizeObserver?.disconnect();
    document.body.style.removeProperty("--mediavault-android-bottom-inset");
    document.body.style.removeProperty("--mediavault-android-toolbar-inset");
  };
}

export function teardownAndroidSafeArea(): void {
  androidSafeAreaCleanup?.();
  androidSafeAreaCleanup = null;
}
