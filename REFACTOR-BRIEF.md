# CoRead 网页端重构交接文档

> **读者**：接手本仓库的 AI 编程助手（Gemini）。
> **人类负责人**：果冻（项目所有者，最终决策人）。
> **本副本的由来**：从上游项目的定制分支中裁剪出的**脱敏副本**，只保留重构所需内容，
> 已剥离全部自有服务器信息、部署配置、桌面/安卓相关代码与本地数据。
>
> **你的唯一使命**：
> 1. 把**应用层**换成我们自己写的实现（不再依赖无源码的黑盒）；
> 2. **只把 kookit 当渲染内核**；
> 3. 保证全仓库**没有任何自有服务器信息**，运行时**不访问任何自有服务器**。
>
> 先读第 0 节的红线，再读第 2 节的现状基线，然后按第 7 节的分批计划推进。
> **不要在读完第 4.3 节（内核硬编码契约）之前动手改渲染相关代码。**
>
> ⚠️ **关于自由度（先建立正确预期）**：**视觉与交互——尤其移动端外观——项目所有者已授权你自由发挥**，
> 不必逐条请示、也不需要"人工确认"这一环。**必须守住的是**：红线、内核契约（4.3）、
> 打包就绪约束（9.5）、数据兼容性、许可证。详见 [`GEMINI.md`](./GEMINI.md)「你有多少自由度」。
>
> **另外两份必读文档**（第一份尤其重要——它是为了**防止删多了**而写的）：
> - [`AI-AND-TTS-KEEP.md`](./AI-AND-TTS-KEEP.md) —— AI 问书 / 听书里"免费、用户自配置"的部分**必须保留**；
>   `src/utils/request/common.ts` 是**混装文件，不许整目录删**（见本文档 5.2.1）。
> - [`MOBILE-UX-PLAN.md`](./MOBILE-UX-PLAN.md) —— 移动端阅读体验：内核 `isMobile` 开关在哪、
>   有哪些坑、环境限制。**外观与交互自由发挥，不是复刻任务**（见该文档定位声明）。

---

## 0. 六条红线（违反即失败，任何理由都不能绕）

| # | 红线 | 说明 |
| --- | --- | --- |
| 1 | **许可证必须是 AGPL-3.0** | 本项目使用 kookit（AGPL-3.0）。**保留根目录 `LICENSE`，不许删除、不许改成别的协议**。衍生作品必须同样以 AGPL-3.0 开源。新增任何依赖前先确认其许可证与本项目兼容（GPL-3.0/AGPL-3.0 兼容；纯闭源商业库不可引入）。**不要尝试闭源、不要加商业授权条款。** |
| 2 | **禁止引入 `kookit-extra*`** | 它**没有公开源码**，且内部包含设备指纹（`TokenService.getFingerprint`）与上游账号/云同步逻辑。它要承担的职责全部由我们自写（见第 6 节）。**`src/assets/lib/kookit-extra-browser.min.js` 与 `src/assets/lib/kookit-extra.min.mjs` 必须删除。** |
| 3 | **禁止反混淆/逆向 `kookit.min.js`** | 引擎源码已经 vendor 在 `vendor/kookit/`（TypeScript，71 个文件，含 LICENSE）。要读内核就读源码，**不要去反编译 min 文件**。 |
| 4 | **前端运行时不得访问任何自有服务器** | 允许的外部网络仅限：公开 CDN、格式规范 URI、用户明确填写的第三方网盘/OAuth 地址。**不许硬编码任何我们自己的域名、IP、端口。** |
| 5 | **提交前必须 `npm run scan` 且 0 命中** | 见第 8 节。当前有 8 处已知命中（第 5.2 节的清零清单），Phase 1 结束时必须全部清零。 |
| 6 | **禁止反编译闭源第三方 App（如微信读书）并把产物带入项目** | 想复刻移动端手感，**只允许"装 App + 录屏观察"**这一条路。反编译得到的字符串/伪 JS **一律不得提交、不得写进代码、不得作为实现依据**（法律与许可证污染双重风险）。详见 [`MOBILE-UX-PLAN.md`](./MOBILE-UX-PLAN.md) 第 4 节。 |

---

## 1. 这是什么项目

**CoRead 是一个「多人房间共读」阅读器**：多个用户进入同一个房间，共同阅读同一本书，
实时同步彼此的阅读位置，并带有「随心笔记 / 涂鸦」批注能力。

技术出身需要讲清楚，否则容易做错判断：

