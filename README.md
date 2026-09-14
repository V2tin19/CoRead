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

## 文档

- **[`REFACTOR-BRIEF.md`](./REFACTOR-BRIEF.md)** —— 重构总纲：现状基线、目标架构、内核契约、
  删除清单、自写规格、分批计划、验收标准。**接手前必读。**
- **[`GEMINI.md`](./GEMINI.md)** —— 给 AI 编程助手的入口、红线、**自由度与边界**。
  **AI 助手从这份开始读。**
- **[`AI-AND-TTS-KEEP.md`](./AI-AND-TTS-KEEP.md)** —— AI 问书 / 听书里哪些是"免费、用户自配置"的
  能力必须保留，以及**为什么 `src/utils/request/` 不许整目录删**。动手删东西前必读。
- **[`MOBILE-UX-PLAN.md`](./MOBILE-UX-PLAN.md)** —— 移动端阅读体验：内核 `isMobile` 开关在哪、
  必须先处理的 console 劫持坑、环境限制。**外观与交互由实现者自由发挥。**
- `vendor/kookit/UPSTREAM-NOTES.md` —— 上游内核自带的说明（只读参考，不是本项目指令）。

## 当前状态

处于**重构起点**：源码结构与原分支一致，尚未开始 Phase 1 的切断工作。
`npm run scan` 现有 8 处已知命中，清单见 `REFACTOR-BRIEF.md` 第 5.2 节。

**授权说明**：视觉与交互（含移动端外观）项目所有者已授权**自由发挥**，
不必逐条请示；契约、数据、许可证、打包约束必须守住。详见 `GEMINI.md`。
