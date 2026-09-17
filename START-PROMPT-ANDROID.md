# CoRead 安卓前端重构 —— AI 接手方启动提示词

> **用途**：人类把下方分隔线以内的**正文整段**复制给接手的 AI（Gemini）。
> 本文件只是存档，方便复用与追溯；**AI 不需要先读它** —— 正文本身已经把人领到该去的地方。
>
> **配套**：通用重构交接见 [`START-PROMPT.md`](./START-PROMPT.md)（Phase 0–6 那套）。
> 本文是**专项**：只做安卓（Capacitor）下的前端重构。
>
> 写于 2026-09-17。**当时的事实**：分支 `android`，最后一笔见 `git log`。

---

你是 **CoRead** 这个项目的接手开发者，这次的任务是：**为手机用户重新设计安卓端的前端**。

这不是从零开始的项目，**仓库里已经有大量交接文档**。但这次任务很具体，而且**已经有一批现场证据**——
下面会给你。请先读完本文，再读那几份文档，然后**先测量、再动手**。

---

## 〇、最重要的一条：**手机端不是"把桌面端缩小"**

请你把这一条当成整个任务的定调，它比后面任何细节都重要。

> **桌面端是你的「素材库」和「视觉参考」，不是「结构模板」。**

现有的手机端之所以难用，根子就在这里：它是在**桌面布局上打补丁**打出来的
（把 760px 的弹窗硬改成 `calc(100vw - 16px)`、把搜索框写成 `calc(100vw - 225px)`……），
**信息架构还是桌面那一套**。补到最后就是现在这样：控件出屏、尺寸畸变。

**所以你有权——并且被鼓励——推翻移动端的信息架构本身。** 具体说：

- 桌面端**左侧**的常驻导航栏，在手机上移到**最下方**做成 tab bar —— **这是对的方向，放手做。**
- 桌面端的侧边面板、桌面式弹窗，都可以改成手机上合理的形态（底部 sheet / 全屏页 / 抽屉）。
- 桌面端靠 **hover** 才能触发的交互，在手机上**根本没有意义**，该换方式就换。
- 一个界面在手机上放不下，可以**拆成两级页面**，不必硬塞。

**判断标准只有一条：一个手机用户，单手握着手机，能不能顺畅用完全部功能。**

⚠️ 但有两件事**必须保持一致**，见第三节（视觉语言 / 数据契约）。**一致的是"看起来像同一个产品"，
自由的是"怎么组织、怎么操作"。** 别把这两件事搞混。

---

## 一、开工前先确认你在哪个分支

安卓相关的全部工作在一个**独立分支 `android`** 上（`main` 上没有安卓壳）。

```bash
git branch            # 应当看到 * android
```

没有的话：`git fetch` → `git checkout android`。**不要在 `main` 上做这次的工作。**

## 二、项目是什么（自包含简介，30 秒版）

- **CoRead** = 多人共读阅读器的网页端，从上游 **Koodo Reader 的定制分支**裁剪、脱敏而来，
  许可证 **AGPL-3.0**（因为用了渲染内核 `kookit`）。**不允许闭源、不允许换许可证。**
- 技术栈：**React 18 + TypeScript + Redux + CRA(react-scripts 5)**，class 组件为主。
  渲染内核 `kookit` 是 vendor 进来的（`vendor/kookit/` 有 TypeScript 源码，
  `src/vendor/kookit.esm.js` 是压缩产物）。
- **一份 `build/` 产物，三种外壳**：

  | 形态 | 怎么起 | 页面 origin |
  | --- | --- | --- |
  | 开发 | `npm start` | `http://localhost:3000` |
  | 桌面 | Electron（`main.js`） | `app://coread`（自定义协议） |
  | **安卓** | **Capacitor 8.4.1（`android/`）** | **`https://localhost`** |

- 后端是**用户自己部署**的共读服务器，代码就在仓库里：`collab-server/server.js`（Node，零依赖）。
- **前端运行时不许硬编码任何我们自己的服务器地址**（红线，见 `GEMINI.md`）。

## 三、先读什么（顺序别换）

1. **`GEMINI.md`** —— 入口。六条红线、自由度边界、最容易踩的坑。
2. **`MOBILE-UX-PLAN.md`** —— 移动端专项：内核 `isMobile` 开关、已做了什么、还剩什么。
   读的时候注意它的定位声明：**它是方向参考，不是验收标准；外观与交互由你自由发挥。**
