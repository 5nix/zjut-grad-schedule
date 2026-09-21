# ZJUT 研究生课表订阅

[在线使用：https://zjutgs.ironip.ink](https://zjutgs.ironip.ink)

将浙江工业大学研究生教务系统中的课表转换为 ICS 课程表订阅，方便在手机或电脑上查看。

登录后会生成一个课程表订阅链接，复制到手机或电脑的订阅中即可，也可以直接在浏览器中查看日历视图。

## 运行

需要 Node.js 20 或更高版本。

### 服务端

```sh
export CREDENTIAL_MASTER_KEY="$(openssl rand -base64 32)"
export APP_SESSION_SECRET="$(openssl rand -base64 32)"
export PUBLIC_BASE_URL="http://127.0.0.1:8787"
npm start
```

### 前端

```sh
cd web
npm ci
npm run build
```

部署时，将 `web/dist` 作为网站目录，并把服务端请求转发到 Node 服务。

## License

[MIT](LICENSE)
