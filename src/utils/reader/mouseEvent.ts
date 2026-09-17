import { ConfigService } from '../../services';
import { isElectron } from "react-device-detect";
import { getIframeDoc, getIframeWin } from "./docUtil";
import { handleExitFullScreen, handleFullScreen, sleep } from "../common";
import { isMobileRuntime } from "../mobileRuntime";
import Hammer from "hammerjs";
import TTSUtil from "./ttsUtil";
import {
  getShortcutConfig,
  isNextPageKey,
  isPrevPageKey,
  matchShortcut,
  ShortcutAction,
} from "./shortcutUtil";
import { withPageTurnAnimation } from "./pageTurnAnimation";
import { bindPageSwipeTurn, smoothPageTurn } from "./pageSwipeTurn";
declare var window: any;

let throttleTime = isMobileRuntime()
  ? 220
  : (ConfigService.getReaderConfig("animation") || "none") !== "none"
  ? 240
  : 100;

/**
 * 选区快照 —— 用来救「菜单弹出来了、点任何一个按钮都没反应」。
 *
 * 场景：手机上点 CoRead 自己那个选区菜单时，**这一下点击本身会先把选区清掉**
 * （系统认为你点在了选区外面），等 onClick 跑到时 `getSelection()` 已经空了。
 * 桌面端不存在这个问题（鼠标点击不会清掉选区），所以这是纯手机向的补丁。
 *
 * 做法：在菜单弹出的那一刻（viewer 的 pointerup / contextmenu 拿到选区时）
 * 存一份 Range 的克隆。Range 克隆之后即使选区被清空也依然有效（只要那段 DOM 还在）。
 * 之后任何动作读选区前，若发现实时选区没了就把快照塞回去。
 */
let savedSelection: { doc: Document; range: Range } | null = null;

/** 记录当前选区（只在实时选区非空时覆盖快照）。 */
export const rememberSelection = (docs: any[]) => {
  for (let i = 0; i < docs.length; i++) {
    let doc = docs[i];
    if (!doc) continue;
    let sel = doc.getSelection && doc.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed && String(sel).trim()) {
      try {
        savedSelection = { doc, range: sel.getRangeAt(0).cloneRange() };
      } catch (err) {
        savedSelection = null;
      }
      return;
    }
  }
};

/** 选区被用户主动取消 / 笔记落库后调用，避免下次误恢复。 */
export const clearSavedSelection = () => {
  savedSelection = null;
};

/**
 * 把快照恢复回实时选区（仅在实时选区已经空掉时动手），返回可用的 Selection。
 * 桌面端实时选区一直在，这个函数等于什么都不做。
 */
export const ensureSelectionAlive = (doc: any): Selection | null => {
  if (!doc || !doc.getSelection) return null;
  let live = doc.getSelection();
  if (live && live.rangeCount > 0 && !live.isCollapsed && String(live).trim()) {
    return live;
  }
  if (!savedSelection || savedSelection.doc !== doc) return live;
  let range = savedSelection.range;
  try {
    // 翻页 / 重排之后 range 可能已经脱离文档了，这种情况直接放弃，别硬塞进去
    if (!doc.contains(range.startContainer) || !doc.contains(range.endContainer)) {
      savedSelection = null;
      return live;
    }
    if (!live) return null;
    live.removeAllRanges();
    live.addRange(range);
    return live;
  } catch (err) {
    savedSelection = null;
    return live;
  }
};

export const getSelection = (format: string, bookKey?: string) => {
  let docs = getIframeDoc(format, bookKey);
  let text = "";
  for (let i = 0; i < docs.length; i++) {
    let doc = docs[i];
    if (!doc) continue;
    // 手机上点菜单那一下会把选区清掉，先试恢复快照，再读
    let sel = ensureSelectionAlive(doc) || doc.getSelection();
    if (!sel || sel.rangeCount === 0) continue;
    // In Electron/Chromium, Selection.toString() includes text inside
    // user-select:none elements (e.g. <rt>/<rp> ruby annotations), even though
    // they are not visually highlighted. Clone the selected ranges into a
    // fragment, strip the ruby annotations, and read back the text so it
    // matches the visual selection (consistent with the CSS rule on <rt>).
    let fragment = doc.createDocumentFragment();
    for (let r = 0; r < sel.rangeCount; r++) {
      fragment.appendChild(sel.getRangeAt(r).cloneContents());
    }
    fragment.querySelectorAll("rt, rp").forEach((el) => el.remove());
    text = (fragment.textContent || "").trim();
    if (text) {
      break;
    }
  }

  return text;
};

