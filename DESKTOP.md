# CoRead 桌面端（Windows）说明

把 `build/`（CRA 前端产物）装进 Electron，做成**纯本地阅读器**。
没有配置服务器时，共读相关功能整体退化为不可用 —— 这是设计，不是待办。

---

## 1. 三条不要动的约束

这三条踩过坑，动了会**静默坏掉**（不报错、界面只是"点了没反应"）：

### 1.1 页面必须用 `app://coread/index.html` 加载，不能用 `file://`

`public/index.html` 里第三方库写成 `%PUBLIC_URL%/lib/...`，CRA 构建后 `PUBLIC_URL` 为空串，
于是变成根绝对路径 `/lib/...`。在 `file://` 下会被解析成 `file:///D:/lib/pdfjs/pdf.mjs` →
**PDF / sql.js / 高亮库全部 404**。
自定义协议 `app://` 是 standard scheme，能正确解析根路径。

### 1.2 `webPreferences` 必须 `nodeIntegration: true` + `contextIsolation: false`

`src/` 里大量 `window.require("fs" | "path" | "adm-zip" | "electron")`，
且 `react-device-detect` 的 `isElectron` 决定走原生分支（靠 UA 里有没有 `Electron`）。
关掉 nodeIntegration → `window.require` 是 undefined → 点"导入"直接抛
`window.require is not a function`，表现为**点了没反应**。

### 1.3 数据走浏览器存储（IndexedDB），主进程不提供原生 SQLite

本 fork 已移除 `better-sqlite3` 与闭源 `kookit-extra`，没有可用的 SQL 方言表。
所以拆成两个概念：

| 概念 | 位置 | 用途 |
| --- | --- | --- |
| `isElectron` | `src/utils/platform.ts` | **文件层**：保留原生 fs，书真的落盘 |
| `isElectronStorage = false` | 同上 | **数据层**：配置/笔记/高亮走 IndexedDB |

`src/utils/storage/databaseService.ts`、`src/utils/file/configUtil.ts` 整文件用
`isElectronStorage as isElectron` 覆盖；`bookUtil.ts` 只把 5 个 SQL 查询分支换掉，
文件读写分支仍用 `isElectron`。

---

## 2. 目录结构

```
app.asar              <- build/ + main.js + package.json
%APPDATA%/CoRead/     <- userData：索引库、缓存、uploads/data（书与封面落盘处）
```

资源覆盖目录（前端改了不用重新打包），优先级：
1. 环境变量 `COREAD_RESOURCE_DIR`
2. `%APPDATA%/CoRead/app-resources`
3. asar 内

只要目录里有 `build/index.html` 就算可用。

---

## 3. IPC 通道

主进程注册 **61 个**通道（`main.js`）。

- `ipcMain.handle` → 渲染端用 `ipcRenderer.invoke`
- `ipcMain.on` → 渲染端用 `ipcRenderer.sendSync`（`storage-location` / `get-dirname` / `user-data` / `system-color` / `url-window-status` / `check-main-open` / `get-file-data` / `check-file-data` 等）

**这两类不能混**：`sendSync` 通道挂到 `handle` 上，渲染端会永远返回 `null`。

### 显式抛错的不支持通道

云端同步、网盘 Picker、云端 TTS、AI 聊天、`database-command`、`custom-database-command`
统一在 `UNSUPPORTED` 集合里**抛人话错误**。
原因：渲染端对这些通道是 `await`，如果静默返回会让界面永久挂起。

### 主要通道

| 通道 | 用途 |
| --- | --- |
| `select-book` / `select-path` / `select-file` / `select-zip-file` | 系统文件对话框 |
| `open-book` / `new-tab` / `reload-*` / `exit-tab` / `switch-moyu` | 窗口控制 |
| `enter-fullscreen` / `exit-fullscreen` | 全屏 |
| `set-always-on-top` / `toggle-auto-launch` | 窗口置顶 / 开机自启 |
| `reset-main-position` / `reset-reader-position` | 窗口位置重置 |
| `get-debug-logs` / `open-console` | 调试 |
| `encrypt-data` / `decrypt-data` | safeStorage |
| `clear-tts` / `close-database` / `clear-all-data` | 数据清理 |
| `system-ocr` → `null`，`get-biometric-capability` → `false` | 明确不支持 |

---

## 4. 构建与打包

```bash
npm run build          # 只出前端产物 build/
npm run ele            # 开发模式起 Electron（读 build/）
npm run pack           # build + electron-builder --dir（出 dist/win-unpacked）
npm run release        # build + electron-builder --win（出 安装包 + 便携版）
```

产物在 `dist/`：

