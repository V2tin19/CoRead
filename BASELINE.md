# CoRead 网页端重构基线记录 (Phase 0 Baseline)

> 记录时间：2026-09-15  
> 执行阶段：Phase 0（平整地基）  
> 状态：✅ 全部基线建立完成，未修改任何既有业务代码

---

## 1. 运行与工具链环境

| 项 | 版本 / 说明 |
| --- | --- |
| 操作系统 | Windows 64-bit (PowerShell 7) |
| Node.js | `v22.19.0` |
| npm | `10.9.3` |
| TypeScript | `5.9.3` |
| React Scripts | `5.0.1` |
| 依赖安装策略 | `npm install --legacy-peer-deps`（解决 React Scripts 5 与 TS 5 peer 冲突并自动对齐 `package-lock.json`） |

---

## 2. 架构分层骨架建设

根据 `REFACTOR-BRIEF.md` 第 3 节目标架构，已建立 `src/core/` 目录结构与依赖规范：

```
src/core/
├── README.md               # 核心架构分层与依赖方向契约说明
├── domain/                 # 纯数据模型与纯函数（零外部依赖，禁止 import React/Redux/kookit 等）
├── ports/                  # 接口定义契约（IRenderService, IConfigStore, INoteStore 等）
├── usecases/               # 业务流程用例编排
└── adapters/               # 具体适配器实现
    ├── render/             # 渲染内核适配器（kookitLoader, kookitRenderAdapter 等）
    ├── store/              # 本地存储适配器（IndexedDB / localforage）
    └── collab/             # 共读网络适配器
```

---

## 3. 独立验证 Harness（§4.5）建设与状态

已在 `tools/harness/` 搭建完全脱离主 App 复杂环境的轻量验证工具：

- **页面与样式**：
  - `tools/harness/index.html`：包含契约 1 所要求的宿主容器 `<main class="ebook-viewer" id="page-area"></main>`；
  - `tools/harness/index.css`：符合契约 8（宿主容器 `overflow-y: auto`，iframe 不设 `height: 100%`）；
- **本地化与零外联**：
  - `tools/harness/localforage.min.js`：由本地依赖直接提取，替换原上游测试页 BootCDN 外联；
  - PDF.js 资源：本地直接引用 `public/lib/pdfjs/pdf.mjs` 与 `pdf.worker.mjs`；
- **配套服务与自动化断言**：
  - `tools/harness/server.mjs`：零依赖 Node.js 静态文件服务器；
  - `tools/harness/verify-harness.mjs`：自动化环境与契约断言脚本。

### 自动化验证执行结果
```
=== CoRead Harness 自动化环境与契约断言 ===
✅ Harness HTML 页面存在
✅ 契约 1: 宿主容器 id='page-area' 声明
✅ Harness CSS 文件存在
✅ 契约 8: 宿主容器设置 overflow-y: auto
✅ 零外联约束: Harness HTML 未引入外部 CDN 脚本
✅ 本地依赖: localforage.min.js 本地化就绪
✅ 契约 5: 本地 PDF.js 核心库及 Worker 存在
✅ 内核基线: src/assets/lib/kookit.min.js 完好
[Test Server] 临时测试服务已启动: http://127.0.0.1:3199
✅ 服务探测: /tools/harness/index.html 可访问 (200)
✅ MIME 类型: index.html 为 text/html
✅ 服务探测: /public/lib/pdfjs/pdf.mjs 可访问 (200)
✅ MIME 类型: pdf.mjs 正确响应为 text/javascript
✅ 契约 14: 笔记高亮颜色必须编码为 background-#RRGGBB 格式
✅ 契约 12: 位置章节字段转换为 number 类型
✅ 契约 12: 位置进度字段转换为 number 类型

断言汇总: 共 15 项，通过 15 项，失败 0 项。
✅ Harness 验证全部通过！
```

---

## 4. 质量门禁与基线指标

### 4.1 TypeScript 类型检查
- **命令**：`npx tsc --noEmit`
- **结果**：退出码 `0`，零错误，无任何警告输出。

### 4.2 敏感信息自检扫描（`npm run scan`）
- **命令**：`npm run scan`（等价于 `node tools/scan-sensitive.mjs`）
- **结果**：扫描 499 个文件，发现已知 8 处命中（涉及 4 个文件），严格符合 `REFACTOR-BRIEF.md` 第 5.2 节的已知清单。
- **靶标明细表（供 Phase 1 切断比对清零）**：
  1. `src/components/dialogs/importDialog/component.tsx:298` (`dl.koodoreader.com`)
  2. `src/utils/common.ts:690` (`app.chatwoot.com`)
  3. `src/utils/file/fontUtil.ts:235` (`storage.koodoreader.cn`)
  4. `src/utils/file/fontUtil.ts:236` (`storage.koodoreader.com`)
  5. `src/utils/request/common.ts:16` (`api.koodoreader.com`)
  6. `src/utils/request/common.ts:17` (`api.koodoreader.cn`)
  7. `src/utils/request/common.ts:140` (`api.koodoreader.com`)
  8. `src/utils/request/common.ts:151` (`mineru.net`)

### 4.3 生产构建基线
- **命令**：`$env:BUILD_PATH="./tmp-build-baseline"; $env:GENERATE_SOURCEMAP="false"; npm run build`
- **结果**：`Compiled successfully.`
- **产物体积（gzip 后）**：
  - JS 主包：`2.62 MB` (`static/js/main.31ba223b.js`)
  - CSS 主包：`28.84 kB` (`static/css/main.d988f8c8.css`)
- **清理确认**：测试生成的临时目录 `tmp-build-baseline` 已在构建完成后立即删除，未污染仓库与现有 `build/` 目录。

---

## 5. 黑盒库调用现状与技术债务快照

| 库文件 | 状态 / 体积 | 导出符号与调用量 | Phase 1 处理计划 |
| --- | --- | --- | --- |
| `src/assets/lib/kookit.min.js` | 470 KB | `BookHelper`, `StyleHelper`, `Kookit`（15 个文件使用） | 暂保留作为 Phase 0-1 行为基准；Phase 2 换为自建 vendor |
| `src/assets/lib/kookit-extra-browser.min.js` | 1.23 MB | 16 个符号（`ConfigService`: 1211 处, `TokenService`: 54 处, `HighlightUtil`: 25 处 等），共 118 个文件引用 | Phase 1 切断删除，通过 `ports` 空实现过渡编译 |
| `src/assets/lib/kookit-extra.min.mjs` | 1.23 MB | 0 引用（死文件） | Phase 1 直接删除 |

---

## 6. 代码改动范围核对

通过 `git status` 与 `git diff` 确认：
- 本阶段仅对齐了 `package-lock.json`，新增了 `src/core/` 架构骨架、`tools/harness/` 验证工具及本 `BASELINE.md` 文档。
- **业务代码变动**：零修改（`src/components/`、`src/containers/`、`src/pages/`、`src/utils/` 等业务路径文件 100% 保持原样）。
