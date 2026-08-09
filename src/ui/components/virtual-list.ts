import { computeVisibleRange } from "./virtual-scroll";

export interface VirtualListOptions<T> {
  container: HTMLElement;
  items: T[];
  rowHeight: number;
  renderRow: (item: T, index: number) => HTMLElement;
  threshold?: number;
  overscan?: number;
}

export function renderVirtualList<T>(
  options: VirtualListOptions<T>,
): () => void {
  const {
    container,
    items,
    rowHeight,
    renderRow,
    threshold = 100,
    overscan = 6,
  } = options;

  container.empty();

  if (items.length <= threshold) {
    items.forEach((item, i) => container.appendChild(renderRow(item, i)));
    return () => {
      // Ignore
    };
  }

  const viewport = container.createDiv({ cls: "mediavault-virtual-viewport" });
  const topSpacer = viewport.createDiv({ cls: "mediavault-virtual-spacer" });
  const rowsContainer = viewport.createDiv({ cls: "mediavault-virtual-rows" });
  const bottomSpacer = viewport.createDiv({ cls: "mediavault-virtual-spacer" });

  function renderVisible() {
    const range = computeVisibleRange(
      viewport.scrollTop,
      viewport.clientHeight || 400,
      rowHeight,
      items.length,
      overscan,
    );

    topSpacer.style.height = `${range.topSpacerHeight}px`;
    bottomSpacer.style.height = `${range.bottomSpacerHeight}px`;

    rowsContainer.empty();
    for (let i = range.startIndex; i < range.endIndex; i++) {
      rowsContainer.appendChild(renderRow(items[i], i));
    }
  }

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(() => {
      renderVisible();
      ticking = false;
    });
  };

  viewport.addEventListener("scroll", onScroll);
  renderVisible();

  return () => viewport.removeEventListener("scroll", onScroll);
}