3. **`REFACTOR-BRIEF.md`** —— 总纲。**动渲染层之前必须读第 4.3 节（内核 17 条硬编码契约）**。
4. 要删任何东西之前 → **`AI-AND-TTS-KEEP.md`**（`src/utils/request/common.ts` 是混装文件，
   整目录删 = AI 问书 / 翻译 / 词典三个功能全废）。
5. 打包与出包 → **`ANDROID.md`**。

## 四、问题是什么（项目所有者「果冻」的实测反馈，原话）

> 「这个 apk 我在手机上实测了一下，有问题，**兼容性不对**，**好多按键都在屏幕外**，
> **大小也奇奇怪怪**，也就是说**手机端的前端需要进行重构**，
> 但是要**和电脑端保持配色和一些动感上的一致**。
> 并且要保证**前端和后端对接是稳的**，**功能都是可用的**。」

拆成四条：

1. **有控件跑出屏幕外**（点不到 = 功能不可用，最严重）。
2. **尺寸比例失常**（该大的小、该小的大）。
3. **要重构**，但**配色与动效观感要和桌面端一致**。
4. **功能要真的能用**，尤其与共读服务器（后端）的对接要稳。

## 五、根因（我已查过，有代码级证据 —— 但**你要自己复核**）

**结论：现有的"手机适配"不是一套响应式系统，而是一堆按具体宽度调出来的像素魔法数字。**
它是「在桌面结构上打补丁」，不是「为手机做设计」。

| # | 位置 | 事实 | 为什么在手机上炸 |
| --- | --- | --- | --- |
| 1 | `src/containers/header/header.css:232` | 窄屏搜索框 `width: calc(100vw - 225px) !important`、`margin-left: 60px !important`、图标行 `right: 70px` | 在 360px 屏上搜索框只剩 **135px** —— "大小奇奇怪怪"的实证。这些常数是按**某一个宽度**量出来的 |
| 2 | `src/pages/reader/index.css:472` vs `:210` | 容器 `top: calc(100vh - 60px - env(safe-area-inset-bottom,0px))`，且写死 `height: 60px` | 里面 `.progress-panel`（`progressPanel.css:177`）是 `min-height: 100px` 的**三行**面板 ⇒ **容器与内容高度对不上** |
| 3 | `src/pages/reader/index.css:212` | 用 **`100vh`** 而非 `100dvh` | 安卓 WebView 上 `100vh` 不跟随可视区（软键盘、系统栏），必然算错 |
| 4 | 多个对话框 | 写死宽度：`settingDialog.css:2` **760px**（还有 `left: calc(50% - 380px)`、`height: 540px`）、`popupMenu.css:6` 500px、`loadingDialog.css:2` 454px、`opdsDialog.css:124` 454px、`editDialog.css:2` / `metadataDialog.css:2` 380px、`addDialog.css:2` 309px、`deleteDialog.css:2` 319px | 760px 宽的对话框在 360px 屏上，`left` 直接算成 **−200px**，左侧整栏跑到屏幕外 |
| 5 | 断点不一致 | 主流用 **570px**，但 `popupMenu.css:34` 用 **576px** | 570–576px 之间是两个断点的缝，行为不可预测 |
| 6 | `src/containers/cloudLibrary/cloudLibrary.css:857` | 570px 块**只**覆盖了几个零散子元素 | **书架主布局（侧栏 + 网格 + 分页）根本没适配** |
| 7 | 全局 | `src/` 下**没有任何 `:root` 定义**；`--main-color` / `--background-color` / `--second-text-color` 只在 CSS 里被**消费**（带 fallback），**赋值来自渲染内核 `kookit`**（`src/vendor/kookit.esm.js`） | **配色真源在内核**。你的移动端外壳要么复用它、要么自己补一套，不能各自拍脑袋 |

**另外三个结构性事实，重构时必须知道：**

- **正文是渲染在 iframe 里的**（内核控制），**不是**直接受你的 React 组件 CSS 影响。
  ⇒ 「壳」和「正文」是两套样式，改壳的 CSS 不会影响正文排版。
- **左侧导航栏的现状与牵连**：`.sidebar` 宽 190px（菜单容器 210px）。
  有一个 `isNavLocked`（侧栏常驻）状态，会把一批面板**整体右推 300 / 305 / 307 / 309px**
  （见 `containers/pageWidget/component.tsx:99`、`components/background/component.tsx:106,122,183`、
  `components/popups/popupBox/component.tsx:157`）。
  ⇒ **如果你把导航改到底部（推荐），这套偏移在移动端就完全无意义了，要一并处理**，
  别留下"移动端还在给一个不存在的侧栏让 300px"这种死逻辑。
