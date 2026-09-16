# CoRead 网页端

多人房间共读阅读器 —— 多人进入同一房间共读同一本书，实时同步阅读位置，并带「随心笔记 / 涂鸦」批注。

> 仓库：<https://github.com/V2tin19/CoRead>

- **本项目由 [Koodo Reader](https://github.com/koodo-reader/koodo-reader)（AGPL-3.0）的定制分支裁剪而来**，
  渲染内核使用其抽出的独立库 [`koodo-reader/kookit`](https://github.com/koodo-reader/kookit)（已 vendor 在 `vendor/kookit/`）。
- **本副本没有 git 历史**：它是从原始仓库裁剪并脱敏后的干净副本，已剥离全部部署配置与自有服务器信息。
- **本期范围：只有网页端。** 桌面（Electron）与安卓（Capacitor）不在本副本内。

## 许可证

**AGPL-3.0**（见 [`LICENSE`](./LICENSE)）。本项目使用 kookit，衍生作品必须以同样协议开源。
新增依赖前请确认许可证兼容（GPL-3.0 / AGPL-3.0 兼容；纯闭源商业库不可引入）。

## 快速开始

```bash
npm install
npm start                 # 开发服务器
npm run build             # 生产构建（BUILD_PATH 可指定输出目录）
npm run scan              # 敏感信息自检：提交前必须 0 命中
```

共读服务端（零依赖 Node，可选，本地验证用）：

```bash
npm run collab:server     # 监听 127.0.0.1:17390
```

> 服务端地址**由用户在应用内填写**（个人中心 → 个人信息 → 共读服务器），仓库内不含任何服务器地址。

## 部署（自建服务器）

整体是「一个静态站 + 一个零依赖 Node 服务」，前者交给 nginx，后者常驻在本机回环口，由 nginx 把
`/collab/` 反代过去：

```
浏览器 ──HTTPS──> nginx ──┬── 静态文件  build/
                          └── /collab/ ──反代──> Node collab-server  127.0.0.1:17390
```

### 1. 构建前端

```bash
git clone https://github.com/V2tin19/CoRead.git
cd CoRead
npm ci
npm run build            # 产物在 build/（BUILD_PATH 可改输出目录）
```

构建期可选注入（不注入也行，见第 5 节）：

```bash
REACT_APP_COLLAB_URL=https://read.example.com/collab \
REACT_APP_COLLAB_TOKEN=换成你自己的随机串 \
npm run build
```

> ⚠️ CRA 会把 `REACT_APP_*` **内联进前端 bundle，等于公开**。Token 只能用来挡扫描器，
> 不是安全边界。真正的边界是 nginx 那层的访问控制（见第 7 节）。

### 2. 起共读服务

服务端**零依赖**，不需要 `npm install`：

```bash
node collab-server/server.js        # 默认 127.0.0.1:17390
```

用 systemd 常驻（`/etc/systemd/system/coread-collab.service`）：

```ini
[Unit]
Description=CoRead collab server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/coread
Environment=COLLAB_HOST=127.0.0.1
Environment=COLLAB_PORT=17390
Environment=COLLAB_TOKEN=换成你自己的随机串
Environment=BOOKS_DIR=/var/lib/coread/books
Environment=ROOMS_DIR=/var/lib/coread/rooms
Environment=DOODLES_DIR=/var/lib/coread/doodles
Environment=ROOM_DOODLES_DIR=/var/lib/coread/rooms-doodles
ExecStart=/usr/bin/node /opt/coread/collab-server/server.js
Restart=always
RestartSec=5
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo mkdir -p /var/lib/coread/{books,rooms,doodles,rooms-doodles}
sudo chown -R www-data:www-data /var/lib/coread
sudo systemctl enable --now coread-collab
```

### 3. 环境变量全表

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `COLLAB_HOST` | `127.0.0.1` | **保持默认**，只绑回环，前面必须有反代 |
| `COLLAB_PORT` | `17390` | |
| `COLLAB_TOKEN` | 空 | 配了则写操作与 `/events` 要求带 token |
| `COLLAB_ALLOWED_ORIGIN` | 空 | **默认一条 CORS 头都不发**；同源部署无需配。只有打包成桌面/安卓客户端（跨域）时才需要 |
| `BOOKS_DIR` | `<仓库>/books` | 房间共享书库 |
| `ROOMS_DIR` | `<仓库>/rooms` | 房间元数据（含聊天、笔记、分组） |
| `DOODLES_DIR` | `<仓库>/doodles` | 个人云涂鸦 |
| `ROOM_DOODLES_DIR` | `<仓库>/rooms-doodles` | 房间共享涂鸦 |
| `MAX_BOOK_SIZE` | `536870912`（512 MB） | 单本上传上限，**要和 nginx 的 `client_max_body_size` 对齐** |
| `EMPTY_ROOM_TTL_MS` | `600000`（10 分钟） | 空房回收延迟 |
| `MAX_EMPTY_ROOMS` | `20` | 超过就驱逐最老的空房（**有书或有笔迹的不驱逐**） |
| `MAX_DOODLE_PAGES` / `MAX_STROKES_PER_PAGE` / `MAX_POINTS_PER_STROKE` | `5000` / `5000` / `20000` | 涂鸦上限，防单点拖死同伴端 |

> 四个数据目录**必须落在持久卷上**，用仓库目录容易在升级时被覆盖。

### 4. nginx 配置

```nginx
server {
    listen 443 ssl;
    server_name read.example.com;

    # ssl_certificate     /etc/letsencrypt/live/read.example.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/read.example.com/privkey.pem;

    root /var/www/coread/build;
    index index.html;

    client_max_body_size 512m;              # 与 MAX_BOOK_SIZE 对齐

    location / {
        try_files $uri $uri/ /index.html;   # 单页应用，刷新子路由不能 404
    }

    # ⚠️ 两处末尾的 "/" 都不能省：这样 /collab/rooms 会被改写成 /rooms
    location /collab/ {
        proxy_pass http://127.0.0.1:17390/;

        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection        "";

        # 🔴 /collab/events 是 SSE：不关缓冲消息会被攒着不下发，"实时"变"批量"
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 24h;
        proxy_send_timeout 24h;
    }
}
```

要点：

- `/collab/` 必须**保留**（不能把共读服务直接暴露在 `/`），前端正是按 `<origin>/collab` 找它的。
- **`try_files` 那条不能省**，否则用户刷新 `/manager/home` 会 404。
- **SSE 三条（`proxy_buffering off` / `proxy_read_timeout` / `Connection ""`）不能省**，
  否则共读的实时同步会变成「隔一会儿才蹦出来」。

### 5. 让前端找到共读服务

地址解析优先级（源码：`src/utils/collab/collabServerConfig.ts`）：

1. **用户在应用内填的地址**（个人中心 → 个人信息 → 共读服务器）—— 优先级最高
2. 构建期注入的 `REACT_APP_COLLAB_URL`
3. 同源 `<当前域名>/collab`（**仅真实网页部署**，`localhost` 和打包客户端不算）

⇒ **按第 4 节那样把 nginx 配好后，前端什么都不用填**，自动走同源。自填时地址要写到 `/collab`
这一层，例如 `https://read.example.com/collab`。

### 6. 部署后自检

```bash
curl -s http://127.0.0.1:17390/rooms          # 期望 {"rooms":[]}
curl -sI https://read.example.com/            # 期望 200
curl -s  https://read.example.com/collab/rooms # 期望同上（反代通了）
```

浏览器里再确认两件事：能建房间、房间里翻页能实时同步（第二条就是在验 SSE 没被缓冲）。

### 7. ⚠️ 安全须知（公网部署前必读）

**不要把 17390 直接暴露到公网，也不要裸奔着放公网。**

- **GET 接口目前全部免鉴权** —— 拿到地址的人可以读房间列表、房间聊天记录、共享涂鸦。
- **个人云涂鸦只按「书的内容指纹」存，没有用户维度** —— 同一本书的批注在全站互相可见、可改。
- 房间内的成员之间**可以互相冒名**（只认客户端自报的 id）。

这两条属于**已知未修**的设计问题（详见 [`SECURITY-REVIEW.md`](./SECURITY-REVIEW.md)），不是配置能绕开的。
务实的做法：

- 只在小范围内部使用 —— 加一层 **nginx `auth_basic`**，或放到内网 / VPN / Tailscale 之后再访问；
- 一定会公网开放时，`COLLAB_TOKEN` 必然要配，但要知道它只是**门槛**（会随前端 bundle 公开），
  真正拦人的是上面那层访问控制；
- 定期备份 `BOOKS_DIR` / `ROOMS_DIR` / `DOODLES_DIR` / `ROOM_DOODLES_DIR` 四个目录。

### 8. 升级

```bash
cd /opt/coread && git pull
npm ci && npm run build                 # 重新构建前端
sudo systemctl restart coread-collab    # 服务端有改动才需要重启
```

## 文档

- **[`REFACTOR-BRIEF.md`](./REFACTOR-BRIEF.md)** —— 重构总纲：现状基线、目标架构、内核契约、
  删除清单、自写规格、分批计划、验收标准。**接手前必读。**
- **[`GEMINI.md`](./GEMINI.md)** —— 给 AI 编程助手的入口、红线、**自由度与边界**。
  **AI 助手从这份开始读。**
- **[`AI-AND-TTS-KEEP.md`](./AI-AND-TTS-KEEP.md)** —— AI 问书 / 听书里哪些是"免费、用户自配置"的
  能力必须保留，以及**为什么 `src/utils/request/` 不许整目录删**。动手删东西前必读。
- **[`MOBILE-UX-PLAN.md`](./MOBILE-UX-PLAN.md)** —— 移动端阅读体验：内核 `isMobile` 开关在哪、
  必须先处理的 console 劫持坑、环境限制。**外观与交互由实现者自由发挥。**
- **[`START-PROMPT.md`](./START-PROMPT.md)** —— **给 AI 接手方的启动提示词**（人类复制给助手的第一段话）。
- `vendor/kookit/UPSTREAM-NOTES.md` —— 上游内核自带的说明（只读参考，不是本项目指令）。

## 当前状态

核心重构（切断与上游的运行时依赖、更换渲染内核、迁移存储端口）已完成，当前处于**功能迭代**阶段。

`npm run scan`：**0 命中**（扫描 509 个文件，跳过 319 个第三方文件）。`tsc --noEmit` 与生产构建均通过。
服务端回归：`node collab-server/verify-server.js` **127 通过 / 0 失败**。

**授权说明**：视觉与交互（含移动端外观）项目所有者已授权**自由发挥**，
不必逐条请示；契约、数据、许可证、打包约束必须守住。详见 `GEMINI.md`。