export const getSelectionSentence = (
  format: string,
  bookKey?: string
): string => {
  let docs = getIframeDoc(format, bookKey);
  for (let i = 0; i < docs.length; i++) {
    let doc = docs[i];
    if (!doc) continue;
    let sel = doc.getSelection();
    if (!sel || !sel.toString().trim()) continue;
    try {
      let range = sel.getRangeAt(0);
      let container = range.commonAncestorContainer;
      // Walk up to a text-containing element
      let el: Node | null =
        container.nodeType === Node.TEXT_NODE
          ? container.parentElement
          : container;
      let fullText = (el as Element)?.textContent || "";
      let selectedText = sel.toString().trim();
      // Split on sentence-ending punctuation to find the sentence
      let sentences = fullText.split(/(?<=[.!?。！？])\s*/);
      for (let s of sentences) {
        if (s.includes(selectedText)) {
          return s.trim();
        }
      }
      // Fallback: return the whole text content of the container
      return fullText.trim();
    } catch {
      // ignore
    }
  }
  return "";
};

const clickEvent = () =>
  new MouseEvent("click", {
    view: window,
    bubbles: true,
    cancelable: true,
  });

export const searchInTheBook = (
  keyword: string,
  format: string,
  isSearch: boolean
) => {
  let leftPanel = document.querySelector(".left-panel");
  if (!leftPanel) return;
  leftPanel.dispatchEvent(clickEvent());
  const focusEvent = new MouseEvent("focus", {
    view: window,
    bubbles: true,
    cancelable: true,
  });
  let searchBox: any = document.querySelector(".header-search-box");
  searchBox.dispatchEvent(focusEvent);
  let searchIcon = document.querySelector(".header-search-icon");
  searchIcon?.dispatchEvent(clickEvent());
  if (isSearch) {
    searchBox.value = getSelection(format) || keyword;
  }
  const keyEvent: any = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    keyCode: 13,
  } as any);
  searchBox.dispatchEvent(keyEvent);
};

export const triggerPopupOptionClick = (optionName: string) => {
  const option = document.querySelector(`.${optionName}-option`);
  if (!option) return;
  option.dispatchEvent(clickEvent());
};

const SELECTION_SHORTCUT_OPTIONS: Array<{
  shortcut: ShortcutAction;
  optionName: string;
}> = [
  { shortcut: "selectionTranslate", optionName: "translation" },
  { shortcut: "selectionDict", optionName: "dict" },
  { shortcut: "selectionNote", optionName: "note" },
  { shortcut: "selectionHighlight", optionName: "highlight" },
  { shortcut: "selectionSpeak", optionName: "speaker" },
  { shortcut: "selectionSearch", optionName: "search-book" },
];

export const READING_PANEL_TOGGLE_EVENT = "koodo-reading-panel-toggle";

export const openReadingPanel = (
  position: "left" | "right" | "top" | "bottom"
) => {
  const panel = document.querySelector(`.${position}-panel`);
  if (!panel) return;
  panel.dispatchEvent(clickEvent());
};

export const toggleReadingPanel = (
  position: "left" | "right" | "top" | "bottom"
) => {
  window.dispatchEvent(
    new CustomEvent(READING_PANEL_TOGGLE_EVENT, {
      detail: { position },
    })
  );
};

export const openTableOfContents = () => {
  openReadingPanel("left");
};

const READING_PANEL_SHORTCUTS: Array<{
  shortcut: ShortcutAction;
  position: "left" | "right" | "top" | "bottom";
}> = [
  { shortcut: "openLeftPanel", position: "left" },
  { shortcut: "openRightPanel", position: "right" },
  { shortcut: "openTopPanel", position: "top" },
  { shortcut: "openBottomPanel", position: "bottom" },
];

export const NAV_TAB_TOGGLE_EVENT = "koodo-nav-tab-toggle";
export const toggleNavTab = (tab: string) => {
  window.dispatchEvent(
    new CustomEvent(NAV_TAB_TOGGLE_EVENT, {
      detail: { tab },
    })
  );
};

