# SmsBackup Node 服务端

这是与 SmsBackup Android 客户端直接匹配的零依赖 Node.js 服务端。整个 `server` 文件夹可单独复制部署，不需要数据库，也不依赖项目根目录或 `node_modules`。

它支持：

- 接收全部已授权的收到短信和已发短信，按 `recordId` 去重写入 TXT。
- 由服务器动态设置最近多少小时的相册范围，同时收集图片和视频。
- 在网页控制台手动点击“立即获取”，或按服务器策略自动创建同步指令。
- 手机分 100 条提交媒体清单，原文件按 1 MiB 分块断点续传，服务端不会把整个视频读进内存。
- 在受密码保护的网页中查看设备、短信、图片和视频。

## 一、只复制 server 即可部署

把当前 `server` 文件夹完整复制到服务器，例如：

```text
C:\Users\Administrator\Desktop\server
```

必须保留这些内容：

```text
server.js
package.json
lib\
public\
data\
```

`test\` 和两个 `MEDIA_SYNC_*.md` 文件只用于测试和开发说明，保留不会影响运行。服务端没有第三方依赖，所以不执行 `npm install` 也能启动。

## 二、Windows PowerShell 启动

需要 Node.js 18 或更高版本。建议分别设置手机访问令牌和网页管理密码：

```powershell
Set-Location C:\Users\Administrator\Desktop\server
$env:HOST = "0.0.0.0"
$env:PORT = "8787"
$env:SMS_BACKUP_TOKEN = "88888888"
$env:SMS_ADMIN_PASSWORD = "88888888"
node server.js
```

也可以执行 `npm start`，效果相同。看到以下提示表示监听成功：

```text
SmsBackup server listening on http://0.0.0.0:8787
Admin console: http://0.0.0.0:8787/admin
```

当前 PowerShell 窗口关闭后 Node 进程也会停止。每次替换服务端代码或修改环境变量后，先按 `Ctrl+C` 停止旧进程，再重新执行 `node server.js`；只复制文件但不重启，运行中的 Node 不会加载新代码。

## 三、打开端口并检查

腾讯云安全组需要放行入站 TCP `8787`。如果服务器启用了 Windows Defender 防火墙，再用管理员 PowerShell 执行：

```powershell
New-NetFirewallRule `
  -DisplayName "SmsBackup 8787" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 8787 `
  -Action Allow
```

先在服务器本机检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/health
```

再从其他电脑检查公网地址：

```powershell
Invoke-RestMethod http://119.91.65.202:8787/api/health
```

正常结果为 `{ "ok": true }`。本机成功而公网失败，通常是云安全组、公网 IP/端口映射或 Windows 防火墙问题，不是 Node 路由问题。

## 四、网页控制台与动态小时配置

浏览器打开：

```text
http://119.91.65.202:8787/admin
```

使用 `SMS_ADMIN_PASSWORD` 登录。控制台可以动态修改：

- `回溯小时数`：`1` 到 `87600`，默认 `168`（最近 7 天）。
- `自动周期`：`15` 到 `10080` 分钟，默认 `15`。
- `自动创建同步指令`：开启后，服务器按周期产生指令。
- `相册仅 Wi-Fi 上传`：开启后，手机在计费网络上等待重试。

保存后，新创建的指令立即使用新配置。已经存在的待处理指令保留创建时的绝对开始/结束时间，完成后下一条指令才使用新配置。

手机首次连上服务器后会出现在“设备与同步状态”。点击设备右侧“立即获取”会排队一条手动指令。手机下一次后台轮询到该指令后会：

1. 补扫系统短信库中的全部收到短信和已发短信。
2. 上传短信队列中服务端还没有确认的记录。
3. 分页扫描服务器指定时间窗内、用户已授权访问的全部相册图片和视频。
4. 只上传服务端缺少的媒体，断网后从已有字节位置继续。

“服务器获取”不是服务器绕过 Android 主动连接手机；实际由手机 WorkManager 轮询并执行服务器命令。因此无需保持 App 页面打开，但必须已打开过 App、由持有人授予权限、网络可用，并且没有在系统设置中“强行停止”应用。Android 周期任务是省电调度，15 分钟是最短请求周期，不保证精确到分钟。

## 五、手机端设置

App 中填写：

```text
服务器：http://119.91.65.202:8787
访问令牌：88888888
允许 HTTP：开启
同步开关：开启
```

服务器地址末尾不要添加 `/api/sms`。App 访问令牌必须与服务器 `SMS_BACKUP_TOKEN` 完全一致。首次在 App 点击“授权并一键同步全部”，由手机持有人分别确认短信、照片/视频和联系人权限。

## 六、数据目录

默认数据全部保存在本文件夹的 `data` 下：

```text
data\sms-records.txt       每行一条短信 JSON
data\settings.txt          服务器动态设置事件
data\devices.txt           设备上线和完成状态事件
data\sync-requests.txt     手动/自动同步指令事件
data\media-records.txt     已完成媒体索引
data\media\               图片、视频和未完成的 .part 分块
```

TXT 文件均为 UTF-8 JSON Lines，可用记事本查看。不要在 Node 正在写入时手工删改最后一行。备份时应复制整个 `data`，不仅是 `sms-records.txt`。

如需把所有持久数据移到其他磁盘，可指定短信文件；其他 TXT 与媒体会使用它所在的同一目录：

```powershell
$env:SMS_DATA_FILE = "D:\SmsBackupData\sms-records.txt"
```

单个图片或视频默认最大允许 `10737418240` 字节（10 GiB），可在启动前调整：

```powershell
$env:SMS_MEDIA_MAX_BYTES = "2147483648"
```

这是单个文件上限，不是整个相册的总容量限制；实际可保存总量取决于服务器磁盘空间。

## 七、主要接口

- `GET /api/health`：健康检查，无需登录。
- `POST /api/sms`：手机写入短信，需要 Bearer Token。
- `GET /api/sms?limit=50&offset=0&deviceId=&direction=`：分页读取短信。
- `GET /api/sms/export.md`：根据 TXT 实时导出 Markdown。
- `GET /api/device/:deviceId/commands/next`：手机心跳并领取服务器指令。
- `POST /api/media/manifest`：提交最多 100 个图片/视频清单项。
- `PUT /api/media/:mediaId/content`：`Content-Range` 断点上传。
- `GET /api/media`、`GET /api/media/:mediaId/content`：登录后查看媒体，支持视频 Range 播放。

同一短信 `recordId` 重复提交会返回成功，但不会重复写入 TXT；同一媒体 ID、设备和大小已经完成时不会重复保存。

## 八、安全说明

`SMS_BACKUP_TOKEN` 保护手机接口，`SMS_ADMIN_PASSWORD` 保护管理网页。管理登录使用 HttpOnly、SameSite Cookie，但当前公网地址仍是 HTTP，短信正文、图片、视频、令牌和密码都可能在网络中被窃听。

仅在可信网络临时联调时使用明文 HTTP。长期公网运行应在 Node 前配置 HTTPS 反向代理、关闭 App 的“允许 HTTP”、限制安全组来源，并限制 `data` 文件夹的 Windows 访问权限。固定密码 `88888888` 只适合当前私有部署，正式长期使用应替换为不同的高强度令牌和管理密码。

## 九、自测

```powershell
Set-Location C:\Users\Administrator\Desktop\server
npm test
```

测试不访问真实手机，也不会写入正式 `data`；它使用临时目录验证鉴权、短信去重、动态小时设置、设备命令、图片/视频清单、断点续传、损坏分块恢复、Range 播放和网页控制台。
