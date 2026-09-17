/**
 * 运行形态判定：当前这次运行是不是「移动端阅读形态」。
 *
 * 判的不是屏幕宽度，而是**运行容器**，理由见下：
 * - 安卓壳（Capacitor）：`window.Capacitor.isNativePlatform()` 为真 —— 主要目标形态。
 *   该对象由 Capacitor 原生侧注入（`JSExport.getGlobalJS` 建骨架，
 *   `native-bridge.js` 往上挂 `isNativePlatform()` / `getPlatform()`），已实测存在。
 * - 手机 / 平板浏览器：没有 Capacitor，退化为「触屏 + 屏幕短边 ≤ 768」。
 *   这里用 `screen` 而不是 `innerWidth`：桌面浏览器把窗口拖窄不该被当成手机。
 * - 桌面（Electron / 浏览器）：假。桌面上平滑滚动、1000ms 翻页等待都是合理行为，不该被内核的移动分支关掉。
 *
 * ⚠️ 这个值会被塞进 kookit 内核的 `isMobile` 配置（内核只认字符串 `"yes"` / `"no"`），
 * 内核据此改以下行为（源码实测，见 MOBILE-UX-PLAN.md 第 1 节）：
 *   1. 翻页滚动由 `smooth` 改瞬时 `auto`；
 *   2. 翻页后跳过 1000ms 等待（`record()` 里那段 `setTimeout`）；
 *   3. **强制放行 iframe 内脚本**（无视用户的 `isAllowScript` 设置）；
 *   4. 段落模式控件的 bottom 偏移由 20px 改 32px、可见边界 padding 由 16 改 0；
 *   5. **把 `console.log / info / error` 改写成 `window.ReactNativeWebView.postMessage(...)`**。
 * 第 5 条意味着必须同时安装兼容桩（见 `installReactNativeWebViewStub`）。
 */

/** 是否为移动端运行形态。 */
export function isMobileRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const cap = (window as any).Capacitor;
  if (cap && typeof cap.isNativePlatform === "function") {
    return !!cap.isNativePlatform();
  }
  const isTouch =
    "ontouchstart" in window ||
    (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0);
  if (!isTouch) {
    return false;
  }
  const shortSide = Math.min(
    (window.screen && window.screen.width) || 9999,
    (window.screen && window.screen.height) || 9999
  );
  return shortSide <= 768;
}

/**
 * 给内核 config 用的取值，5 处走显示 / 渲染的调用点统一走这里。
 *
 * **预缓存路径（`preCacheAllBooks`）刻意不用它，保持 `"no"`**：
 * 那条路径只把书解析成缓存数据、不显示，内核里受 `isMobile` 影响的几项
 * （翻页滚动行为、控件偏移、段落模式边界）都碰不到它；
 * 而它的 config 与显示端本来就已有多处不同（`readerMode`、`textRules` 等），
 * 两边独立是既有设计。跟随运行形态只会多出一批「走移动分支才生成」的缓存，
 * 让缓存与显示端行为分叉，收益为零、回归风险不为零。
 */
export function isMobileConfigValue(): "yes" | "no" {
  return isMobileRuntime() ? "yes" : "no";
}

/**
 * 安装 `window.ReactNativeWebView` 兼容桩。
 *
 * 背景：内核里带一整套「Koodo 自家 React Native 客户端」适配，共 **38 处** 直接调用
 * `window.ReactNativeWebView.postMessage(...)` —— 不只是 console 劫持那一处，
 * 还包括触摸翻页、滑动到底 / 到顶、选区变化、双指缩放、点击外链、图片查看等事件。
 * 这些事件在安卓真机上**都会被触发**。
 *
 * 我们是 Capacitor 壳，没有这个桥，所以：
 * - 事件侧：会抛 `TypeError: Cannot read properties of undefined (reading 'postMessage')`；
 * - 日志侧：`isMobile` 为 `"yes"` 时内核把 console 三件套改写成桥调用，于是**连报错都打不出来**。
 *
 * 处置：放一个带 `__coreadStub` 标记的空桩。postMessage 什么都不做（那些事件本来就是
 * 发给 RN 宿主的，Capacitor 侧无需消费）；标记则让内核跳过 console 劫持，日志照常。
 * 真 RN 客户端里不存在这个桩，内核行为不受影响。
 *
 * 必须在任何 `GeneralRender` 构造之前调用 —— 目前挂在 `src/index.tsx` 的最前面。
 */