- `CoRead-2.3.9-Setup.exe`（NSIS 安装包）
- `CoRead-2.3.9-Portable.exe`（便携版）

配置见 `package.json` 的 `build` 字段：`asar: true`、`compression: "maximum"`、
`win.target: [nsis, portable]`、`nsis.oneClick: true`、
`allowToChangeInstallationDirectory: false`。

---

## 5. 安装路径：不做拦截（2026-09-16 起）

`assets/windows/installer.nsh` **不再有任何安装路径防呆**。安装向导就是标准 NSIS 流程：
能自选目录、一路下一步装完，中间不弹自定义提示、不中止。

现在 `installer.nsh` 里只剩两件事：

| 钩子 | 做什么 |
| --- | --- |
| `customInstall` | 装前 `taskkill /f /im "CoRead.exe"` 关掉正在运行的应用 + `Sleep 2000`，避免文件占用导致替换失败 |
| `customUnInstall` | 问一句要不要连用户数据一起删（默认「否」），只删 `%APPDATA%\CoRead` |

> **删掉的是什么 / 为什么曾经有**：以前有三道「源码仓库检测」防呆
> （`customInit` 发现 `$INSTDIR` 是源码仓库就改回默认目录；`customInstall`、
> `customUnInstall` 发现 `package.json` + `.gitignore` 同时存在就 `Abort`）。
> 起因是一次真实事故：应用被装进了源码仓库，NSIS 卸载执行 `RMDir /r "$INSTDIR"`，
> 把整个仓库（含 `.git`、几万个 `node_modules` 文件）一起删了 ——
> 表现为「卸载特别久、屏幕刷一堆 node 路径」。防呆于 2026-09-16 按需求整体删除。
>
> ⚠️ **删掉之后这条风险重新存在**：别把应用装进任何源码目录。装的时候自己看准路径。

---

## 6. 主题

- 外观只剩两项：`light`（默认模式）/ `night`（黑夜模式），见 `src/constants/settingList.tsx`
- 主题色只剩 `default` 一项，见 `src/constants/themeList.tsx`
- 右上角有白天/黑夜开关 `src/components/themeToggle/`
- 核心逻辑 `src/utils/theme.ts`：`resolveAppSkin()` 把遗留 `"system"` 归一化，`applySkin()` 写配置 + 同步 nativeTheme + `reloadManager()`
- 左上角 logo：`brandLogo.css` 里 `color: inherit`（原来用 `--color-alpha-beta`，全仓库从未赋值，黑夜下是黑的看不见），组件里按 `isDarkModeNow()` 显式上深浅两色

---

## 7. 冒烟测试

```bash
node tools/desktop-smoke.cjs
```

会起一个真实 Electron 窗口跑探测，检查：
origin 是否为 `app://coread`、pdf.js 版本、`window.require` 可用性、React 挂载、
IndexedDB 可写、资源是否 200（15 项）、关键 IPC 通道是否注册、userData 路径、
以及 console 里有没有 `vex is not defined`。

另外会拿 `uploads/data/cover` 里**真实存在的一张封面**去 fetch
`app://coread/__local__/cover/<文件名>`，断言返回 200（报告里的 `coverUrlOk`）。
没有封面文件时该项记为通过 —— 不能因为还没导入书就误判失败。

结果写 `smoke-report.json`（路径由 `COREAD_SMOKE_OUT` 指定）。

> 探测脚本**不能** `invoke` 会弹系统对话框的通道（`select-book` 等），
> 无人点击会永久挂起。通道检查改为主进程侧比对 `registeredChannels`。

---

## 8. 已知环境坑

