export function normalizeServerUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("服务器地址格式不正确");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("仅支持 HTTP 或 HTTPS");
  }

  return trimmed.replace(/\/+$/, "");
}