- 有些适配注释直接写着"不再溢出屏幕"（`header.css:231`）——
  说明这是**逐次打补丁**打出来的，专门针对当时看到的那个宽度。

## 六、🔴 第二件事（仅次于第〇节）：先测量，不要先动手

`MOBILE-UX-PLAN.md` 里已写明的原则同样适用于你：**不许把"印象"写成"事实"。**
我上面那张表是**代码层面**的证据，但**"手机上的实际视口宽度、断点到底有没有生效"
我无法确认（开发机没有安卓设备）**。

**动手改代码之前，先在真机 APK 上测出这几个数**（加一段临时诊断，或让人类用
Chrome 远程调试 `chrome://inspect` 看 Console）：

```js
console.log({
  innerWidth: window.innerWidth,               // 布局视口宽度（媒体查询看的就是它）
  clientWidth: document.documentElement.clientWidth,
  dpr: window.devicePixelRatio,
  visualW: window.visualViewport && window.visualViewport.width,
  visualH: window.visualViewport && window.visualViewport.height,
  screen: [window.screen.width, window.screen.height],
  is570: window.matchMedia("(max-width: 570px)").matches,   // 断点到底生效没有？
  is576: window.matchMedia("(max-width: 576px)").matches,
  capacitor: !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()),
});
```

**两种结果，影响完全不同：**

| 结果 | 说明 | 你要做的 |
| --- | --- | --- |
| `innerWidth` 在 360–430，`is570 === true` | 断点**生效**，问题是那堆像素魔法本身算错 | 按第〇/七节**放手重设计** |
| `innerWidth` 明显偏大（例如 ≈980）或 `is570 === false` | 断点**根本没生效**，布局视口不对 | **先解决视口问题**（`public/index.html` 的 viewport / Capacitor 的 `androidScheme`）——**否则任何基于媒体查询的设计都不会生效**。这属于 `capacitor.config.ts` / `android/` 范畴，**先告诉人类再动手** |

> 💡 **顺带一个稳妥做法**：正因为断点可能不可靠，**强烈建议你的移动端布局不要只靠 CSS 媒体查询，
> 而是用运行形态判定做条件渲染**——项目里现成有这个函数：

```ts
import { isMobileRuntime } from "../../utils/mobileRuntime";
// 安卓壳 / 手机浏览器 → true；桌面 Electron / 桌面浏览器 → false
```

> 它是**实测通过**的基础设施（详见第七节 C 条）。用它来决定"渲染哪套布局"，
> 比 `@media` 更稳，也让结构级分叉变得自然。

## 七、约束：**分三层，别搞混**

这是全文最容易做错的地方。请把三层分清：

| 层 | 内容 | 桌面端 | 手机端 |
| --- | --- | --- | --- |
| **① 视觉语言** | 配色、主色、品牌色、圆角风格、阴影质感、**动效的时长与缓动** | 保持 | 🔒 **必须与桌面端一致**（果冻明确要求） |
| **② 信息架构 / 布局 / 交互** | 导航形态、页面组织、面板形态（弹窗 vs 全屏 vs 底部 sheet）、手势、层级 | 🔒 **不许改坏** | 🆓 **自由重设计，鼓励推翻** |
| **③ 数据与契约** | 内核 17 条契约、共读协议、存储格式、业务语义 | 🔒 不许动 | 🔒 不许动 |

一句话：**一致的是"看起来像同一个产品"，自由的是"怎么组织、怎么操作"。**

### A. ① 视觉语言：怎么做到"一致"

- **配色**：读 `src/assets/styles/global.css` 与各组件 CSS，**以及内核下发的 CSS 变量**。
  现有主色是 `#4b89ff`（`--main-color` 的 fallback）。
  **不要引入新的主色体系**，不要换视觉调性（现在是清爽的浅色 + 蓝色点缀）。
- **动感（动效）**：项目现有关键帧共 18 个，**优先复用同一套动效语言**：
  `fade-up / fade-down / fade-left / fade-right / fade-in / slide-up / slide-down /
  slidein / slide-down-rotate / popup / popout / paging / spin / rotate /
  clickme / collab-pulse / shortcut-pulse / cloud-book-spin`。
  桌面端的过渡时长（多为 `0.15s ~ 0.5s ease`）与缓动风格**保持一致**。
  你可以**新增**移动端需要的动效（比如底部 sheet 的上滑），但要**同一套风格**，别变成另一个 App。