export const TOGGLE_DOODLE_DRAWER_EVENT = "coread-toggle-doodle-drawer";
export const toggleDoodleDrawer = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(TOGGLE_DOODLE_DRAWER_EVENT));
  }
};

const NAV_TAB_SHORTCUTS: Array<{
  shortcut: ShortcutAction;
  tab: string;
}> = [
  { shortcut: "openBookmarkList", tab: "bookmarks" },
  { shortcut: "openNoteList", tab: "notes" },
  { shortcut: "openHighlightList", tab: "highlights" },
  { shortcut: "openToc", tab: "contents" },
];
let lock = false; //prevent from clicking too fasts
const arrowKeys = async (
  rendition: any,
  event: any,
  readerMode: string,
  format: string,
  bookKey: string
) => {
  if (
    event.target.tagName.toLowerCase() === "textarea" ||
    event.target.tagName.toLowerCase() === "input"
  ) {
    return;
  }
  if (isPrevPageKey(event, readerMode)) {
    event.preventDefault();
    if (readerMode === "scroll") {
      await rendition.prev();
    } else {
      await withPageTurnAnimation("prev", () => rendition.prev());
    }
  } else if (isNextPageKey(event, readerMode)) {
    event.preventDefault();
    if (readerMode === "scroll") {
      await rendition.next();
    } else {
      await withPageTurnAnimation("next", () => rendition.next());
    }
  }
  handleShortcut(event, format, bookKey, rendition);
};

const mouseChrome = async (rendition: any, deltaY: number) => {
  if (deltaY < 0) {
    await withPageTurnAnimation("prev", () => rendition.prev());
  }
  if (deltaY > 0) {
    await withPageTurnAnimation("next", () => rendition.next());
  }
};

const handleShortcut = (
  event: any,
  format: string,
  bookKey: string,
  rendition?: any
) => {
  const shortcuts = getShortcutConfig();
  if (matchShortcut(event, shortcuts.bossKey)) {
    if (isElectron) {
      event.preventDefault();
      window.require("electron").ipcRenderer.invoke("hide-reader", "ping");
    }
  }
  if (matchShortcut(event, shortcuts.exitReader)) {
    if (ConfigService.getReaderConfig("isFullscreen") === "yes") {
      ConfigService.setReaderConfig("isFullscreen", "no");
      handleExitFullScreen();
    } else {
      ConfigService.setReaderConfig("isFullscreen", "no");
      window.speechSynthesis && window.speechSynthesis.cancel();
      TTSUtil.pauseAudio();
      if (isElectron) {
        if (ConfigService.getReaderConfig("isOpenInMain") === "yes") {
          window.require("electron").ipcRenderer.invoke("exit-tab", "ping");
        } else {
          window.close();
        }
      } else {
        ConfigService.setReaderConfig("isFinishWebReading", "yes");
        window.close();
      }
    }
  }
  if (matchShortcut(event, shortcuts.toggleFullscreen)) {
    event.preventDefault();
    const entering = ConfigService.getReaderConfig("isFullscreen") !== "yes";
    entering ? handleFullScreen() : handleExitFullScreen();
    ConfigService.setReaderConfig("isFullscreen", entering ? "yes" : "no");
  }
  if (matchShortcut(event, shortcuts.toggleFishMode)) {
    if (isElectron && ConfigService.getReaderConfig("isMergeWord")) {
      event.preventDefault();
      ConfigService.setReaderConfig(
        "isMergeWord",
        ConfigService.getReaderConfig("isMergeWord") === "yes" ? "no" : "yes"
      );
      window.require("electron").ipcRenderer.invoke("switch-moyu", "ping");
    }
  }
  if (matchShortcut(event, shortcuts.searchInBook)) {
    event.preventDefault();
    searchInTheBook("", "", false);
  }
  for (const { shortcut, position } of READING_PANEL_SHORTCUTS) {
    if (matchShortcut(event, shortcuts[shortcut])) {
      event.preventDefault();
      toggleReadingPanel(position);
      break;
    }
  }
  for (const { shortcut, tab } of NAV_TAB_SHORTCUTS) {
    if (matchShortcut(event, shortcuts[shortcut])) {
      event.preventDefault();
      toggleNavTab(tab);
      break;
    }
  }
  if (matchShortcut(event, shortcuts.createBookmark)) {
    event.preventDefault();
    const bookmarkBtn = document.querySelector(".add-bookmark-button");
    bookmarkBtn?.dispatchEvent(clickEvent());
  }
  if (rendition && matchShortcut(event, shortcuts.prevChapter)) {
    event.preventDefault();
    rendition.prevChapter();
  }
  if (rendition && matchShortcut(event, shortcuts.nextChapter)) {
    event.preventDefault();
    rendition.nextChapter();
  }
  for (const { shortcut, optionName } of SELECTION_SHORTCUT_OPTIONS) {
    if (matchShortcut(event, shortcuts[shortcut])) {
      if (getSelection(format, bookKey)) {
        event.preventDefault();
        triggerPopupOptionClick(optionName);
      }
      break;
    }
  }
};

