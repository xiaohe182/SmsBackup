export function normalizeServerUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  // Android 的部分 uni-app JS 运行时没有完整实现全局 URL 构造器，
  // 因此只使用基础字符串规则校验服务端基址，避免合法公网 IP 被误判。
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed);
  if (!schemeMatch) {
    throw new Error("服务器地址格式不正确");
  }

  const protocol = schemeMatch[1].toLowerCase();
  if (protocol !== "http" && protocol !== "https") {
    throw new Error("仅支持 HTTP 或 HTTPS");
  }

  const remainder = trimmed.slice(schemeMatch[0].length);
  if (!remainder || /\s/.test(remainder)) {
    throw new Error("服务器地址格式不正确");
  }

  const authority = remainder.split(/[/?#]/, 1)[0];
  if (!authority || authority.includes("@")) {
    throw new Error("服务器地址格式不正确");
  }

  let host = authority;
  let port = "";
  if (authority.startsWith("[")) {
    const bracketEnd = authority.indexOf("]");
    if (bracketEnd <= 1) throw new Error("服务器地址格式不正确");
    host = authority.slice(0, bracketEnd + 1);
    const tail = authority.slice(bracketEnd + 1);
    if (tail && !tail.startsWith(":")) {
      throw new Error("服务器地址格式不正确");
    }
    port = tail.slice(1);
  } else {
    const colonIndex = authority.lastIndexOf(":");
    if (colonIndex >= 0) {
      host = authority.slice(0, colonIndex);
      port = authority.slice(colonIndex + 1);
    }
  }

  if (!host || (!host.startsWith("[") && !/^[a-z0-9.-]+$/i.test(host))) {
    throw new Error("服务器地址格式不正确");
  }
  if (authority.includes(":") && !port) {
    throw new Error("服务器地址格式不正确");
  }
  if (port && (!/^\d{1,5}$/.test(port) || Number(port) > 65_535)) {
    throw new Error("服务器端口格式不正确");
  }

  return trimmed.replace(/\/+$/, "");
}
