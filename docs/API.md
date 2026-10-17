# API 契约 v1

## 约定

- 基础路径：`/api/v1`
- 认证：`Authorization: Bearer <access_token>`；小程序登录后由服务端换取微信会话并签发同一套 token。
- 时间：ISO 8601，服务端统一保存 UTC，客户端按 Asia/Shanghai 展示。
- 列表：首屏使用 `pageSize`，移动端优先使用 `cursor`。

## 内容检索

`POST /posts/search`

```json
{
  "keyword": "Codex",
  "platformId": "youtube",
  "projectId": "overseas",
  "skillId": "ai",
  "tab": "digest",
  "dateStart": "2026-01-01T00:00:00+08:00",
  "dateEnd": "2026-10-14T23:59:59+08:00",
  "sort": "latest",
  "displayMode": "compact",
  "pageSize": 20,
  "cursor": null
}
```

```json
{
  "items": [
    {
      "id": "post_123",
      "title": "示例内容标题",
      "excerpt": "内容摘要",
      "author": { "id": "user_1", "name": "作者", "avatarUrl": null },
      "publishedAt": "2026-10-13T08:00:00Z",
      "digest": true,
      "counts": { "anchors": 4, "likes": 18, "comments": 3, "favorites": 6 },
      "tags": [{ "id": "tag_ai", "dimension": "skill", "name": "AI" }]
    }
  ],
  "total": 121,
  "nextCursor": "eyJpZCI6InBvc3RfMTIzIn0",
  "hasMore": true,
  "tabTotals": { "hot": 121, "digest": 42, "all": 121 },
  "facets": {
    "platforms": [{ "id": "youtube", "name": "YouTube", "count": 1582 }],
    "projects": [{ "id": "overseas", "name": "出海", "count": 121 }],
    "skills": [{ "id": "ai", "name": "AI", "count": 121 }]
  }
}
```

`keyword` 会匹配标题、摘要、作者和标签；`sort` 支持 `latest`、`oldest`、`favorites`、`comments`、`likes`、`anchors`、`anchor-latest`；移动端优先使用返回的 `nextCursor` 继续加载，日期条件使用 `dateStart` / `dateEnd`。

## 内容详情

- `GET /posts/:id`
- `GET /posts/:id/comments?cursor=...`
- `POST /posts/:id/like`
- `DELETE /posts/:id/like`
- `POST /posts/:id/favorite`
- `DELETE /posts/:id/favorite`
- `POST /posts/:id/anchor`
- `POST /posts/:id/comments`
- `POST /comments/:id/replies`
- `POST /comments/:id/report`
- `DELETE /comments/:id`（仅本人，软删除并级联隐藏回复）

详情响应中的 `content` 是服务端按段落生成的安全 HTML；导入脚本接收纯文本 `content`，空行会分段，避免把未过滤的 HTML 直接交给前端。

本地 API 基线对应路径带 `/api/v1` 前缀，并已实现：

- `GET /api/v1/posts/:id`
- `GET /api/v1/posts/:id/share`（公开分享元数据：标题、摘要、作者、平台、权益标签、封面和规范链接；不返回正文）；追加 `?format=html` 或使用 `Accept: text/html` 返回适合微信/社交平台抓取的 OG/Twitter 分享预览页。用户分享链接使用 `GET /share/:id`，预览页会在浏览器打开后进入对应详情页
- `GET /api/v1/posts/:id/comments`
- `POST /api/v1/posts/:id/comments`
- `POST /api/v1/comments/:id/replies`（回复评论，返回带 `parentId` 的评论）
- `POST /api/v1/comments/:id/report`、`DELETE /api/v1/comments/:id`
- `GET /api/v1/posts/:id/comments?sort=latest|oldest|hot&pageSize=&cursor=`（返回 `items`、`total`、`nextCursor`、`hasMore`）
- `POST|DELETE /api/v1/posts/:id/like`
- `POST|DELETE /api/v1/posts/:id/favorite`
- `POST|DELETE /api/v1/posts/:id/anchor`

## 标签

- `GET /tags?dimension=platform`
- `GET /tags?dimension=project`
- `GET /tags?dimension=skill`
- `POST /api/v1/admin/tags/:dimension`（管理员）
- 标签编辑和删除暂未开放；当前由内容导入或管理员新增接口维护标签。

## 常用筛选

- `GET /saved-filters`
- `POST /saved-filters`
- `PATCH /saved-filters/:id`
- `DELETE /saved-filters/:id`

## 管理端