export function installReactNativeWebViewStub(): void {
  if (typeof window === "undefined") {
    return;
  }
  const w = window as any;
  if (w.ReactNativeWebView) {
    return;
  }
  w.ReactNativeWebView = {
    __coreadStub: true,
    postMessage: () => {
      /* 空实现：内核发往 RN 宿主的事件在 Capacitor 下无人消费，静默丢弃 */
    },
  };
}

/**
 * 诊断测量：输出布局视口、物理屏幕、断点匹配与 Capacitor 环境数据。
 * 用于验证移动端视口设置与断点生效情况。
 */
export function logViewportDiagnostics(): void {
  if (typeof window === "undefined") return;
  try {
    const diag = {
      innerWidth: window.innerWidth,
      clientWidth: document.documentElement.clientWidth,
      dpr: window.devicePixelRatio,
      visualW: window.visualViewport ? window.visualViewport.width : null,
      visualH: window.visualViewport ? window.visualViewport.height : null,
      screen: [window.screen.width, window.screen.height],
      is570: window.matchMedia("(max-width: 570px)").matches,
      is576: window.matchMedia("(max-width: 576px)").matches,
      capacitor: !!(
        (window as any).Capacitor &&
        (window as any).Capacitor.isNativePlatform &&
        (window as any).Capacitor.isNativePlatform()
      ),
      isMobile: isMobileRuntime(),
    };
    console.log("[ViewportDiagnostics]", JSON.stringify(diag));
  } catch (err) {
    console.error("[ViewportDiagnostics] failed", err);
  }
}

/**
 * 请求持久化存储配额（防止 Android 系统因存储紧张回收 IndexedDB 造成丢书）。
 * 在支持的浏览器和 WebView 环境下安全异步调用。
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (
    typeof navigator === "undefined" ||
    !navigator.storage ||
    !navigator.storage.persist
  ) {
    return false;
  }
  try {
    const isPersisted = await navigator.storage.persisted();
    if (isPersisted) {
      return true;
    }
    const granted = await navigator.storage.persist();
    console.log(`[Storage] Persistent storage granted: ${granted}`);
    return granted;
  } catch (err) {
    console.warn("[Storage] Failed to request persistent storage", err);
    return false;
  }
}

/**
 * 切换移动端系统状态栏可见性（阅读时沉浸隐藏，退出时恢复）。
 */
export function setMobileStatusBar(visible: boolean): void {
  if (typeof window === "undefined") return;
  try {
    const androidBar = (window as any).AndroidStatusBar;
    if (androidBar && typeof androidBar.setStatusBarVisible === "function") {
      androidBar.setStatusBarVisible(visible);
    }
  } catch (err) {
    // 忽略平台不支持情况
  }
}

/**
  * 设置全局 Android 返回键拦截分发器（挂载到 window.handleAndroidBack）。
  * 返回 boolean：true 表示已由 Web 前端消费（不退出应用），false 表示在书架根页面（交由 Android 原生双击退出）。
  */
export function setupGlobalAndroidBackHandler(): void {
  if (typeof window === "undefined") return;
  (window as any).handleAndroidBack = () => {
    // 1. 如果阅读器内注册了当前活跃的处理函数（关闭选区、关闭面板、退出阅读等）
    const readerHandler = (window as any).readerAndroidBackHandler;
    if (typeof readerHandler === "function") {
      const handled = readerHandler();
      if (handled) return true;
    }

    // 2. 如果页面上有任何打开的通用模态框或取消按钮，点击取消
    const cancelBtn = document.querySelector(
      ".add-dialog-cancel, .edit-dialog-cancel, .delete-dialog-cancel, .action-dialog-cancel, .token-dialog-cancel, .popup-close"
    ) as HTMLElement | null;
    if (cancelBtn) {
      cancelBtn.click();
      return true;
    }

    // 3. 如果有下拉菜单遮罩层开启（如导入下拉、排序菜单），关闭它
    const backdrop = document.querySelector(".more-options-backdrop") as HTMLElement | null;
    if (backdrop) {
      backdrop.click();
      return true;
    }

    // 4. 如果当前处于书架的子路由（如标签、云端、设置等），回退到书架首页 #/manager/home
    const hash = window.location.hash || "";
    if (hash.startsWith("#/manager") && !hash.includes("/manager/home")) {
      window.location.hash = "#/manager/home";
      return true;
    }

    // 5. 如果路由仍在阅读器（例如冷启动或异常未注册 handler），退出沉浸状态并回到书架
    if (hash.includes("/reader")) {
      setMobileStatusBar(true);
      window.location.hash = "#/manager/home";
      return true;
    }

    // 6. 已在书架首页且无任何弹窗，返回 false，交由 Android 原生 Toast「再按一次退出应用」
    return false;
  };
}
