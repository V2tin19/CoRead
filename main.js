/**
 * CoRead 桌面端主进程（Electron）
 * ============================================================
 * 目标：把 Web 端构建产物 `build/` 装进 Electron，做成「纯本地阅读器」。
 * 没有配置服务器时，共读相关功能整体退化为不可用（不是待办，是设计）。
 *
 * ⚠️ 三条不要动的约束（动了就会静默坏掉）
 * ------------------------------------------------------------
 * 1) 页面必须用 `app://coread/index.html` 加载，**不能用 file://**
 *    原因：`public/index.html` 里所有第三方库都写成 `%PUBLIC_URL%/lib/...`，
 *    CRA 构建后 PUBLIC_URL 为空串，于是变成根绝对路径 `/lib/...`。
 *    在 file:// 下 `/lib/pdfjs/pdf.mjs` 会被解析成 `file:///D:/lib/pdfjs/pdf.mjs`
 *    → PDF / sql.js / 高亮库全部 404。自定义协议 app:// 能正确解析根路径。
 *
 * 2) webPreferences 必须是 nodeIntegration:true + contextIsolation:false
 *    原因：`src/` 里大量 `window.require("fs"|"path"|"adm-zip"|"electron")`，
 *    并且 `src` 用 react-device-detect 的 isElectron 判定走「原生分支」。
 *    关掉 nodeIntegration，`window.require` 就是 undefined → 点导入直接
 *    抛 "window.require is not a function"，表现为「点了没反应」。
 *
 * 3) 配置 / 笔记 / 高亮这类数据走**浏览器存储**（IndexedDB），
 *    主进程不再提供原生 SQLite 通道。
 *    原因：本 fork 已移除 better-sqlite3 与闭源 kookit-extra，
 *    没有可用的 SQL 方言表；对应渲染端开关见
 *    `src/utils/storage/databaseService.ts` 等文件顶部的 `isElectron` 覆盖。
 *
 * 目录结构（打包后）
 * ------------------------------------------------------------
 *   app.asar            ← build/ + main.js + package.json
 *   %APPDATA%/CoRead/   ← userData：索引库、缓存、uploads/data（书与封面落盘处）
 */
const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  dialog,
  protocol,
  net,
  nativeTheme,
  shell,
  powerSaveBlocker,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

// ------------------------------------------------------------
// 基础常量
// ------------------------------------------------------------
const APP_SCHEME = "app";
const APP_ORIGIN = "app://coread";
const IS_DEV = !app.isPackaged && process.env.COREAD_FORCE_PROD !== "1";

// 数据目录（userData 下的 uploads，兼容上游 Koodo 的目录约定）
let DATA_DIR = "";
const bookOpenLogPath = () => path.join(DATA_DIR, "log.json");

let mainWin = null;
let readerWindowList = [];
let filePath = null;
let sleepBlockerId = null;

// 已注册的 ipcMain 处理器（用于幂等注册 + 自检）
const registeredChannels = new Set();

// ------------------------------------------------------------
// 资源根目录：支持「外部覆盖目录」，这样前端改动可以不重新打包
//   优先级：环境变量 COREAD_RESOURCE_DIR > userData/app-resources > asar 内
//   只要是含 build/index.html 的目录就算可用
// ------------------------------------------------------------
let RESOURCE_CONTAINER = null;
function resolveResourceContainer() {
  if (RESOURCE_CONTAINER) return RESOURCE_CONTAINER;
  const candidates = [];
  if (process.env.COREAD_RESOURCE_DIR) {
    candidates.push(process.env.COREAD_RESOURCE_DIR);
  }
  try {
    candidates.push(path.join(app.getPath("userData"), "app-resources"));
  } catch (e) {
    /* app 尚未 ready 时忽略 */
  }
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, "build", "index.html"))) {
        RESOURCE_CONTAINER = dir;
        return RESOURCE_CONTAINER;
      }
    } catch (e) {
      /* 忽略不可读的候选目录 */
    }
  }
  RESOURCE_CONTAINER = __dirname;
  return RESOURCE_CONTAINER;
}
function resourceRoot() {
  return path.join(resolveResourceContainer(), "build");
}
function entryFile() {
  return path.join(resourceRoot(), "index.html");
}

