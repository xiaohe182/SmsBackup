export interface VirtualMediaRangeInput {
  totalCount: number;
  scrollTop: number;
  viewportHeight: number;
  columnCount: number;
  rowHeight: number;
  overscanRows: number;
  pageSize: number;
}

export interface VirtualMediaRange {
  startIndex: number;
  endIndex: number;
  totalHeight: number;
  requiredPages: number[];
}

/**
 * 只计算视口附近的固定高度行。这样即使相册有一万张图片，页面也只创建几十个 image 节点，
 * 同时限制需要解码的位图数量，避免 Android WebView 因瞬时内存压力卡死。
 */
export function calculateVirtualMediaRange(
  input: VirtualMediaRangeInput,
): VirtualMediaRange {
  const totalCount = Math.max(0, Math.floor(input.totalCount));
  if (totalCount === 0) {
    return { startIndex: 0, endIndex: 0, totalHeight: 0, requiredPages: [] };
  }

  const columnCount = Math.max(1, Math.floor(input.columnCount));
  const rowHeight = Math.max(1, input.rowHeight);
  const overscanRows = Math.max(0, Math.floor(input.overscanRows));
  const viewportHeight = Math.max(0, input.viewportHeight);
  const scrollTop = Math.max(0, input.scrollTop);
  const pageSize = Math.max(1, Math.floor(input.pageSize));
  const totalRows = Math.ceil(totalCount / columnCount);
  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows);
  const endRow = Math.min(
    totalRows,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscanRows,
  );
  const startIndex = Math.min(totalCount, startRow * columnCount);
  const endIndex = Math.min(totalCount, endRow * columnCount);
  const firstPage = Math.floor(startIndex / pageSize);
  const lastPage = Math.floor(Math.max(startIndex, endIndex - 1) / pageSize);
  const requiredPages = Array.from(
    { length: lastPage - firstPage + 1 },
    (_, offset) => firstPage + offset,
  );

  return {
    startIndex,
    endIndex,
    totalHeight: totalRows * rowHeight,
    requiredPages,
  };
}

export interface MediaPageCache<T> {
  get(page: number): T[] | undefined;
  set(page: number, items: T[]): void;
  has(page: number): boolean;
  clear(): void;
  pageCount(): number;
}

export function createMediaPageCache<T>(maxPages: number): MediaPageCache<T> {
  const capacity = Math.max(1, Math.floor(maxPages));
  const pages = new Map<number, T[]>();

  return {
    get(page) {
      const items = pages.get(page);
      if (items === undefined) return undefined;
      pages.delete(page);
      pages.set(page, items);
      return items;
    },
    set(page, items) {
      if (pages.has(page)) pages.delete(page);
      pages.set(page, items);

      // Map 的首项就是最久未访问页；每次只淘汰溢出的旧页，缓存始终不超过四页预算。
      while (pages.size > capacity) {
        const oldestPage = pages.keys().next().value as number | undefined;
        if (oldestPage === undefined) break;
        pages.delete(oldestPage);
      }
    },
    has: (page) => pages.has(page),
    clear: () => pages.clear(),
    pageCount: () => pages.size,
  };
}
