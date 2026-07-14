# SmsBackup Android 端设计

## 目标

在 `D:\myFile\SmsBackup` 创建一个仅支持 Android 的 uni-app 应用。应用在手机持有人明确授权后读取已有短信、接收后续新短信、过滤广告短信，并把允许同步的短信可靠地提交到用户配置的服务器地址。Node 后端不在本阶段实现。

## 范围

- 仅构建 Android App，不支持 iOS、H5 或小程序。
- 最低 Android 8.0（API 26），面向 Android 8 至 Android 16。
- 首次授权后扫描已有收件和发件短信。
- 使用原生广播接收器接收后续新短信。
- 黑名单同时支持发件人规则与正文关键词规则。
- 内置淘宝、拼多多、退订、促销、优惠券等默认过滤规则，规则可新增、启停和删除。
- 服务器地址由用户在设置页维护，并支持连接测试。
- Node 后端和服务器记事本落盘留到下一阶段。

## 实现路线

采用 `uni-app Vue 3 + TypeScript + UTS/Kotlin Android 插件`。uni-app 负责授权说明、同步状态、黑名单和服务器设置；Android 原生层负责短信权限、历史扫描、短信广播、本地队列和后台上传。

不采用纯 JavaScript/Native.js，因为其运行依赖应用进程，无法可靠处理应用退出后的短信广播。不采用纯 Kotlin UI，因为用户明确要求 uni-app。

## 组件边界

### uni-app 页面

- 首页：显示权限、服务器配置、待上传数量、成功数量、过滤数量和最后同步时间。
- 授权页：明确说明读取和上传范围，由用户主动触发系统权限申请。
- 黑名单页：维护发件人和内容关键词规则。
- 设置页：维护服务器基地址、设备名称并测试连接。

### 应用服务层

- `smsBackupApi`：为页面提供初始化、权限、扫描、同步和状态查询的统一接口。
- `blacklistStore`：管理默认规则和用户规则，执行确定性的过滤判断。
- `settingsStore`：保存服务器地址、设备名称和同步开关。
- `uploadContract`：定义未来 Node 后端需要接收的短信 JSON 格式。

### Android 原生层

- `SmsReceiver`：通过 Manifest 静态注册，收到短信后快速解析并交给仓储。
- `SmsRepository`：读取系统短信、标准化短信字段、去重并写入可靠队列。
- `SmsQueueDatabase`：基于 `SQLiteOpenHelper` 的数据库，保存待上传、已上传和已过滤状态；不引入注解处理器，降低 HBuilderX 打包兼容风险。
- `SmsUploadWorker`：使用 WorkManager 在网络可用时上传，失败指数退避重试。
- `SmsReconcileWorker`：每天扫描系统短信并补齐遗漏记录。
- `SmsBackupUTS`：向 uni-app 暴露权限、扫描、同步、状态和规则配置能力。

## 数据流

1. 用户打开应用，阅读说明并主动授权 `READ_SMS` 和 `RECEIVE_SMS`。
2. 用户配置服务器地址，应用测试 `GET /api/health`。
3. 首次扫描读取系统短信并标准化为统一记录。
4. 黑名单命中时只累计过滤数量，不进入上传队列。
5. 未命中时先写入 SQLite，使用 `deviceId + sourceId + direction` 唯一约束去重。
6. WorkManager 调用 `POST /api/sms` 上传；只有服务器确认后才标记为已上传。
7. 新短信由 Manifest Receiver 唤醒进程并重复步骤 4 至 6。
8. 每日补漏任务重新扫描历史短信，保证普通进程回收、断网和重启不会造成永久漏传。

## 上传数据格式

```json
{
  "recordId": "device-id:source-id:inbox",
  "deviceId": "stable-app-device-id",
  "deviceName": "家人手机",
  "sourceId": "12345",
  "sender": "10690000",
  "body": "短信正文",
  "receivedAt": 1783900800000,
  "direction": "inbox",
  "simSubscriptionId": 1
}
```

`recordId` 是幂等键。后端重复收到相同记录时应返回成功但不重复写入。

## 可靠性与系统边界

- 不依赖 uni-app 页面、JS 定时器或常驻 WebView 接收短信。
- 广播接收器只解析并落库，不在 `onReceive` 中进行长时间网络请求。
- WorkManager 负责网络约束、重试、重启恢复和每日补漏。
- 不使用隐藏图标、保活对抗、Root 或绕过系统强行停止。
- 用户执行系统“强行停止”后，Android 不允许应用自行恢复；再次手动打开应用后恢复任务。
- 国产系统的后台白名单只作为设置页提示，不作为正确性的唯一保障。

## 安全和隐私

- 应用必须保持可见，并显示同步开关与最近同步状态。
- 只有设备持有人主动授权后才读取短信。
- 默认要求 HTTPS；为局域网调试可显式允许 HTTP，并在界面提示风险。
- 短信正文不写入普通调试日志。
- 用户可以暂停同步、撤销权限并清空应用本地队列。

## 测试策略

- TypeScript 单元测试覆盖服务器地址规范化、上传数据校验和黑名单匹配。
- Kotlin/UTS 可测试逻辑覆盖短信标准化、幂等键和过滤规则边界。
- Android 构建检查验证 Manifest 权限、Receiver、SQLite 和 WorkManager 声明。
- 真机验收覆盖首次历史扫描、新短信、断网重试、进程回收、重启补传、黑名单过滤和重复短信去重。

## 完成标准

- 项目可以作为 uni-app Android 工程打开和构建。
- 未授权时不读取短信。
- 授权后可扫描历史短信，并能接收新的普通短信。
- 命中黑名单的短信不进入上传队列。
- 服务器未配置或不可用时短信保留在本地，配置恢复后可重试。
- 应用进程被普通系统回收后，新短信广播和补漏任务仍能恢复工作。