// ------------------------------------------------------------
// app:// 协议：必须在 app ready 之前登记 privileges
// ------------------------------------------------------------
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true, // 有 Origin、能解析根绝对路径
      secure: true, // 视作安全上下文（crypto.subtle / File System Access 需要）
      supportFetchAPI: true,
      stream: true, // PDF.js 按 Range 取字节要用
      corsEnabled: true,
      allowServiceWorkers: true,
    },
  },
]);

let APP_PROTOCOL_READY = false;
// 虚拟前缀：app://coread/__local__/xxx → <userData>/uploads/data/xxx
// ------------------------------------------------------------
// 为什么需要它：渲染端拿到的是「书封面的真实磁盘路径」（如
// C:\Users\...\uploads\data\cover\123.jpeg）。页面跑在 app:// 上，
// 直接把这个路径塞进 <img src> 浏览器解析不了，封面就是一片空白。
// 走这个前缀就变成同源的 app:// URL，图片正常加载，也不会被
// webSecurity 拦（file:// 子资源在自定义协议页面里是会被拦的）。
const LOCAL_PREFIX = "/__local__/";
const localDataRoot = () => path.join(DATA_DIR, "data");

function registerAppProtocol() {
  const root = path.resolve(resourceRoot());
  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      let rel = decodeURIComponent(url.pathname);
      if (!rel || rel === "/") rel = "/index.html";

      // 本地数据（封面、背景图等）：映射到 <userData>/uploads/data
      if (rel.startsWith(LOCAL_PREFIX)) {
        const localRoot = path.resolve(localDataRoot());
        const sub = rel.slice(LOCAL_PREFIX.length);
        const localTarget = path.resolve(path.join(localRoot, sub));
        if (
          localTarget !== localRoot &&
          !localTarget.startsWith(localRoot + path.sep)
        ) {
          return new Response("Forbidden", { status: 403 });
        }
        if (!fs.existsSync(localTarget)) {
          return new Response("Not Found: " + rel, { status: 404 });
        }
        return net.fetch(pathToFileURL(localTarget).toString());
      }

      const target = path.resolve(path.join(root, rel));
      // 目录穿越防护
      if (target !== root && !target.startsWith(root + path.sep)) {
        return new Response("Forbidden", { status: 403 });
      }
      if (!fs.existsSync(target)) {
        return new Response("Not Found: " + rel, { status: 404 });
      }
      // 用 net.fetch + file:// 让 Electron 自己推断 MIME 并支持流式读取，
      // 手搓 Content-Type 会在 .mjs / .wasm 上翻车。
      return net.fetch(pathToFileURL(target).toString());
    } catch (error) {
      console.error("[protocol] app:// 处理失败:", error);
      return new Response("Internal Error", { status: 500 });
    }
  });
  APP_PROTOCOL_READY = true;
  console.log("[CoRead] app:// 资源根目录 =", root);
}

// ------------------------------------------------------------
// 窗口
// ------------------------------------------------------------
const BASE_WEB_PREFERENCES = {
  nodeIntegration: true, // ← 见文件头约束 2
  contextIsolation: false,
  sandbox: false,
  webSecurity: true,
  spellcheck: false,
  backgroundThrottling: false,
};

function defaultWindowOptions() {
  return {
    width: 1200,
    height: 800,
    minWidth: 480,
    minHeight: 360,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: IS_DEV ? "#ffffff" : "#2c2f31",
    webPreferences: { ...BASE_WEB_PREFERENCES },
  };
}

function createMainWindow() {
  mainWin = new BrowserWindow({
    ...defaultWindowOptions(),
    title: "CoRead",
    icon: path.join(__dirname, "assets", "icons", "icon.ico"),
  });
  if (IS_DEV) mainWin.webContents.openDevTools({ mode: "detach" });

  mainWin.once("ready-to-show", () => {
    mainWin.show();
  });

  // 站内跳转放行，页外跳转交给系统浏览器
  mainWin.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(APP_ORIGIN) || url.startsWith("file://") || url.startsWith("about:")) {
      return;
    }
    event.preventDefault();
    shell.openExternal(url);
  });
  // 新窗口一律不开，改用系统浏览器
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_ORIGIN)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWin.on("closed", () => {
    mainWin = null;
  });

  loadEntry(mainWin);
  if (process.env.COREAD_SMOKE === "1") {
    runSmokeTest(mainWin);
  }
  return mainWin;
}

