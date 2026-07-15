# SmsBackup Node 服务端

这是与 SmsBackup Android 客户端直接匹配的零依赖 Node.js 服务。收到的短信会追加到 `data/sms-records.txt`，每行一条 JSON，可直接用记事本打开。

## 运行要求

- Node.js 18 或更高版本。
- 不需要数据库，也不需要安装第三方 npm 包。

## 直接启动

```powershell
Set-Location D:\myFile\SmsBackup\server
$env:SMS_BACKUP_TOKEN = "88888888"
npm start
```

默认监听 `0.0.0.0:8787`，默认记录文件是：

```text
D:\myFile\SmsBackup\server\data\sms-records.txt
```

也可以完全不使用 npm：

```powershell
node server.js
```

## 修改端口或记录文件

PowerShell：

```powershell
$env:HOST = "0.0.0.0"
$env:PORT = "8787"
$env:SMS_DATA_FILE = "D:\SmsData\sms-records.txt"
$env:SMS_BACKUP_TOKEN = "88888888"
node server.js
```

Linux：

```bash
HOST=0.0.0.0 PORT=8787 SMS_DATA_FILE=/srv/sms-data/sms-records.txt SMS_BACKUP_TOKEN=88888888 node server.js
```

## 手机端填写

当前客户端默认填写用户提供的公网地址：

```text
http://119.91.65.202:8787
```

不要在地址末尾添加 `/api/sms`。访问令牌默认是 `88888888`，必须与服务器的 `SMS_BACKUP_TOKEN` 一致。服务器安全组和系统防火墙需要允许 TCP 8787 端口。

公网 HTTP 会明文传输短信正文和访问令牌。当前地址可以直接联调，但长期使用必须给该服务配置 HTTPS 反向代理，再关闭 App 的“允许 HTTP”。

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/health
```

正常结果为 `{ "ok": true }`。

## 接口

- `GET /api/health`：连接测试。
- `POST /api/sms`：接收短信，需要 Bearer Token。
- `GET /api/sms?limit=50&offset=0&deviceId=&direction=`：分页读取 TXT 中的短信，需要 Bearer Token。
- `GET /api/sms/export.md`：下载根据 TXT 实时生成的 Markdown，需要 Bearer Token。
- `recordId` 重复时仍返回成功，但不会在文本中重复写入。
- 请求正文最大 1 MiB。
- 服务重启时会重新读取文本中的 `recordId`，继续防重复。

PowerShell 读取最近短信：

```powershell
$headers = @{ Authorization = "Bearer 88888888" }
Invoke-RestMethod `
  -Uri "http://119.91.65.202:8787/api/sms?limit=50&offset=0" `
  -Headers $headers
```

导出 Markdown：

```powershell
Invoke-WebRequest `
  -Uri "http://119.91.65.202:8787/api/sms/export.md" `
  -Headers $headers `
  -OutFile ".\sms-backup.md"
```

## 数据与安全

短信正文是敏感数据。Bearer Token 可以阻止没有令牌的普通请求，但 HTTP 不加密，网络监听者仍可能看到正文和令牌。公网部署应增加 HTTPS、限制服务器安全组来源，并限制 `data` 目录的系统访问权限。

## 自测

```powershell
npm test
```

测试会启动真实 HTTP 服务，并验证鉴权、写入、防重复、重启恢复、分页筛选、Markdown 转义、参数校验和请求大小限制。
