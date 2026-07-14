# SmsBackup

一个只面向 Android 的 uni-app 短信备份应用。设备持有人主动授权后，应用会扫描已有收件/发件短信，接收后续新短信，过滤黑名单内容，并把允许同步的短信可靠地排队提交到自定义服务器。

## 已实现

- Android 8.0（API 26）及以上。
- 首次授权后扫描已有收件和发件短信。
- Manifest 静态 `SmsReceiver`，应用普通进程被回收后仍可由新短信唤醒。
- SQLite 本地可靠队列；服务器成功确认前不删除待上传记录。
- `recordId` 与内容指纹双重去重，避免广播和全量扫描重复上传。
- WorkManager 网络恢复重试、指数退避及每日全量补漏。
- 发件人和正文关键词黑名单，内置淘宝、拼多多、退订、促销、优惠券。
- 首页可进入“查看全部短信”，输入固定密码 `88888888` 后查看系统短信库中的完整记录。
- 查看页覆盖收件、已发送、草稿、发件箱、失败和排队短信；退出或切到后台后立即重新锁定并清空页面正文。
- 可配置服务器地址、设备名称、同步开关和局域网 HTTP 开关。
- 不隐藏应用、不绕过系统强行停止、不在普通日志输出短信正文。

## 目录

```text
src/pages/                         uni-app 页面
src/domain/                        可测试的规则和上传契约
src/stores/                        设置与黑名单本地状态
src/services/                      页面到 UTS 插件的适配层
src/uni_modules/sms-backup-native/ Android UTS/Kotlin 原生插件
server/                            可直接运行的零依赖 Node.js 服务端
tests/                             TypeScript 与原生契约测试
docs/android-device-test-checklist.md  真机验收步骤
```

## 本地检查

需要 Node.js 18 或 20+；当前工程已在 Node.js 22 下完成检查。

```powershell
Set-Location D:\myFile\SmsBackup
npm install
npm test -- --run
npm run type-check
npm run build:app-plus
```

`build:app-plus` 生成 `dist\build\app`，同时将 UTS 入口编译为 Kotlin，并复制混编 Kotlin、Manifest 和依赖配置。

## HBuilderX 真机运行

1. 安装当前正式版 HBuilderX，建议 5.15 或更高版本。
2. 在 HBuilderX 中安装“UTS 开发扩展 - Android”，并配置 Android/JDK/Gradle 环境。
3. 打开 `D:\myFile\SmsBackup`。这是 CLI 工程，不要另建项目或再套一层目录。
4. 在 `src\manifest.json` 的可视化界面中登录 DCloud 账号并获取你自己的 AppID；当前占位值不能用于正式云打包。
5. 连接 Android 真机，选择“运行到 Android App 基座”。
6. 在首页点击“同意并授权读取短信”，由手机持有人在系统弹窗中确认。
7. 按 [真机验收清单](docs/android-device-test-checklist.md) 验证后再生成正式 APK。

短信权限属于 Android 受限制权限。私有 APK 不受 Google Play 上架审核约束，但部分 Android 版本或厂商安装器仍可能阻止授予。如果系统弹窗没有短信权限选项，优先用 HBuilderX/ADB 安装调试包并在系统应用权限页确认，不要尝试隐藏应用或绕过持有人授权。

## 查看全部短信

首页点击“查看全部短信”，输入固定密码 `88888888` 后才会调用原生短信读取接口。前端先校验一次，Kotlin 原生入口在查询 `Telephony.Sms` 前再次校验；密码错误时不会读取系统短信。

该密码按需求直接写在代码中，只能防止普通误看。APK 可以被反编译，因此固定密码不能替代真正的用户认证或加密存储。查看页不会把短信另存到新的前端持久化存储，页面隐藏或退出时会清空内存列表并重新要求密码。

## Node 服务端

服务端已放在 [`server`](server) 目录，只需要 Node.js 18 或更高版本，不需要数据库和第三方依赖：

```powershell
Set-Location D:\myFile\SmsBackup\server
npm start
```

默认监听 `0.0.0.0:8787`，短信写入 `server\data\sms-records.txt`，可直接用记事本打开。完整部署和局域网配置见 [`server/README.md`](server/README.md)。

服务端提供两个接口：

### 健康检查

```http
GET /api/health
```

任意 `2xx` 表示连接成功。

### 写入短信

```http
POST /api/sms
Content-Type: application/json
Idempotency-Key: <recordId>
```

```json
{
  "recordId": "device-id:source-id:inbox",
  "deviceId": "stable-app-device-id",
  "deviceName": "家人手机",
  "sourceId": "12345",
  "sender": "10086",
  "body": "短信正文",
  "receivedAt": 1783900800000,
  "direction": "inbox",
  "simSubscriptionId": 1
}
```

后端应把 `recordId` 当作幂等键：重复提交返回成功，但不能重复写入记事本。

## 系统边界

- 普通清理后台、系统内存回收和重启由 Receiver、SQLite 与 WorkManager 恢复。
- 用户在系统设置点击“强行停止”后，Android 禁止应用自行启动；必须再次手动打开 App。
- 未配置服务器或服务器不可用时，短信只保留在本机应用私有 SQLite 队列。
- 命中黑名单的短信只记录过滤标识，不保存和上传正文。
- 卸载应用会同时删除尚未上传的本地队列。