/**
 * 冒烟自检（只有设置 COREAD_SMOKE=1 时才跑，正常启动完全不触发）
 * 检查打包后最容易「静默坏掉」的几件事：
 *   1. 页面真的跑在 app://coread 上（file:// 会让 /lib/... 全 404）
 *   2. pdfjsLib 注入成功（PDF 能不能读的前提）
 *   3. window.require 可用（导入图书要用 fs / electron）
 *   4. IndexedDB 可写（本机版书架数据存在这）
 *   5. 页面引用的静态资源都拿得到
 * 报告写到 COREAD_SMOKE_OUT 指定的文件，然后自动退出。
 */
function runSmokeTest(win) {
  const consoleErrors = [];
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 2) consoleErrors.push(String(message).slice(0, 300));
  });

  // 取一张真实存在的封面文件名，用来验证 /__local__/ 通道真的能取到图。
  // 没有封面就跳过这一项（不能因为没书就误判失败）。
  let coverFile = null;
  try {
    const coverDir = path.join(DATA_DIR, "data", "cover");
    if (fs.existsSync(coverDir)) {
      const f = fs.readdirSync(coverDir).filter((n) => !n.startsWith("."));
      if (f.length > 0) coverFile = f[0];
    }
  } catch (e) {
    /* 忽略：没有封面目录不算失败 */
  }

  const probeScript = `(async () => {
    const out = {};
    out.origin = window.location.origin;
    out.pdfjs = (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions)
      ? (window.pdfjsLib.version || "unknown") : null;
    out.hasRequire = typeof window.require === "function";
    out.isElectronRenderer = !!(window.process && window.process.type === "renderer");
    out.rootMounted = !!document.getElementById("root") && document.getElementById("root").children.length > 0;
    out.indexedDB = await new Promise((resolve) => {
      try {
        const req = indexedDB.open("__coread_smoke__", 1);
        req.onsuccess = () => { req.result.close(); resolve(true); };
        req.onerror = () => resolve(false);
        setTimeout(() => resolve(false), 3000);
      } catch (e) { resolve(false); }
    });
    const urls = [];
    document.querySelectorAll("link[href]").forEach((n) => urls.push(n.href));
    document.querySelectorAll("script[src]").forEach((n) => urls.push(n.src));
    out.assetUrls = urls;
    // 封面通道自检：app://coread/__local__/cover/<file> 必须能取到图。
    // 以前 getCover() 返回裸磁盘路径，页面根本加载不了，封面一片空白。
    out.coverStatus = null;
    const coverName = ${JSON.stringify(coverFile)};
    if (coverName) {
      out.coverName = coverName;
      out.coverStatus = await fetch("app://coread/__local__/cover/" + encodeURIComponent(coverName))
        .then((r) => r.status)
        .catch((e) => "ERR:" + e.message);
    }
    // 导入用到的通道：没有注册 handler 时 invoke 会立刻抛 No handler registered
    out.ipc = {};
    if (typeof window.require === "function") {
      const { ipcRenderer } = window.require("electron");
      try { out.ipc.storageLocation = ipcRenderer.sendSync("storage-location", "ping") || "(empty)"; }
      catch (e) { out.ipc.storageLocation = "ERR:" + e.message; }
      try { out.ipc.dirname = ipcRenderer.sendSync("get-dirname", "ping") || "(empty)"; }
      catch (e) { out.ipc.dirname = "ERR:" + e.message; }
      // 注意：这里绝不能 invoke("select-book") —— 那会真的弹出系统文件对话框，
      // 没人点就永远不返回（冒烟测试就是这么被挂住的）。
      // 通道是否注册改由主进程侧用 registeredChannels 判断。
    }
    return out;
  })()`;

  const finish = async () => {
    try {
      await new Promise((r) => setTimeout(r, 3000)); // 给 SPA 挂载时间
      const probe = await win.webContents.executeJavaScript(probeScript, true);

      const assets = [];
      for (const url of probe.assetUrls || []) {
        const status = await win.webContents.executeJavaScript(
          `fetch(${JSON.stringify(url)}).then(r => r.status).catch(e => "ERR:" + e.message)`,
          true
        );
        assets.push({ url, status });
      }
      const badAssets = assets.filter((a) => a.status !== 200);

      let screenshot = null;
      try {
        const img = await win.webContents.capturePage();
        const outPng = process.env.COREAD_SMOKE_PNG;
        if (outPng) {
          fs.writeFileSync(outPng, img.toPNG());
          screenshot = outPng;
        }
      } catch (e) {
        console.error("[smoke] 截图失败:", e);
      }

      // 关键通道是否注册（主进程侧查，不会触发任何用户交互）
      const keyChannels = [
        "select-book", "select-path", "select-file", "select-zip-file",
        "storage-location", "get-dirname", "user-data", "open-book",
      ];
      const missingChannels = keyChannels.filter((c) => !registeredChannels.has(c));

      const report = {
        generatedAt: new Date().toISOString(),
        host: { appName: app.getName(), isPackaged: app.isPackaged, userData: app.getPath("userData") },
        probe,
        ipc: { total: registeredChannels.size, missing: missingChannels },
        assets: { total: assets.length, ok: assets.length - badAssets.length, bad: badAssets },
        consoleErrors,
      };
      report.verdict = {
        originIsApp: probe.origin === "app://coread",
        pdfjsReady: !!probe.pdfjs,
        requireWorks: probe.hasRequire,
        reactMounted: !!probe.rootMounted,
        indexedDB: probe.indexedDB === true,
        assetsOk: badAssets.length === 0,
        keyChannelsOk: missingChannels.length === 0,
        // 没有封面文件时为 null，不算失败（不能因为没导入书就误判）
        coverUrlOk: probe.coverStatus === null ? true : probe.coverStatus === 200,
      };
      report.allPass = Object.values(report.verdict).every(Boolean);

      fs.writeFileSync(
        process.env.COREAD_SMOKE_OUT || path.join(DATA_DIR, "smoke-report.json"),
        JSON.stringify(report, null, 2),
        "utf-8"
      );
    } catch (error) {
      fs.writeFileSync(
        process.env.COREAD_SMOKE_OUT || path.join(DATA_DIR, "smoke-report.json"),
        JSON.stringify({ allPass: false, error: String(error && error.stack) }, null, 2),
        "utf-8"
      );
    } finally {
      app.exit(0);
    }
  };

  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", finish);
  } else {
    finish();
  }
  // 兜底：45 秒还没写完就强行退出，别把进程挂住
  setTimeout(() => {
    try {
      if (!fs.existsSync(process.env.COREAD_SMOKE_OUT || "")) {
        fs.writeFileSync(
          process.env.COREAD_SMOKE_OUT || path.join(DATA_DIR, "smoke-report.json"),
          JSON.stringify({ allPass: false, error: "timeout" }, null, 2),
          "utf-8"
        );
      }
    } catch (e) {}
    app.exit(3);
  }, 45000);
}