管理员生产登录使用 `POST /api/v1/admin/auth/login` 返回的 `x-admin-token`，并由预设角色进行权限校验；`x-admin-key` 仅保留给内部兼容调用（后台 API 前置 Basic Auth 时不使用 `Authorization: Bearer`，避免与 Nginx 认证头冲突）。

- `GET /api/v1/admin/overview`
- `GET /api/v1/admin/posts`
- `POST /api/v1/admin/posts`
- `PATCH|DELETE /api/v1/admin/posts/:id`
- `GET /api/v1/admin/reports?status=pending`、`PATCH|POST /api/v1/admin/reports/:id[/resolve]`
- `GET /api/v1/admin/comment-reports?status=pending`、`PATCH|POST /api/v1/admin/comment-reports/:id[/resolve]`
- `GET /api/v1/admin/comments?status=published|deleted`、`PATCH|DELETE /api/v1/admin/comments/:id`
- `GET /api/v1/admin/tags/:dimension`
- `POST /api/v1/admin/tags/:dimension`

## 登录

- `POST /api/v1/auth/wechat-login`：入参为小程序 `code`。
- `POST /api/v1/auth/dev-login`：仅本地联调用的演示登录，不得用于生产。
- `GET /api/v1/me`：读取当前 Bearer token 对应的用户。
- `GET|PATCH /api/v1/me/profile`：读取或更新昵称、头像、简介、城市和网站。
- `GET /api/v1/me/notifications?unread=true&pageSize=&cursor=`、`PATCH /api/v1/me/notifications/:id/read`、`POST /api/v1/me/notifications/read-all`：通知中心和已读状态。
- `GET /api/v1/me/posts?status=&sort=&pageSize=&cursor=`、`GET /api/v1/me/posts/:id`：本人投稿状态和草稿。
- `POST /api/v1/posts`：登录用户投稿，默认进入 `pending`；传 `status=draft` 可保存草稿。管理员审核通过后才进入公开检索。
- `POST /api/v1/uploads`：登录用户以 `multipart/form-data` 上传图片（字段名 `file`、`files` 或 `images`，也兼容单图 JSON data URL）；支持 JPG/PNG/GIF/WEBP，单张最多 5MB、单次最多 9 张，服务端校验文件头后保存并返回 `items[].url`。本地开发保存于 `server/uploads`；生产环境应替换为对象存储适配器。投稿接口可将返回的 URL 放入 `coverImage` 和 `images`，服务端只保留 `/uploads/...` 路径。
- `PATCH|DELETE /api/v1/posts/:id`：本人草稿/待审投稿编辑、提交审核或归档。
- `POST /api/v1/posts/:id/report`：登录用户举报公开内容；后台通过 `/api/v1/admin/reports` 列表和 `PATCH|POST /api/v1/admin/reports/:id[/resolve]` 处理。

生产环境配置 `WECHAT_APPID`、`WECHAT_SECRET` 和 `AUTH_SECRET` 后，`/api/v1/auth/wechat-login` 会向微信 `jscode2session` 换取会话并签发服务端令牌；微信的 `session_key` 不返回给前端。
生产模式下 `dev-login` 默认返回 404，评论、回复、点赞、收藏、投锚和常用筛选要求有效 Bearer token；H5 跨域源通过 `CORS_ORIGIN` 配置，开发模式才允许 `*`。

## 商业化接口契约

### 当前本地 JSON 基线

服务端已经实现可联调的最小闭环，路径和字段以以下接口为准：