- **可以**为移动端调整：点击热区（建议 ≥44px）、字号、间距、面板形态。
  **不可以**：换配色体系、换一套动效语言、把桌面端现有观感改坏。

### B. ② 结构：怎么做到"自由但不出事"

**业务逻辑只有一份，布局外壳可以分叉。** 具体讲：

- ✅ **允许**：同一个容器组件里按 `isMobileRuntime()` 返回两套 JSX；
  或抽出独立的移动端布局组件；或改信息架构（导航位置、页面层级、面板形态）。
- ⛔ **不允许**：复制业务逻辑。书的导入/解析、共读协议、存储读写、内核调用
  **只能有一处实现**。布局可以分叉，逻辑不行——否则两边会漂移，且无法维护。
- ⛔ **改完必须验证桌面端没被改坏**（桌面 Electron + 浏览器窄窗口都要看）。

### C. ③ 别改坏的既有成果（2026-09-17 刚做完，请复用而不是重写）

- **`src/utils/mobileRuntime.ts`** —— 移动端判据 + 内核 RN 桥兼容桩。**实测通过的基础设施，直接用。**
  - `isMobileRuntime()`：安卓壳 = `window.Capacitor.isNativePlatform()`；无 Capacitor 时兜底 =
    触屏且 `screen` 短边 ≤768；桌面一律 `false`。
  - `installReactNativeWebViewStub()`：内核里有 **38 处** `window.ReactNativeWebView` 调用
    （触摸翻页、滑到底、选区、双指缩放、点外链、看图片…），**安卓真机上必然触发**。
    没有这个桩会直接 `TypeError`；且 `isMobile:"yes"` 时内核会把 `console.*` 改写成桥调用，
    于是**连报错都打不出来**。桩已由 `src/index.tsx` 最前面安装，**别删**。
- **`isMobile` 内核开关已接线 5 处**（`viewer` / `cloudLibrary` / `importLocal` /
  `roomImportButton` / `moreAction`）。
  ⚠️ `utils/common.ts` 的 `preCacheAllBooks` **刻意保持 `"no"`**，**不要"顺手改成跟随"** ——
  那会让缓存与显示端行为分叉（原因写在 `MOBILE-UX-PLAN.md` 第 1 节）。
- **安全区已接**：`public/index.html` 的 `viewport-fit=cover`
  + `reader/index.css` 里的 `env(safe-area-inset-*)` 块。**留着，别删**（欢迎改进）。

### D. 技术硬约束

1. **零原生插件**：`android/app/capacitor.build.gradle` 的 `dependencies {}` 是空的，
   `MainActivity.java` 只有 3 行。**不要引入 Capacitor 原生插件**（如状态栏插件）——
   这会改变交付形态。**确实需要时先问人类**，别自己装。
2. **一份产物三种形态**：`build/` 必须同时在 `http://localhost:3000`、`app://coread`、
   `https://localhost` 下都能跑。不要用只有某一种壳才有的 API。
3. **不许反混淆内核**：`src/vendor/kookit.esm.js` 是压缩产物。
   **要读源码请读 `vendor/kookit/`（TypeScript 原文）。**
4. **不许动许可证**：根目录 `LICENSE` 保持 AGPL-3.0。
5. **不许引入 `kookit-extra*`**（无源码黑盒）。
6. **不许反编译闭源第三方 App**（如微信读书）—— 复刻手感只允许"装 App + 录屏观察"。
7. **`npm run scan` 必须 0 命中**（提交门槛）。注意：**文档里也不能写本机绝对路径**
   （会被 `win-abs-path` 抓），版本号别写成四段式数字（会被误判成 IP）。
8. **功能语义不许弱化**：共读房间、随心笔记 / 涂鸦是本产品的核心。

## 八、移动端设计方向（**例子，不是清单 —— 你可以推翻并提更好的方案**）

下面是"桌面结构 → 手机合理形态"的具体例子。它们说明**第〇节的精神**，不是待办检查表。