function createReaderWindow(config = {}) {
  const options = {
    ...defaultWindowOptions(),
    title: config.title || "CoRead",
    width: config.width || 1000,
    height: config.height || 720,
  };
  if (config.isAlwaysOnTop === "yes") {
    options.alwaysOnTop = true;
  }
  const win = new BrowserWindow(options);
  readerWindowList.push(win);
  win.once("ready-to-show", () => {
    win.show();
    if (config.isAutoMaximize === "yes") win.maximize();
    if (config.isAutoFullscreen === "yes") win.setFullScreen(true);
  });
  win.on("closed", () => {
    readerWindowList = readerWindowList.filter((w) => w !== win);
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(APP_ORIGIN) && !url.startsWith("file://") && !url.startsWith("about:")) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  return win;
}

/** 统一入口：装了协议走 app://，没装上（极端情况）退回 file:// */
function loadEntry(win, hashUrl) {
  const url = hashUrl || `${APP_ORIGIN}/index.html`;
  if (APP_PROTOCOL_READY) {
    win.loadURL(url);
  } else {
    win.loadFile(entryFile());
  }
}

/** 把渲染进程给的 `xxx/index.html#/route` 之类 URL 规整成我们要加载的地址 */
function normalizeAppUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return `${APP_ORIGIN}/index.html`;
  }
  const hashIndex = rawUrl.indexOf("#");
  const hash = hashIndex >= 0 ? rawUrl.slice(hashIndex) : "";
  return `${APP_ORIGIN}/index.html${hash}`;
}

