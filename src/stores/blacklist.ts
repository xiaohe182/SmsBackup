import {
  DEFAULT_BLACKLIST_RULES,
  type BlacklistRule,
  type BlacklistRuleKind,
} from "@/domain/blacklist";
import type { KeyValueStorage } from "@/stores/settings";

const RULES_KEY = "sms-backup:blacklist";

function cloneRules(rules: BlacklistRule[]): BlacklistRule[] {
  return rules.map((rule) => ({ ...rule }));
}

function isRule(value: unknown): value is BlacklistRule {
  if (!value || typeof value !== "object") {
    return false;
  }
  const rule = value as Record<string, unknown>;
  return (
    typeof rule.id === "string" &&
    (rule.kind === "sender" || rule.kind === "body") &&
    typeof rule.value === "string" &&
    typeof rule.enabled === "boolean"
  );
}

export function loadRules(storage: KeyValueStorage): BlacklistRule[] {
  const stored = storage.get(RULES_KEY);
  if (!Array.isArray(stored) || !stored.every(isRule)) {
    return cloneRules(DEFAULT_BLACKLIST_RULES);
  }
  return cloneRules(stored);
}

export function saveRules(
  storage: KeyValueStorage,
  rules: BlacklistRule[],
): BlacklistRule[] {
  const cloned = cloneRules(rules);
  storage.set(RULES_KEY, cloned);
  return cloned;
}

export function addRule(
  rules: BlacklistRule[],
  kind: BlacklistRuleKind,
  rawValue: string,
): BlacklistRule[] {
  const value = rawValue.trim();
  if (!value) {
    throw new Error("规则内容不能为空");
  }
  const duplicate = rules.some(
    (rule) =>
      rule.kind === kind && rule.value.toLocaleLowerCase() === value.toLocaleLowerCase(),
  );
  if (duplicate) {
    throw new Error("规则已经存在");
  }
  return [
    ...cloneRules(rules),
    {
      id: `custom-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      value,
      enabled: true,
    },
  ];
}

export function toggleRule(rules: BlacklistRule[], id: string): BlacklistRule[] {
  return rules.map((rule) =>
    rule.id === id ? { ...rule, enabled: !rule.enabled } : { ...rule },
  );
}

export function removeRule(rules: BlacklistRule[], id: string): BlacklistRule[] {
  return rules.filter((rule) => rule.id !== id).map((rule) => ({ ...rule }));
}
