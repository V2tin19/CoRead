# CoRead 安卓前端重构 —— AI 接手方启动提示词

> **用途**：人类把下方分隔线以内的**正文整段**复制给接手的 AI（Gemini）。
> 本文件只是存档，方便复用与追溯；**AI 不需要先读它** —— 正文本身已经把人领到该去的地方。
>
> **配套**：通用重构交接见 [`START-PROMPT.md`](./START-PROMPT.md)（Phase 0–6 那套）。
> 本文是**专项**：只做安卓（Capacitor）下的前端重构。
>
> 写于 2026-09-17。**当时的事实**：分支 `android`，最后一笔 `ab16f45`。

---

你是 **CoRead** 这个项目的接手开发者，这次的任务是：**把手机端（安卓）的前端重做一遍**。

这不是从零开始的项目，**仓库里已经有大量交接文档**。但这次任务很具体，而且**已经有一批现场证据**——
下面会给你。请先读完本文，再读那几份文档，然后**先测量、再动手**。

## ⚠️ 第一条：开工前先确认你在哪个分支

安卓相关的全部工作在一个**独立分支 `android`** 上（`main` 保持干净，没有安卓壳）。

```bash
git branch            # 应当看到 * android
```

如果你那里没有 `android` 分支，先 `git fetch` 再 `git checkout android`。
**不要在 `main` 上做这次的工作。**

## 一、项目是什么（自包含简介，30 秒版）

- **CoRead** = 一个多人共读阅读器的网页端，从上游 **Koodo Reader 的定制分支**裁剪、脱敏而来，
  许可证 **AGPL-3.0**（因为用了渲染内核 `kookit`）。**不允许闭源、不允许换许可证。**
- 技术栈：**React 18 + TypeScript + Redux + CRA(react-scripts 5)**，class 组件为主。
  渲染内核 `kookit` 是 vendor 进来的（`vendor/kookit/` 有 TypeScript 源码，`src/vendor/kookit.esm.js` 是打包产物）。
- **一份 `build/` 产物，三种外壳**：

  | 形态 | 怎么起 | 页面 origin |
  | --- | --- | --- |
  | 开发 | `npm start` | `http://localhost:3000` |
  | 桌面 | Electron（`main.js`） | `app://coread`（自定义协议） |
  | **安卓** | **Capacitor 8.4.1（`android/`）** | **`https://localhost`** |

- 后端是**用户自己部署**的共读服务器，代码就在仓库里：`collab-server/server.js`（Node，零依赖）。
- **前端运行时不许硬编码任何我们自己的服务器地址**（红线，见 `GEMINI.md`）。

## 二、先读什么（顺序别换）

1. **`GEMINI.md`** —— 入口。六条红线、你的自由度边界、最容易踩的坑都在这。
2. **`MOBILE-UX-PLAN.md`** —— 移动端专项：内核 `isMobile` 开关、已经做了什么、还剩什么。
3. **`REFACTOR-BRIEF.md`** —— 总纲。**动渲染层之前必须读第 4.3 节（内核 17 条硬编码契约）**。
4. 要删任何东西之前 → **`AI-AND-TTS-KEEP.md`**（`src/utils/request/common.ts` 是混装文件，
   整目录删 = AI 问书 / 翻译 / 词典三个功能全废）。
5. 打包与出包 → **`ANDROID.md`**（安卓构建，含本机环境落点）。

## 三、问题是什么（项目所有者「果冻」的实测反馈，原话）

> 「这个 apk 我在手机上实测了一下，有问题，**兼容性不对**，**好多按键都在屏幕外**，
> **大小也奇奇怪怪**，也就是说**手机端的前端需要进行重构**，
> 但是要**和电脑端保持配色和一些动感上的一致**。
> 并且要保证**前端和后端对接是稳的**，**功能都是可用的**。」

拆成可执行的四条：

1. **有控件跑出屏幕外**（点不到 = 功能不可用，最严重）。
2. **尺寸比例失常**（该大的小、该小的大）。
3. **要重构，但不是另做一套设计** —— 桌面端的**配色与动效观感必须保持一致**。
4. **功能要真的能用**，尤其是和共读服务器（后端）的对接要稳。