// ------------------------------------------------------------
// IPC 注册助手
// ------------------------------------------------------------
function handle(channel, fn) {
  if (registeredChannels.has(channel)) return;
  registeredChannels.add(channel);
  ipcMain.handle(channel, fn);
}
function onSync(channel, fn) {
  if (registeredChannels.has(channel)) return;
  registeredChannels.add(channel);
  ipcMain.on(channel, fn);
}

/**
 * 明确声明「桌面端没有实现、也不打算实现」的通道。
 * 直接 reject 并带上人话错误，好过让 renderer 的 await 永远挂着
 * —— 挂着的表现就是「点了没反应」，非常难查。
 */
const UNSUPPORTED = {
  "cloud-upload": "本机版没有开启云同步：请在「设置 → 数据」里保持云同步关闭。",
  "cloud-download": "本机版没有开启云同步。",
  "cloud-progress": "本机版没有开启云同步。",
  "cloud-reset": "本机版没有开启云同步。",
  "cloud-stats": "本机版没有开启云同步。",
  "cloud-delete": "本机版没有开启云同步。",
  "cloud-list": "本机版没有开启云同步。",
  "cloud-exist": "本机版没有开启云同步。",
  "picker-download": "本机版没有接入网盘 Picker。",
  "picker-progress": "本机版没有接入网盘 Picker。",
  "picker-list": "本机版没有接入网盘 Picker。",
  "check-cloud-url": "本机版没有开启云同步。",
  "database-command": "本机版把配置/笔记存放在浏览器存储（IndexedDB），未启用原生 SQLite。",
  "custom-database-command": "本机版把配置/笔记存放在浏览器存储（IndexedDB），未启用原生 SQLite。",
  "generate-tts": "本机版未接入云端 TTS，请使用系统语音朗读。",
  "new-chat": "本机版未接入 AI 对话窗口。",
};

function registerUnsupported() {
  Object.keys(UNSUPPORTED).forEach((channel) => {
    handle(channel, async () => {
      throw new Error(UNSUPPORTED[channel]);
    });
  });
}

