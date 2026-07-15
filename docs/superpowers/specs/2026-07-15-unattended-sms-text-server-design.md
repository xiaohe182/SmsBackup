# 无人值守短信采集与纯文本 Node 服务设计

日期：2026-07-15

## 目标

SmsBackup 在设备持有人完成一次短信权限授权后，不再依赖用户点击“扫描历史短信”才能工作。应用关闭、普通进程被系统回收或手机重启后，新收到的短信继续进入本地可靠队列；历史收件和已发送短信通过启动补扫与周期补扫进入同一队列，网络恢复后自动上传。

服务端继续使用零第三方依赖的 Node.js，不引入数据库。短信以一行一条 JSON 的形式追加到 TXT 文件，并额外提供受保护的分页读取接口和 Markdown 导出接口。默认服务器地址使用用户提供的 `http://119.91.65.202:8787`。

## 明确边界

- Android 的短信权限必须由设备持有人至少授权一次；从未打开、从未授权的设备不能读取短信。
- 服务端不能直接越过 Android 从公网拉取系统短信。数据流始终是手机本地读取、可靠排队、主动上传，其他软件再从 Node 服务读取归档。
- 普通清理后台、进程回收和重启需要恢复采集；系统设置中的“强行停止”必须等用户再次打开应用后才能恢复，这是 Android 平台限制。
- `SMS_RECEIVED` 能立即覆盖新收到的 SMS；已发送短信没有等价的非默认短信应用广播，因此通过启动补扫和 WorkManager 周期补扫获取。周期任务不承诺精确执行时间。
- 如果用户在下一次周期补扫前立即删除刚发送的短信，非默认短信应用无法保证找回这条记录；做到发送短信零时间窗采集需要让 SmsBackup 成为默认短信应用，本次不扩大到该范围。
- 服务端不使用数据库。手机端仍保留现有应用私有 SQLite 队列，因为它负责断网重试、幂等状态和崩溃恢复，不属于服务端归档数据库，也不能安全地用普通 TXT 替代。
- 本次不把应用改成默认短信应用，不隐藏应用，不绕过系统权限或强行停止。

## 采用方案

采用“系统广播 + 立即补扫 + 周期补扫 + 启动/重启恢复”的组合方案。

不采用常驻前台服务。前台服务会持续显示通知、增加耗电，仍无法突破强行停止；当前家庭自用场景先利用系统短信广播处理收件，利用 WorkManager 处理历史和已发送短信补漏。Android 官方说明 `SMS_RECEIVED_ACTION` 会通知已注册的接收器；WorkManager 周期任务最短间隔为 15 分钟且受省电策略影响，因此它只承担补漏，不承担收到短信的实时主链路。

## Android 客户端设计

### 首次授权

1. 首页保留一处明确的短信授权按钮，不能静默弹权或绕过用户确认。
2. 权限授权成功后，立即执行一次历史收件与已发送短信扫描。
3. 扫描完成后立即安排上传任务，并刷新首页状态。
4. 已授权用户的主按钮文案改为“立即补扫”，强调它只是手动补漏，不是自动采集的必要条件。

### 无人值守恢复

- `SmsReceiver` 继续在收到 `SMS_RECEIVED` 时拼接多段短信、写入本地队列并安排上传。
- `WorkScheduler.initialize` 在应用每次启动时安排周期补扫、立即补扫和待上传重试。立即补扫使用唯一 OneTimeWork，避免多次启动重复并发。
- 周期补扫从 24 小时调整为 15 分钟。系统可以延迟执行，但不会短于 Android 允许的最小周期。
- 新增启动恢复 Receiver，监听 `BOOT_COMPLETED` 与 `MY_PACKAGE_REPLACED`，重新初始化 WorkManager 任务。
- `SmsReconcileWorker` 只在 `READ_SMS` 已授权时扫描；无权限时安全结束，不弹窗、不崩溃。
- 所有扫描继续依赖 `recordId` 与内容指纹去重，立即补扫、周期补扫和广播可以安全重叠。

### 默认服务器配置

- `DEFAULT_SETTINGS.serverUrl` 设为 `http://119.91.65.202:8787`。
- 因用户当前只提供公网 IP、没有域名和证书，默认允许该 HTTP 地址运行，并在设置页持续显示“公网 HTTP 会明文传输短信”的警告。
- 上传与读取默认使用兼容令牌 `88888888`；`AppSettings.apiToken` 与设置页允许修改，Node 端通过 `SMS_BACKUP_TOKEN` 环境变量设置相同值。默认令牌只能阻止未携带令牌的普通访问，不能抵御 HTTP 监听或 APK 反编译。
- 后续具备域名后，应使用 HTTPS 反向代理，并关闭 `allowInsecureHttp`。

