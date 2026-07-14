export type BlacklistRuleKind = "sender" | "body";

export interface BlacklistRule {
  id: string;
  kind: BlacklistRuleKind;
  value: string;
  enabled: boolean;
  builtIn?: boolean;
}

export interface BlacklistMatch {
  rule: BlacklistRule;
  matchedText: string;
}

export const DEFAULT_BLACKLIST_RULES: BlacklistRule[] = [
  { id: "sender-taobao", kind: "sender", value: "淘宝", enabled: true, builtIn: true },
  { id: "sender-pinduoduo", kind: "sender", value: "拼多多", enabled: true, builtIn: true },
  { id: "body-unsubscribe", kind: "body", value: "退订", enabled: true, builtIn: true },
  { id: "body-promotion", kind: "body", value: "促销", enabled: true, builtIn: true },
  { id: "body-coupon", kind: "body", value: "优惠券", enabled: true, builtIn: true },
];

export function matchesBlacklist(
  sender: string,
  body: string,
  rules: BlacklistRule[],
): BlacklistMatch | null {
  const normalizedSender = sender.toLocaleLowerCase();
  const normalizedBody = body.toLocaleLowerCase();

  for (const rule of rules) {
    const needle = rule.value.trim().toLocaleLowerCase();
    if (!rule.enabled || !needle) {
      continue;
    }

    const target = rule.kind === "sender" ? normalizedSender : normalizedBody;
    if (target.includes(needle)) {
      return { rule, matchedText: rule.kind === "sender" ? sender : body };
    }
  }

  return null;
}
