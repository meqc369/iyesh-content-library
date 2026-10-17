# 实现说明

## 可直接预览的 H5 原型

根目录的 `index.html`、`styles.css` 和 `app.js` 是无需构建工具的静态原型：

```bash
python3 -m http.server 4173
```

然后打开 `http://127.0.0.1:4173/`。静态 H5 页通过根目录的 `api-config.js` 读取 API 地址；localhost 会自动使用本地 API，同源生产部署可保持默认值，API 独立部署时在脚本前注入 `window.CONTENT_API_BASE` 或改成实际 HTTPS API 域名。

已覆盖：

- 平台、项目、技能三层单选筛选。
- 展开更多标签。
- 热门、精华、全部切换。
- 日期、排序、常规/简洁/精简阅读模式。
- 常用筛选保存、应用、清空，最多 7 组。
- 桌面双栏和移动端单栏响应式布局。

## uni-app 工程

`uniapp/` 是正式前端入口，使用 Vue 3 + uni-app：

```bash
cd uniapp
npm install --legacy-peer-deps
npm run dev:h5
npm run dev:mp-weixin
```

构建命令：

```bash
npm run build:h5
npm run build:mp-weixin
```

构建产物分别位于 `uniapp/dist/build/h5` 和 `uniapp/dist/build/mp-weixin`。微信小程序正式运行前，需要替换 `src/manifest.json` 中的 AppID，并配置合法请求域名、图片域名和业务域名。

`uniapp/src/api/client.ts` 已封装检索、详情、评论、互动、常用筛选、个人中心、通知、订单和投稿请求。检索和详情在开发接口不可用时保留本地演示内容，并显示重试提示；用户写操作仍以服务端结果为准，不会把失败的评论或投稿伪装成成功。

`uniapp/src/api/auth.ts` 和 `pages/login/index.vue` 负责微信登录、令牌保存和请求身份头；H5 本地原型提供 `login.html` 的演示登录入口。

## 接入真实后端

`src/data/posts.ts` 仍保留演示数据作为离线回退；配置 API 后，`pages/tags/index.vue` 会通过 `src/api/client.ts` 请求 `/api/v1/posts/search`，并将 `selected`、`tab`、`date`、`sort`、`mode` 映射到 [API 契约](API.md) 中的请求字段。

本地 API 已支持详情、评论、点赞、收藏、投锚、演示登录和游标/日期筛选。开发阶段的数据会写入 `server/data/store.json`，部署到生产时替换为数据库事务和真实用户鉴权。

授权内容迁移使用 `server/import-content.mjs`，先执行 `npm run import -- --file your-content.json --dry-run` 检查，再去掉 `--dry-run` 写入本地存储。

生产登录需要复制 `server/.env.example` 为环境配置，设置 `WECHAT_APPID`、`WECHAT_SECRET` 和强随机 `AUTH_SECRET`。微信小程序端还需要把 API 配置为 HTTPS 合法域名。

本地管理页面是 [admin.html](../admin.html)，通过 [admin-login.html](../admin-login.html) 使用管理员账号密码登录。生产环境使用管理员角色会话鉴权，不配置共享后台密钥。

服务端提供 [Docker Compose 部署模板](../deploy/README.md)，用于先把 API 放到独立容器；正式环境还需要反向代理、HTTPS、日志和备份策略。

