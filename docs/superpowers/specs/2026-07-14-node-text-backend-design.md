# Node 文本短信后端设计

## 目标

在 `D:\myFile\SmsBackup\server` 提供可直接运行的零依赖 Node.js 服务，与 Android 客户端现有接口完全匹配。服务器收到短信后追加写入 `data\sms-records.txt`，文件采用一行一条 JSON 的文本格式，可用 Windows 记事本直接打开。

## 接口

- `GET /api/health`：返回 `200` 和 `{ "ok": true }`。
- `POST /api/sms`：接收客户端短信 JSON，并读取 `Idempotency-Key`。
- 首次收到 `recordId` 时写入文件并返回 `{ "ok": true, "duplicate": false }`。
- 重复收到同一 `recordId` 时不再次写入，返回 `{ "ok": true, "duplicate": true }`。
- 非 JSON、缺失必要字段、幂等头与正文 ID 冲突时返回 `400`；请求体超过 1 MiB 返回 `413`。

## 存储

- 默认文件：`server/data/sms-records.txt`。
- 每行是完整 JSON，保留客户端字段并补充服务器接收时间 `storedAt`。
- 正文换行会被 JSON 转义，不会破坏一行一条记录的结构。
- 启动时扫描现有文本文件中的 `recordId`，服务重启后继续防重。
- 写入通过单一 Promise 队列串行化，避免并发重复写入。

## 部署

- 只要求 Node.js 18 或更高版本，不安装 npm 依赖。
- `npm start` 或 `node server.js` 启动。
- 默认监听 `0.0.0.0:8787`，可用 `HOST`、`PORT`、`SMS_DATA_FILE` 环境变量覆盖。
- 客户端服务器地址填写 `http://服务器IP:8787`，不要包含 `/api/sms`。

## 安全边界

当前客户端协议没有身份验证，因此本服务只应部署在受信任局域网、VPN 或带访问控制的反向代理后，不应把 8787 端口直接暴露到公网。短信正文属于敏感数据，文本文件目录需要限制操作系统访问权限并做好备份。