- `GET /api/v1/member/groups`、`GET /api/v1/member/plans`、`GET /api/v1/member/me`、`GET /api/v1/member/permissions`、`GET /api/v1/member/entitlements`；会员计划返回 `purchaseMode=points` 和 `pricePoints`，会员开通不走现金支付。
- `POST /api/v1/orders` 或 `POST /api/v1/posts/:id/purchase`（`kind=post` 使用积分并立即完成；`kind=membership` 和现金打赏会拒绝）、`GET /api/v1/orders`、`GET /api/v1/orders/:id`
- `POST /api/v1/orders/:id/pay`、`POST /api/v1/orders/:id/mock-success`、`POST /api/v1/orders/:id/cancel`
- `POST /api/v1/payments/webhook`，以及微信/支付宝兼容通知路径
- `GET /api/v1/tips?postId=`、`GET /api/v1/me/tips`、`POST /api/v1/tips`（`points` 积分打赏；`POST /api/v1/tips/orders` 兼容同一积分语义）
- `GET|POST|PATCH|DELETE /api/v1/admin/member-groups`、`/admin/member-plans`（同时兼容 `/admin/plans`）；会员组支持自定义 `permissions` 和 `initialPoints`。
- `POST /api/v1/member/plans/:id/activate`：当前用户按会员计划 `pricePoints` 扣减积分并开通等级；服务端按套餐发放首开 `initialPoints`，重复开通和余额不足会拒绝。
- `POST /api/v1/admin/memberships/grant` 或 `POST /api/v1/admin/users/:id/memberships`：管理员补发、延长或手动开通会员，传 `groupId`、可选 `planId`、`days`、`note`；此接口不替代用户的积分开通流程。
- `GET /api/v1/commerce/contact`：公开返回积分购买客服二维码、微信号、客服名称和说明；后台通过 `GET|PATCH /api/v1/admin/commerce/contact` 配置。
- `POST /api/v1/cdkeys/redeem`、`GET /api/v1/me/cdkey-redemptions`：用户兑换 CDKEY 和查询自己的兑换记录。
- `POST /api/v1/admin/cdkeys`、`GET /api/v1/admin/cdkeys`、`POST /api/v1/admin/cdkeys/:id/revoke`：后台按 `points` 和 `quantity` 生成、查询或撤销 CDKEY；明文只在生成响应中返回一次。
- `GET /api/v1/points/config`、`GET /api/v1/me/points`、`GET /api/v1/me/points/ledger`：用户读取积分名称、余额和不可删除流水。
- `GET|PATCH /api/v1/admin/points/config`：管理员查询或自定义积分名称。
- `POST /api/v1/admin/points/recharge`（`userId`、`points`、`note`）作为内部补发兼容接口；正常线下销售通过 CDKEY 完成。`GET /api/v1/admin/points/ledger`、`GET /api/v1/admin/point-recharges` 查询账户和历史流水，均不提供删除接口。
- `GET|PATCH /admin/orders`、`POST /admin/orders/:id/refund`、`GET|PATCH /admin/tips`、`GET /admin/memberships`、`GET /admin/cdkeys`、`GET /admin/audit-logs`
- `PATCH|POST /api/v1/admin/posts/:id/monetization`（同时兼容 `/access`）
- `GET /api/v1/admin/reports?status=&postId=`、`PATCH|POST /api/v1/admin/reports/:id[/resolve]`
- `GET /api/v1/admin/comment-reports?status=&postId=&pageSize=&cursor=`、`PATCH|POST /api/v1/admin/comment-reports/:id[/resolve]`
- `GET /api/v1/admin/comments?postId=&status=&pageSize=&cursor=`、`PATCH|DELETE /api/v1/admin/comments/:id`
- `PATCH /api/v1/admin/posts/:id`：审核投稿（`status=pending|published|rejected|archived`），通过后自动通知作者。

本地 JSON 存储用于联调和演示，生产部署应替换为事务数据库。`mock-success` 只在非生产环境开放；当前现金收款由客服微信在线下完成，服务端不创建会员或积分现金订单，只处理 CDKEY 兑换和积分账本。

以下接口是会员、CDKEY、积分内容购买、积分打赏和运营后台的完整最小闭环。用户在客服微信线下购买积分后兑换 CDKEY，积分流水与系统审计日志均为追加记录，不提供删除操作。内容购买订单以 `amountPoints` 记录，会员计划以 `pricePoints` 记录，并通过 `Idempotency-Key` 请求头或 `idempotencyKey` 字段幂等创建。

## 关系型生产扩展（当前 JSON 基线未启用）

以下章节保留关系型数据库和支付扩展设计，供迁移生产数据库时参考；当前本地服务端以“客服二维码引导线下购买、CDKEY 兑换积分、积分开通会员、积分购买内容和积分打赏”的接口清单为准，会员现金订单和现金打赏不会创建。

### CDKEY、客服二维码和积分兑换

- `GET /api/v1/commerce/contact`：返回 `wechatQrUrl`、`wechatId`、`displayName`、`instructions` 和 `isEnabled`。积分购买页应提供保存二维码按钮，并提示用户添加客服后购买 CDKEY。
- `POST /api/v1/admin/cdkeys`：管理员传 `{ "points": 1000, "quantity": 10, "expiresAt": "...", "note": "..." }` 批量生成兑换码。响应中的 `codes` 只展示一次；列表只返回 `codePrefix`、尾号、批次、面额、状态和兑换时间。
- `POST /api/v1/cdkeys/redeem`：登录用户传 `{ "code": "SCYS-..." }`。服务端哈希比对、校验有效期和 `unused` 状态，事务内写入 `cdkey_redemptions` 和 `point_ledger`，再将 CDKEY 标记为 `redeemed`。重复请求返回同一兑换结果，不会重复加分。
- `POST /api/v1/member/plans/:id/activate`：登录用户不传价格，服务端读取计划 `pricePoints`，原子扣减积分、写入积分流水和会员记录；首次开通可追加 `initialPoints` 赠送流水。
- `POST /api/v1/admin/cdkeys/:id/revoke`：仅管理员可停用未兑换 CDKEY；已兑换记录不可删除、回滚或复用。

