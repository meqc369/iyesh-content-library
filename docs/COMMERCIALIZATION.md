# 商业化与后台实现清单

当前产品采用“微信客服承接线下收款，CDKEY 兑换积分，积分开通会员”的模式。H5 不创建现金支付订单；前端展示客服二维码，用户保存并添加客服微信后在线下购买 CDKEY。

## 用户侧闭环

1. 用户通过 H5 登录，服务端使用统一的用户身份和 token。
2. 积分购买页读取 `GET /api/v1/commerce/contact`，展示微信二维码、微信号和购买说明，引导用户保存二维码并添加客服。
3. 用户线下向客服购买积分后，管理员在后台按金额生成一个或一批不同积分值的 CDKEY；明文 CDKEY 只在生成响应中展示一次，管理员把它发给用户。
4. 用户在 H5 输入 CDKEY 兑换积分。服务端以哈希校验、幂等锁定和状态更新，成功后追加 `cdkey_redeem` 积分流水；成功兑换记录和失败尝试都可在兑换/审计日志中查询，CDKEY、兑换记录和流水不提供删除。
5. 会员计划配置 `pricePoints`，不同等级可设置不同开通积分。用户确认后由服务端原子扣除积分、开通会员并按计划发放首开赠送积分；重复开通、余额不足或已过期 CDKEY 均拒绝。
6. 内容付费和打赏都只接受积分。服务端校验余额后扣除用户积分，内容作者获得等额积分，并保留订单、打赏记录和不可变账本流水。
7. 会员内容由服务端按会员组权限裁剪；管理员撤销会员后立即失去对应内容权限。会员开通、CDKEY 生成与兑换、积分赠送、打赏和撤销都会写入系统审计日志。

## 会员组与权限

会员组的 `name`、`code`、说明、排序、状态、权限列表和 `initialPoints` 均可在后台维护。权限使用稳定的字符串编码，例如：

- `content.member.read`：查看会员内容
- `content.download`：下载资料
- `content.publish`：发布内容
- `content.tip`：使用积分打赏
- `community.private`：加入私享社区
- `support.priority`：优先客服

开通时可关联一个套餐。套餐可配置 `pricePoints`、价格展示、有效天数、权益说明和 `initialPoints`。`pricePoints` 是用户开通该等级实际消耗的积分；线下人民币价格仅作为客服沟通和历史登记快照，不会触发线上支付。

## 后台页面

| 模块 | 已提供能力 |
| --- | --- |
| 总览 | 内容、待审、会员、订单、积分账户、积分流通量、流水数和审计日志数 |
| 会员组 | 自定义名称、编码、权限、排序、状态和首开赠送积分 |
| 套餐 | 配置会员组、有效期、展示价格、权益和首开赠送积分 |
| 会员开通 | 用户按计划积分开通；后台可补发、延长、撤销并查询积分扣减和赠送流水 |
| 积分账户 | CDKEY 批量生成、按用户和类型查询余额及流水；CDKEY 只允许兑换一次 |
| 兑换码 | 生成不同积分面额、设置有效期和批次；查看掩码、状态、兑换人和兑换时间 |
| 客服配置 | 配置微信二维码、微信号、客服名称和购买说明，前端购买积分页读取 |
| 打赏 | 查询积分打赏记录和作者收款积分 |
| 系统日志 | 只读查询管理员操作、会员、积分、内容、标签、举报和打赏变更 |

积分流水、CDKEY 兑换记录和系统审计日志都没有删除接口；记录在存储层永久追加。CDKEY 只能停用或标记过期，不能修改面额或复用。列表接口支持筛选和分页，后台界面不提供删除按钮。

## 关键接口

- `POST /api/v1/admin/memberships/grant`：管理员补发、延长或手动开通会员；正常用户开通走积分计划接口。
- `PATCH /api/v1/admin/memberships/:id` 或 `POST /api/v1/admin/memberships/:id/revoke`：撤销会员。
- `POST /api/v1/admin/cdkeys`：管理员生成单个或批量积分 CDKEY，传 `points`、`quantity`、可选 `expiresAt` 和 `note`；明文只返回一次。
- `GET /api/v1/admin/cdkeys`、`POST /api/v1/admin/cdkeys/:id/revoke`：查询掩码、批次、状态和兑换情况；停用未使用的 CDKEY。
- `POST /api/v1/cdkeys/redeem`：用户兑换 CDKEY；返回新增积分、当前余额和兑换流水 ID。
- `GET /api/v1/me/cdkey-redemptions`：用户查询自己的兑换记录。
- `POST /api/v1/member/plans/:id/activate`：用户使用积分开通会员等级；服务端按计划 `pricePoints` 扣减并授予会员权益。
- `GET /api/v1/admin/points/accounts`、`GET /api/v1/admin/points/ledger`、`GET /api/v1/admin/point-recharges`：查询积分账户和充值记录。
- `GET /api/v1/admin/audit-logs`：查询系统审计日志。
- `GET /api/v1/me/points`、`GET /api/v1/me/points/ledger`：用户查询积分余额和流水。
- `GET /api/v1/points/config`：公开读取当前积分名称；后台通过 `GET|PATCH /api/v1/admin/points/config` 自定义名称。
- `GET /api/v1/commerce/contact`：公开读取积分购买客服二维码、微信号和购买说明；后台通过 `GET|PATCH /api/v1/admin/commerce/contact` 配置。
- `POST /api/v1/tips`：使用积分打赏；`POST /api/v1/tips/orders` 保留同语义兼容入口。
- `POST /api/v1/orders` 或 `POST /api/v1/posts/:id/purchase`：使用积分购买单篇付费内容，订单立即记为已支付并写入双方积分流水。

会员开通、CDKEY 生成与兑换、内容购买和打赏均不创建现金支付订单。现金收款发生在客服微信线下沟通，系统只记录 CDKEY 面额、兑换和积分流水，不保存银行卡或微信转账凭证。

## 存储与生产要求

本地 JSON 存储用于联调，字段与 [database/schema.sql](../database/schema.sql) 中的 `member_groups`、`membership_plans`、`point_settings`、`commerce_contact_settings`、`cdkeys`、`cdkey_redemptions`、`point_accounts`、`point_ledger` 和 `audit_logs` 对应。生产环境应迁移到事务数据库，将 CDKEY 兑换、积分扣减、会员开通、作者入账和打赏记录放在同一事务中，并用数据库权限限制兑换记录、流水和日志的删除操作。