| 桌面端现状 | 手机上更合理的形态 | 牵连 / 注意 |
| --- | --- | --- |
| **左侧常驻导航栏** `.sidebar`（190px，菜单容器 210px） | **底部 tab bar**（书架 / 共读 / 我的 / 设置） | `isNavLocked` 会把面板右推 300/305/307/309px（见第五节）；改底部后要一并清理 |
| 右侧设置面板 `.setting-panel-container`（299px × 100vh） | **底部 sheet** 或全屏页 | 面板里已有 `.panel-close-button` |
| 左侧目录面板 `.navigation-panel-container`（299px × 100vh） | 全屏目录页 或 底部 sheet | 同上 |
| 桌面式对话框（`settingDialog` 760×540） | **全屏页 + 顶部返回**（像原生 App 的设置页） | 现有 570px 适配可参考，也可以推翻 |
| 阅读页左右边缘触发条 `.left-panel` / `.right-panel`（40px，**hover 才显**） | **删掉** | 手机上 hover 不存在，没意义；点按翻页已覆盖 |
| 悬浮页眉 `.reader-top-dock` | 点正文才出现的顶栏，或并入底部工具条 | 安卓系统返回键的交互要一起想 |
| 顶部工具栏 | **底部工具条**（单排大按钮） | 已有雏形，见 `progressPanel` |
| 划线气泡 `popupMenu`（500px 宽弹窗） | 贴选区的气泡 / 底部 sheet | E 块能力是现成的（`popupNote`/`popupTrans`/`popupDict`/`popupAssist`） |

**判断该不该改结构的几条粗筛（比上面那张表更本质）：**

- 依赖 **hover** 才能用的 → 手机上必须改。
- 靠**精确像素定位**维持的（`right: 70px` 这类）→ 必须改。
- **一屏放不下**、需要横向滚动的 → 必须改（拆两级页面 or 换形态）。
- 需要**精细瞄准**的小目标（< 44px）→ 放大或换交互方式。
- 需要**同时看到两个区域**才能操作的 → 手机上多半要拆开。

## 九、后端对接：要"稳"，必须同时满足这几条

后端 = **共读服务器**（`collab-server/server.js`，用户自己部署）。这套形态下前后端是**跨域**的，
这是最容易"看起来能跑、实际连不上"的地方。四件事：

| # | 事项 | 事实 | 你要确认的 |
| --- | --- | --- | --- |
| 1 | **CORS 白名单** | 服务器默认**一条 CORS 头都不发**，必须设 `COLLAB_ALLOWED_ORIGIN`。安卓端 origin 是 **`https://localhost`**（Capacitor 8 默认 `androidScheme: https`） | 服务器侧必须包含 **`https://localhost`**（Electron 还要 `null`）。见 `collab-server/server.js:601-604` |
| 2 | **混合内容** | `capacitor.config.ts` 开了 `allowMixedContent: true`，且 `AndroidManifest.xml` 有 `usesCleartextTraffic="true"`。因为页面是 `https://`、而共读服务器**通常是 `http://私网IP:17390`** | **两处必须同时开**（要收窄也要一起收窄）。**不要擅自关掉** |
| 3 | **地址真源** | 前端不硬编码服务器地址。真源是 `src/utils/collab/collabServerConfig.ts`：用户设置 > 构建期注入 > 同源 `/collab`（**打包客户端不算网页部署**，一律视为未配置 ⇒ 退化成纯本地阅读器） | 改动这块要**保持"未配置也能用（纯本地）"**这个语义 |
| 4 | **安卓上不可用的功能** | `src/utils/file/localFile.ts` 依赖 `showDirectoryPicker`，**安卓 WebView 没有**。已有 `"showDirectoryPicker" in window` 特性检测（`:71`）⇒ **静默降级、不是崩溃** | 要在大白话里告诉用户"手机上不能用本地文件夹"，**不要留一个点了没反应的按钮** |

**另外两个"功能可用性"风险（我查过，目前确实没处理，建议顺手做掉）：**

- **存储可能被系统回收**：全项目**没有任何 `navigator.storage.persist()` 调用**。
  安卓 WebView 的 IndexedDB 在空间紧张时可能被清理 ⇒ **用户的图书馆可能丢**。
  建议启动时请求持久化，并处理不支持的情况。
- **软键盘**：安卓软键盘弹出会顶起/遮挡底部区域。用 `dvh` + `visualViewport` 处理，
  别让输入框（跳页 / 跳章 / 搜索）被键盘盖住。

## 十、验收标准

### 手机端（结构级 —— 这是本次任务的重点）

- [ ] **任何宽度下都不出屏**。至少覆盖 320 / 360 / 390 / 412 / 430（竖）与 640 / 768 / 844（横），
      **最窄的 320px 必须过**。