// ------------------------------------------------------------
// IPC 实现
// ------------------------------------------------------------
function registerIpc() {
  registerUnsupported();

  // ---- 文件 / 目录选择：导入图书走这里 ----
  handle("select-book", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择要导入的书",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "图书",
          extensions: [
            "epub", "pdf", "txt", "mobi", "azw3", "azw", "htm", "html",
            "xml", "xhtml", "mhtml", "docx", "md", "fb2",
            "cbz", "cbt", "cbr", "cb7",
          ],
        },
        { name: "全部文件", extensions: ["*"] },
      ],
    });
    if (result.canceled) return [];
    return result.filePaths;
  });

  handle("select-path", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择目录",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return "";
    return result.filePaths[0];
  });

  handle("select-file", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择文件",
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return "";
    return result.filePaths[0];
  });

  handle("select-zip-file", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择备份文件",
      properties: ["openFile"],
      filters: [{ name: "Zip", extensions: ["zip"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return "";
    return result.filePaths[0];
  });

  handle("open-explorer-folder", async (event, config) => {
    const target = config && config.path ? config.path : DATA_DIR;
    if (!target || !fs.existsSync(target)) {
      throw new Error("目录不存在：" + target);
    }
    return shell.openPath(target);
  });

  handle("open-url", async (event, config) => {
    const url = config && config.url;
    if (!url) throw new Error("缺少 url");
    if (config.type === "shell") {
      return shell.openExternal(url);
    }
    // 内置窗口打开（词典 / 翻译 / 外链）
    const win = new BrowserWindow({
      ...defaultWindowOptions(),
      width: 900,
      height: 700,
      title: config.title || "CoRead",
    });
    win.once("ready-to-show", () => win.show());
    win.loadURL(url);
    return true;
  });

  // ---- 窗口控制 ----
  handle("enter-fullscreen", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.setFullScreen(true);
    return true;
  });
  handle("exit-fullscreen", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.setFullScreen(false);
    return true;
  });
  handle("enter-tab-fullscreen", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.setFullScreen(true);
    return true;
  });
  handle("exit-tab-fullscreen", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.setFullScreen(false);
    return true;
  });
  handle("hide-reader", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.minimize();
    return true;
  });
  handle("set-native-theme-source", (event, appSkin) => {
    // 让窗口标题栏/系统菜单跟随主题（light / dark / system）
    nativeTheme.themeSource = appSkin === "night" ? "dark" : appSkin === "light" ? "light" : "system";
    return true;
  });
  handle("set-always-on-top", (event, config) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.setAlwaysOnTop(config && config.isAlwaysOnTop === "yes");
    return true;
  });
  handle("set-auto-maximize", (event, config) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && config && config.isAutoMaximize === "yes") win.maximize();
    return true;
  });
  handle("toggle-auto-launch", (event, config) => {
    const enable = !!(config && config.isAutoLaunch === "yes");
    try {
      app.setLoginItemSettings({ openAtLogin: enable });
      return true;
    } catch (error) {
      throw new Error("设置开机自启失败：" + error.message);
    }
  });
  handle("toggle-minimize-to-tray", () => {
    // 本机版不做托盘，最小化即最小化。保留通道以免渲染端 await 悬挂。
    return true;
  });
  handle("reset-main-position", () => {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.setSize(1200, 800);
      mainWin.center();
    }
    return true;
  });
  handle("reset-reader-position", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.setSize(1000, 720);
      win.center();
    }
    return true;
  });

  // ---- 打开图书 / 标签页 ----
  handle("open-book", (event, config) => {
    const win = createReaderWindow(config || {});
    loadEntry(win, normalizeAppUrl(config && config.url));
    // 防休眠（跟上游一致：阅读时禁止系统睡眠）
    if (config && config.isPreventSleep === "yes") {
      try {
        sleepBlockerId = powerSaveBlocker.start("prevent-display-sleep");
      } catch (error) {
        /* 平台不支持就算了 */
      }
    }
    return true;
  });
  handle("new-tab", (event, config) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWin;
    if (win && !win.isDestroyed()) {
      win.loadURL(normalizeAppUrl(config && config.url));
    }
    return true;
  });
  handle("reload-tab", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWin;
    if (win && !win.isDestroyed()) win.reload();
    return true;
  });
  handle("reload-reader", (event, config) => {
    const bookKey = config && config.bookKey;
    readerWindowList.forEach((win) => {
      if (win && !win.isDestroyed() && (!bookKey || win.webContents.getURL().includes(bookKey))) {
        win.reload();
      }
    });
    return true;
  });
  handle("reload-main", () => {
    if (mainWin && !mainWin.isDestroyed()) mainWin.reload();
    return true;
  });
  handle("exit-tab", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && win !== mainWin && !win.isDestroyed()) {
      win.close();
    }
    return true;
  });
  handle("switch-moyu", () => {
    // 墨鱼（阅读器皮肤切换）在网页端由路由承担，这里无需主进程参与
    return true;
  });
  handle("close-database", () => true);
  // 渲染端 clearAllData() 会删掉图书目录，这里负责把空目录重建回来，
  // 否则下次 addBook 的 fs.mkdirSync 仍会成功，但 storageLocation 指向的父目录没了。
  handle("clear-all-data", () => {
    try {
      fs.mkdirSync(path.join(DATA_DIR, "data"), { recursive: true });
    } catch (error) {
      console.error("[CoRead] 重建数据目录失败:", error);
    }
    return true;
  });
  handle("clear-tts", () => {
    if (sleepBlockerId !== null) {
      try {
        powerSaveBlocker.stop(sleepBlockerId);
      } catch (error) {
        /* ignore */
      }
      sleepBlockerId = null;
    }
    return true;
  });

  // ---- 调试 ----
  handle("get-debug-logs", () => {
    shell.openPath(DATA_DIR);
    return "pong";
  });
  handle("open-console", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.webContents.openDevTools({ mode: "detach" });
    return true;
  });

  // ---- 加密（登录态 token 落盘用，无服务器时不启用） ----
  handle("encrypt-data", async (event, config) => {
    const { safeStorage } = require("electron");
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("当前系统不支持安全存储，无法保存登录信息。");
    }
    const token = config && config.token ? config.token : "";
    return safeStorage.encryptString(token).toString("base64");
  });
  handle("decrypt-data", async () => {
    const { safeStorage } = require("electron");
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("当前系统不支持安全存储，无法读取登录信息。");
    }
    const tokenPath = path.join(DATA_DIR, "token.bin");
    if (!fs.existsSync(tokenPath)) return "";
    const buf = Buffer.from(fs.readFileSync(tokenPath, "utf-8"), "base64");
    return safeStorage.decryptString(buf);
  });

  // ---- 生物识别：桌面端暂不支持，明确回 false 而不是挂住 ----
  handle("get-biometric-capability", () => false);
  handle("prompt-biometric-auth", () => {
    throw new Error("本机版暂不支持生物识别解锁。");
  });

  // ---- Discord RPC / OCR：不做，但别让调用方悬挂 ----
  handle("discord-rpc-update", () => true);
  handle("discord-rpc-clear", () => true);
  handle("system-ocr", () => null);

  // ---- 同步通道（渲染端用 sendSync，必须同步 set returnValue） ----
  onSync("storage-location", (event) => {
    event.returnValue = path.join(DATA_DIR, "data");
  });
  onSync("user-data", (event) => {
    event.returnValue = DATA_DIR;
  });
  onSync("get-dirname", (event) => {
    // 必须是「资源容器」而不是 __dirname：内部覆盖目录模式下
    // sql.js 等 wasm 要按这个路径去找。
    event.returnValue = resolveResourceContainer();
  });
  onSync("system-color", (event) => {
    event.returnValue = nativeTheme.shouldUseDarkColors;
  });
  onSync("url-window-status", (event) => {
    event.returnValue = readerWindowList.some((w) => w && !w.isDestroyed());
  });
  onSync("check-main-open", (event) => {
    event.returnValue = !!mainWin;
  });
  onSync("get-file-data", (event) => {
    event.returnValue = readPendingBookPath(true);
  });
  onSync("check-file-data", (event) => {
    event.returnValue = readPendingBookPath(false);
  });

  // 注意：这些是渲染端用 send() 单向发的（关窗握手），
  // 必须用 ipcMain.on 接，否则 Electron 会抛
  // "No handler registered"。
  ipcMain.on("reader-close-ready", () => {});
  ipcMain.on("tab-close-ready", () => {});
}