## 四、根因判断（我已经查过，不是猜的 —— 但**你要自己复核**）

**结论：现有的"手机适配"不是一套响应式系统，而是一堆按具体宽度调出来的像素魔法数字。**

证据（都在仓库里，你可以自己打开看）：

| # | 位置 | 事实 | 为什么会在手机上炸 |
| --- | --- | --- | --- |
| 1 | `src/containers/header/header.css:232` | 窄屏搜索框 `width: calc(100vw - 225px) !important`、`margin-left: 60px !important`、图标行 `right: 70px` | 在 360px 屏上搜索框只剩 **135px** —— 这就是"大小奇奇怪怪"。这些常数是按**某一个宽度**量出来的 |
| 2 | `src/pages/reader/index.css:472` | `.progress-panel-container { top: calc(100vh - 60px - env(safe-area-inset-bottom,0px)) }`，而容器在 `:210` 写死 `height: 60px` | 但里面 `.progress-panel`（`progressPanel.css:177`）是 `min-height: 100px` 的**三行**面板 ⇒ **容器与内容高度对不上**，位置/裁切必然错 |
| 3 | `src/pages/reader/index.css:212` | `.progress-panel-container` 用 `top: calc(100vh - 60px)` | 用 **`100vh`** 而不是 `100dvh`。安卓 WebView 上 `100vh` 不跟随可视区变化（软键盘、系统栏），会算错 |
| 4 | 多个对话框 | 写死宽度：`settingDialog.css:2` **760px**、`popupMenu.css:6` 500px、`loadingDialog.css:2` 454px、`opdsDialog.css:124` 454px、`editDialog.css:2` / `metadataDialog.css:2` 380px、`addDialog.css:2` 309px、`deleteDialog.css:2` 319px。<br>`settingDialog` 还写死 `left: calc(50% - 380px)`、`height: 540px` | 760px 宽的对话框在 360px 屏上，`left` 直接算成 **−200px**，左侧整栏跑到屏幕外 |
| 5 | 断点不一致 | 主流用 **570px**，但 `popupMenu.css:34` 用 **576px** | 570–576px 之间是两个断点的缝，行为不可预测 |
| 6 | `src/containers/cloudLibrary/cloudLibrary.css:857` | 570px 块**只**覆盖了几个零散子元素（`collab-start-card` 等） | **书架主布局（侧栏 + 网格 + 分页）根本没适配** |
| 7 | 全局 | `src/` 下**没有任何 `:root` 定义**；`--main-color` / `--background-color` / `--second-text-color` 只在 CSS 里被**消费**（带 fallback），**赋值来自渲染内核 `kookit`**（`src/vendor/kookit.esm.js`） | 意味着**配色真源在内核**，你的移动端外壳要么复用它、要么自己补一套，不能各自拍脑袋 |

**另外两个结构性事实，重构时必须知道：**

- **正文是渲染在 iframe 里的**（内核控制），**不是**直接受你的 React 组件 CSS 影响。
  ⇒ 「壳」和「正文」的样式是两套，改壳的 CSS 不能期望影响正文排版。
- 有些"手机适配"的注释本身就写着"不再溢出屏幕"（`header.css:231`）——
  说明这是**逐次打补丁**打出来的，专门针对当时看到的那个宽度。

### 所以你要做的不是"再补几个补丁"

**建议方向（你可以提出更好的方案）**：把这批像素魔法替换成**一套明确的响应式机制**：

1. **单一真源**：把断点、安全区、常用间距/字号/圆角抽成 CSS 变量（或一个断点常量模块），
   **消灭散落的魔法数字**，并统一 570/576 那个裂缝。
2. **流体布局优先**：能用 `%`、`fr`、`min()/max()/clamp()`、`flex-wrap` 的地方就别写死 px。
3. **高度用 `dvh`**，不要用 `100vh`（软键盘/系统栏会咬人）。
4. **强制下限保护**：所有弹层/面板加 `max-width: calc(100vw - Npx)` 之类的兜底，
   让"任何宽度下都不会出屏"成为**结构性保证**，而不是靠逐个数出来的常数。
5. **保持单一一套组件树**：不要为手机另写一套页面。桌面端现有观感**不能被改坏**。

