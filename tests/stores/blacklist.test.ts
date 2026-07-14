import { describe, expect, it } from "vitest";

import {
  addRule,
  loadRules,
  removeRule,
  saveRules,
  toggleRule,
} from "@/stores/blacklist";
import type { KeyValueStorage } from "@/stores/settings";

function createStorage(): KeyValueStorage {
  const values = new Map<string, unknown>();
  return {
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
  };
}

describe("blacklist store", () => {
  it("loads independent copies of approved defaults", () => {
    const storage = createStorage();
    const first = loadRules(storage);
    first[0].enabled = false;

    expect(loadRules(createStorage()).some((rule) => rule.value === "淘宝")).toBe(true);
    expect(loadRules(createStorage()).some((rule) => rule.value === "拼多多")).toBe(true);
  });

  it("adds, toggles, persists, and removes a custom rule", () => {
    const storage = createStorage();
    const added = addRule(loadRules(storage), "sender", "1069");
    const custom = added.find((rule) => rule.value === "1069");
    expect(custom).toBeDefined();

    const toggled = toggleRule(added, custom!.id);
    expect(toggled.find((rule) => rule.id === custom!.id)?.enabled).toBe(false);

    saveRules(storage, toggled);
    const persisted = loadRules(storage);
    expect(persisted.find((rule) => rule.id === custom!.id)?.enabled).toBe(false);

    expect(removeRule(persisted, custom!.id).some((rule) => rule.id === custom!.id)).toBe(
      false,
    );
  });

  it("rejects blank and duplicate rules", () => {
    const rules = loadRules(createStorage());
    expect(() => addRule(rules, "body", "   ")).toThrow("规则内容不能为空");
    expect(() => addRule(rules, "sender", "淘宝")).toThrow("规则已经存在");
  });
});
