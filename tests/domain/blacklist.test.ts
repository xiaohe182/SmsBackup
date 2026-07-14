import { describe, expect, it } from "vitest";

import {
  DEFAULT_BLACKLIST_RULES,
  matchesBlacklist,
  type BlacklistRule,
} from "@/domain/blacklist";

describe("matchesBlacklist", () => {
  it("matches an enabled sender rule", () => {
    const rules: BlacklistRule[] = [
      { id: "sender-taobao", kind: "sender", value: "淘宝", enabled: true },
    ];

    expect(matchesBlacklist("【淘宝】", "您的包裹已发出", rules)?.rule.value).toBe(
      "淘宝",
    );
  });

  it("matches an enabled body rule without case sensitivity", () => {
    const rules: BlacklistRule[] = [
      { id: "body-td", kind: "body", value: "TD退订", enabled: true },
    ];

    expect(matchesBlacklist("10690000", "限时促销，回复td退订", rules)?.rule.value).toBe(
      "TD退订",
    );
  });

  it("ignores disabled rules and ordinary family messages", () => {
    const rules: BlacklistRule[] = [
      { id: "disabled", kind: "body", value: "回家", enabled: false },
    ];

    expect(matchesBlacklist("妈妈", "晚上回家吃饭", rules)).toBeNull();
  });

  it("ships the approved default sender and marketing rules", () => {
    expect(DEFAULT_BLACKLIST_RULES.some((rule) => rule.value === "淘宝")).toBe(true);
    expect(DEFAULT_BLACKLIST_RULES.some((rule) => rule.value === "拼多多")).toBe(true);
    expect(DEFAULT_BLACKLIST_RULES.some((rule) => rule.value === "退订")).toBe(true);
  });
});