## Node 纯文本服务设计

### 存储

- 主文件继续是 `server/data/sms-records.txt`。
- 每行是一个完整 JSON 对象，短信正文中的换行由 JSON 转义，因此仍保持一条记录一行。
- `recordId` 是幂等键；服务启动时扫描现有 TXT，恢复去重集合和只读记录列表。
- 写入使用现有串行 Promise 队列，避免并发请求交叉写行。
- Markdown 不是主事实源；`GET /api/sms/export.md` 根据 TXT 内容实时生成，避免两份持久文件不一致。

### 接口

`GET /api/health`

- 保持公开，仅返回服务可用状态，不返回短信、路径或令牌。

`POST /api/sms`

- 需要 `Authorization: Bearer <token>`。
- 保持现有 JSON 校验、1 MiB 请求上限和 `Idempotency-Key` 校验。
- 重复 `recordId` 返回成功但不重复写入。

`GET /api/sms?limit=50&offset=0&deviceId=&direction=`

- 需要 Bearer Token。
- `limit` 限制为 1–100，`offset` 不小于 0。
- 支持按设备和收发方向过滤，按 `storedAt`/`receivedAt` 从新到旧返回。
- 响应包含 `items`、`offset`、`limit`、`totalCount` 和 `hasMore`，其他软件可以直接分页读取。

`GET /api/sms/export.md`

- 需要 Bearer Token。
- 返回 UTF-8 Markdown 附件，按时间倒序展示设备、方向、号码、时间和完整正文。
- Markdown 特殊字符和正文换行必须转义或使用代码块，不能破坏记录边界。

### 直接运行

服务继续支持：

```powershell
Set-Location D:\myFile\SmsBackup\server
npm start
```

默认监听 `0.0.0.0:8787`。可选环境变量只有：

- `HOST`
- `PORT`
- `SMS_DATA_FILE`
- `SMS_BACKUP_TOKEN`

没有数据库安装、迁移或外部依赖步骤。

## 数据流与失败处理

1. 收到新 SMS 后 Receiver 立即构造本地记录。
2. 本地 SQLite 以 `recordId` 和内容指纹去重并保存 pending 状态。
3. Upload Worker 在有网络时向公网 Node 服务上传，携带 Bearer Token。
4. Node 校验令牌、请求体和幂等键后串行追加 TXT。
5. Node 返回 2xx 后手机标记 uploaded；断网和 5xx 保持 pending 并指数退避。
6. 启动、重启和周期 Worker 扫描系统 Provider，将漏掉的收件/已发送短信补入相同队列。
7. 用户强行停止后暂停；再次打开时立即补扫并恢复任务。

## 测试要求

### 自动测试

- 首页契约：授权成功自动扫描；已授权状态不要求用户点击采集才能安排后台任务。
- 原生契约：Boot Receiver、`RECEIVE_BOOT_COMPLETED`、立即唯一补扫和 15 分钟周期补扫存在。
- Receiver 契约：进程未运行时收到短信仍入队并安排上传。
- 设置契约：默认服务器是 `http://119.91.65.202:8787`，HTTP 警告仍存在。
- 上传契约：请求包含 Bearer Token。
- Node 测试：无令牌拒绝、正确令牌写入、重复幂等、分页、筛选、边界参数、Markdown 导出、重启恢复。
- 回归：原有应用测试、类型检查、Node 测试和 `build:app-plus` 全部通过。

### 真机测试

- 首次授权后退出应用，不点击“立即补扫”，另一台手机发送短信，服务器 TXT 自动出现记录。
- 从最近任务划掉应用后重复测试。
- 手机重启后不打开应用，等待新短信并验证自动上传。
- 发送短信后等待周期补扫，验证已发送记录进入 TXT。
- 断网接收短信，恢复网络后验证补传且不重复。
- 系统强行停止后确认不会收集；重新打开后确认补扫恢复。

## 官方平台依据

- Android `SMS_RECEIVED_ACTION`：https://developer.android.com/reference/android/provider/Telephony.Sms.Intents.html
- WorkManager 周期任务与 15 分钟最小间隔：https://developer.android.com/reference/androidx/work/PeriodicWorkRequest
- Android 15 强行停止状态：https://developer.android.com/about/versions/15/behavior-changes-all