const gesture = async (rendition: any, type: string) => {
  if (type === "panleft" || type === "swipeleft" || type === "panup") {
    await withPageTurnAnimation("next", () => rendition.next());
  }
  if (type === "panright" || type === "swiperight" || type === "pandown") {
    await withPageTurnAnimation("prev", () => rendition.prev());
  }
};

const handleLocation = (key: string, rendition: any) => {
  let position = rendition.getPosition();
  ConfigService.setObjectConfig(key, position, "recordLocation");
};
export const scrollChapter = async (
  element: any,
  rendition: any,
  deltaY: number
) => {
  if (deltaY < 0) {
    if (element.scrollTop === 0) {
      await rendition.prev();
    }
  }
  if (deltaY > 0) {
    var scrollHeight = element.scrollHeight;
    var scrollTop = element.scrollTop;
    var clientHeight = element.clientHeight;
    if (Math.abs(scrollTop + clientHeight - scrollHeight) < 10) {
      await rendition.next();
    }
  }
};
let lastScaleTime = 0;
// 每次页面渲染(rendered)都会走一遍 bindHtmlEvent;window 与存活 doc 上的
// 监听会跨渲染累积,这里记录已绑定的句柄/文档避免重复注册
let windowKeydownHandler: ((event: KeyboardEvent) => void) | null = null;
const boundDocs = new WeakSet<object>();

const isTypingOutsideIframe = () => {
  const active = document.activeElement as HTMLElement | null;
  return Boolean(
    active &&
      active.ownerDocument === document &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.isContentEditable)
  );
};

/**
 * 底部工具条(进度面板)当前是否展开。
 *
 * 读的是 `pages/reader/component.tsx` 挂上去的 `data-open` —— 刻意不去解析
 * 容器上的 transform:面板的显隐用了 translateY 内联样式,解析字符串等于把
 * 样式实现当契约,改一次样式就会静默失灵。
 */
const isReadingPanelOpen = () =>
  Boolean(
    typeof document !== "undefined" &&
      document.querySelector('.progress-panel-container[data-open="yes"]')
  );

