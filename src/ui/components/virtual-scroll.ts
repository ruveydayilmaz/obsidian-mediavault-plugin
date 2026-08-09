export interface VirtualRange {
  startIndex: number;
  endIndex: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
}

export function computeVisibleRange(
  scrollTop: number,
  containerHeight: number,
  rowHeight: number,
  totalItems: number,
  overscan = 5,
): VirtualRange {
  if (totalItems === 0 || rowHeight <= 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
    };
  }

  const firstVisible = Math.floor(scrollTop / rowHeight);
  const visibleCount = Math.ceil(containerHeight / rowHeight);

  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(totalItems, firstVisible + visibleCount + overscan);

  return {
    startIndex,
    endIndex,
    topSpacerHeight: startIndex * rowHeight,
    bottomSpacerHeight: (totalItems - endIndex) * rowHeight,
  };
}
