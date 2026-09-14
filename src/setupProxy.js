// CRA 开发服务器的代理配置（仅开发环境生效，不影响生产构建）。
//
// 为什么要这个文件：
// 前端 `collabClient.serverUrl` 在同源场景下会拼成 `<origin>/collab`，
// 生产部署时由前置反向代理把 `/collab` 转发到共读服务；但 CRA dev server 没有这层转发，
// 请求会落到 SPA fallback 上返回 index.html（HTTP 200 但内容是 HTML），
// 前端 `response.json()` 随之解析失败 —— 表现就是「房间列表空 + 创建房间失败」。
//
// 这里把 dev 环境的 `/collab/*` 转发到本机共读服务，并去掉 `/collab` 前缀，
// 使线上线下（开发/部署）的请求路径语义完全一致。
//
// 目标地址可被环境变量 `COLLAB_PROXY_TARGET` 覆盖；默认值是共读服务端的本地默认监听地址。
// ⚠️ 本文件只影响 `npm start`（开发服务器），**不参与生产构建**。

const { createProxyMiddleware } = require("http-proxy-middleware");

module.exports = function (app) {
  app.use(
    "/collab",
    createProxyMiddleware({
      target: process.env.COLLAB_PROXY_TARGET || "http://127.0.0.1:17390",
      changeOrigin: true,
      // SSE（/collab/events）必须关闭缓冲，否则消息会被攒着不下发
      onProxyRes: (proxyRes) => {
        proxyRes.headers["cache-control"] = "no-cache";
      },
      pathRewrite: { "^/collab": "" },
      // 长连接的 SSE 不设超时；普通请求失败时给出明确错误
      proxyTimeout: 1000 * 60 * 60,
      onError: (err, req, res) => {
        console.error(`[collab-proxy] ${req.method} ${req.url} -> ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(502, { "content-type": "application/json" });
        }
        res.end(
          JSON.stringify({
            error: "共读服务未启动或不可达，请确认 collab-server 正在运行",
          })
        );
      },
    })
  );
};