## 五、🔴 第一件事：先测量，不要先动手（最重要的一条）

`MOBILE-UX-PLAN.md` 里已经写明的原则同样适用于你：**不许把"印象"写成"事实"。**
我上面那张表是**代码层面的证据**，但**"果冻的手机到底是什么宽度、断点到底有没有生效"
我无法确认（本机没有安卓设备）。所以：

**动手改代码之前，先在真机 APK 上测出这几个数**（加一段临时诊断、或让他用
Chrome 远程调试 `chrome://inspect` 看 Console）：

```js
// 在手机上把这几行打出来 —— 这决定了后面所有工作
console.log({
  innerWidth: window.innerWidth,              // 布局视口宽度（断点看的就是它）
  clientWidth: document.documentElement.clientWidth,
  dpr: window.devicePixelRatio,
  visualW: window.visualViewport && window.visualViewport.width,
  visualH: window.visualViewport && window.visualViewport.height,
  screen: [window.screen.width, window.screen.height],
  is570: window.matchMedia("(max-width: 570px)").matches,   // 断点到底生效没有？
  is576: window.matchMedia("(max-width: 576px)").matches,
  isMobileConfig: /* 见 src/utils/mobileRuntime.ts 导出的判据 */ null,
  capacitor: !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()),
});
```

**可能的两种结局，处理方式完全不同：**

| 测出来的结果 | 说明 | 你要做的 |
| --- | --- | --- |
| `innerWidth` 是 360–430 之间，`is570 === true` | 断点**生效了**，问题是那堆像素魔法本身算错 | 按第四节的建议**系统性重做** |
| `innerWidth` 明显偏大（例如 ≈980）或 `is570 === false` | 断点**根本没生效** —— 布局视口不对 | 先解决视口问题（`public/index.html` 的 viewport、Capacitor 的 `androidScheme`），**先别改 CSS** |

⚠️ 如果排查发现是**视口/壳配置**的问题（不是 CSS），**先告诉人类再动手** ——
那属于 `capacitor.config.ts` / `android/` 的范畴，改动面比 CSS 大。

## 六、必须守住的约束

### A. 视觉：与桌面端保持一致（果冻的原话）

- **配色**：读 `src/assets/styles/global.css` 与各组件 CSS，**以及内核下发的 CSS 变量**。
  不要引入新的主色。现有主色是 `#4b89ff`（`--main-color` 的 fallback）。
- **动感（动效）**：项目现有关键帧共 18 个，**尽量复用，不要另造一套**：
  `fade-up / fade-down / fade-left / fade-right / fade-in / slide-up / slide-down /
  slidein / slide-down-rotate / popup / popout / paging / spin / rotate /
  clickme / collab-pulse / shortcut-pulse / cloud-book-spin`。
  桌面端的过渡时长（多为 `0.15s ~ 0.5s ease`）与缓动风格**保持一致**。
- **可以**为了移动端手感调整：点击热区大小（建议 ≥44px）、字号、间距、面板形态
  （侧栏 → 底部 sheet 之类）。**不可以**：换配色体系、换一套动效语言、改桌面端现有观感。

### B. 技术：不能破的硬约束

1. **零原生插件**：`android/app/capacitor.build.gradle` 的 `dependencies {}` 是空的，
   `MainActivity.java` 只有 3 行。**不要引入 Capacitor 原生插件**（如状态栏插件）——
   这会改变交付形态。**确实需要时先问人类**，别自己装。
2. **一份产物三种形态**：`build/` 必须同时在 `http://localhost:3000`、`app://coread`（Electron）、
   `https://localhost`（Capacitor）下都能跑。不要用只有某一种壳才有的 API。
3. **不许反混淆内核**：`src/vendor/kookit.esm.js` 是压缩产物。
   **要读源码请读 `vendor/kookit/`（TypeScript 原文）。**
4. **不许动许可证**：根目录 `LICENSE` 保持 AGPL-3.0。
5. **不许引入 `kookit-extra*`**（无源码黑盒）。
6. **不许反编译闭源第三方 App**（如微信读书）—— 复刻手感只允许"装 App + 录屏观察"。
7. **`npm run scan` 必须 0 命中**（提交门槛）。注意：**文档里也不能写本机绝对路径**
   （会被 `win-abs-path` 抓），版本号别写成四段式数字（会被误判成 IP）。