- 本项目是 **Koodo Reader（AGPL-3.0 开源电子书阅读器）的定制分支**的后续重构。
- Koodo Reader 的**渲染内核被作者抽成了独立仓库 [`koodo-reader/kookit`](https://github.com/koodo-reader/kookit)**
  （TypeScript，AGPL-3.0，2021 年抽出，当前 `dev` 分支，71 个文件）。
- 原始仓库里，内核是**以编译产物形式**引入的（`src/assets/lib/kookit.min.js`），
  连同另一个**没有源码的配套包** `kookit-extra`（内含配置服务、账号、云同步、AI/TTS 请求等）。
  我们的代码有 **118 个文件**直接挂在 `kookit-extra` 上——这就是本次重构要解决的核心问题。
- 本次副本已经把 kookit 的**源码**固化到 `vendor/kookit/`，所以从现在起我们**有能力读它、改它、构建它**。

**本次范围：只做网页端（Web）。** 桌面（Electron）、安卓（Capacitor）、服务端部署均不在本副本内。

---

## 2. 现状基线（动手前必须理解的三个事实）

### 2.1 技术栈

| 项 | 现状 | 说明 |
| --- | --- | --- |
| 构建 | **Create React App**（`react-scripts` 5） | `npm start` / `npm run build` |
| 语言 | TypeScript | `tsconfig.json` |
| UI | **React class 组件为主** + 少量函数组件 | 不要为了"现代化"整体改写成 hooks，那是另一场重构 |
| 状态 | **Redux + redux-thunk** | `src/store/` |
| 路由 | react-router-dom | `src/router/` |
| 样式 | 每组件一个 `index.css` | 无 CSS-in-JS、无 Tailwind |
| 本地存储 | `localforage`（IndexedDB） | 网页端不用 SQLite |
| 国际化 | i18next | `src/i18n.tsx` + `src/**/*.json` |

### 2.2 目录结构（本副本实际内容）

```
LICENSE                  必须保留（AGPL-3.0）
README.md                项目说明（给人看的）
GEMINI.md                AI 编程助手入口，指向本文件
REFACTOR-BRIEF.md        本文档（总纲）
AI-AND-TTS-KEEP.md       AI 问书 / 听书：哪些必须保留（**删之前必读**）
MOBILE-UX-PLAN.md        移动端阅读体验（往微信读书靠）的路线与坑
package.json             已做 web 化裁剪（详见第 5.1 节）
package-lock.json        保留，npm install 时会自动对齐
tsconfig.json / .eslintrc.js / .prettierrc / .gitattributes
.gitignore               已重写，见 8.3
public/                  静态资源：index.html、pdfjs、字体、图标、各 wasm 库
src/                     应用源码（约 490 个文件）
  assets/lib/            ⚠️ 三个内核包都在这里（见 2.3）
  components/            UI 组件（dialogs / popups / readerSettings / ...）
  containers/            UI 容器（settings / panels / lists / header / viewer / ...）
  constants/             常量与配置项定义
  models/                数据模型（Book / HtmlBook / Note / Bookmark）
  pages/                 页面（reader / manager / login / stats / redirect）
  router/                路由
  store/                 Redux actions + reducers
  utils/                 工具层
    request/             ⚠️ 混装文件：**逐函数判定，不许整目录删**（见 5.2.1）
    collab/              共读客户端（**我们自己写的，零黑盒依赖，保留**）
    file/                书籍文件、配置、导出、涂鸦等
    reader/              阅读器交互（快捷键、选区、主题、TTS 等）
    storage/             数据层封装
types/                   类型声明
assets/                  品牌图标
collab-server/           共读服务端（零依赖 Node；网页端功能由它支撑，见 6.7）
vendor/kookit/           ✅ kookit 源码（TypeScript，71 文件，AGPL LICENSE 在内）
tools/scan-sensitive.mjs 敏感信息自检脚本（第 8 节）
```

### 2.3 三个内核包的真实身份（**这是全项目最重要的一张表**）

| 文件 | 它是什么 | 有源码吗 | 本副本怎么处理 |
| --- | --- | --- | --- |
| `src/assets/lib/kookit.min.js` | **渲染内核**（kookit 的构建产物）。只导出 3 个符号：`BookHelper` / `StyleHelper` / `Kookit`，15 个文件在用 | ✅ 有（`vendor/kookit/`） | **保留能力，但改为由 vendor 源码自建**（第 4 节） |
| `src/assets/lib/kookit-extra-browser.min.js` | 配置 / 账号 / 云同步 / 上游 AI / TTS / OCR / 翻译。导出 16 个符号，**118 个文件在用** | ❌ **无任何公开源码** | **必须删除**，职责全部自写（第 6 节） |
| `src/assets/lib/kookit-extra.min.mjs` | 上一个包的 ESM 版本 | ❌ | **零引用，是死文件，直接删除** |

`kookit-extra-browser.min.js` 导出的 16 个符号（**118 个文件的依赖全在这里**）：

```
CommonTool      ConfigService   HighlightUtil   KOReaderUtil    KookitConfig
LoginHelper     NoteSyncManager ReaderRequest   ReadingTimeUtil SqlStatement
SyncHelper      SyncUtil        ThirdpartyRequest TokenService  UserRequest
WordSyncManager
```

**为什么要重构**：这 16 个符号里，一半是应用底座（配置、高亮、工具、SQL），
另一半是**账号与上游云服务**（设备指纹、登录、网盘同步、上游 AI/TTS/OCR/翻译）。
它们被打包进同一个没有源码的文件里，**切不开**——所以只能整体不用，自己写。

### 2.4 现状代码的调用量（决定工作量）

| 符号 | 使用点 | 唯一成员数 | 处理决定 |
| --- | --- | --- | --- |
| `ConfigService` | **1211** | 24 | 🟡 **自写**（最大一块） |
| `HighlightUtil` | 25 | 14 | 🟡 **自写** |
| `CommonTool` | 22 | 8 | 🟡 **自写**（多数是通用工具） |
| `SyncUtil` | 22 | 8 | 🔴 **删除**（网盘同步） |
| `ReaderRequest` | 12 | 12 | 🔴 **删除**（上游 AI/TTS/OCR/翻译） |
| `BookHelper` | 9 | 2 | 🟢 **保留**（属于 kookit，不是 extra） |
| `SqlStatement` | 6 | 3 | 🟡 **自写** |
| `TokenService` | 54 | 4 | 🔴 **删除**（设备指纹） |
| `StyleHelper` | 1 | 1 | 🟢 **保留**（属于 kookit） |

---

## 3. 目标架构

### 3.1 分层与依赖方向（硬性，会被 code review 检查）

```
UI（pages / containers / components）
      ↓ 只能往下依赖
usecases（业务流程编排）
      ↓
domain（纯数据模型与纯函数，零外部依赖）
      ↑ 依赖倒置
ports（接口定义：IRenderService / IConfigStore / INoteStore / IHighlightService ...）
      ↑ 实现
adapters（kookit 适配器 / IndexedDB 适配器 / 共读适配器 ...）
```

**硬性规则：**

1. **`domain/` 层零依赖** —— 不许 import React、Redux、kookit、localforage。
2. **UI 层不许直接 import `kookit`、`indexedDB`、`WebSocket`** —— 必须经 ports 拿到的接口。
3. **kookit 专属概念不得越过 adapter 上行**（例如它的 `rendition` 对象、`tempLocation` 原始结构）——
   适配器必须把它们翻译成我们自己的领域类型。
4. 新增文件前先问：它属于哪一层？放不下就说明设计有问题，停下来讨论。

> 这套分层不是"架构洁癖"，它的唯一目的是：**将来换掉渲染内核时，只需要重写适配器层，UI 与领域层零改动。**

### 3.2 建议目录（可微调，但分层与依赖方向不许变）

```
src/
  core/
    domain/        纯模型与纯函数（Book / Note / Bookmark / Location / ReaderMode ...）
    ports/         接口定义
    usecases/      用例编排
    adapters/
      render/      kookit 适配器（kookitLoader.ts / kookitRenderAdapter.ts / pdfjsSetup.ts）
      store/       IndexedDB / localforage 适配器
      collab/      共读适配器
  ui/              现有的 pages / containers / components 逐步迁入
  legacy/          暂时没迁完的老代码（只减不增，见 7.2）
```

### 3.3 给适配器的两个端口（最小值，可按需扩）

```ts
// ports/IRenderService.ts
export interface RenderTarget { /* 我们自己定义的宿主容器描述 */ }
export interface RenderPosition {
  chapterIndex: number;   // 章节/渲染节索引，number
  progress: number;       // 0~1
  text?: string;          // 可见文本片段（可选）
}
export interface IRenderService {
  open(file: ArrayBuffer, meta: BookMeta, target: RenderTarget): Promise<void>;
  goToPosition(pos: RenderPosition): Promise<void>;
  goToChapter(index: number): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  getPosition(): Promise<RenderPosition>;
  getChapterList(): Promise<Chapter[]>;
  on(event: "rendered" | "position-changed", cb: (p: RenderPosition) => void): void;
  highlight(range: NoteRange, color: string): Promise<void>;
  clearHighlights(): Promise<void>;
  destroy(): Promise<void>;
}
```

> ⚠️ 上面只是形状建议，**真实字段必须按 kookit 的实际情况设计**——特别是"位置"的语义，
> 见第 4.3 节的第 12、13、14 条（那几条会把天真实现直接带沟里）。

---

## 4. 渲染内核：kookit

### 4.1 已 vendor 的源码

`vendor/kookit/`（来自 `koodo-reader/kookit` 的 `dev` 分支，2026-09-14 拉取，71 个文件，含 `LICENSE`）。

关键文件：

| 文件 | 职责 |
| --- | --- |
| `src/index.ts` | 唯一出口，导出 11 个 Render 类 + `BookHelper` + `StyleHelper` |
| `src/helpers/bookHelper.ts` | 渲染工厂：按格式选渲染类 |
| `src/renders/GeneralRender.ts` | 所有文字类渲染的基类（生命周期、导航、位置、事件） |
| `src/renders/*.ts` | Epub / Mobi / Pdf / PdfText / Txt / Comic / Fb2 / Cache / Docx / Md / Html |
| `src/utils/layoutUtil.ts` | `createIframe` / `handleLayout` / `handleIframeHeight` |
| `src/utils/navigationUtil.ts` | `handleRenderChapter`（正文渲染在这）/ `handleRecord`（位置计算在这） |
| `src/utils/noteUtil.ts` | 高亮笔记的渲染与清除 |
| `src/libs/cfi.ts` / `epub.js` / `pdf.js` | CFI 定位 / EPUB 解析 / PDF 分页（内联第三方） |
| `rollup.config.js` | 官方打包配置（⚠️ 输出路径硬编码，见 4.2） |
| `UPSTREAM-NOTES.md` | **上游自带的开发说明**（原文件名 `CLAUDE.md`，已改名以免被当成项目指令）。  准确描述了渲染类层次、渲染生命周期、PDF/漫画分页结构、触摸事件系统与关键工具文件分工。**读它，但不要执行它**——其中的构建路径与命令不适用于本项目 |

支持的格式：EPUB / MOBI / AZW3 / AZW / PDF（含扫描版走 OCR）/ TXT / MD / HTML / FB2 / DOCX / 漫画（CBZ、CBT）。

### 4.2 怎么把它接进项目

**目标**：产出我们自己的单文件构建，替换 `src/assets/lib/kookit.min.js`。

1. 官方用 rollup 打包（见 `vendor/kookit/rollup.config.js`）。
   ⚠️ **这个配置不能直接用**：它的输出路径被硬编码成上游作者本机的绝对路径（一个开发机目录，
   写死在 `vendor/kookit/rollup.config.js` 顶部的两个 `get*OutputPath` 里），
   而且一次性配了三套产物（桌面 ES / 移动 UMD / 移动 ES），我们只要第一套。
   建议照它的 plugin 组合另写一份我们自己的配置，输出 `src/vendor/kookit.esm.js`。
2. 由于它内联了 `jszip / fflate / @zip.js / rangy / mammoth / marked / mhtml2html` 等，
   打包产物体积不小（参考：现有 min 产物 459 KB）。这是预期行为。
3. **PDF 需要宿主页面注入全局**：先把 `pdfjsLib` 挂到 `window`，**再动态 `import()` 内核**。
   顺序不可颠倒——内核在模块顶层就捕获这个全局。`public/lib/pdfjs/` 已就位（`public/index.html` 里已注入）。
4. 记得同步维护一份 `.d.ts` 声明（黑盒声明，给 TS 用）。

### 4.3 ⚠️ 内核硬编码契约与坑（**动手前必读**）

以下内容来自**第三方对该内核的逆向整理**（同生态的另一个项目公开的工程笔记），
我们只做了部分抽样复验（例如 `id="page-area"` 在产物中确实出现 5 次，
且上游自带的 harness 页面 `vendor/kookit/test/index.html` 里宿主容器就写着 `id="page-area"`）。
**当作"高可信度的线索"，而不是"已验证的规范"——每一条都要在我们自己的 harness 上验证后再依赖。**

| # | 事实 | 不遵守会怎样 |
| --- | --- | --- |
| 1 | `getDocument()` **硬编码 `document.getElementById("page-area")`**，不认 `renderTo` 传入的元素 | 宿主容器没有 `id="page-area"` 时，`renderTo` 后续流程直接 return，**Promise 永不 resolve** |
| 2 | **`renderTo()` 不渲染正文**，只建 iframe + 布局 | 必须再补一次导航调用（`goToChapterIndex(0)` 或 `goToPosition(last)`）才出现内容 |
| 3 | 正文经 `item.load()` → `fetch(blobUrl)` → `doc.body.innerHTML` | **CSP 必须放行 `blob:`**（connect/img/style/frame/font-src；PDF 还要 `worker-src`） |
| 4 | 非 PDF、非移动端时 iframe 带 `sandbox="allow-same-origin"` | 脚本被禁是预期行为 |
| 5 | PDF / 漫画依赖**外部全局对象** + `/lib/pdfjs/` 静态资源 | 注入顺序不能反（见 4.2 第 3 条） |
| 6 | 内部有 `isElectron()` 检测，影响 `pdfjsPath` 前缀 | 网页端走非 Electron 分支，注意别把 `file://` 与 `http://` 混为一谈 |
| 7 | `tempLocation` 初始为 `{}` | 首次 `getPosition()` 的字段可能是 `undefined`，适配器要兜底 |
| 8 | **scroll 模式下滚动发生在宿主容器上**（内核把 iframe 拉高到 `body.scrollHeight + 300`，翻页对宿主容器 `scrollTo/scrollBy`） | 宿主容器必须 `overflow-y: auto`，且 **CSS 不许给其中 iframe 设 `height: 100%`** ——否则 iframe 被压回一屏、宿主容器不可滚、翻页退化成跳章 |
| 9 | PDF 的 scroll 模式**不**拉高外层 iframe | 适配器需自己按 `scrollHeight + 300` 补齐，否则页面容器永远不可滚 |
| 10 | 文字类渲染**不监听宿主容器 scroll**，`next()` 一开始就 `record()` | 位置是**旧值**。消费方必须在滚动停稳后**补一次 `record()`**（PDF 例外，它自带监听）。另：无头隐藏窗口会把平滑滚动推迟约 2 秒 |
| 11 | `record()` 内部有动画等待 | `animation !== "none"` 且非移动端时会 sleep 1000ms，别在热路径里频繁调 |
| 12 | **`getPosition()` 的数值字段是 string** | 领域层必须统一归一为 number，否则比较逻辑会静默出错 |
| 13 | **`rendered` 事件的载荷不一致**：文字类**不带参数**（`trigger("rendered")`），`PdfRender` **带章号** | 若按"事件带章号"实现，文字类会拿到 `undefined`——它既不等于 `null` 也不报错，表现为"按章过滤恒不成立、静默 0 命中"（典型症状：**高亮永远不出现，日志干净**）。**正确做法：一律以位置为权威**（`getPosition().chapterDocIndex`） |
| 14 | **笔记/高亮用的是 rangy 字符范围，不是 CFI**：`saveCharacterRanges` 序列化结果，`range` 是 **JSON 字符串**、`notes` 是**字符串** | 颜色必须传 `"background-#RRGGBB"` 形态（内核按 `-` 切分），传裸 hex 会**静默不显色**；`renderHighlighters` **只作用于当前那一节的 document**，跨节笔记要调用方自己过滤、换章后必须重挂；它的 `notes.reverse()` 会**原地修改入参**（记得传拷贝） |
| 15 | 高亮点击回调是**委托 + 配对**的：`doc.body` 上 capture 一个 `click`，且要求 `mousedown` 与 `click` 坐标差 ≤ 5px | 回调参数只有 `{ target }`（**没有鼠标坐标**，要坐标自己 `getBoundingClientRect()`）；用合成事件测试必须**成对派发且坐标一致**，否则内核直接 return（**静默**） |
| 16 | 桌面端**没有任何** contextmenu 处理（相关接线是死代码） | 右键槽位可以自由使用 |
| 17 | 扫描版 PDF 的 OCR 是**插槽**设计：`config.externalWorker = { recognize }` | 不需要改内核即可替换 OCR 引擎；**但内核默认的 OCR 模型地址指向上游 CDN，必须替换或关闭**（见 5.3） |

### 4.4 ⚠️ 版本漂移警告（重要）

我们的 `src/assets/lib/kookit.min.js` **未必等于** `vendor/kookit/` 当前 `dev` HEAD。
用特征串比对的结果（我们 : 上游源码）：

| 特征串 | 我们 | 上游 |
| --- | --- | --- |
| `page-area` | 5 | 5 ✅ |
| `kookitmarker` | 10 | 10 ✅ |
| `goToChapterDocIndex` | 2 | 2 ✅ |
| `kookit-note` | 33 | 35 ⚠️ |
| `getHightlightCoords` | 6 | 0 ⚠️ |

**要求**：
- 在替换内核之前，**保留 `src/assets/lib/kookit.min.js` 作为行为基线**（先别删）。
- 自建产物接入后，跑一遍第 4.5 节的 harness 做**行为回归**；不一致就先查是不是版本差异，
  必要时把 `vendor/kookit` 回退到与基线等价的提交。
- **不要只看版本号就宣布升级成功。**

### 4.5 强烈建议先搭一个独立验证工具（harness）

在动渲染层之前，做一个**脱离 App 环境**的最小验证页（零依赖静态服务器 + 一个 HTML 页 + 无头浏览器跑断言）：

- 打开一本已知的 EPUB/MOBI/AZW3/PDF，断言：章节列表非空、正文有文字、`next()` 后位置真的变化；
- 用它来验证 4.3 的每一条契约，而不是靠"在 App 里点点看"。

理由：渲染问题在完整 App 里**极难定位**（面板可能不可见、CSS 相互干扰、时序窗口窄），
而内核的失败方式**大多是静默的**（不报错、不 resolve、0 命中）。没有 harness 会被拖死。

> 💡 **上游已经给了一个现成的手写 harness**，别从零写：`vendor/kookit/test/index.html`（约 140 行）。
> 它做的事正是我们要的：文件选择 → `localforage` 存 → `new PdfRender(...)` → `renderTo(元素)`
> → `getChapter()` 渲染目录 → `next()` / `prev()` / `goToChapter()`。
> **注意三处要改**：
> 1. 它 `import * as Kookit from "../dist/kookit.mjs"` —— 这个 `dist` 是上游本机构建产物，我们仓库里没有，
>    必须先按 4.2 自建产物再把路径指过去；
> 2. 它 `import "./pdfjs/pdf.min.mjs"` 期望 `test/pdfjs/` 存在（上游本机才有），
>    本副本里 pdf.js 在 `public/lib/pdfjs/`，改路径或复制过去；
> 3. 它从 CDN（`cdn.bootcdn.net`）加载 `localforage` —— **改成用本地依赖**，我们的 harness 不该外联。
>
> 另外这个页面本身就是一个佐证：它的宿主容器写的是 `<div class="ebook-viewer" id="page-area">` ——
> 与 4.3 第 1 条（`id="page-area"`）一致。

---

## 5. 删除与清理清单

### 5.1 package.json 已做的裁剪（不用你再做，仅需知晓）

- 删除字段：`main`（指向已排除的桌面入口）、`repository`、`homepage`、`build`（electron-builder 全套）。
- `name` → `coread-web`，`private: true`。
- 删除依赖：`better-sqlite3`（原生模块，桌面用；网页端用 localforage）。
- 删除 devDependencies：`electron` / `electron-builder` / `electron-rebuild` / `concurrently` / `cross-env` / `nodemon` / `wait-on`。
- 删除 `webpack.config.js`（`target: "electron-main"`、entry `./main.js`，是桌面主进程的构建配置；
  纯网页副本里 `main.js` 已被排除，这份配置是死配置），以及只服务于它的 devDependency `hard-source-webpack-plugin`。
- 只保留脚本：`analyze` / `start` / `build` / `test` / `eject` / `collab:server` / `scan` / `scan:all`。
- **`src/` 里真正静态引用桌面依赖的只有 `crypto-js` 与 `@mozilla/readability`，二者已保留。**
- 依赖里仍留着 `electron-store` / `electron-log` / `electron-is-dev` / `node-machine-id` / 各网盘 SDK 等，
  它们属于被删除的功能（账号/云同步）。**Phase 1 清完功能后请一并从 `dependencies` 里删掉，并重新生成 lock。**
- ⚠️ **`package-lock.json` 目前与 `package.json` 不完全同步**（副本里裁剪了 `better-sqlite3`、
  `hard-source-webpack-plugin` 与若干 electron 系 devDeps，而 lock 还是原样）。
  第一次 `npm install` 会自动对齐，属于预期行为，**不要为此去手工改 lock**。
- 本副本**没有 `webpack.config.js`**：原文件是桌面主进程的构建配置（`target: "electron-main"`、
  entry `./main.js`），在纯网页副本里是死配置，连同只服务于它的 `hard-source-webpack-plugin` 一起删了。
  前端构建走 CRA 自带的 `react-scripts`，不需要自定义 webpack 配置。

### 5.2 安全清零清单（`npm run scan` 当前 8 处命中，Phase 1 必须清零）

| 文件:行 | 内容 | 处理 |
| --- | --- | --- |
| `src/utils/request/common.ts:16,17,140` | `api.koodoreader.com` / `.cn` | ⚠️ **不要整目录删！** 见下方「§5.2.1 警告」与 [`AI-AND-TTS-KEEP.md`](./AI-AND-TTS-KEEP.md)：这个文件是**混装**的，删域名相关的函数、保留 `chatStream` 等 |
| `src/utils/request/common.ts:151` | `mineru.net` | 同上，删 `parseWithMineruAgent` 一个函数即可 |
| `src/utils/file/fontUtil.ts:235,236` | `storage.koodoreader.cn` / `.com`（在线字体下载） | 删除在线字体下载能力，改为只用本地字体；或改为用户自配字体目录 |
| `src/components/dialogs/importDialog/component.tsx:298` | `dl.koodoreader.com`（网盘 OAuth 中转） | 删除该中转；网盘导入改为用户直连（自填凭据）或整体下线 |
| `src/utils/common.ts:690` | `app.chatwoot.com`（上游在线客服） | 删除客服入口及相关常量（现已被 `UPSTREAM_SUPPORT_ENABLED = false` 关停，请连代码一起删） |

#### 5.2.1 ⚠️ 警告：`src/utils/request/` **不许整目录删除**

这一条曾经写错，特此更正。`src/utils/request/common.ts` 是**混装文件**：

| 函数 | 判定 |
| --- | --- |
| `chatStream` | ✅ **必留** —— 它是 **AI 问书 / 翻译 / 词典三个功能的唯一可用主路径**（直连用户自己配置的模型 endpoint + apiKey，SSE 流式）。删了这三个功能全废 |
| `uploadFile` | ✅ 留（通用 PUT，与上游无关） |
| `parseWithSystemOCR` | ✅ 留（Electron 调操作系统 OCR，**本地免费**） |
| `getPublicUrl` / `checkDeveloperUpdate` / `checkStableUpdate` / `getPluginList` / `getNotification` / `parseWithMineruAgent` / `handleExitApp` / `handleClearToken` | 🔴 删 |

另外三个文件（`reader.ts` / `user.ts` / `thirdparty.ts`）以删为主，
**但 `user.ts` 里混着 `detectBrowser` / `getOSName` 这类通用环境探测，删之前先查调用点。**

> 逐函数判定表与迁移建议见 **[`AI-AND-TTS-KEEP.md`](./AI-AND-TTS-KEEP.md) 第 3 节**。**动手前先读它。**

### 5.3 必须删除的文件（黑盒与上游层）

| 路径 | 理由 |
| --- | --- |
| `src/assets/lib/kookit-extra-browser.min.js` | 无源码黑盒，含设备指纹与上游账号逻辑（红线 2） |
| `src/assets/lib/kookit-extra.min.mjs` | 零引用的死文件 |
| `src/utils/request/reader.ts`（约 350 行） | 上游 API 客户端（`ReaderRequest` 包装）。**整体可删**，但要先接掉三个调用点（见 5.2.1 与 `AI-AND-TTS-KEEP.md` 3.2） |
| `src/utils/request/thirdparty.ts` | 第三方登录 / 网盘 OAuth 中转 |
| `src/utils/request/common.ts` | ⚠️ **混装文件，逐函数判定，不许整删**（见 5.2.1） |
| `src/utils/request/user.ts` | 上游账号接口（但 `detectBrowser` / `getOSName` 是通用工具，删前查调用点） |
| `src/utils/storage/syncService.ts` | 依赖 `SyncUtil`，网盘同步 |
| `src/pages/login/` | 上游账号登录页 |
| `src/containers/settings/accountSetting/`、`pluginSetting/` | 上游账号与插件页 |
| `src/components/dialogs/supportDialog/`、`updateDialog/` | 上游客服与更新通道 |
| `src/components/textToSpeech/` 中的"官方 AI 语音"分支 | 依赖上游 TTS 配额 |
| `src/components/popups/popupAssist/`、`popupDict/`、`popupTrans/` 的上游分支 | 依赖上游 AI / 词典 / 翻译接口 |
| `src/components/dialogs/metadataDialog/` 的联网搜索分支 | 依赖上游元数据服务 |

> 删除是"先让它不编译"还是"先做替换"？见第 7 节的阶段划分——**Phase 1 只做"切断"，允许暂时少功能**。

### 5.4 需要"关闭或替换"的运行时外联（不是文件级删除）

| 位置 | 外联对象 | 处理 |
| --- | --- | --- |
| `vendor/kookit/src/renders/PdfTextRender.ts` | 上游 OCR 模型 CDN | 扫描版 PDF 的 OCR：**Phase 1 直接关闭该功能**；后续再接自托管引擎 |
| `public/index.html` 加载的 `tesseract.min.js` / `ort.min.js` / `esearch-ocr` | 这些库本身是本地文件，但**模型文件默认从公网 CDN 下载** | Phase 1 关闭 OCR 相关入口；要用就自托管模型 |
| `src/utils/file/googlePicker.ts` | Google Picker / Drive API | 属于网盘导入，随 5.2 一并处理 |
| `src/components/dialogs/opdsDialog/` | 公开 OPDS 书源（古登堡等） | **可以保留**，是合法第三方公开资源 |
| `src/components/footer/` 的备案号链接 | 政府备案查询站 | 与我们无关，可删可留 |
| `src/setupProxy.js` | 把 dev 环境的 `/collab/*` 转发到本机共读服务 | **保留**。目标默认 `127.0.0.1:17390`（私网，允许），可用 `COLLAB_PROXY_TARGET` 覆盖；⚠️ 它**只影响 `npm start`，不参与生产构建** |

---

## 6. 要自写的等价物（规格书）

> 判据：**凡是"我们自己的应用逻辑"就自写；凡是"账号/云/上游 AI"就删除。**

### 6.1 `ConfigService` —— 最大的一块（24 个成员，1211 处调用）

它实际是一个**带命名空间的键值配置仓库**。按调用形态分五组：

| 组 | 成员 | 语义 |
| --- | --- | --- |
| 标量 | `getItem` / `setItem` / `removeItem` | 单键读写 |
| 列表 | `getListConfig` / `setListConfig` / `deleteListConfig` / `getAllListConfig` / `setAllListConfig` | 有序列表（书架、书单） |
| 映射 | `getMapConfig` / `setMapConfig` / `setOneMapConfig` / `deleteMapConfig` / `deleteFromMapConfig` / `getAllMapConfig` / `getFromAllMapConfig` / `deleteFromAllMapConfig` | 按 key 存的对象集合（每本书的阅读配置、笔记分组） |
| 对象 | `getObjectConfig` / `setObjectConfig` / `deleteObjectConfig` / `getAllObjectConfig` | 单例对象（全局设置） |
| 阅读器 | `getReaderConfig` / `setReaderConfig` | 阅读偏好（字号、主题、行距、模式…） |
| 同步记录 | `getAllSyncRecord` / `setAllSyncRecord` / `setSyncRecord` | ⚠️ **这是云同步用的，删掉即可** |

**设计要求**：

1. 实现成一个 `IConfigStore` port + 一个 `IndexedDBConfigStore` 适配器（`localforage` 已在依赖里）。
2. **接口形态尽量与原来一致**（因为 1211 处调用点），先保证行为等价，再谈重构。
   建议做法：先把所有调用点改成 `import { configStore } from "@/core/ports"`，
   **不要一次性改 1211 处**——按第 7.3 节的策略分批。
3. 键名与现有 localStorage/IndexedDB 里的键**保持兼容**，否则用户升级后书库会"消失"。
4. 阅读进度（`recordLocation` / `recentBooks` 这类语义）属于 `ConfigService` 的范畴，
   迁移到 `IReadingProgressStore` port，**位置数据结构用我们自己的 `Location` 类型**（见 4.3 第 12、13 条）。

### 6.2 `HighlightUtil`（14 个成员）

分三类高亮的"取值 / 存值 / 构造样式"：`note`（笔记）/ `search`（搜索命中）/ `tts`（朗读逐字）。
成员：`getHighlightValue` / `saveNoteHighlightValue` / `saveSearchHighlightValue` / `saveTtsHighlightValue`
/ `getNoteHighlightValue` / `getSearchHighlightValue` / `getTtsHighlightValue` / `formatHighlightValue`
/ `convertNumberToHighlightValue` / `buildHighlightPreviewStyle` / `buildHighlightStyle`（4 个变体）。

**设计要求**：

1. 先弄清"HighlightValue"到底是什么（大概率是"当前章 + 若干字符偏移"的压缩编码），**从调用点反推语义**，
   再定义我们自己的类型。**不要照抄它的字符串格式**——除非发现它被持久化在用户数据里。
2. 与 4.3 第 14 条强相关：内核要的是 **rangy 字符范围 + `background-#RRGGBB`**，
   而我们的领域层应该用**自己的锚点模型**（章索引 + 字符区间 + 文本指纹），在适配器里做双向转换。
3. 高亮颜色在深色主题下**必须给低亮度色**（内核会把颜色包成 `rgba(色, 0.8)` 叠在正文上，
   浅色块配浅色字会糊掉）。

### 6.3 `SqlStatement`（3 个成员）

`jsonToSqlite` / `sqliteToJson` / `sqlStatement`。用于书籍数据的导入导出与同步。

**设计要求**：

1. 先搞清它导出的数据格式（HTML/MD 等"可读格式"的书籍数据是纯 JSON，还是 SQL 文本）。
2. 我们只需要**自己的一个序列化格式**（建议直接 JSON + 版本号），**不要复刻 SQL 文本**——
   网页端不需要 SQLite。
3. 必须考虑**向后兼容**：老用户的导出文件可能已经是旧格式，导入时要能识别并转换。

### 6.4 `CommonTool`（8 个成员）

| 成员 | 处理 |
| --- | --- |
| `arrayBufferToBase64` / `base64ToArrayBuffer` | 自写（十几行） |
| `generateSHA256Hash` | 自写（用浏览器 `crypto.subtle`） |
| `getMimeType` | 自写（一个映射表） |
| `configList` / `databaseList` | 数据表/配置项的清单常量，自写 |
| `EmailProviders` | 邮箱服务商清单（用于"发送到 Kindle"之类），若无该功能则删 |
| `getDisableThinkingParams` | 上游 AI 参数，**删** |

### 6.5 明确**不实现**（直接删除相关功能与调用点）

| 符号 | 是什么 | 处置 |
| --- | --- | --- |
| `TokenService`（4 个成员，54 处调用） | `getFingerprint`（**设备指纹**）/ `getToken` / `setToken` / `deleteToken` | **删**。这是本项目最需要切断的东西之一 |
| `ReaderRequest`（12 个成员） | 上游 AI：`analyzeText` / `detectLanguage` / `getAnswerFetch` / `getBatchTrans` / `getDictionary` / `getOcrResult(V2)` / `getSplitSentence` / `getTransFetch` / `getTTSAudio` / `getBookMetadata` | **删**。但⚠️ **要分清双分支**：翻译/词典/问书三个弹窗各有一条"用户自带模型"的分支（`chatStream`）**必须保留**——见 [`AI-AND-TTS-KEEP.md`](./AI-AND-TTS-KEEP.md) |
| `KookitConfig.AiProviderList` / `DefaultPrompts` / `CommonTool.getDisableThinkingParams` | 黑盒里的 AI 供应商表、默认提示词、"关闭思考"参数 | **自写**（成本极低，是一张数据表 + 一个 switch）。见 `AI-AND-TTS-KEEP.md` 3.3 |
| `UserRequest` | 上游账号接口 | **删** |
| `ThirdpartyRequest` | 第三方登录/网盘中转 | **删** |
| `LoginHelper` | 登录流程 | **删** |
| `SyncUtil` / `SyncHelper`（8 个成员） | 网盘同步（WebDAV/S3/网盘…） | **删**。若将来要做同步，只做我们自己的共读协议 + 可选的 WebDAV 直连 |
| `NoteSyncManager` / `WordSyncManager` | 云笔记/生词同步 | **删** |
| `KOReaderUtil` | kosync 协议客户端 | **删**（如将来要做墨水屏互通再独立立项） |

> ⚠️ 删除时注意：这些符号被大量文件 import，**直接删会连锁编译失败**。
> 建议做法：先建 `src/core/ports/index.ts` 提供**空实现/抛错实现**（`NotSupportedError`），
> 让编译先过，再逐个功能决定是"隐藏入口"还是"替换实现"。**不要为了过编译而留假实现上线。**

### 6.6 要保留（**属于 kookit，不要误删**）

- `BookHelper`（`getRendition` / `generateBook`）
- `StyleHelper`（`getDefaultCss`）
- `Kookit` 命名空间（各 Render 类）

这三个来自 `kookit.min.js`，**不是 `kookit-extra`**。替换内核后它们由我们自建的 vendor 提供。

### 6.7 共读功能（我们自己写的，重点保护）

- `src/utils/collab/`（4 个文件）—— **实测零 `kookit` 依赖**：只 import 自己的 client、`react-hot-toast`、`dompurify`。
- `collab-server/server.js` + `verify-server.js`（零依赖 Node）—— 服务端，本副本已包含代码，
  但**部署配置（nginx / docker / Caddy）已按安全要求剥离**，不在本副本内。
- 共读入口 UI：`src/containers/collabPanel/`、`src/containers/cloudLibrary/`、
  `src/components/roomImportButton/`、`src/components/doodleLayer/`。
- ⚠️ 例外：`src/utils/file/doodleUtil.ts`（涂鸦持久化）**依赖 `ConfigService`**，
  在 6.1 完成后要改为走新的存储 port。
- 服务端地址一律**由用户运行时填写**（存在 localStorage），**不许硬编码**。
  当前 UI 里的示例占位已改为 `https://your-server.example.com`。

#### 6.7.1 ⚠️ 打包方向的两个硬要求（本期的产品形态就是打包客户端）

本期的交付形态是 **Windows 客户端（Electron）+ 安卓 APK（Capacitor）**，
共读服务器由**用户/团队自己部署**。这带来两个**必须在重构阶段解决**的问题：

**① 共读 token 必须是运行时设置项（现在不是）**

现状：`src/utils/collab/collabClient.ts` 的 `token` 来自 **构建期注入** 的
`process.env.REACT_APP_COLLAB_TOKEN`（`roomBook.ts` 的 `collabAuthHeaders()` 是唯一真源，
读的是 `collabClient.token`）。而服务端 `COLLAB_TOKEN` 是**部署方自己设的**。

后果：**用户没法在应用里填自己的 token** ⇒ 服务端一开 token 校验，客户端就写不进任何东西（401）；
唯一的绕法是"我们为每个团队单独打一个包"——这不可接受。

要求：把 token 变成**与服务器地址同级的运行时设置**（同一个设置卡、同一份 localStorage、
同一个解析函数），并保留 `REACT_APP_COLLAB_TOKEN` 作为构建期默认值（优先级低于用户设置）。
服务端地址的既有实现（`src/utils/collab/collabServerConfig.ts`）就是模板，照它再做一个即可。

**② 打包客户端的 Origin 必须能进服务端白名单**

客户端里页面不是从用户服务器上加载的，因此对共读服务是**跨域**：

| 客户端 | 页面 origin | 是否受 CORS 约束 |
| --- | --- | --- |
| Windows（Electron） | `file://` ⇒ 请求头 `Origin: null` | ❌ 不受（`main.js` 里有 `webSecurity: false`） |
| 安卓（Capacitor） | `https://localhost` | ✅ 受，**必须配白名单** |

服务端环境变量是 **`COLLAB_ALLOWED_ORIGIN`（单数，值是逗号分隔的多来源）**——
⚠️ 名字是单数但支持多值，别写成复数（写成复数 = 读不到 = **一条 CORS 头都不发** = 安卓端全挂）。
建议部署时写成：`null,https://localhost,http://localhost,capacitor://localhost`
（后三个都写上是为兼容不同 Capacitor 版本的 `androidScheme`；写成 `*` 只用于排查）。

> 这两条是"能不能不靠托管网页就跑起来"的前提。**在 Phase 1 就要把它们纳入范围**，
> 否则 Phase 6 打包时会发现产品模型走不通、被迫回退到"我们托管一个网页"。
> 客户端侧还要保证：用户填了地址就够了（未填 = 本地阅读器模式），**不要**再要求任何构建期配置。

---

## 7. 分批计划

> 原则：**每一阶段都要能跑起来、能验收**。宁可阶段小，不要出现"改到一半编译不过"的状态。
>
> **并行轨道**：移动端阅读体验（[`MOBILE-UX-PLAN.md`](./MOBILE-UX-PLAN.md)）**不属于 Phase 0–6**，
> 是一条独立轨道 —— 建议在 **Phase 1 切断完成之后**开始（那时源码干净、不会被删除工作反复打断）。
> 注意：本副本内做的是**Web 层的移动端体验**，**打包（Capacitor/Electron）不在本副本**。

### Phase 0：把地基搭平（先做，不要跳）

- 建 `src/core/{domain,ports,usecases,adapters}` 空目录与依赖方向约定。
- 搭第 4.5 节的 harness（独立验证页 + 无头断言脚本）。
- 跑通基线：`npx tsc --noEmit` 通过；`npm run build` 成功（用 `BUILD_PATH` 输出到临时目录，见第 9 节）。
- **产出**：一份"当前基线"记录（构建产物哈希、自检扫描结果、能跑的功能清单）。
- **禁止**：本阶段不改任何业务代码。

### Phase 1：切断（做减法，允许少功能）

- 执行第 5.2 / 5.3 的删除与清零：黑盒、上游 API 层、账号/登录/同步/客服/更新通道全部下线。
- 建 `ports` 层的**空实现**，让编译通过；相关 UI 入口**隐藏或置灰并提示"该功能已移除"**。
- 关闭所有会外联的运行时路径（OCR、在线字体、官方 TTS、通知、元数据联网）。
- **验收**：
  1. `npm run scan` → **0 命中**（这是硬门槛）；
  2. `npx tsc --noEmit` 通过；
  3. `npm run build` 成功；
  4. 用浏览器开发者工具确认：**打开一本本地书、翻页、加书签的过程里，Network 面板没有任何非 CDN 的外部请求**。
- **禁止**：本阶段不要动渲染层实现（内核还是用现有 `kookit.min.js`）。

### Phase 2：内核换代

- 用 `vendor/kookit/` 自建 vendor bundle，替换 `src/assets/lib/kookit.min.js`。
- 写 `adapters/render/kookitLoader.ts`（保证 `pdfjsLib` 注入顺序）+ `kookitRenderAdapter.ts`。
- 按 4.3 逐条验证契约，跑 harness 行为回归（对照 Phase 0 的基线）。
- **验收**：EPUB / MOBI / AZW3 / TXT / PDF 五格式的"打开-翻页-记录位置-高亮"全部通过 harness；App 内手工验证一致。
- **产出**：`src/assets/lib/kookit.min.js` 可以删除了（在此之前一直留着当基线）。

### Phase 3：配置与存储自写

- 实现 `IConfigStore` + IndexedDB 适配器，替换 `ConfigService`（1211 处调用**分批**替换，见 7.3）。
- 实现阅读进度、书库、书签、笔记的存储 port。
- **验收**：老数据能读出来（键名兼容）；重启后进度不丢；`tsc` 干净。

### Phase 4：高亮与笔记自写

- 实现 `HighlightUtil` 的领域模型 + 适配器转换（见 6.2）。
- 打通"选区 → 高亮 → 重开书自动回挂 → 切章重挂"完整链路。
- **验收**：文字类与 PDF 两类都要过；深色主题下颜色可读。

### Phase 5：功能补齐与打磨

- 补回 Phase 1 里"暂时下线"的本地能力（如本地词典、本地 TTS 视情况）。
- 共读（collab）功能接入新架构。
- **验收**：共读房间端到端可用（建房 / 入房 / 位置同步 / 跟随领读可开关 / 涂鸦）。

### Phase 6：性能与验收

- 大书（1000+ 页）键盘连续翻页不卡；大书库（500+ 本）滚动不卡。
- 补第三方许可证声明（见第 8.5 节）。

### 7.3 「1211 处调用」怎么改才不失控

**不要全局替换。** 建议：

1. 先建 port 与本项目自己的 `stores.ts` 统一出口；
2. 按**模块**分批（一次一个 `containers/xxx` 或 `components/xxx`），每批独立提交、独立验证；
3. 每批只需要保 `tsc` 干净 + 该模块功能可用；
4. 允许新旧实现**短期共存**（旧的黑盒 → 新的 port），但**每次提交只能减少旧实现的引用数**。

---

## 8. 安全与脱敏

### 8.1 绝不允许出现在仓库里的东西

- 任何**真实公共 IP**、自有域名、自有端口
- 任何**账号 / 密码 / token / API Key / 私钥**
- 任何**本机绝对路径**（Windows 用户目录、Unix home 目录、开发机的任意盘符路径）
- 任何**真实邮箱**（除 `example.com` 与 `users.noreply.github.com`）
- 任何**部署配置**（nginx / docker-compose / Caddy / 证书）

> 上面第一条与本条刻意**不写字面示例**——写了字面形态，`npm run scan` 会命中本文件（实测过）。
> 需要看具体长什么样，直接读 `tools/scan-sensitive.mjs` 里的正则。

示例地址只允许：`example.com`、`.example.com`、`.invalid`、私网段（`127.0.0.1` / `192.168.x.x` / `10.x.x.x`）、
以及 RFC 5737 文档网段（`192.0.2.x` / `198.51.100.x` / `203.0.113.x`）。

### 8.2 自检脚本

```bash
npm run scan          # 等价于 node tools/scan-sensitive.mjs         ← 提交门槛
npm run scan:all      # 等价于 node tools/scan-sensitive.mjs --include-vendor
```

- 退出码 `0` = 干净；`1` = 有命中（列出了文件:行）。
- `npm run scan` 跳过：`node_modules` / `build` / `.git` / `public/lib/` / `vendor/` / `*.min.js` / 依赖锁文件，
  并会**明确打印跳过了多少个文件**（别把"跳过了"当成"扫过了"）。
- `npm run scan:all` 把 `vendor/` 与 `public/lib/` 也纳入扫描。**结果只作参考，不是提交门槛**——
  这两个目录是第三方固化源码，内部天然含上游自己的 CDN 与作者本机路径；
  它们的处置见 5.4 节，**不要为了让它变干净去改写上游内核源码**。
- 想追加本项目专属的封禁串（比如"绝对不许再出现的历史域名"）：
  建 `tools/banned-hosts.json`，内容是一个字符串数组。**只放"不该出现的东西"，不要放真实凭据。**

### 8.3 `.gitignore` 约定

已写入，要点：`node_modules` / `build` / `dist` / `coverage` / `.env.local` / `HANDOVER*.md` /
`.local-books/` / `books/` / `rooms/` / `doodles/` / `data/` / 各类本地工具目录 / 日志。
**如果你新增了本地数据目录或密钥文件，必须同步加进 `.gitignore`。**

### 8.4 提交前检查表（每次提交都过一遍）

- [ ] `npm run scan` → 0 命中
- [ ] `npx tsc --noEmit` → 无错误
- [ ] `npm run build` → 成功
- [ ] 本次改动没有引入新的外部网络请求（除非是公开 CDN）
- [ ] 没有新增 `TODO: 临时/先这样` 的假实现留在主路径上
- [ ] commit message 用中文，说明**为什么改**和**验证结论**

### 8.5 上线前必须补：第三方许可证声明

kookit 内联了多个第三方库（`jszip`（MIT OR GPL-3.0，选 MIT）、`rangy`、`mammoth`、`marked`、
`mhtml2html`、`fflate`、`@zip.js`、`chardet`、`js-untar`，以及内联的 `epub.js` / `pdf.js`）。
发布前需要一份第三方声明文件（名称 / 版本 / 许可证 / 出处），
其中 **PDF.js 是 Apache-2.0**、**foliate-js/epub.js 需逐个确认**。
**AGPL-3.0 项目本身必须开源，声明文件是额外义务，不能互相替代。**

---

## 9. 验收标准（可执行）

```bash
# 1. 类型检查
npx tsc --noEmit
# 期望：无输出，退出码 0

# 2. 生产构建
#    ⚠️ BUILD_PATH 必须指向一个"尚不存在"的临时目录，否则可能因清理旧产物而失败
BUILD_PATH=./tmp-build-$(date +%s) GENERATE_SOURCEMAP=false npm run build
# 期望：Compiled successfully

# 3. 敏感信息自检
npm run scan
# 期望：✅ 未发现敏感信息，退出码 0

# 4. （服务端，可选）共读服务端自测
node collab-server/verify-server.js
# 期望：全部通过、0 失败
```

**功能验收（Phase 5 结束时）**：本地书导入 / 打开 5 种格式 / 翻页与进度记忆 / 书签 / 高亮与笔记 /
目录跳转 / 搜索 / 深色主题 / 共读房间端到端 / 跟随领读可开关。

> ⚠️ **如果你跑不了这些命令**（例如你是纯对话式助手、没有 shell）：**不许假装验证过**。
> 每条改动都要标注"未能编译/未跑测试"，并把上面这几条命令交给果冻执行。见 [`GEMINI.md`](./GEMINI.md)
> 「如果你跑不了命令」一节。

---

## 9.5 打包就绪约束（本期的**交付形态就是打包客户端**，重构期间不许破坏这些）

本期不是"托管一个网页给用户访问"，而是 **Windows 客户端 + 安卓 APK**，
共读服务器由用户/团队自建。这意味着 `build/` 是**唯一交付产物入口**：

```
npm run build  →  build/   ┬→ Electron 打包收 build/**/*（Windows 客户端）
                           ├→ Capacitor 的 webDir 收 build/（安卓 APK）
                           └→ 纯网页形态仍可跑，但不再对外托管（只作开发与自测）
```

**硬约束：**

1. **不许改构建流程与输出目录** —— 继续用 `react-scripts build`，产物继续落 `build/`。
   不要为了"优化"引入 Vite / 自定义 webpack / 改 `webDir`（那会让两个打包链同时返工）。
2. **资源一律相对路径** —— 打包端页面是 `file://` / `https://localhost`，
   绝对路径（`/static/...`）会 404。现有配置依赖 `homepage: "./"`，别把它改成 `/`。
3. **前端不许用 Node API，也不许新增原生模块依赖** —— 安卓端没有 Node，
   Windows 端虽然有，但用了就断掉安卓。新依赖必须先确认"纯浏览器可用"。
4. **不许把"同源"当业务前提** —— 打包端没有同源服务器。
   唯一允许读 `window.location` 的地方是共读地址解析（`collabServerConfig` 的形态分支），
   且必须保持"打包端不兜底同源"的行为。**其他任何地方都不许再引入同源假设。**
5. **三种形态都要能跑**：`npm start`（开发）/ Electron / 安卓 WebView。
   涉及 PDF.js worker、wasm、blob URL、iframe 的改动，三种形态都要各测一遍（见第 4.3 节第 3、5 条）。
6. **共读两个硬要求**见 6.7.1（token 运行时化、客户端 Origin 进白名单）—— **Phase 1 就要排进去**。

> ⚠️ 与打包链有关的文件（`package.json` 的 `build` 段、`main.js`、`capacitor.config.ts`、
> `android/`）**不在本副本内**，所以你在本副本里的任何改动都**不要**假设能顺手改打包配置；
> 需要动它们时告诉果冻。

---

## 10. 工作方式约定（与果冻协作）

**先看一条总原则：视觉与交互**（UI、布局、配色、移动端外壳、文案）**果冻已明确授权自由发挥，
不必逐条请示**；**契约、数据、许可证、打包约束才是必须守住的**。
详细的"能自由做什么 / 必须守什么 / 不许动什么"，见 [`GEMINI.md`](./GEMINI.md) 的
「你有多少自由度」一节。**本节只讲做事节奏。**

1. **一次一个需求**，一次提交。不要在一个提交里混合"重构 + 新功能"。
2. **中文 commit**，格式 `type(scope): 标题`，正文写清**为什么改**与**验证结论**。
3. **先跑通，再讲原理**：任何改动都要给出可执行的验证命令与期望输出，不要只说"应该没问题"。
4. **不确定就问，不要猜**：尤其是内核行为（第 4.3 节）、数据兼容性、许可证判断。
   （注意：**视觉审美不属于"不确定"**，那一条你自己定。）
5. **视觉改动要在提交信息里写清改了哪些界面/哪些文件**：果冻无法靠测试发现视觉变化，
   需要一份"该去看哪里"的清单。**不要求他先批准，只要求他能回看。**
6. **跑不了命令就明说**：如果你没有 shell 执行能力，禁止假装验证过，
   必须标注哪些改动未经验证，并给出果冻可自行执行的命令（见第 9 节）。
7. **不要把"暂时下线的功能"偷偷删干净**：应该保留入口并提示"已移除"，或者明确列出清单交给果冻决定。
8. **遇到需要"编造事实"才能继续的时候停下来**：告诉他缺什么信息。

---

## 11. 附录 A：术语表

| 术语 | 含义 |
| --- | --- |
| **kookit** | Koodo Reader 的渲染内核，独立 AGPL 仓库，本项目的解析能力来源 |
| **kookit-extra** | 无源码的上游配套包（配置/账号/云/AI）。**本项目要彻底摆脱的东西** |
| **rendition** | 内核的渲染实例对象（`renderTo` / 导航 / 位置 / 事件） |
| **chapterDocIndex** | 内核的位置主键：**渲染节索引**（注意 ≠ 目录项索引） |
| **CFI** | EPUB 的标准定位语法。内核内联了其实现，但**笔记高亮实际用的是 rangy 字符范围** |
| **rangy 字符范围** | 内核高亮的载体，可序列化为 JSON 字符串 |
| **宿主容器** | 承载内核 iframe 的滚动容器，**必须有 `id="page-area"`** |
| **port / adapter** | 六边形架构里的接口与实现，本项目用来隔离内核 |
| **扫描版 PDF** | 没有文字层的 PDF（图片），需要 OCR |

## 12. 附录 B：关键文件地图（重构后建议的样子）

```
src/core/domain/                 纯模型：Book / Note / Bookmark / Location / ReaderMode
src/core/ports/                  接口：IConfigStore / IRenderService / INoteStore / IHighlightService ...
src/core/usecases/               用例：openBook / turnPage / saveNote / applyHighlight ...
src/core/adapters/render/        kookitLoader.ts / kookitRenderAdapter.ts / pdfjsSetup.ts
src/core/adapters/store/         IndexedDB 适配器（localforage）
src/ui/                          现有 pages / containers / components 逐步迁入
src/vendor/kookit.esm.js         由 vendor/kookit 自建的产物
```

## 13. 附录 C：本副本故意**没有**给你的东西（不要去找，也不要试图补）

| 缺席的东西 | 原因 |
| --- | --- |
| `.git` 历史 | 原始仓库的历史里有需要彻底丢弃的服务器信息（详见果冻）。本副本从零开始 |
| `HANDOVER*.md` | 内部交接笔记，含真实服务器信息 |
| `docs/`（大部分） | 内部规划与体检报告，含部署细节 |
| `Caddyfile` / `docker-compose*.yml` / `Dockerfile*` / `.env` | 部署配置 |
| `main.js` / `capacitor.config.ts` / `android/` | 桌面 Electron 与安卓外壳，本期不重构 |
| `httpserver/` / `scripts/` | 本地调试与辅助脚本 |
| `.github/` | CI 配置指向上游，且含上游发布流程 |
| `.local-books/` / `books/` / `rooms/` / `doodles/` | 本地书籍与房间数据 |
| `assets/icons/*.ico/.icns` | 桌面与移动端图标（品牌资产已保留在 `assets/`） |

**如果重构过程中需要参考原始仓库的某个文件，请让果冻提供，不要自己去找镜像或历史。**

---

## 14. 最后：如果你只记得三件事

1. **kookit 是内核（有源码，`vendor/kookit/`），`kookit-extra` 是要摆脱的黑盒。**
2. **动渲染之前先读第 4.3 节**——内核的失败方式大多是静默的，且有几条硬编码契约不遵守就直接不工作。
3. **任何面向公网的提交前，`npm run scan` 必须 0 命中。**
