# ZJUT 课表服务端适配器

这是一个不运行浏览器的最小 Node.js 服务端：

1. 调用学校 CAS 登录页；
2. 获取动态 RSA 公钥并完成密码加密；
3. 跟随 CAS Ticket 建立教务系统会话；
4. 请求 `xsjxrwcx.do` 课表接口；
5. 生成适合日历订阅的 ICS 课表。

## 本地运行

需要 Node.js 20 或更高版本，不需要安装第三方依赖。

```sh
export CREDENTIAL_MASTER_KEY="$(openssl rand -base64 32)"
export APP_SESSION_SECRET="$(openssl rand -base64 32)"
# 公网部署时必须改成实际的 HTTPS 地址
export PUBLIC_BASE_URL="https://calendar.example.com"
npm start
```

接口：

- `GET /health`
- `POST /api/login`，请求体 `{ "studentId": "...", "password": "..." }`
- `GET /calendar.ics?token=<token>`，订阅或下载全部非空学期的课表

密码和学校 Cookie 会使用 Node 内置 `crypto` 的 AES-256-GCM 加密写入 `data/credentials.json`。主密钥只从 `CREDENTIAL_MASTER_KEY` 读取，不写入数据库。服务运行期间只把活跃账号的客户端放在内存，重启后优先恢复保存的 Cookie，只有 Cookie 失效时才使用密码重新登录。

最近一次成功生成的 ICS 快照会写入 `data/calendars/`。学校服务临时不可用时，服务会在配置的保留时间内返回这份旧课表，而不是返回空课表。

默认运行参数：

- 上游单次请求超时 20 秒；
- 同一 IP 10 分钟最多 20 次失败登录；
- 同一学号 10 分钟最多 6 次失败登录；
- 同时最多 4 个上游登录；
- 课表热缓存 10 分钟；
- 上游异常时最多使用 3 天的旧快照。

可以通过同名环境变量调整这些参数。原始课程字段接口不对外开放，课程拉取和其他格式转换应在进程内部复用 `lib/calendar.mjs`。

如果 Node 服务位于可信的 HTTPS 反向代理之后，可设置 `TRUST_PROXY=true`，让登录限流按真实客户端 IP 工作；没有可信代理时不要开启。

生产部署时建议让 Nginx 提供 `web/dist` 静态文件，并把 `/api/`、`/calendar.ics` 和 `/health` 反向代理到只监听 `127.0.0.1` 的 Node 服务。前端构建：

```sh
cd web
npm ci
npm run build
```

密码、Cookie 加密主密钥、会话签名密钥和 `data/` 目录都只放在服务器，不提交到 Git。若前后端不是同源部署，再设置精确的 `CORS_ORIGIN`，不要使用 `*`。

ICS 日历名称固定为“浙工大研究生课表”，事件标题为“课程名称 · 任课教师”。课次按 `SCSKRQ` 作为首次日期直接展开，时间来自学校节次接口。