### C. 别改坏的既有成果（2026-09-17 刚做完，别推倒重来）

- **`src/utils/mobileRuntime.ts`** —— 移动端判据（`isMobileConfigValue()`）+
  内核 RN 桥兼容桩（`installReactNativeWebViewStub()`）。**这是已实测通过的基础设施，复用它。**
  - 判据：安卓壳 = `window.Capacitor.isNativePlatform()`；无 Capacitor 时兜底 = 触屏且 `screen` 短边 ≤768；桌面一律 `"no"`。
  - 为什么需要桩：内核里有 **38 处** `window.ReactNativeWebView` 调用（触摸翻页、滑到底、选区、
    双指缩放、点外链、看图片…），**安卓真机上必然触发**。没有桩会直接 `TypeError`。
- **`isMobile` 已接线 5 处**（`viewer` / `cloudLibrary` / `importLocal` / `roomImportButton` / `moreAction`）。
  ⚠️ `utils/common.ts` 的 `preCacheAllBooks` **刻意保持 `"no"`**，**不要"顺手改成跟随"** ——
  那会让缓存与显示端行为分叉（原因写在 `MOBILE-UX-PLAN.md` 第 1 节）。
- **安全区已接**：`public/index.html` 的 `viewport-fit=cover`
  + `reader/index.css` 里的 `env(safe-area-inset-*)` 块。**留着，别删**（但欢迎改进）。

## 七、后端对接：要"稳"，必须同时满足这几条

后端 = **共读服务器**（`collab-server/server.js`，用户自己部署）。前后端在这套形态下是**跨域**的，
这是最容易"看起来能跑、实际连不上"的地方。四件事：

| # | 事项 | 事实 | 你要确认的 |
| --- | --- | --- | --- |
| 1 | **CORS 白名单** | 服务器默认**一条 CORS 头都不发**，必须设 `COLLAB_ALLOWED_ORIGIN`。安卓端 origin 是 **`https://localhost`**（Capacitor 8 默认 `androidScheme: https`） | 服务器侧必须包含 **`https://localhost`**（Electron 还要 `null`）。见 `collab-server/server.js:601-604` |
| 2 | **混合内容** | `capacitor.config.ts` 开了 `allowMixedContent: true`，且 `AndroidManifest.xml` 有 `usesCleartextTraffic="true"`。因为页面是 `https://`、而共读服务器**通常是 `http://私网IP:17390`** | **两处必须同时开**（要收窄也要一起收窄）。**不要擅自关掉** |
| 3 | **地址真源** | 前端不硬编码服务器地址。真源是 `src/utils/collab/collabServerConfig.ts`：用户设置 > 构建期注入 > 同源 `/collab`（**打包客户端不算网页部署**，一律视为未配置 ⇒ 退化成纯本地阅读器） | 改动这块要**保持"未配置也能用（纯本地）"**这个语义 |
| 4 | **安卓上不可用的功能** | `src/utils/file/localFile.ts` 依赖 `showDirectoryPicker`，**安卓 WebView 没有**。好在有 `"showDirectoryPicker" in window` 特性检测（`:71`）⇒ **静默降级、不是崩溃** | 这是**已知限制**：要在大白话里告诉用户"手机上不能用本地文件夹"，不要留一个点了没反应的按钮 |

**另外建议顺手核实的两个"功能可用性"风险**（我查过，目前确实没处理）：

- **存储可能被系统回收**：全项目**没有任何 `navigator.storage.persist()` 调用**。
  安卓 WebView 的 IndexedDB 在空间紧张时可能被清理 ⇒ **用户的图书馆可能丢**。
  建议在启动时请求持久化（`navigator.storage.persist()`），并处理不支持的情况。
- **软键盘**：安卓软键盘弹出会顶起/遮挡底部区域。用 `dvh` + `visualViewport` 处理，
  别让输入框（跳页 / 跳章 / 搜索）被键盘盖住。

## 八、验收标准（写成可勾的清单）

### 必须做到

