# 本地 API 基线

这是开发阶段的 JSON 持久化 API，用于验证前端请求契约。正式环境需要把 JSON 存储替换为 PostgreSQL/MySQL、Redis 和搜索引擎。

```bash
node index.mjs
```

接口：

- `GET /health`
- `GET /api/v1/tags?dimension=platform|project|skill`
- `POST /api/v1/posts/search`
- `GET /api/v1/saved-filters`
- `POST /api/v1/saved-filters`
- `GET /api/v1/posts/:id`
- `GET|POST /api/v1/posts/:id/comments`
- `POST /api/v1/comments/:id/replies`
- `POST|DELETE /api/v1/posts/:id/like|favorite|anchor`
- `POST /api/v1/auth/dev-login`（仅本地联调）
- `POST /api/v1/auth/register/request-code`、`POST /api/v1/auth/register`（邮箱验证码注册）
- `POST /api/v1/auth/login`（用户名或邮箱密码登录，默认 30 天会话）
- `POST /api/v1/auth/password-reset/request-code`、`POST /api/v1/auth/password-reset`（邮箱验证码找回密码；验证码 10 分钟有效，单个验证码最多尝试 5 次，重置后旧会话失效）
- `POST /api/v1/auth/wechat-login`
- `GET /api/v1/me`
- `GET|PATCH /api/v1/me/profile`
- `GET /api/v1/me/notifications`（支持 `unread=true`、`pageSize`、`cursor`；可用 `PATCH /api/v1/me/notifications/:id/read` 或 `POST /api/v1/me/notifications/read-all` 标记已读）
- `GET /api/v1/me/posts`、`GET /api/v1/me/posts/:id`（本人投稿，支持 `status`、`sort`、`pageSize`、`cursor`）
- `POST /api/v1/posts`（登录用户投稿；默认进入 `pending`，传 `status=draft` 可保存草稿）
- `POST /api/v1/uploads`（登录用户上传图片；优先使用 `multipart/form-data`，字段名使用 `file`/`files`/`images`，也兼容单图 JSON data URL；单张原图最多 5MB、一次最多 9 张；服务端会限制最长边 2400px 并压缩到 2MB 以内，开发环境保存到 `server/uploads` 并返回压缩后的可访问 URL）
- `PATCH|DELETE /api/v1/posts/:id`（本人草稿/待审投稿编辑、提交审核或归档）
- `POST /api/v1/posts/:id/report`（登录用户举报公开内容）
- `GET /api/v1/posts/:id/comments`（支持 `sort=latest|oldest|hot`、`pageSize`、`cursor`）
- `POST /api/v1/comments/:id/report`、`DELETE /api/v1/comments/:id`（举报评论、删除本人评论）
- `GET /api/v1/member/groups|plans|me|permissions|entitlements`（计划返回 `pricePoints`）
- `POST /api/v1/member/plans/:id/activate`（按计划积分开通会员）
- `GET /api/v1/commerce/contact`（积分购买客服二维码和微信号）
- `POST /api/v1/cdkeys/redeem`、`GET /api/v1/me/cdkey-redemptions`（用户兑换 CDKEY）
- `POST /api/v1/orders` 或 `POST /api/v1/posts/:id/purchase`（内容购买使用积分；不创建现金订单）
- `GET /api/v1/orders|orders/:id`
- `POST /api/v1/orders/:id/pay|mock-success|cancel`
- `POST /api/v1/payments/webhook`（生产需配置回调签名）
- `GET /api/v1/tips|me/tips`、`POST /api/v1/tips`（按积分打赏）
- `GET /api/v1/me/points|me/points/ledger`（当前用户积分余额与流水）
- `GET /api/v1/admin/overview`
- `POST /api/v1/analytics/visit`（前台页面访问埋点；仅保存每日聚合数据）
- `GET /api/v1/admin/analytics/visits?days=30`（管理员访问趋势、设备、热门页面和来源统计）
- `POST /api/v1/admin/auth/login`、`GET /api/v1/admin/auth/me`（管理员账号登录；`x-admin-token` 会话默认 30 天）
- `GET|POST|PATCH /api/v1/admin/admins`、`PATCH /api/v1/admin/admins/:id`（多管理员与预设角色：超级管理员、内容管理员、财务管理员、客服管理员；停用而不删除）
- `GET|POST|PATCH|DELETE /api/v1/admin/member-groups|member-plans`（会员组权限和计划初始赠送积分可配置）
- `POST /api/v1/admin/memberships/grant`、`POST /api/v1/admin/users/:id/memberships`（补发或手动开通会员），`PATCH /api/v1/admin/memberships/:id` 或 `POST /api/v1/admin/memberships/:id/revoke`（撤销）
- `POST /api/v1/admin/cdkeys`、`GET /api/v1/admin/cdkeys`、`POST /api/v1/admin/cdkeys/:id/revoke`（按不同积分面额生成、查询和撤销 CDKEY）
- `GET|PATCH /api/v1/admin/commerce/contact`（配置积分购买客服二维码、微信号和说明）
- `GET|PATCH /api/v1/admin/settings/smtp`（后台配置注册验证码 SMTP，密码不会通过接口回显）
- `POST /api/v1/admin/points/recharge`（内部补发兼容）、`GET /api/v1/admin/points/ledger`、`GET /api/v1/admin/point-recharges`（积分流水和兑换记录不可删除）
- `GET|PATCH /api/v1/admin/orders`、`POST /api/v1/admin/orders/:id/refund`
- `GET|PATCH /api/v1/admin/tips`、`GET /api/v1/admin/memberships|audit-logs`（审计日志只读）
- `GET|POST /api/v1/admin/posts`
- `PATCH|DELETE /api/v1/admin/posts/:id`
- `GET /api/v1/admin/reports?status=&postId=`、`PATCH /api/v1/admin/reports/:id`、`POST /api/v1/admin/reports/:id/resolve`
- `GET /api/v1/admin/comment-reports`、`PATCH|POST /api/v1/admin/comment-reports/:id/resolve`
- `GET /api/v1/admin/comments`、`PATCH|DELETE /api/v1/admin/comments/:id`
- `GET|POST /api/v1/admin/tags/:dimension`