CDKEY 表只保存哈希和展示所需的前缀/尾号，不保存可再次使用的明文。生成、撤销、兑换、会员开通和积分流水都必须写审计日志；兑换码面额和会员计划价格以后端记录为准，客户端传入值一律忽略。

### 权限和会员

- `GET /api/v1/membership/groups`：公开返回可展示的会员分组。
- `GET /api/v1/membership/plans`：返回会员计划、会员组权限、`pricePoints` 和初始赠送积分；前端展示积分开通按钮及客服二维码入口。
- `GET /api/v1/me/membership`：返回当前用户分组、计划、权限、状态、开始/结束时间和积分余额；未登录返回 `null`。
- `GET /api/v1/me/entitlements?resourceType=post&cursor=...`：返回当前用户有效和最近失效的内容权益。

内容详情和搜索卡片中的受保护字段必须包含 `access`：

```json
{
  "access": {
    "type": "paid",
    "canView": false,
    "canDownload": false,
    "requiredGroup": null,
      "previewHtml": "<p>免费预览……</p>",
      "offers": [{
      "productId": "prod_post_123",
      "name": "单篇解锁",
      "pricePoints": 990,
      "pointsUnitName": "积分"
    }]
  }
}
```

`canView=false` 时不得返回完整 `content`、原图 URL、附件下载 URL 或隐藏字段。会员内容只返回满足当前分组后的 `canView`，购买、退款和手工撤销均以 `user_entitlements` 为准。

### 结算、订单和支付

以下现金结算接口属于未来可选扩展，当前版本不用于会员、积分充值或打赏；当前内容购买使用积分订单，会员使用 `pricePoints` 扣减，积分通过 CDKEY 兑换。

- `POST /api/v1/checkout/preview`：预览结算，入参为 `items:[{productId,quantity}]`、`couponCode`；返回商品快照、折扣、应付金额和优惠券错误，不创建订单。
- `POST /api/v1/checkout/orders`：创建待支付订单。入参同上，另加 `purpose`（`content`、`membership`、`tip`）和 `metadata`；服务端再次计算金额并锁定订单项。
- `GET /api/v1/orders?status=&cursor=`：当前用户订单列表。
- `GET /api/v1/orders/:id`：订单详情、订单项、支付状态、退款状态；只能访问本人订单或有财务权限的后台账号。
- `POST /api/v1/orders/:id/payments`：选择 `provider=wechat` 或 `alipay`，返回支付所需参数，不返回私钥。
- `POST /api/v1/orders/:id/cancel`：取消待支付订单；超时订单由后台任务同样转为 `expired`。
- `POST /api/v1/orders/:id/refund`：按业务规则申请退款，入参 `amountMinor`、`reason`；后台审核或自动退款后更新状态。
- `POST /api/v1/payments/wechat/notify`：微信支付回调，不使用 Bearer；验签、校验商户号/金额/订单号后按微信流水号幂等处理。
- `POST /api/v1/payments/alipay/notify`：支付宝回调（启用支付宝时），按支付宝交易号幂等处理。

支付成功处理必须在一个事务中完成：订单转 `paid`、写入支付流水、授予会员/内容权益或创建打赏记录、记录优惠券核销。支付通知重复到达只能返回成功确认，不能再次延长会员或增加权益。

订单响应示例：

```json
{
  "id": "ord_202610140001",
  "status": "pending",
  "currency": "CNY",
  "totalAmountMinor": 1990,
  "discountAmountMinor": 500,
  "payableAmountMinor": 1490,
  "items": [{"productId":"plan_pro_month","name":"专业会员月卡","quantity":1,"unitPriceMinor":1990}],
  "expiresAt": "2026-10-14T09:15:00Z"
}
```

### 优惠券

- `GET /api/v1/coupons/available`：列出当前用户可用券（只返回展示所需字段）。
- `POST /api/v1/checkout/preview` 会校验券的有效期、最低金额、适用商品、总次数和每用户次数。
- `GET /api/v1/me/coupons?status=available|used|expired`：查看领取和使用记录。