- [ ] **任何宽度下都不出屏**。至少覆盖：320 / 360 / 390 / 412 / 430（竖）与 640 / 768 / 844（横）。
      每加一个界面，都要在**最窄的 320px** 下过一遍。
- [ ] 点击目标 ≥ 44×44 CSS px（含底部工具条、目录、返回、关闭）。
- [ ] 桌面端（`npm start` 桌面窗口 + Electron）**观感与改动前一致** —— 配色、动效、布局都没被改坏。
- [ ] 共读链路在安卓形态下可用：**填服务器地址 → 连接 → 进房间 → 看到同房间的人**。
- [ ] 核心功能可用：**导入书 → 打开 → 翻页（点按/滑动）→ 目录跳转 → 进度跳转 →
      划线/笔记 → 听书 → AI 问书**。
- [ ] 横竖屏切换、软键盘弹出，布局不炸。
- [ ] 深色主题下对比度可读。
- [ ] `npm run scan` **0 命中**。

### 明确做不到的（**不许假装做过**）

- **真机验收**：开发机没有连安卓设备。触摸惯性、系统返回键与菜单抢事件、
  沉浸式遮挡、锁屏回来是否丢状态 —— **这些你测不了**。
  ⇒ 用 **Chrome DevTools 设备模拟**覆盖布局与多数交互，然后**如实标注哪些只做了模拟**，
  并给人类一份"请在真机上确认这几条"的清单。

## 九、怎么跑、怎么验证（本机已验证可用的命令）

```bash
# 装依赖（首次）
npm install

# 开发（桌面浏览器调手机尺寸）
npm start

# 类型检查（期望无输出）
npx tsc --noEmit

# 敏感信息扫描（提交门槛，期望 0 命中）
npm run scan

# 出 APK（内含 build + cap sync + gradle）
npm run android:build:debug
#   → android/app/build/outputs/apk/debug/app-debug.apk

# 共读服务器（本地自测后端用）
npm run collab:server
```

**构建相关的两个已知坑**（`ANDROID.md` 有详细记录）：

1. **CRA 构建前会清空 `build/`**（约 269 文件）。若你用**带批量删除保护的工具**
   （如某些 agent 环境）跑 `npm run build`，会被拦并**把 `build/` 删一半**。
   绕过：**先把 `build/` 同盘改名移走**（改名不算删除），再构建。
2. **`BUILD_PATH` 若要用，必须指向一个尚不存在的目录**，不要输出到仓库里已有的 `build/`。

**环境**（本机已配齐，换机的话照这个来）：JDK **21**（系统自带的是 25，Gradle 不认）、
Android SDK（`platforms;android-36` + `build-tools;36.0.0`）、Gradle 8.14.3（wrapper 首次自动下载，约 5 分钟）。

## 十、跟人怎么协作（项目所有者：果冻）

- **中文回复、中文 commit**：`type(scope): 标题`，正文写清**为什么改**与**验证结论**。
- **一次一个需求，一次提交。** 不要攒一个巨大改动，出问题无法定位。
- **视觉改动要在提交信息里写清"改了哪些界面/哪些文件"** ——
  果冻无法靠测试发现视觉变化，他需要一份"我该去看哪里"的清单。
- **跑不了命令就直说**：禁止假装验证过。明确标注哪些改动**未编译 / 未跑测试**，并给出可执行命令让他自己跑。
- **需要"编造事实"才能继续时，停下来**，说明缺什么信息。
- **红线与契约问题不确定就问** —— 尤其内核行为（`REFACTOR-BRIEF.md` 4.3 节）、数据兼容性、许可证判断。

## 十一、进场请先回答我三件事

1. 你的运行环境：**能否执行 shell / 能否直接读写仓库文件 / 能否连安卓真机或模拟器**？
2. 读完 `GEMINI.md`、`MOBILE-UX-PLAN.md`、`REFACTOR-BRIEF.md` 第 4.3 节之后，
   说说你对**第四节那张根因表**的判断 —— **哪几条你认同、哪几条你觉得不对**（可以反驳，要有理由）。
3. 给我一份**执行计划**：分几步、每步改哪些文件、每步怎么验证。
   **计划里必须包含"第五节：先测量"这一步。**

我确认后你再动手。在此之前不要改业务代码。