- [ ] **主要入口在拇指可达区**（单手握住时能碰到），不需要换手或挪动握姿。
- [ ] 点击目标 ≥ 44×44 CSS px。
- [ ] **全站不依赖 hover**。
- [ ] 弹层是**手机形态**（底部 sheet / 全屏页），不是桌面式窄弹窗。
- [ ] 横竖屏切换、软键盘弹出，布局不炸。
- [ ] 深色主题下对比度可读。

### 桌面端（回归 —— 不许改坏）

- [ ] `npm start` 的桌面窗口 + Electron 形态，**观感与改动前一致**（配色、动效、布局）。

### 功能（都要真能用）

- [ ] 共读链路在安卓形态下可用：**填服务器地址 → 连接 → 进房间 → 看到同房间的人**。
- [ ] 核心功能：**导入书 → 打开 → 翻页（点按/滑动）→ 目录跳转 → 进度跳转 →
      划线/笔记 → 听书 → AI 问书**。
- [ ] `npm run scan` **0 命中**。

### 明确做不到的（**不许假装做过**）

- **真机验收**：开发机没有连安卓设备。触摸惯性、系统返回键与菜单抢事件、
  沉浸式遮挡、锁屏回来是否丢状态 —— **这些你测不了**。
  ⇒ 用 **Chrome DevTools 设备模拟**覆盖布局与多数交互，然后**如实标注哪些只做了模拟**，
  并给人类一份"请在真机上确认这几条"的清单。

## 十一、怎么跑、怎么验证（本机已验证可用的命令）

```bash
npm install                # 装依赖（首次）

npm start                  # 开发（浏览器里用 DevTools 设备模拟）

npx tsc --noEmit           # 类型检查（期望无输出）

npm run scan               # 敏感信息扫描（提交门槛，期望 0 命中）

npm run android:build:debug  # 出 APK（内含 build + cap sync + gradle）
#   → android/app/build/outputs/apk/debug/app-debug.apk

npm run collab:server      # 本地起共读服务器（自测后端用）
```

**构建相关的两个已知坑**（`ANDROID.md` 有详细记录）：

1. **CRA 构建前会清空 `build/`**（约 269 文件）。若你用**带批量删除保护的工具**
   （如某些 agent 环境）跑 `npm run build`，会被拦并**把 `build/` 删一半**。
   绕过：**先把 `build/` 同盘改名移走**（改名不算删除），再构建。
2. **`BUILD_PATH` 若要用，必须指向一个尚不存在的目录**，不要输出到仓库里已有的 `build/`。

**环境**（本机已配齐，换机的话照这个来）：JDK **21**（系统自带的是 25，Gradle 不认）、
Android SDK（`platforms;android-36` + `build-tools;36.0.0`）、
Gradle 8.14.3（wrapper 首次自动下载，约 5 分钟）。

## 十二、跟人怎么协作（项目所有者：果冻）

- **中文回复、中文 commit**：`type(scope): 标题`，正文写清**为什么改**与**验证结论**。
- **一次一个需求，一次提交。** 不要攒一个巨大改动，出问题无法定位。
- **结构或视觉改动要在提交信息里写清"改了哪些界面/哪些文件"** ——
  果冻无法靠测试发现视觉变化，他需要一份"我该去看哪里"的清单。
- **跑不了命令就直说**：禁止假装验证过。明确标注哪些改动**未编译 / 未跑测试**，并给出可执行命令让他自己跑。
- **需要"编造事实"才能继续时，停下来**，说明缺什么信息。
- **红线与契约问题不确定就问** —— 尤其内核行为（`REFACTOR-BRIEF.md` 4.3 节）、数据兼容性、许可证判断。

## 十三、进场请先回答我四件事

1. 你的运行环境：**能否执行 shell / 能否直接读写仓库文件 / 能否连安卓真机或模拟器**？
2. 读完 `GEMINI.md`、`MOBILE-UX-PLAN.md`、`REFACTOR-BRIEF.md` 第 4.3 节之后，
   说说你对**第五节那张根因表**的判断 —— **哪几条你认同、哪几条你觉得不对**（可以反驳，要有理由）。
3. **你会怎么重新设计移动端的信息架构？** 请具体说：
   - 主界面（书架）的导航放哪、分几层；
   - 阅读页的顶栏/底栏/设置入口怎么组织；
   - 哪些桌面形态你打算彻底换掉。
   **这一问是为了确认你理解了第〇节 —— 不要只是把桌面布局等比缩小。**
4. 给我一份**执行计划**：分几步、每步改哪些文件、每步怎么验证。
   **计划里必须包含"第六节：先测量"这一步。**

我确认后你再动手。在此之前不要改业务代码。
