# SmsBackup Node 服务端

这是与 SmsBackup Android 客户端直接匹配的零依赖 Node.js 服务。收到的短信会追加到 `data/sms-records.txt`，每行一条 JSON，可直接用记事本打开。

## 运行要求

- Node.js 18 或更高版本。
- 不需要数据库，也不需要安装第三方 npm 包。

## 直接启动

```powershell
Set-Location D:\myFile\SmsBackup\server
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
node server.js
```

Linux：

```bash
HOST=0.0.0.0 PORT=8787 SMS_DATA_FILE=/srv/sms-data/sms-records.txt node server.js
```

## 手机端填写

手机和服务器在同一个局域网时，在 App 的“服务器设置”中填写：

```text
http://服务器局域网IP:8787
```

例如 `http://192.168.1.8:8787`。不要在地址末尾添加 `/api/sms`。使用局域网 HTTP 时，还要在 App 中开启“允许不安全 HTTP”。Windows 服务器需要允许 TCP 8787 端口通过防火墙。

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/health
```

正常结果为 `{ "ok": true }`。

## 接口

- `GET /api/health`：连接测试。
- `POST /api/sms`：接收短信。
- `recordId` 重复时仍返回成功，但不会在文本中重复写入。
- 请求正文最大 1 MiB。
- 服务重启时会重新读取文本中的 `recordId`，继续防重复。

## 数据与安全

短信正文是敏感数据。当前客户端协议没有登录令牌，因此不要把 8787 端口直接开放到公网。建议只在可信局域网或 VPN 中使用；如需公网部署，应在前面增加 HTTPS 和访问控制，并限制 `data` 目录的系统访问权限。

## 自测

```powershell
npm test
```

测试会启动真实 HTTP 服务，并验证写入、防重复、重启恢复、参数校验和请求大小限制。