| 现象 | 原因 | 解法 |
| --- | --- | --- |
| `npm ci` rc=1 | `react-scripts@5.0.1` 要求 typescript ^4，与 ^5.9.3 冲突 | `npm ci --legacy-peer-deps` |
| Electron 退化成纯 node | 终端里继承了 `ELECTRON_RUN_AS_NODE=1` | 启动时 `delete env.ELECTRON_RUN_AS_NODE` |
| `GPU process isn't usable` | 本机 GPU 进程起不来 | 测试时加 `--no-sandbox --disable-gpu --in-process-gpu --disable-software-rasterizer`（正式版不带） |
| `require("electron")` 返回路径字符串 | 普通 node 里 `require("electron")` 只给路径 | 探测必须经由 Electron 主进程跑 |
| `ERROR: Cannot create symbolic link`（winCodeSign 解压） | electron-builder 跑 `7za x -snld -bd ...`，包里有 macOS 用的 `darwin/.../lib{crypto,ssl}.dylib` 符号链接；当前账号不是管理员、也没开开发者模式 | **装一个 7za 转发器**：解压时自动追加 `-xr!darwin`。源码在 `tools/7za-shim/main.go`，编译后覆盖 `node_modules/7zip-bin/win/x64/7za.exe`（原版备份成 `7za.real.exe`）。详见下文 8.1 |
| `Get "https://github.com/.../winCodeSign-2.6.0.7z": EOF / Bad Gateway` | GitHub 反复下载触发限流 | 打包前设 `ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/` |
| 换 7-Zip 24.09 仍 rc=2 | `-snld` 在 21.07 和 24.09 的帮助里都查不到，不是「禁用符号链接」开关 | 别在版本上折腾，直接用转发器 |
| 预置 winCodeSign 缓存目录无效 | 缓存目录名是 URL 哈希，**每次运行都不一样**（880167211 / 559986591 / 562867271…） | 同上，用转发器 |
| 打包版 exe 在 agent 环境里秒退、无输出、无退出码 | 无头/沙箱环境拉不起 GUI 进程 | 打包产物只能真机验证；开发模式自动化走 `node tools/desktop-smoke.cjs` |
| 安装时 Windows SmartScreen 蓝色提示 | 没有代码签名证书 | 正常，点「更多信息 → 仍要运行」。要消除得买证书 |

### 8.1 7za 转发器怎么重建

`node_modules` 不进 git，`npm ci` 之后要重做一次：

```powershell
cd tools/7za-shim
go build -o 7za-shim.exe .
# 只做一次：把原版 7za 备份成 7za.real.exe
copy node_modules\7zip-bin\win\x64\7za.exe node_modules\7zip-bin\win\x64\7za.real.exe
copy 7za-shim.exe node_modules\7zip-bin\win\x64\7za.exe
```

校验：`7za.exe x -snld -bd <winCodeSign>.7z -o<临时目录>` 应返回 rc=0。

> 备选方案：`package.json` 里设 `"win": { "signAndEditExecutable": false }` 也能绕开
> rcedit（就不需要 winCodeSign），代价是 exe 丢掉应用图标和版本信息，
> 快捷方式会显示成 Electron 默认图标。不建议。

---

## 9. 本地图片（书封面）是怎么显示出来的

**坑**：封面文件确实写进了 `%APPDATA%\CoRead\uploads\data\cover\<key>.jpeg`，
但界面上一片空白。

**原因**：`CoverUtil.getCover()` 在 Electron 分支返回的是**磁盘绝对路径**
（`C:\Users\...\cover\123.jpeg`）。页面跑在 `app://coread` 上，
把它塞进 `<img src>` 浏览器解析不了 —— 既不是相对路径，也不是合法 URL。

**不能用 `file://` 兜底**：自定义协议页面里加载 `file://` 子资源会被 `webSecurity` 拦掉。

**解法**：给 `app://` 协议加一个虚拟前缀 `/__local__/`，映射到
`<userData>/uploads/data`。`getCover()` 返回同源的
`app://coread/__local__/cover/<文件名>`，图片正常加载，也没有跨域问题。

- 主进程：`main.js` 的 `registerAppProtocol()`（`LOCAL_PREFIX` 常量）
- 渲染端：`src/utils/file/coverUtil.ts` 的 `getCover()`
- 目录穿越防护照旧：解析后的绝对路径必须落在 `localDataRoot()` 内

> 阅读背景图（`backgroundUtil.ts`）不受影响 —— 它读文件后转成 data URL 返回，
> 不存在这个问题。别顺手"统一改"，会改坏。

## 10. 安装器

`package.json` 的 `nsis` 段：`oneClick: false` +
`allowToChangeInstallationDirectory: true` + `installerLanguages: ["zh_CN"]`。

**为什么是「可自选目录」**：最早是 `oneClick: true` + 不让选目录（防用户把应用装进源码仓库，
见第 5 节那个事故）。但"双击一下就装完、不知道装哪"体感太差，改回了正常向导。

**现在向导不做任何路径拦截**：`customInit` / `customInstall` / `customUnInstall` 里的
源码仓库检测（含「注册表继承了坏路径 → 改回默认目录」那段处理）已于 2026-09-16 整体删除，
见第 5 节。向导按标准流程走，不会因为装在哪而弹窗或中止。

> 留个历史备忘（已不适用，仅解释当初为什么那么写）：
> `customInit` 阶段 `$INSTDIR` 可能来自 electron-builder `.onInit` → `initMultiUser`
> 读的注册表「上一次安装位置」，那时它还不是用户确认过的值 —— 所以当年在那里 `Abort`
> 会导致"放哪都提示不能装"。真要恢复任何拦截，拦截点只能放在 `customInstall`。