优惠券字段约定：`discountType=fixed` 时 `discountValue` 为分；`discountType=percent` 时为万分比（10000 表示 100%）；`maxDiscountMinor` 限制百分比券的最高优惠。锁券和核销必须有唯一约束，订单取消/过期按配置释放库存。

### 打赏（生产扩展草案）

- `GET /api/v1/users/:id/tip-settings`：返回作者是否开启打赏、金额档位和匿名选项。
- 当前实现使用上文的 `POST /api/v1/tips`，入参为 `postId`、`points`、`message`；以下金额订单字段仅供迁移到关系型支付结算时参考。
- `GET /api/v1/me/tips?cursor=`：当前用户发出的打赏记录。
- `GET /api/v1/users/:id/tips?cursor=`：作者可见的已支付打赏（匿名打赏隐藏发送者）。

打赏支付成功后才展示留言并进入作者待结算账本。退款会将打赏转为 `refunded`，不直接删除留言或支付流水；平台费和作者净额必须保留在记录中。

### 管理后台与权限

生产后台使用管理员账号登录和 `x-admin-token` 会话。当前预设角色：`superadmin`（全部权限）、`content_admin`（内容审核与标签）、`finance_admin`（积分、CDKEY、订单和会员财务操作）、`support_admin`（客服查询与基础处理）。管理员只能停用，账号和日志不物理删除。

**用户与会员**

- `GET /api/v1/admin/users?keyword=&status=&groupId=&cursor=`
- `GET /api/v1/admin/users/:id`
- `PATCH /api/v1/admin/users/:id`：状态、昵称、禁言/封禁期限。
- `GET|POST|PATCH /api/v1/admin/member-groups[/:id]`
- `GET|POST|PATCH /api/v1/admin/membership-plans[/:id]`
- `POST /api/v1/admin/users/:id/memberships`：赠送、延长、升级或撤销会员，必须填写原因。
- `GET /api/v1/admin/users/:id/entitlements`
- `POST /api/v1/admin/users/:id/entitlements`：手工授予/撤销内容权益。

**内容与商品**

- `GET|POST|PATCH /api/v1/admin/posts[/:id]/access`：公开/会员/付费策略、预览长度、商品绑定。
- `GET|POST|PATCH|DELETE /api/v1/admin/products[/:id]`：单篇、专题包和会员商品。
- `GET|POST|PATCH|DELETE /api/v1/admin/collections[/:id]`：专题集合及内容排序。
- 现有内容、标签和评论接口继续使用；权限字段的每次变化写入审计日志。

**订单、支付、打赏和优惠券**

- `GET /api/v1/admin/orders?status=&provider=&cursor=`
- `GET /api/v1/admin/orders/:id`
- `POST /api/v1/admin/orders/:id/refund`
- `GET /api/v1/admin/payments?status=&cursor=`
- `GET /api/v1/admin/tips?status=&recipientUserId=&cursor=`
- `POST /api/v1/admin/tips/:id/review`：审核留言/匿名展示。
- `GET /api/v1/admin/settlements?status=&cursor=`、`POST /api/v1/admin/settlements`：生成和确认作者结算批次。
- `GET|POST|PATCH|DELETE /api/v1/admin/coupons[/:id]`
- `GET /api/v1/admin/coupons/:id/redemptions`

**审核和数据**

- `GET /api/v1/admin/reports?status=&cursor=`、`POST /api/v1/admin/reports/:id/resolve`
- `GET /api/v1/admin/audit-logs?actorId=&resourceType=&cursor=`
- `GET /api/v1/admin/metrics?from=&to=`：用户、访问、转化、GMV、退款、打赏和内容漏斗。

所有后台写接口返回 `requestId`。金额、状态、角色、商品绑定和权益变化必须记录审计日志；后台列表使用游标分页，导出任务异步执行并限制权限。

### 错误和安全约定

- `401` 表示未登录，`403` 表示已登录但没有会员/角色权限，`404` 不泄露未授权资源是否存在。
- `409` 用于幂等键重复但请求内容不同、订单状态冲突或优惠券库存冲突；客户端应重新读取订单。
- 所有金额、商品、优惠券和受保护内容字段由服务端计算或裁剪；前端传来的价格、会员等级和 `canView` 一律不可信。
- 支付回调保存原始报文的脱敏副本和验签结果，禁止在日志中输出支付密钥、微信 `session_key` 或完整手机号。