export const bindHtmlEvent = (
  rendition: any,
  doc: any,
  key: string = "",
  readerMode: string = "",
  format: string = "",
  handleScale: (scale: string) => void,
  renderBookFunc: () => void
) => {
  doc.addEventListener(
    "keydown",
    async (event) => {
      if (lock) return;
      lock = true;
      await arrowKeys(rendition, event, readerMode, format, key);
      handleLocation(key, rendition);
      setTimeout(() => (lock = false), throttleTime);
    },
    { passive: false }
  );

  doc.addEventListener(
    "wheel",
    async (event) => {
      if (event.ctrlKey && readerMode !== "double") {
        const currentTime = Date.now();
        if (currentTime - lastScaleTime < 1500) {
          return;
        }
        lastScaleTime = currentTime;
        event.preventDefault();
        let scale = parseFloat(ConfigService.getReaderConfig("scale") || "1");
        if (event.deltaY < 0) {
          ConfigService.setReaderConfig("scale", scale + 0.1 + "");
        } else {
          ConfigService.setReaderConfig("scale", scale - 0.1 + "");
        }
        handleScale(ConfigService.getReaderConfig("scale") || "1");
        renderBookFunc();
        return;
      }
      if (lock) return;
      lock = true;
      if (readerMode === "scroll") {
        await sleep(200);
        await rendition.record();
        if (
          Math.abs(event.deltaX) === 0 &&
          ConfigService.getReaderConfig("isDisableAutoScroll") !== "yes"
        ) {
          let srollElement = document.getElementById("page-area");
          await scrollChapter(srollElement, rendition, event.deltaY);
        }
      } else {
        if (Math.abs(event.deltaX) === 0) {
          await mouseChrome(rendition, event.deltaY);
        }
      }
      handleLocation(key, rendition);
      setTimeout(() => (lock = false), throttleTime);
    },
    { passive: false }
  );

  if (windowKeydownHandler) {
    window.removeEventListener("keydown", windowKeydownHandler);
  }
  windowKeydownHandler = async (event: KeyboardEvent) => {
    if (lock) return;
    lock = true;
    await arrowKeys(rendition, event, readerMode, format, key);
    handleLocation(key, rendition);
    setTimeout(() => (lock = false), throttleTime);
  };
  window.addEventListener("keydown", windowKeydownHandler, {
    passive: false,
  });

  // 触屏设备默认启用滑动翻页(仅识别横向滑动,避免和滚动/选择冲突);
  // 桌面端仍由"触屏模式"配置项控制
  const isTouchEnabled =
    ConfigService.getReaderConfig("isTouch") === "yes" ||
    (typeof window !== "undefined" && "ontouchstart" in window);
  // 手机端(态)的滑动翻页已经由 pageSwipeTurn 的跟手实现接管：它在 touchmove 里
  // 实时拖内容、抬手再平滑吸附。这里若同时挂 Hammer 的 swipe，一次滑动会被两边
  // 各消费一次 —— 表现就是「划一下翻两页」。所以手机端不挂 Hammer。
  const useHammerSwipe = isTouchEnabled && !isMobileRuntime();
  if (useHammerSwipe) {
    const mc = new Hammer(doc);
    // 用 swipe(抬手判定、一次手势只触发一次)而非 pan:
    // 手指按住持续拖动时 pan 会连续触发导致连环翻页
    // threshold 设为 28px（默认 10px 太敏感，容易把轻触唤出菜单误判为翻页；28px 既防误触又顺手）
    // velocity 设为 0.2，保证轻扫即可触发
    mc.get("swipe").set({
      direction: Hammer.DIRECTION_HORIZONTAL,
      threshold: 28,
      velocity: 0.2,
    });
    mc.on("swipeleft swiperight", async (event: any) => {
      if (readerMode === "scroll") {
        return;
      }
      if (event.pointerType === "mouse") return;
      // 正在划选文字时不翻页
      const selection = doc.getSelection && doc.getSelection();
      if (selection && String(selection).length > 0) return;
      if (lock) return;
      lock = true;
      await gesture(rendition, event.type);
      handleLocation(key, rendition);
      setTimeout(() => (lock = false), throttleTime);
    });
  }

  // 点按分区(触屏):手机上点一下通常就是想翻页,而不是打开两侧收纳起来的
  // 面板。左 35% 上一页、右 35% 下一页、中间 30% 呼出底部工具条。
  // (2026-09-17 改:原为「左 40% / 右 40% / 中间 20% 不动作」——中间是死区。
  //  微信读书那类阅读器点中间就是呼出菜单,这里补上;两侧各收 5% 让中间更好点中。)
  // 点在链接/脚注/笔记图标上、或正在选中文字时不动作。
  // 窄屏窗口(手机/半屏)也按"点一下=翻页"处理
  //
  // 2026-09-17 二次修正（用户反馈「阅读界面无法触发菜单栏」）：
  //   ① 中间区**不再**依赖 isTouchEnabled。外层这个 if 已经判定过
  //      「触屏 or 安卓壳 or 窄屏」，再要求「中间区只在触屏上动作」，
  //      等于在窄屏浏览器 / 部分 WebView 上把中间整块写成死区 —— 怎么点都没反应。
  //   ② 唤出工具条用**独立**的节流计时，不与翻页共用一个时间戳。
  //      原先翻页后的 throttleTime（动画模式下 1000ms）会把紧随其后的
  //      「点中间」整段吞掉，表现为「有时能唤出、有时怎么点都没用」。
  //   ③ 移动端滑动阅读也启用中间区：PDF 默认就是滑动阅读，一进 PDF 就彻底
  //      没有唤出菜单的途径（连带回不到书架）。滑动阅读下两侧仍不翻页 ——
  //      滚动本身就是翻页。
  const isNarrowScreen =
    typeof document !== "undefined" && document.body.clientWidth < 570;
  const isMobileShell = isMobileRuntime();
  const enableTapZones = isTouchEnabled || isMobileShell || isNarrowScreen;
  if (enableTapZones) {
    let lastTapFlipAt = 0;
    let lastTapMenuAt = 0;
    // 唤出/收起工具条自己的节流：只防「一次手势被算成两次开合」，
    // 不能沿用翻页那个（最长 1000ms），否则「翻一页再点中间」永远被吞。
    const MENU_TAP_THROTTLE = 300;
    const isScrollMode = readerMode === "scroll";
    doc.addEventListener("click", async (event: any) => {
      try {
        const target = event.target as HTMLElement | null;
        if (!target) return;
        if (
          target.closest &&
          target.closest("a, .kookit-note, button, input, textarea")
        ) {
          return;
        }
        const selection = doc.getSelection && doc.getSelection();
        if (selection && String(selection).length > 0) return;
        const now = Date.now();
        const viewWidth = doc.body ? doc.body.clientWidth : 0;
        if (!viewWidth) return;
        // 工具条开着时,点正文任意处先收起它(这一下不翻页) —— 否则面板会一直
        // 挡着正文,用户得专门去点那个小 × 才能继续读。
        if (isReadingPanelOpen()) {
          if (now - lastTapMenuAt < MENU_TAP_THROTTLE) return;
          lastTapMenuAt = now;
          toggleReadingPanel("bottom");
          return;
        }
        const x = event.clientX;
        const isCenterTap = x >= viewWidth * 0.35 && x <= viewWidth * 0.65;
        if (isCenterTap) {
          // 中间区:呼出底部工具条 = 移动端主菜单（返回书架 / 目录 /
          // 随心笔记 / 阅读选项都在它上面）。
          if (now - lastTapMenuAt < MENU_TAP_THROTTLE) return;
          lastTapMenuAt = now;
          toggleReadingPanel("bottom");
          return;
        }
        // 滑动阅读下两侧不翻页(滚动本身就是翻页),只保留中间的「唤出菜单」
        if (isScrollMode) return;
        if (now - lastTapFlipAt < throttleTime) return;
        lastTapFlipAt = now;
        const dir = x < viewWidth * 0.35 ? "prev" : "next";
        // 手机端点按也走「平滑滑动 + record() 记账」，与滑动翻页同一套观感；
        // 只有到本章首/尾（同篇文档内滑不动了）才交回内核做跨章硬切。
        // 桌面端一行不动。
        let handled = false;
        if (isMobileRuntime()) {
          handled = await smoothPageTurn(rendition, doc, dir);
        }
        if (!handled) {
          if (dir === "prev") {
            await withPageTurnAnimation("prev", () => rendition.prev());
          } else {
            await withPageTurnAnimation("next", () => rendition.next());
          }
        }
        handleLocation(key, rendition);
      } catch (e) {
        // 翻页失败不打断其它点击行为
      }
    });
  }

  doc.addEventListener(
    "touchend",
    async () => {
      if (lock) return;
      lock = true;
      if (readerMode === "scroll") {
        await sleep(200);
        await rendition.record();
      }
      handleLocation(key, rendition);
      setTimeout(() => (lock = false), throttleTime);
    },
    { passive: false }
  );

  // 手机端：跟手拖动（实时拖内容）+ 抬手平滑吸附 + record() 让内核记账。
  // 内部自带 isMobileRuntime() 与 readerMode==="scroll" 守卫，桌面端不受影响。
  bindPageSwipeTurn(rendition, doc, readerMode);
};
export const htmlMouseEvent = (
  rendition: any,
  key: string,
  readerMode: string,
  format: string,
  handleScale: (scale: string) => void,
  renderBookFunc: () => void
) => {
  rendition.on("rendered", () => {
    let iframe = getIframeWin();
    if (!iframe) return;
    // 输入框(如共读面板)正聚焦时不能把焦点抢回书籍 iframe,
    // 否则手机端软键盘会立即收起,导致面板无法输入
    if (!isTypingOutsideIframe()) {
      iframe?.focus();
    }
    let docs = getIframeDoc(format, key);
    for (let i = 0; i < docs.length; i++) {
      let doc = docs[i];
      if (!doc || boundDocs.has(doc)) continue;
      boundDocs.add(doc);
      bindHtmlEvent(
        rendition,
        doc,
        key,
        readerMode,
        format,
        handleScale,
        renderBookFunc
      );
    }
    lock = false;
  });
};
