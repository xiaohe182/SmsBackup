function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return "未知时间";
  return new Date(timestamp).toISOString();
}

export function formatSmsMarkdown(records) {
  const sections = records.map((record, index) => {
    const direction = record.direction === "sent" ? "已发送" : "已接收";
    return [
      `## ${index + 1}. ${escapeHtml(direction)} · ${escapeHtml(record.sender)}`,
      "",
      `- 设备：${escapeHtml(record.deviceName)}`,
      `- 设备 ID：${escapeHtml(record.deviceId)}`,
      `- 时间：${formatTimestamp(record.receivedAt)}`,
      `- 记录 ID：${escapeHtml(record.recordId)}`,
      "",
      // 使用 HTML pre 并转义正文，正文中的 Markdown、换行和标签都不会破坏记录边界。
      `<pre>${escapeHtml(record.body)}</pre>`,
    ].join("\n");
  });

  return [
    "# SmsBackup 短信归档",
    "",
    `导出时间：${new Date().toISOString()}`,
    `记录数量：${records.length}`,
    "",
    ...sections,
    "",
  ].join("\n");
}
