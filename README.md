# SmsBackup

一个只面向 Android 的 uni-app 家庭备份应用。设备持有人主动授权后，应用会同步全部收到/已发短信，并按服务器动态时间范围上传已授权相册中的图片和视频。

## 已实现

- Android 8.0（API 26）及以上。
- 首次授权后自动扫描已有收件和发件短信，以后不需要再点击采集。
- Manifest 静态 `SmsReceiver`，应用普通进程被回收后仍可由新短信唤醒。
- SQLite 本地可靠队列；服务器成功确认前不删除待上传记录。
- `recordId` 与内容指纹双重去重，避免广播和全量扫描重复上传。
- WorkManager 网络恢复重试、指数退避、每次启动立即补漏及最短 15 分钟周期补漏。
- `BOOT_COMPLETED` 与 `MY_PACKAGE_REPLACED` 恢复任务，手机重启或应用升级后继续自动补扫。
- 不做广告、验证码或关键词过滤；淘宝、拼多多、退订、促销等短信同样进入备份队列。
- 首页可进入“查看全部短信”，输入固定密码 `88888888` 后查看系统短信库中的完整记录。
- 查看会话固定有效 10 分钟；覆盖收件、已发送、草稿、发件箱、失败、排队短信和彩信附件。
- 会话列表使用系统联系人备注、号码标签与缩略头像；拒绝联系人权限时显示完整号码和统一默认头像，联系人数据不会上传。
- 短信/彩信使用 40 条游标分页；相册使用 60 张分页、四页 LRU 缓存和视口虚拟网格，不会一次渲染一万张图片。
- 服务端动态决定相册回溯小时数；Android 按绝对时间窗、相册卷和媒体类型分页扫描图片/视频，不写死最近 7 天。
- 图片和视频先提交清单，只上传服务器缺少的文件；使用 1 MiB 分块断点续传和最多 2 路并发，避免大视频占满内存。
- WorkManager 在 App 页面未打开时轮询手动/自动服务器指令，并用前台数据同步通知执行长任务。
- Node 管理网页可调整回溯小时、自动周期、Wi-Fi 策略，手动要求某台手机立即获取，并查看短信、图片与视频。
- 默认服务器为 `http://119.91.65.202:8787`，可配置访问令牌、设备名称、同步开关和 HTTP 开关。
- 不隐藏应用、不绕过系统强行停止、不在普通日志输出短信正文。

## 目录

```text
src/pages/                         uni-app 页面
src/domain/                        可测试的分页、会话和上传契约
src/stores/                        应用设置本地状态
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
4. 在 HBuilderX 登录拥有 `__UNI__89C367C` 的 DCloud 账号；若以后更换 AppID，证书、包名和云打包配置也要同步核对。
5. 连接 Android 真机，选择“运行到 Android App 基座”。
6. 在首页点击“授权并一键同步全部”，由手机持有人在系统弹窗中确认短信、照片/视频和联系人权限。
7. 按 [真机验收清单](docs/android-device-test-checklist.md) 验证后再生成正式 APK。

短信权限属于 Android 受限制权限。私有 APK 不受 Google Play 上架审核约束，但部分 Android 版本或厂商安装器仍可能阻止授予。如果系统弹窗没有短信权限选项，优先用 HBuilderX/ADB 安装调试包并在系统应用权限页确认，不要尝试隐藏应用或绕过持有人授权。

## 查看全部短信

首页点击“查看全部短信”，输入固定密码 `88888888` 后才会调用原生短信读取接口。前端先校验一次，Kotlin 原生入口在查询 `Telephony.Sms`/`Telephony.Mms` 前再次校验；密码错误时不会读取系统短信。

该密码按需求直接写在代码中，只能防止普通误看。APK 可以被反编译，因此固定密码不能替代真正的用户认证或加密存储。查看页不会把短信或联系人另存到新的前端持久化存储；手动锁定或 10 分钟到期会清空密码、联系人和分页缓存。

解锁后应用单独请求联系人权限。联系人拒绝授权不会影响短信读取、备份和上传；页面改用完整号码与 `src/static/default-contact.png`。图片/视频权限独立于短信权限：本地查看页只分页加载图片；服务器同步则仅处理持有人已授权、且位于服务器下发时间窗内的图片和视频。

## Node 服务端

服务端已放在 [`server`](server) 目录，只需要 Node.js 18 或更高版本，不需要数据库和第三方依赖：

```powershell
Set-Location D:\myFile\SmsBackup\server
$env:SMS_BACKUP_TOKEN = "88888888"
$env:SMS_ADMIN_PASSWORD = "88888888"
npm start
```

默认监听 `0.0.0.0:8787`。打开 `http://119.91.65.202:8787/admin` 可登录控制台，动态修改最近多少小时、自动周期和 Wi-Fi 策略，并对在线设备点击“立即获取”。短信写入 `server\data\sms-records.txt`，媒体写入 `server\data\media`。服务端不使用数据库，完整复制 `server` 文件夹即可独立运行。详细步骤见 [`server/README.md`](server/README.md)。

服务端提供以下接口：

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
Authorization: Bearer 88888888
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

### 分页读取与 Markdown 导出

```http
GET /api/sms?limit=50&offset=0&deviceId=&direction=
Authorization: Bearer 88888888
```

```http
GET /api/sms/export.md
Authorization: Bearer 88888888
```

查询接口按最新记录优先返回，`direction` 支持 `inbox` 和 `sent`。默认令牌可以在 App 设置中修改，服务器使用 `SMS_BACKUP_TOKEN` 设置相同值。

当前公网地址使用 HTTP，短信正文和令牌会以明文经过网络。它可以直接联调，但长期公网使用应配置 HTTPS 反向代理。

## 系统边界

- 普通清理后台、系统内存回收和重启由 Receiver、Boot Receiver、SQLite 与 WorkManager 恢复。
- 新收到的短信通过系统广播立即入队；收件和已发送短信都会在授权、启动、重启恢复与周期任务中补扫。
- 服务器手动“立即获取”实际是排队命令，由手机 WorkManager 下一次联网轮询执行；服务器不能绕过 Android 权限直接连接手机存储。
- 相册同步包括已授权的图片和视频，时间范围由服务器配置；Android 14 只授权“部分照片和视频”时只能同步用户选择的项目。
- 媒体清单分页为 100 条、上传并发为 2 路，不会一次将一万张图片或整个视频读入内存。
- 非默认短信应用没有已发送短信广播；如果发送后在下一次补扫前立刻删除，应用无法保证捕获这条记录。
- 用户在系统设置点击“强行停止”后，Android 禁止应用自行启动；必须再次手动打开 App。
- 未配置服务器或服务器不可用时，短信只保留在本机应用私有 SQLite 队列。
- 媒体原文件不复制到本机队列；服务器不可用时保留服务端指令和已有 `.part`，恢复网络后重新扫描并续传。
- 广告、验证码、服务通知和普通短信使用同一入队规则，不按内容跳过。
- 卸载应用会同时删除尚未上传的本地队列。

## 本轮构建边界

已执行 `npm test -- --run`、`npm run type-check` 和编译器 4.87 的 `npm run build:app-plus`。`build:app-plus` 只是 App 资源编译；本轮按要求没有调用 HBuilderX 云打包，也没有生成 APK。
