# 月入万刀

这是面向 H5 的实战内容与会员权益平台工作区。

## 当前产物

- [MVP PRD](docs/PRD.md)
- [API 契约](docs/API.md)
- [数据库设计](database/schema.sql)
- [实现说明](docs/IMPLEMENTATION.md)
- [H5 静态原型](index.html)
- [H5 个人中心](profile.html)
- [H5 发布内容](publish.html)
- [H5 会员中心](membership.html)
- [H5 登录页](login.html)
- [后台登录页面](admin-login.html) · [内容管理页面](admin.html)
- [uni-app 前端骨架](uniapp/README.md)
- [本地 API 基线](server/README.md)
- [容器部署说明](deploy/README.md)
- [授权内容导入示例](server/import.example.json)

商业化 v1 已包含自定义会员分组与权限、积分面额 CDKEY、客服微信二维码、积分开通不同会员等级、首开赠送积分、积分名称自定义、积分内容购买、积分打赏、不可删除的积分流水和完整后台审计。用户通过前端保存二维码并添加客服，线下购买后兑换 CDKEY；会员开通、内容购买和积分兑换均不走线上现金支付。账号支持用户名/邮箱密码登录、邮箱验证码注册和邮箱验证码找回密码，默认保持 30 天会话；SMTP 可在后台配置。后台支持 `superadmin`、`content_admin`、`finance_admin`、`support_admin` 四种管理员角色，首页、登录页和个人中心均展示 500 条内置每日一语中的随机内容。

## 本地联调

先启动 API，再启动 H5 静态页面：

```bash
cd server && npm start
# 新终端
python3 -m http.server 4173
```

打开 `http://127.0.0.1:4173/`，也可以直接使用兼容原站的 `http://127.0.0.1:4173/tags?platformId=387806` 深链接。H5 原型通过根目录的 `api-config.js` 指向 API，本地会请求 `http://127.0.0.1:8787`；生产同源部署可以保持默认值，API 在独立域名时需在该脚本之前注入 `window.CONTENT_API_BASE = 'https://api.example.com'`（或直接修改脚本）。uni-app 需要在构建或开发时设置 `VITE_API_BASE`，例如：

```bash
cd uniapp
VITE_API_BASE=http://127.0.0.1:8787 npm run dev:h5
VITE_API_BASE=http://127.0.0.1:8787 npm run build:mp-weixin
```

微信小程序正式包必须把这个地址换成 HTTPS 合法请求域名，并在 `src/manifest.json` 填写真实 AppID。

## 前端技术路线

推荐使用 uni-app + Vue 3 + TypeScript + Pinia。检索状态、接口类型和业务规则共享；筛选抽屉、富文本渲染、登录和分享使用平台适配组件。

## 开发原则

内容、头像、图片、品牌和代码使用自有或已授权资源。参考目标产品的功能和交互，不直接复制其未授权数据或资产。