/** 读取「双击书本文件启动」留下的路径（由 open-file / 第二实例写入） */
function readPendingBookPath(consume) {
  try {
    const logPath = bookOpenLogPath();
    let pending = filePath;
    if (fs.existsSync(logPath)) {
      const data = JSON.parse(fs.readFileSync(logPath, "utf-8") || "{}");
      if (data && data.filePath) {
        pending = data.filePath;
        if (consume) setTimeout(() => fs.writeFileSync(logPath, "{}", "utf-8"), 1000);
      }
    }
    filePath = null;
    return pending || ".";
  } catch (error) {
    console.error("[CoRead] 读取待打开文件失败:", error);
    return ".";
  }
}

// ------------------------------------------------------------
// 单实例：第二次启动时把书交给已有窗口
// ------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (event, argv) => {
    if (mainWin && !mainWin.isDestroyed()) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
    const candidate = argv.find((a) => /\.(epub|pdf|txt|mobi|azw3?|cbz|cbt|cbr|cb7)$/i.test(a));
    if (candidate && mainWin) {
      filePath = candidate;
      mainWin.webContents.send("open-book-from-link", { filePath: candidate });
    }
  });

  app.on("ready", () => {
    DATA_DIR = path.join(app.getPath("userData"), "uploads");
    fs.mkdirSync(DATA_DIR, { recursive: true });
    Menu.setApplicationMenu(null);
    registerAppProtocol();
    registerIpc();
    createMainWindow();
  });
}

app.on("window-all-closed", () => {
  app.quit();
});
app.on("before-quit", () => {
  if (sleepBlockerId !== null) {
    try {
      powerSaveBlocker.stop(sleepBlockerId);
    } catch (error) {
      /* ignore */
    }
  }
});
app.on("open-file", (event, pathToFile) => {
  event.preventDefault();
  filePath = pathToFile;
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send("open-book-from-link", { filePath: pathToFile });
  }
});
