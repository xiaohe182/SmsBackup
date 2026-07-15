import { describe, expect, it } from "vitest";

import {
  calculateVirtualMediaRange,
  createMediaPageCache,
} from "@/domain/virtual-media-grid";

describe("virtual media grid", () => {
  it("renders only nearby cells for ten thousand photos", () => {
    const range = calculateVirtualMediaRange({
      totalCount: 10_000,
      scrollTop: 64_000,
      viewportHeight: 800,
      columnCount: 3,
      rowHeight: 132,
      overscanRows: 2,
      pageSize: 60,
    });

    expect(range.endIndex - range.startIndex).toBeLessThanOrEqual(36);
    expect(range.totalHeight).toBeGreaterThan(400_000);
    expect(range.requiredPages.length).toBeLessThanOrEqual(2);
  });

  it("clamps empty collections without requesting pages", () => {
    expect(
      calculateVirtualMediaRange({
        totalCount: 0,
        scrollTop: 0,
        viewportHeight: 800,
        columnCount: 3,
        rowHeight: 132,
        overscanRows: 2,
        pageSize: 60,
      }),
    ).toEqual({ startIndex: 0, endIndex: 0, totalHeight: 0, requiredPages: [] });
  });

  it("evicts the least-recently-used media page", () => {
    const cache = createMediaPageCache<string>(4);
    for (let page = 0; page < 5; page += 1) cache.set(page, [`page-${page}`]);

    expect(cache.has(0)).toBe(false);
    expect(cache.pageCount()).toBe(4);

    cache.get(1);
    cache.set(5, ["page-5"]);
    expect(cache.has(2)).toBe(false);
    expect(cache.has(1)).toBe(true);
  });
});