保存的评论、互动、常用筛选、用户资料、通知、投稿、举报、会员、订单、权益、打赏、积分账户、CDKEY、兑换记录和审计记录会写入 `server/data/store.json`；该文件已加入忽略列表，生产环境应替换为数据库和用户鉴权。积分流水、CDKEY 兑换记录和审计日志只允许追加与查询，不提供删除接口。投稿在管理员将状态改为 `published` 前不会出现在公开检索或详情接口中。生产模式下未认证的写操作会返回 401，`dev-login` 默认关闭，`mock-success` 也会拒绝。

检索请求支持 `keyword`、`platformId`、`projectId`、`skillId`、`tab`、`dateStart`、`dateEnd`、`sort`、`pageSize` 和 `cursor`。

生产启动前设置 `WECHAT_APPID`、`WECHAT_SECRET`、`WECHAT_MCHID`、`WECHAT_API_KEY`、`PAYMENT_PROVIDER=wechat`、`PAYMENT_WEBHOOK_SECRET`、强随机 `AUTH_SECRET` 和 H5 的 `CORS_ORIGIN`；服务会拒绝占位密钥。后台统一使用管理员账号密码登录，不再依赖共享 `ADMIN_KEY`。本地未配置微信参数时，使用 `dev-login` 和默认 Mock 支付仅用于联调。真实微信支付的统一下单、JSAPI 拉起、回调验签和退款仍需在支付适配器中接入商户 SDK/证书。

授权内容可以通过导入脚本迁移：

```bash
npm run import -- --file ./import.example.json --dry-run
npm run import -- --file ./your-authorized-content.json
```

输入支持帖子数组，或 `{ "posts": [...] }`；每条内容需要 `title`、`platform`、`project`、`skill`，可选 `excerpt`、`content`、`digest` 和互动数。脚本会按内容 ID 去重并同步三个标签维度。

