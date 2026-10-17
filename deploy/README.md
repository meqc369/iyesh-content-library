# API 容器部署

```bash
cd deploy
cp .env.example .env
# 将 AUTH_SECRET、CORS_ORIGIN、WECHAT_APPID、WECHAT_SECRET、WECHAT_MCHID、WECHAT_API_KEY、PAYMENT_WEBHOOK_SECRET 换成真实值
# CORS_ORIGIN 填 H5 的单个 HTTPS 源，例如 https://m.example.com
docker compose up -d --build
```

服务会监听 `8787`，数据写入 Docker volume `content-data`，镜像内置 `/health` 健康检查。容器启动时会校验生产密钥；生产环境默认关闭 `dev-login`，未配置微信参数时小程序登录会返回 503。

正式上线前：

1. 在反向代理配置 HTTPS、H5 域名和 `/api/v1/admin/*` 限流；H5 后台入口为 `/admin-login.html`，管理员账号登录后通过 `x-admin-token` 会话访问后台接口。
2. 使用密钥管理服务注入随机 `AUTH_SECRET`（至少 32 位）；管理员通过 `/admin-login.html` 使用账号密码登录，不要配置或共享后台密钥；不要把 `.env` 提交到仓库。
3. 配置微信公众平台的 AppID、AppSecret 和服务器域名，保留 `session_key` 在服务端，不要返回给前端。
4. 将 `content-data` 纳入定期备份和恢复演练；正式业务应按 [数据库设计](../database/schema.sql) 迁移到 PostgreSQL/MySQL，并继续使用管理员角色权限与审计日志。
5. 真实微信支付需要在支付适配器中完成统一下单、JSAPI 参数签名、通知验签、退款和对账；本地 `mock-success` 只用于开发环境。
6. 发布后执行 `curl https://api.example.com/health`，再用真实小程序 code 验证 `/api/v1/auth/wechat-login` 和带 Bearer token 的 `/api/v1/me`。

本模板只负责 API 容器，不包含反向代理和证书。Docker 不可用时也可以直接运行 `node server/index.mjs`，但生产仍需满足同样的环境变量和 HTTPS 要求。
