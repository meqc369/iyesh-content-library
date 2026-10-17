# uni-app 前端骨架

该目录提供同一套 Vue 3 业务页面到 H5 和微信小程序的入口。

```bash
npm install
npm run dev:h5
npm run dev:mp-weixin
```

本地联调 API 时可以设置：

```bash
VITE_API_BASE=http://127.0.0.1:8787 npm run dev:h5
```

微信小程序需要把 `VITE_API_BASE` 换成 HTTPS 业务域名，并在微信后台配置为合法请求域名。

开发前需要在 `src/manifest.json` 中替换微信小程序 AppID，并在服务端配置合法请求域名、图片域名和业务域名。

