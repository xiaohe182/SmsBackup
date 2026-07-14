# 固定密码短信查看器设计

## 目标

在现有 Android-only SmsBackup 中增加本机短信查看功能。用户从首页进入“查看全部短信”，必须输入固定密码 `88888888`，校验成功后才能读取并显示 Android 系统短信库中的全部记录。

## 范围

- 仅支持 Android，继续使用现有 `READ_SMS` 权限。
- 展示收件箱、已发送、草稿、发件箱、发送失败、等待发送及未知类型短信。
- 每条记录展示号码、完整正文、短信类型、时间、已读状态、SIM 订阅 ID 等可用元数据。
- 列表按短信时间倒序排列，提供手动刷新。
- 页面隐藏或退出后立即清空列表并重新锁定，再次进入必须重新输入密码。
- 现有黑名单只控制上传；本机“全部短信”查看不套用黑名单，确保确实可以查看所有短信。

## 密码边界

- TypeScript 中提供 `SMS_VIEWER_PASSWORD = "88888888"` 和纯函数校验，供页面即时反馈。
- Kotlin 原生入口再次使用写死密码 `88888888` 校验。密码错误时不执行 `ContentResolver.query`，只返回 `authorized=false`。
- 固定密码会出现在 APK 中，无法抵御反编译，只用于防止家人或普通使用者误看，不作为强安全方案。

## 数据流

1. 首页跳转至 `pages/messages/messages`。
2. 页面显示密码遮罩，不读取短信。
3. 输入 `88888888` 后调用 `smsBackupService.listAllMessages(password)`。
4. UTS 在 IO 调度器中调用 Kotlin `SmsBackupNative.getAllMessagesJson(password)`。
5. Kotlin 校验密码和 `READ_SMS` 权限，通过后查询 `Telephony.Sms.CONTENT_URI`，按 `date DESC` 输出 JSON。
6. TypeScript 验证原生响应结构，页面渲染完整列表。

## 错误处理

- 密码错误：保留锁定状态，提示“密码错误”。
- 未授权：不查询短信，显示授权按钮。
- 原生上下文不可用或响应异常：列表保持为空并显示读取失败提示。
- 页面进入后台或被覆盖：清空正文、密码输入和解锁状态。

## 验证

- 单元测试覆盖固定密码正确/错误、原生响应解析和密码透传。
- 静态契约测试覆盖 UTS/Kotlin 方法、原生密码二次校验、系统短信查询字段和首页入口。
- 运行全量 Vitest、`vue-tsc --noEmit` 和 `uni build -p app-plus`。

