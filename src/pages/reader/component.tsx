import React from "react";
import SettingPanel from "../../containers/panels/settingPanel";
import NavigationPanel from "../../containers/panels/navigationPanel";
import { Toaster, toast } from "react-hot-toast";
import ProgressPanel from "../../containers/panels/progressPanel";
import { ReaderProps, ReaderState } from "./interface";
import { ReadingTimeUtil } from "../../services";
import { configStore, readingProgressStore } from "../../core/ports/stores";
import Viewer from "../../containers/viewer";
import { Tooltip } from "react-tooltip";
import "./index.css";
import Book from "../../models/Book";
import DatabaseService from "../../utils/storage/databaseService";
import ConvertDialog from "../../components/dialogs/convertDialog";
import PdfCropDialog from "../../components/dialogs/pdfCropDialog";
import { isElectron } from "react-device-detect";
import { handleExitFullScreen } from "../../utils/common";
import TTSUtil from "../../utils/reader/ttsUtil";
import SettingDialog from "../../components/dialogs/settingDialog";
import SpeechDialog from "../../components/dialogs/speechDialog";
import PopupOptionDialog from "../../components/dialogs/popupOptionDialog";
import {
  updateDiscordPresence,
  clearDiscordPresence,
} from "../../utils/reader/discordRPC";
import {
  READING_PANEL_TOGGLE_EVENT,
  TOGGLE_DOODLE_DRAWER_EVENT,
  toggleDoodleDrawer,
} from "../../utils/reader/mouseEvent";
import CollabPanel from "../../containers/collabPanel";
import DoodleLayer from "../../components/doodleLayer";
import collabClient, {
  getCollabBookKey,
} from "../../utils/collab/collabClient";
import { isMobileRuntime, setMobileStatusBar } from "../../utils/mobileRuntime";
import {
  READER_VIEW_SETTLED_EVENT,
  TOGGLE_BOOKMARK_BY_GESTURE_EVENT,
  TURN_CHAPTER_BY_GESTURE_EVENT,
} from "../../utils/reader/pageSwipeTurn";
import {
  getBookmarkSignature,
  placeSignature,
  toggleBookmarkByGesture,
} from "../../utils/reader/bookmarkUtil";

let lock = false; //prevent from clicking too fasts
let throttleTime = 200;
let isMouseMoving = false;
const PANEL_POSITIONS = ["left", "right", "top", "bottom"] as const;
type PanelPosition = (typeof PANEL_POSITIONS)[number];
const PANEL_ENTER_DELAY = 500;
const PANEL_LEAVE_DELAY = 500;
const enterTimers: Record<string, NodeJS.Timeout | null> = {
  left: null,
  right: null,
  top: null,
  bottom: null,
};
const leaveTimers: Record<string, NodeJS.Timeout | null> = {
  left: null,
  right: null,
  top: null,
  bottom: null,
};
const isEdgeHovering: Record<string, boolean> = {
  left: false,
  right: false,
  top: false,
  bottom: false,
};
const PANEL_OPEN_STATE: Record<
  PanelPosition,
  | "isOpenLeftPanel"
  | "isOpenRightPanel"
  | "isOpenTopPanel"
  | "isOpenBottomPanel"
> = {
  left: "isOpenLeftPanel",
  right: "isOpenRightPanel",
  top: "isOpenTopPanel",
  bottom: "isOpenBottomPanel",
};

// 阅读器是否在用深色纸张。kookit 里深色主题就是这一个固定值
// （见 containers/viewer/component.tsx 的 isDarkMode 判断），
// 页眉底衬要跟着走，否则深色主题下会出现一块白条。
function isDarkReaderTheme(): boolean {
  try {
    return (
      configStore.getReaderConfig("backgroundColor") === "rgba(44,47,49,1)"
    );
  } catch (e) {
    return false;
  }
}

class Reader extends React.Component<ReaderProps, ReaderState> {
  messageTimer!: NodeJS.Timeout;
  tickTimer!: NodeJS.Timeout;
  // 右上角页眉节点 + 它的尺寸观察器（涂鸦工具条要按页眉宽度让位）
  private dockRef: HTMLDivElement | null = null;
  private dockObserver: ResizeObserver | null = null;
  // 共读事件订阅（入房时按共读规则调整阅读模式）
  private collabUnsubs: Array<() => void> = [];
  // 已经挂过「rendered / page-changed」监听的 rendition —— 换书会换一个新对象，
  // 靠它做「同一份只挂一次」的判断（内核的 on 没有去重）
  private boundRendition: any = null;
  private readingTimeUtil = new ReadingTimeUtil(
    configStore,
    isElectron
      ? {
          registerUnloadHandler(callback: () => void): () => void {
            const { ipcRenderer } = (window as any).require("electron");
            // Separate reader window close
            ipcRenderer.on("before-reader-close", callback);
            // In-app tab (WebContentsView) close
            ipcRenderer.on("before-tab-close", callback);
            return () => {
              ipcRenderer.removeListener("before-reader-close", callback);
              ipcRenderer.removeListener("before-tab-close", callback);
            };
          },
          onBeforeClose(): void {
            const { ipcRenderer } = (window as any).require("electron");
            // Reply to whichever close signal is active
            ipcRenderer.send("reader-close-ready");
            ipcRenderer.send("tab-close-ready");
          },
        }
      : {
          registerUnloadHandler(callback: () => void): () => void {
            window.addEventListener("beforeunload", callback);
            return () => window.removeEventListener("beforeunload", callback);
          },
        }
  );
  constructor(props: ReaderProps) {
    super(props);
    this.state = {
      isOpenTopPanel: false,
      isOpenBottomPanel: false,
      hoverPanel: "",
      isOpenLeftPanel: this.props.isNavLocked,
      // 手机端忽略「锁定阅读选项面板」：锁定 = 桌面端把面板钉住不收，
      // 手机上没有任何可感知效果，却会让每次进书都被抽屉挡住。
      // 锁定入口在手机上已隐藏，SettingPanel 挂载时也会清掉遗留的 "yes"。
      isOpenRightPanel: isMobileRuntime() ? false : this.props.isSettingLocked,
      totalDuration: 0,
      currentDuration: 0,
      scale: configStore.getReaderConfig("scale") || "1",
      isTouch: configStore.getReaderConfig("isTouch") === "yes",
      isPreventTrigger:
        configStore.getReaderConfig("isPreventTrigger") === "yes",
      isShowScale: false,
      // 从「共同阅读」页面点「开始阅读」进来时,自动弹出共读面板完成入房
      isCollabOpen: Boolean(localStorage.getItem("koodo-collab-pending-join")),
      isDoodleOpen: false,
      // 随心笔记在手机端是「左侧抽屉」形态（见 DoodleLayer 的移动端分支）。
      // 这个开关由阅读器持有、下发给 DoodleLayer，因为唤出它的入口在顶栏上 ——
      // 和「目录」共用同一套「左抽屉 + 随时唤出/隐藏」的心智模型。
      isDoodleDrawerOpen: false,
      // 手机端顶栏的小旗：当前这一页在书签库里已经有了。
      // 刻意不复用全局的 viewArea.isShowBookmark —— 那个状态由 operationPanel
      // 的 page-changed 监听管着，比对口径是老的 `JSON.stringify(progress)`
      // （漏 await，恒为 "{}"），手势路径写进去的 `c2|n7|p3` 指纹永远匹配不上，
      // 一翻页就被它关掉。这里自己算，桌面端不受影响。
      isViewBookmarked: false,
      dockWidth: 0,
    };
  }
  componentDidMount() {
    setMobileStatusBar(false);
    // 若不是从云书库「共同阅读」带参数进入房间，且内存中有残留旧房间会话，
    // 则主动离开旧房间，保证从个人书架直接打开图书时为纯净本地模式
    try {
      if (!localStorage.getItem("koodo-collab-pending-join") && collabClient.roomId) {
        collabClient.leaveRoom().catch(() => {});
      }
    } catch (e) {}
    if (configStore.getReaderConfig("isMergeWord") === "yes") {
      document
        .querySelector("body")
        ?.setAttribute("style", "background-color: rgba(0,0,0,0)");
    }

    // 页眉宽度会变（PDF 才有的裁剪/转换图标、展开的缩放条、窄屏压缩），
    // 涂鸦工具条靠它让位，所以这里持续观察，不能只在挂载时量一次。
    if (this.dockRef && typeof ResizeObserver !== "undefined") {
      try {
        this.dockObserver = new ResizeObserver(() => {
          const width = this.dockRef ? this.dockRef.offsetWidth : 0;
          if (width !== this.state.dockWidth) this.setState({ dockWidth: width });
        });
        this.dockObserver.observe(this.dockRef);
      } catch (e) {
        this.dockObserver = null;
      }
    }

    // Update UI counters every second so the navigation panel still shows
    // live reading-time values, but actual storage writes only happen when
    // a reading session ends (visibility hidden / blur / unmount).
    this.tickTimer = setInterval(() => {
      if (!this.props.currentBook.key) return;
      this.setState((prev) => ({
        totalDuration: prev.totalDuration + 60,
        currentDuration: prev.currentDuration + 60,
      }));
    }, 60000);

    window.addEventListener("beforeunload", function (event) {
      if (!isElectron) {
        configStore.setReaderConfig("isFinishWebReading", "yes");
      }
    });
    window.addEventListener("mousemove", () => {
      isMouseMoving = true;
      setTimeout(() => {
        isMouseMoving = false;
      }, 100);
    });
    window.addEventListener(
      READING_PANEL_TOGGLE_EVENT,
      this.handleReadingPanelToggle
    );
    window.addEventListener(
      TOGGLE_DOODLE_DRAWER_EVENT,
      this.handleToggleDoodleDrawer
    );
    // 手机端「一页落定」（同章跟手翻页 / tap 分区翻页）之后，刷新顶栏那个
    // 「当前页有书签」的小旗。同章翻页是我们直接改 scrollLeft 做的，
    // 内核不会派发 page-changed，不自己通知的话小旗会停在旧状态。
    window.addEventListener(READER_VIEW_SETTLED_EVENT, this.refreshBookmarkFlag);
    // 手机端「下拉页面加 / 撤标签」：动作在 iframe 里识别（pageSwipeTurn.ts），
    // 事件派发到外层窗口，由这里落到书签库。
    window.addEventListener(
      TOGGLE_BOOKMARK_BY_GESTURE_EVENT,
      this.handleToggleBookmarkByGesture
    );
    // 手机端「滑动阅读贴到章末/章首继续拖 = 换章」：同上，换章交回这里才拿得到 t()/toast
    window.addEventListener(
      TURN_CHAPTER_BY_GESTURE_EVENT,
      this.handleTurnChapterByGesture as any
    );
    // 注册 Android 系统返回键专用处理器
    (window as any).readerAndroidBackHandler = () => {
      // 1. 如果有打开的抽屉 / 菜单面板，按返回键先收起抽屉
      if (
        this.state.isOpenBottomPanel ||
        this.state.isOpenLeftPanel ||
        this.state.isOpenRightPanel ||
        this.state.isCollabOpen ||
        this.state.isDoodleDrawerOpen
      ) {
        this.setState({
          isOpenBottomPanel: false,
          isOpenLeftPanel: false,
          isOpenRightPanel: false,
          isCollabOpen: false,
          isDoodleDrawerOpen: false,
        });
        return true;
      }
      // 2. 沉浸阅读状态下按下系统返回键：直接平滑退出阅读器回到书架
      this.handleExitReading();
      return true;
    };
  }

  handleToggleDoodleDrawer = () => {
    if (!this.state.isDoodleOpen) {
      this.setState({
        isDoodleOpen: true,
        isDoodleDrawerOpen: true,
      });
    } else {
      this.setState((prev) => ({
        isDoodleDrawerOpen: !prev.isDoodleDrawerOpen,
      }));
    }
  };

  /**
   * 手机端顶栏的小旗：当前这一页在书签库里已经有了吗。
   *
   * 指纹沿用 `bookmarkUtil.placeSignature()`（`c<章>|n<序>|p<页>`）—— 必须和
   * 「下拉加标签」写进库里的 `cfi` 是同一套口径，否则就是「明明加上了、
   * 小旗就是不亮」的鬼打墙。全局那套 `viewArea.isShowBookmark` 走的是老口径
   * （`JSON.stringify(progress)`，还漏了 await，恒为 `"{}"`），这里刻意不复用它。
   */
  refreshBookmarkFlag = () => {
    const rendition = (this.props as any).htmlBook?.rendition;
    const list: any[] = (this.props as any).bookmarks || [];
    let next = false;
    try {
      if (rendition?.getPosition) {
        const signature = placeSignature(rendition.getPosition() || {});
        next = list.some(
          (item) =>
            item &&
            (item.cfi === signature || getBookmarkSignature(item) === signature)
        );
      }
    } catch (err) {
      next = false;
    }
    if (next !== this.state.isViewBookmarked) {
      this.setState({ isViewBookmarked: next });
    }
  };

  /**
   * 加 / 撤之后**直接定音**，不等 redux 刷新再算：
   * `handleFetchBookmarks()` 是 dispatch，props 要下一轮才更新，
   * 而这次操作针对的就是当前页，结果本来就知道。
   */
  markViewBookmarked = (bookmarked: boolean) => {
    if (bookmarked !== this.state.isViewBookmarked) {
      this.setState({ isViewBookmarked: bookmarked });
    }
  };

  componentDidUpdate(prevProps: ReaderProps) {
    // 书签库换了引用（加 / 撤之后 handleFetchBookmarks 会重新拉一份）⇒ 重算
    if (prevProps.bookmarks !== (this.props as any).bookmarks) {
      this.refreshBookmarkFlag();
    }
    // 首次拿到 rendition / 换书之后补挂监听（同一个 rendition 只挂一次）
    const rendition = (this.props as any).htmlBook?.rendition;
    if (rendition && rendition !== this.boundRendition) {
      this.boundRendition = rendition;
      try {
        rendition.on("rendered", this.refreshBookmarkFlag);
        rendition.on("page-changed", this.refreshBookmarkFlag);
      } catch (err) {
        /* 内核不给这两个事件也就算了：手势路径与 READER_VIEW_SETTLED 仍会驱动 */
      }
      this.refreshBookmarkFlag();
    }
  }

  handleAIAssistant = async () => {
    if (!this.props.htmlBook?.rendition) return;
    this.props.handleMenuMode("assistant");
    try {
      const text = await this.props.htmlBook.rendition.chapterText();
      this.props.handleOriginalText(text || "");
    } catch {
      this.props.handleOriginalText("");
    }
    this.props.handleOpenMenu(true);
  };

  handleToggleSpeech = () => {
    this.props.handleSpeechDialog(!this.props.isSpeechOpen);
  };

  handleCollabModeLock = () => {
    const book = this.props.currentBook;
    if (!book?.key) return;
    const isPdfLike =
      (book.format === "PDF" &&
        !configStore.getAllListConfig("convertPDFBooks").includes(book.key)) ||
      book.format.startsWith("CB");
    if (isPdfLike) {
      if (configStore.getReaderConfig("pdfReaderMode") !== "scroll") return;
      configStore.setReaderConfig("pdfReaderMode", "single");
    } else {
      if (this.props.readerMode !== "scroll") return;
      configStore.setReaderConfig("readerMode", "single");
    }
    this.props.handleReaderMode("single");
    this.props.renderBookFunc();
  };
  async UNSAFE_componentWillMount() {
    let url = document.location.href;
    let firstIndexOfQuestion = url.indexOf("?");
    let lastIndexOfSlash = url.lastIndexOf("/", firstIndexOfQuestion);
    let key = url.substring(lastIndexOfSlash + 1, firstIndexOfQuestion);
    this.props.handleFetchBooks();
    this.props.handleFetchAuthed();
    if (
      key &&
      configStore.getAllListConfig("convertPDFBooks").includes(key) &&
      configStore.getReaderConfig(
        this.props.currentBook?.description?.indexOf("scanned") > -1
          ? "scannedOcrEngine"
          : "textOcrEngine"
      ) === "official-ai-ocr"
    ) {
      await this.props.handleFetchUserInfo();
    }
    DatabaseService.getRecord(key, "books").then((book: Book | null) => {
      book = book || JSON.parse(configStore.getItem("tempBook") || "{}");
      if (!book) return;

      this.props.handleFetchPercentage(book);
      let readerMode =
        (book.format === "PDF" &&
          !configStore.getAllListConfig("convertPDFBooks").includes(
            book.key
          )) ||
        book.format.startsWith("CB")
          ? configStore.getReaderConfig("pdfReaderMode") || "scroll"
          : configStore.getReaderConfig("readerMode") ||
            // 窄屏(手机浏览器)默认单页,否则一屏会被排成两个过窄的小页
            (document.body.clientWidth < 570 ? "single" : "double");
      this.props.handleReaderMode(readerMode);
      this.props.handleReadingBook(book);
      // Start event-driven reading-time tracking
      this.readingTimeUtil.start(book.key);
      // Initialise UI duration from persisted total
      const savedTotal = this.readingTimeUtil.getTotalSeconds(book.key);
      this.setState({ totalDuration: savedTotal, currentDuration: 0 });
      if (isElectron) {
        updateDiscordPresence(book);
      }
    });
  }

  componentWillUnmount() {
    (window as any).readerAndroidBackHandler = null;
    setMobileStatusBar(true);
    window.removeEventListener(
      READING_PANEL_TOGGLE_EVENT,
      this.handleReadingPanelToggle
    );
    window.removeEventListener(
      TOGGLE_DOODLE_DRAWER_EVENT,
      this.handleToggleDoodleDrawer
    );
    window.removeEventListener(
      READER_VIEW_SETTLED_EVENT,
      this.refreshBookmarkFlag
    );
    window.removeEventListener(
      TOGGLE_BOOKMARK_BY_GESTURE_EVENT,
      this.handleToggleBookmarkByGesture
    );
    window.removeEventListener(
      TURN_CHAPTER_BY_GESTURE_EVENT,
      this.handleTurnChapterByGesture as any
    );
    this.collabUnsubs.forEach((unsubscribe) => unsubscribe());
    this.collabUnsubs = [];
    try {
      localStorage.removeItem("koodo-collab-pending-join");
      if (collabClient.roomId) {
        collabClient.leaveRoom().catch(() => {});
      }
    } catch (err) {}
    if (isElectron) {
      clearDiscordPresence();
    }
    if (this.dockObserver) {
      try {
        this.dockObserver.disconnect();
      } catch (e) {
        // 忽略
      }
      this.dockObserver = null;
    }
    clearInterval(this.tickTimer);
    PANEL_POSITIONS.forEach((position) => {
      this.cancelEnterReader(position);
      this.cancelLeaveReader(position);
    });
    // Flush any in-flight session time before the component tears down
    this.readingTimeUtil.stop();
  }

  cancelEnterReader = (position: string) => {
    isEdgeHovering[position] = false;
    if (enterTimers[position]) {
      clearTimeout(enterTimers[position]!);
      enterTimers[position] = null;
    }
  };

  scheduleEnterReader = (position: string) => {
    this.cancelEnterReader(position);
    isEdgeHovering[position] = true;
    const delay = this.state.isPreventTrigger ? 0 : PANEL_ENTER_DELAY;
    enterTimers[position] = setTimeout(() => {
      enterTimers[position] = null;
      if (!isEdgeHovering[position] || isMouseMoving) return;
      this.handleEnterReader(position);
    }, delay);
  };

  cancelLeaveReader = (position: string) => {
    if (leaveTimers[position]) {
      clearTimeout(leaveTimers[position]!);
      leaveTimers[position] = null;
    }
  };

  scheduleLeaveReader = (position: string) => {
    this.cancelLeaveReader(position);
    leaveTimers[position] = setTimeout(() => {
      leaveTimers[position] = null;
      this.handleLeaveReader(position);
    }, PANEL_LEAVE_DELAY);
  };

  handleEdgeMouseEnter = (position: PanelPosition) => {
    if (
      this.state.isTouch ||
      this.state[PANEL_OPEN_STATE[position]] ||
      this.state.isPreventTrigger
    ) {
      this.cancelLeaveReader(position);
      this.setState({ hoverPanel: position });
      return;
    }
    this.scheduleEnterReader(position);
  };

  handleEdgeMouseLeave = (position: PanelPosition) => {
    this.cancelEnterReader(position);
    this.setState({ hoverPanel: "" });
  };

  handleEnterReader = (position: string) => {
    this.cancelEnterReader(position);
    this.cancelLeaveReader(position);
    // 手机窄屏互斥:同一时刻最多一个抽屉,避免多面板互相重叠盖住正文后关不掉
    const isNarrowScreen = document.body.clientWidth < 570;
    const target = PANEL_OPEN_STATE[position as PanelPosition];
    // 目标不是四个已知面板之一就直接退出 —— 否则下面的循环会写出 undefined 键。
    if (!target) return;
    const update: any = {};
    if (isNarrowScreen) {
      PANEL_POSITIONS.forEach((panel) => {
        update[PANEL_OPEN_STATE[panel]] = panel === position;
      });
    } else {
      update[target] = true;
    }
    // ⚠️ 这里的 update 必须永远非空。
    // 历史写法把 else 分支写成一串 `else if (position === "left") ... else if
    // ("bottom") ...`，四种之外的位置（以及将来新增的面板名）会落到「什么都没匹配」
    // 的情况下 —— `setState({})` 是合法调用但**什么也不会发生**，静默失效、连报错都没有。
    // 现象就是「点屏幕中央偶尔唤不出菜单」，且因为 mobile-reader-top-bar 只在
    // 底部面板展开时才滑出 → 连带「进阅读器之后回不到书架」。
    this.setState(update);
  };
  // 万能逃生门:无视锁定直接收起全部面板(手机上鼠标移出关闭不可用)
  handleCloseAllPanels = () => {
    this.setState({
      isOpenLeftPanel: false,
      isOpenRightPanel: false,
      isOpenTopPanel: false,
      isOpenBottomPanel: false,
    });
  };
  handleExitReading = (e?: any) => {
    if (e && e.stopPropagation) {
      e.stopPropagation();
    }
    configStore.setReaderConfig("isFullscreen", "no");
    if (window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch (err) {}
    }
    try {
      TTSUtil.pauseAudio();
    } catch (err) {}
    try {
      handleExitFullScreen();
    } catch (err) {}
    try {
      localStorage.removeItem("koodo-collab-pending-join");
      if (collabClient.roomId) {
        collabClient.leaveRoom().catch(() => {});
      }
    } catch (err) {}

    if (isElectron) {
      if (configStore.getReaderConfig("isOpenInMain") === "yes") {
        (window as any).require("electron").ipcRenderer.invoke("exit-tab", "ping");
      } else {
        window.close();
      }
      return;
    }

    configStore.setReaderConfig("isFinishWebReading", "yes");

    // 移动端（Capacitor 壳或手机触屏）：必须直接切换 hash 回到书架，
    // 在 Android WebView 中调用 window.close() 会被系统忽略导致页面卡死在阅读器
    const isMobile = isMobileRuntime() || document.body.clientWidth < 570;
    if (isMobile) {
      setMobileStatusBar(true);
      if (this.props.history?.push) {
        this.props.history.push("/manager/home");
      }
      window.location.hash = "#/manager/home";
      return;
    }

    // 桌面 Web 浏览器：优先尝试关闭标签页，若关不掉则自动回退到书架
    if (window.opener) {
      window.close();
      setTimeout(() => {
        if (!window.closed) {
          window.location.hash = "#/manager/home";
        }
      }, 150);
    } else {
      window.location.hash = "#/manager/home";
    }
  };
  // 当前书是否处于「滑动阅读」模式(随手笔记的滚轮转发要用)
  isScrollReaderMode = () => {
    // currentBook / format 在阅读器挂载早期可能尚未就绪,
    // 这里必须兜底,否则 render 期间访问会直接抛错导致整页白屏
    const format = this.props.currentBook?.format;
    if (!format || typeof format !== "string") return false;
    const mode =
      format === "PDF" &&
      !configStore.getAllListConfig("convertPDFBooks").includes(
        this.props.currentBook.key
      ) ||
      format.startsWith("CB")
        ? configStore.getReaderConfig("pdfReaderMode") || "scroll"
        : configStore.getReaderConfig("readerMode") || "double";
    return mode === "scroll";
  };
  // 下侧进度面板的「可用区偏移」。
  //
  // 背景:面板本体按屏幕绝对定位,外层 .progress-panel-container 用
  // `left:0; right:0; margin:auto` 做水平居中。此前直接写内联
  // `marginLeft: 150`,会把 CSS 的 `margin-left:auto` 整段覆盖掉 →
  // 居中失效,面板贴到左边(用户反馈「没有放到正中央」的根因)。
  //
  // 正确做法:不改 margin,而是收缩「可用区」的左右边界。
  // 侧栏常驻时把那一侧让出 315px(与正文区 .view-area-page 的偏移约定一致:
  // 面板 299px + 间距),居中的是剩下的正文区,视觉上才是「在正文里居中」
  // 而不是「在屏幕里居中」。不常驻时边界归零 → 屏幕正中。
  getProgressPanelOffset = () => {
    const isMobile = isMobileRuntime() || document.body.clientWidth < 570;
    if (isMobile) {
      return {
        left: "0",
        right: "0",
      };
    }
    const navLocked = !!this.props.isNavLocked;
    const settingLocked = !!this.props.isSettingLocked;
    return {
      left: navLocked ? "315px" : "0",
      right: settingLocked ? "315px" : "0",
    };
  };
  handleLeaveReader = (position: string) => {
    this.cancelLeaveReader(position);
    switch (position) {
      case "right":
        if (this.props.isSettingLocked) {
          break;
        } else {
          this.setState({ isOpenRightPanel: false });
          break;
        }

      case "left":
        if (
          this.props.isNavLocked ||
          configStore.getReaderConfig("isTempLocked") === "yes"
        ) {
          break;
        } else {
          this.setState({ isOpenLeftPanel: false });
          break;
        }
      case "top":
        this.setState({ isOpenTopPanel: false });
        break;
      case "bottom":
        this.setState({ isOpenBottomPanel: false });
        break;
      default:
        break;
    }
  };
  handleReadingPanelToggle = (event: Event) => {
    const position = (event as CustomEvent<{ position: string }>).detail
      ?.position;
    if (!PANEL_POSITIONS.includes(position as PanelPosition)) return;
    const stateKey = PANEL_OPEN_STATE[position as PanelPosition];
    if (this.state[stateKey]) {
      this.handleLeaveReader(position);
    } else {
      this.handleEnterReader(position);
    }
  };

  // ── 目录面板「左滑收起」（移动端）─────────────────────────────────
  // 手机上没有 hover，原先只有右上角一个 × 能关；这里做成抽屉式手势：
  // 手指往左划时面板跟手左移，松手超过面板宽 30% 就收起，否则弹回原位。
  // 桌面端完全不参与（每个入口都有 isMobileRuntime 守卫）。
  private leftPanelRef = React.createRef<HTMLDivElement>();
  private leftSwipeActive = false;
  private leftSwipeStartX = 0;
  private leftSwipeStartY = 0;
  private leftSwipeDx = 0;

  handleLeftPanelTouchStart = (event: React.TouchEvent) => {
    if (!isMobileRuntime() || !event.touches || event.touches.length !== 1) {
      return;
    }
    this.leftSwipeActive = false;
    this.leftSwipeDx = 0;
    this.leftSwipeStartX = event.touches[0].clientX;
    this.leftSwipeStartY = event.touches[0].clientY;
  };

  handleLeftPanelTouchMove = (event: React.TouchEvent) => {
    if (!isMobileRuntime() || !event.touches || event.touches.length !== 1) {
      return;
    }
    const el = this.leftPanelRef.current;
    if (!el) return;
    const dx = event.touches[0].clientX - this.leftSwipeStartX;
    const dy = event.touches[0].clientY - this.leftSwipeStartY;
    if (!this.leftSwipeActive) {
      // 只接管明确的「往左横划」；纵向留给目录列表自己的滚动。
      if (dx > -8 || Math.abs(dx) < Math.abs(dy)) {
        return;
      }
      this.leftSwipeActive = true;
      el.style.transition = "none";
    }
    const width = el.offsetWidth || 299;
    const x = Math.max(-width, Math.min(0, dx));
    this.leftSwipeDx = x;
    el.style.transform = `translateX(${x}px)`;
  };

  handleLeftPanelTouchEnd = () => {
    if (!this.leftSwipeActive) return;
    this.leftSwipeActive = false;
    const el = this.leftPanelRef.current;
    if (!el) return;
    const width = el.offsetWidth || 299;
    const shouldClose = Math.abs(this.leftSwipeDx) > width * 0.3;
    el.style.transition = "transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)";
    if (shouldClose) {
      // 先把面板滑到底再交还状态：直接 setState 的话 React 会立刻写
      // translateX(-105%)，中途这段 transition 被跳过，看着像「啪」地消失。
      el.style.transform = `translateX(${-width}px)`;
      window.setTimeout(() => {
        const node = this.leftPanelRef.current;
        if (node) {
          node.style.transition = "";
          node.style.transform = "";
        }
        this.setState({ isOpenLeftPanel: false });
      }, 210);
    } else {
      el.style.transform = "translateX(0px)";
      window.setTimeout(() => {
        const node = this.leftPanelRef.current;
        if (node) node.style.transition = "";
      }, 210);
    }
    this.leftSwipeDx = 0;
  };
  handleLocation = () => {
    let position = this.props.htmlBook.rendition.getPosition();

    configStore.setObjectConfig(
      this.props.currentBook.key,
      position,
      "recordLocation"
    );
  };

  /**
   * 手机端「下拉页面 → 加标签 / 再次下拉 → 撤标签」的落点。
   *
   * 手势侧（`utils/reader/pageSwipeTurn.ts`）只负责识别纵向下拉、把页面壳跟手下移、
   * 越过阈值后回弹，然后无条件派发 `TOGGLE_BOOKMARK_BY_GESTURE_EVENT` ——
   * 「加还是撤」必须在这一层判，因为只有这里同时握有 currentBook 与书签库。
   * 判定细节（位置指纹、为什么不复用操作面板那套）见 `utils/reader/bookmarkUtil.ts`。
   */
  handleToggleBookmarkByGesture = async () => {
    const isMobile =
      isMobileRuntime() ||
      (typeof document !== "undefined" && document.body.clientWidth < 570);
    if (!isMobile) return;
    const result = await toggleBookmarkByGesture({
      bookKey: this.props.currentBook?.key || "",
      rendition: this.props.htmlBook?.rendition,
      t: this.props.t,
    });
    // 顶栏小旗立刻跟着变 —— 不等 redux 那一轮，用户下拉完马上要看到结果
    if (result === "added") {
      this.markViewBookmarked(true);
    } else if (result === "removed") {
      this.markViewBookmarked(false);
    }
    // 书签列表挂在 redux 上：不重新拉一次，「目录面板 → 书签」里看不到刚加的这条
    if (result !== "failed") {
      this.props.handleFetchBookmarks();
    }
  };

  /**
   * 手机端「滑动阅读贴到章末继续上滑 / 贴到章首继续下滑」→ 换章。
   *
   * 手势侧只负责识别与回弹（`pageSwipeTurn.ts` 的 `pickScrollPull`），换章在这里调内核。
   * 之所以不放在手势层：内核在两个边界上是**静默 return**的
   * （`handleNextChapter` 见 `chapterDocIndex >= 列表长度-1` 只把 percentage 写 1；
   * `prev()` 见 `chapterDocIndex === "0"` 直接 return），用户只会看到
   * 「拉了一下又弹回去，页面没变」，分不清是到头了还是坏了 —— 这里用
   * **换章前后的 `chapterDocIndex` 比对**来判，是就给一句提示。
   */
  handleTurnChapterByGesture = async (event: any) => {
    if (!isMobileRuntime()) return;
    const dir: "next" | "prev" = event?.detail?.dir === "prev" ? "prev" : "next";
    const rendition = this.props.htmlBook?.rendition;
    if (!rendition) return;
    // 换章前后比对的「章节指纹」= 章节下标 + 章节标题。
    // 只比下标不够稳：内核 handleRenderChapter 里有一段「按 label 反查下标」的重映射，
    // 个别书的章节可能被映射回同一个下标；标题一起比才判得准。
    const chapterOf = () => {
      const pos: any = rendition.getPosition?.() || {};
      return String(pos.chapterDocIndex ?? "") + "|" + String(pos.chapterTitle ?? "");
    };
    const before = chapterOf();
    try {
      if (dir === "next") {
        await rendition.next();
      } else {
        await rendition.prev();
      }
    } catch (err) {
      return; // 换章失败不该卡住手势，也不该弹提示
    }
    if (chapterOf() === before) {
      toast.error(
        this.props.t(
          dir === "next"
            ? "Already at the last chapter"
            : "Already at the first chapter"
        )
      );
    }
    // 章一换，「当前页有没有书签」的答案就完全不同了 ⇒ 顶栏小旗重算
    this.refreshBookmarkFlag();
  };
  render() {
    const isMobile = isMobileRuntime() || document.body.clientWidth < 570;
    const renditionProps = {
      handleLeaveReader: this.handleLeaveReader,
      handleEnterReader: this.handleEnterReader,
      isShow:
        this.state.isOpenLeftPanel ||
        this.state.isOpenTopPanel ||
        this.state.isOpenBottomPanel ||
        this.state.isOpenRightPanel,
    };
    return (
      <div className={`viewer ${isMobile ? "mobile-reader-mode" : ""}`}>
        <Tooltip id="my-tooltip" style={{ zIndex: 25 }} />

        {/* 常驻右上角优雅书签标：当前页有书签时常驻展示，点击可快速撤销书签 */}
        {this.state.isViewBookmarked && (
          <div
            className="reader-corner-bookmark"
            title="当前页已添加书签，点击撤销"
            onClick={async (e) => {
              e.stopPropagation();
              const rendition = this.props.htmlBook?.rendition;
              if (rendition) {
                await toggleBookmarkByGesture({
                  bookKey: this.props.currentBook?.key || "",
                  rendition,
                  t: this.props.t,
                });
                this.props.handleFetchBookmarks();
                this.refreshBookmarkFlag();
              }
            }}
          >
            <div className="reader-corner-bookmark-ribbon" />
          </div>
        )}

        {isMobile && (
          <div
            className="mobile-reader-top-bar"
            style={{
              transform: this.state.isOpenBottomPanel
                ? "translateY(0%)"
                : "translateY(-120%)",
            }}
          >
            <button
              type="button"
              className="mobile-reader-back-btn"
              onClick={this.handleExitReading}
              onTouchEnd={(e) => {
                e.preventDefault();
                this.handleExitReading(e);
              }}
              title="返回书架"
            >
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                stroke="currentColor"
                strokeWidth="2.2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div className="mobile-reader-top-spacer" />
            <div className="mobile-reader-top-actions">
              {/* 当前页有标签时亮起的小旗（下拉加标签后立刻可见）。
                  放在按钮行最左侧：全局那个 `.bookmark` 红旗是
                  `position:fixed; top:5px; right:70px; z-index:15`，
                  会被顶栏（`z-index:35`、高 48px + 安全区）整个压在底下，
                  手机上永远看不见 —— 这就是「加了标签却看不到记号」的一半原因。 */}
              {this.state.isViewBookmarked && (
                <span
                  className="mobile-reader-bookmark-flag"
                  title="这一页有标签"
                />
              )}
              {/* 随心笔记（自由涂鸦）：手机端的入口在顶栏这里。
                  底栏那个「笔记」是「笔记/高光汇总」，两者刻意分开 ——
                  果冻的要求：汇总归底栏、随手画归顶栏。 */}
              <button
                type="button"
                className={
                  "mobile-reader-top-action" +
                  (this.state.isDoodleDrawerOpen
                    ? " mobile-reader-top-action-active"
                    : "")
                }
                onClick={() => toggleDoodleDrawer()}
                title="随心笔记"
              >
                <span className="icon-edit" style={{ fontSize: "18px" }} />
              </button>
              {/* 在线共读（对应截图分享位置，遵照指示改为在线共读面板） */}
              <button
                type="button"
                className={
                  "mobile-reader-top-action" +
                  (this.state.isCollabOpen
                    ? " mobile-reader-top-action-active"
                    : "")
                }
                onClick={() => {
                  this.setState({ isCollabOpen: !this.state.isCollabOpen });
                }}
                title="在线共读"
              >
                <span className="icon-cloud" style={{ fontSize: "18px" }} />
              </button>
              {/* 更多菜单（对应微信读书截图右侧三个竖点） */}
              <button
                type="button"
                className={
                  "mobile-reader-top-action" +
                  (this.state.isOpenRightPanel
                    ? " mobile-reader-top-action-active"
                    : "")
                }
                onClick={() => {
                  if (this.state.isOpenRightPanel) {
                    this.setState({ isOpenRightPanel: false });
                  } else {
                    this.handleEnterReader("right");
                  }
                }}
                title="阅读选项与更多设置"
              >
                <span className="icon-more" style={{ fontSize: "18px" }} />
              </button>
            </div>
          </div>
        )}

        {/* 微信读书同款单手拇指快捷悬浮按钮：Ai 问书 + 听书（仅在唤出菜单时呈现） */}
        {isMobile && !this.state.isOpenLeftPanel && !this.state.isOpenRightPanel && (
          <div
            className={`mobile-floating-actions ${
              this.state.isOpenBottomPanel ? "mobile-floating-actions-visible" : ""
            }`}
          >
            <button
              type="button"
              className="mobile-fab-btn mobile-fab-ai"
              onClick={this.handleAIAssistant}
              title="向 AI 提问本章"
            >
              <span className="mobile-fab-text">Ai</span>
              <span className="mobile-fab-sparkle">✦</span>
            </button>
            <button
              type="button"
              className={`mobile-fab-btn mobile-fab-tts ${
                this.props.isSpeechOpen ? "mobile-fab-active" : ""
              }`}
              onClick={this.handleToggleSpeech}
              title={this.props.isSpeechOpen ? "停止听书" : "听书"}
            >
              <span className="mobile-fab-text">听</span>
            </button>
          </div>
        )}

        {!this.props.isHidePageButton && (
          <div
            className="previous-chapter-single-container reader-page-nav-button"
            onClick={async () => {
              if (lock) return;
              lock = true;
              await this.props.htmlBook.rendition.prev();
              this.handleLocation();
              setTimeout(() => (lock = false), throttleTime);
            }}
            style={{
              left: !isMobile && this.props.isNavLocked ? 315 : 15,
            }}
          >
            <span className="icon-dropdown previous-chapter-single"></span>
          </div>
        )}
        <div
          style={{
            position: "absolute",
            bottom: 10,
            right: !isMobile && this.props.isSettingLocked ? 315 : 15,
            display: "flex",
            flexDirection: "column-reverse",
            alignItems: "center",
            gap: "8px",
            zIndex: 10,
          }}
        >
          {!this.props.isHidePageButton && (
            <div
              className="next-chapter-single-container reader-page-nav-button"
              onClick={async () => {
                if (lock) return;
                lock = true;
                await this.props.htmlBook.rendition.next();
                this.handleLocation();
                setTimeout(() => (lock = false), throttleTime);
              }}
              style={{ position: "static" }}
            >
              <span className="icon-dropdown next-chapter-single"></span>
            </div>
          )}
          {/* 听书 / AI 问书:已聚合到底部「阅读进度面板」的三个操作按钮里,
              这里不再重复提供入口,避免右下角堆栈过长。 */}
          {/* 随心笔记(涂鸦):滑动阅读下不显示,滚轮要留给页面滚动。
              手机端的入口已经搬到顶部滑出条（左抽屉），这里只在桌面上保留常驻按钮。 */}
          {!isMobile && !this.isScrollReaderMode() && (
            <div
              className="next-chapter-single-container"
              onClick={() =>
                this.setState({ isDoodleOpen: !this.state.isDoodleOpen })
              }
              style={{ position: "static", transform: "rotate(0deg)" }}
            >
              <span
                style={this.state.isDoodleOpen ? { fontWeight: "bold" } : {}}
                className={`icon-${this.state.isDoodleOpen ? "close" : "edit"} next-chapter-single`}
              ></span>
            </div>
          )}
        </div>

        {/* 右上角「页眉」：阅读选项 / 共读 / 更多 三个入口常驻在这里。 */}
        <div
          ref={(ref) => {
            this.dockRef = ref;
          }}
          className={
            "reader-top-dock" +
            (isDarkReaderTheme() ? " reader-top-dock-dark" : "")
          }
          style={{
            right: !isMobile && this.props.isSettingLocked ? 300 : 8,
          }}
        >
          {(this.props.readerMode === "scroll" ||
            this.props.readerMode === "single") &&
            !this.props.isHideScaleButton && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                }}
              >
                {this.state.isShowScale && (
                  <div className="scale-container">
                    <div
                      style={{
                        zIndex: 100,
                        width: "100px",
                      }}
                    >
                      <input
                        className="input-value"
                        defaultValue={
                          configStore.getReaderConfig("scale")
                            ? parseFloat(
                                configStore.getReaderConfig("scale")
                              ) * 100
                            : 100
                        }
                        value={
                          this.state.scale === " "
                            ? this.state.scale
                            : Math.round(parseFloat(this.state.scale) * 100)
                        }
                        type="number"
                        onInput={(event: any) => {
                          let fieldVal = event.target.value;
                          configStore.setReaderConfig(
                            "scale",
                            parseFloat(fieldVal) / 100 + ""
                          );
                        }}
                        onFocus={() => {
                          this.setState({ scale: " " });
                        }}
                        onChange={(event) => {
                          let fieldVal = event.target.value;
                          this.setState({
                            scale: parseFloat(fieldVal) / 100 + "",
                          });
                        }}
                        onBlur={(event) => {
                          let fieldVal = event.target.value;
                          if (fieldVal.trim() !== "") {
                            configStore.setReaderConfig(
                              "scale",
                              parseFloat(fieldVal) / 100 + ""
                            );
                          }
                          this.props.renderBookFunc();
                        }}
                      />
                      <span> %</span>
                    </div>

                    <input
                      className="input-progress"
                      value={this.state.scale}
                      type="range"
                      max={4}
                      min={0.5}
                      step={0.01}
                      onInput={(event: any) => {
                        const scale = event.target.value;
                        configStore.setReaderConfig("scale", scale);
                      }}
                      onChange={(event) => {
                        this.setState({ scale: event.target.value });
                      }}
                      onMouseUp={() => {
                        this.props.handleScale(this.state.scale);
                        this.props.renderBookFunc();
                      }}
                      style={{
                        zIndex: 100,
                        width: "120px",
                      }}
                    />
                  </div>
                )}
                <div
                  className="reader-zoom-in-icon-container"
                  onClick={() => {
                    this.setState({ isShowScale: !this.state.isShowScale });
                  }}
                >
                  <span className="icon-zoom-in reader-setting-icon"></span>
                </div>
              </div>
            )}

          {this.props.currentBook.format === "PDF" &&
            this.props.readerMode === "scroll" && (
              <div
                className="reader-setting-icon-container"
                onClick={() => {
                  this.props.handlePdfCropDialog(!this.props.isPdfCropOpen);
                }}
              >
                <span
                  className="icon-crop reader-setting-icon"
                  style={{ fontSize: 24 }}
                ></span>
              </div>
            )}

          {this.props.currentBook.format === "PDF" &&
            !this.props.isHidePDFConvertButton && (
              <div
                className="reader-setting-icon-container"
                onClick={() => {
                  this.props.handleConvertDialog(!this.props.isConvertOpen);
                }}
              >
                <span
                  className="icon-convert-text reader-setting-icon"
                  style={{ fontSize: 26 }}
                ></span>
              </div>
            )}
          {/* 共读:并入右侧按钮栈,与其它图标按钮同款。
              按用户要求与「更多」交换位置 → 共读在前、更多在后。 */}
          <div
            className={
              "reader-setting-icon-container collab-stack-button" +
              (this.state.isCollabOpen ? " collab-stack-button-active" : "")
            }
            title="共读"
            onClick={() => {
              this.setState({ isCollabOpen: !this.state.isCollabOpen });
            }}
          >
            <span className="icon-cloud reader-setting-icon"></span>
          </div>
          {!this.props.isHideMenuButton && (
            <div
              className="reader-setting-icon-container"
              onClick={() => {
                // 顶部操作面板（退出/书签/全屏）已迁进左侧目录面板，
                // 这里不再有 "top" 这一路，否则 isOpenTopPanel 会置 true 却无面板可关 → 按钮卡死。
                //
                // 另外：右侧「阅读选项」面板改为**只能**从底部进度面板的
                // 「阅读选项」按钮打开，这里不再自动带出右侧，避免一按就弹一堆面板。
                if (
                  this.state.isOpenLeftPanel ||
                  this.state.isOpenBottomPanel
                ) {
                  this.handleCloseAllPanels();
                  return;
                }
                this.handleEnterReader("left");
                this.handleEnterReader("bottom");
              }}
            >
              <span className="icon-grid reader-setting-icon"></span>
            </div>
          )}
        </div>
        {this.state.isCollabOpen && (
          <CollabPanel
            {...({
              onClose: () => this.setState({ isCollabOpen: false }),
            } as any)}
          />
        )}
        {/* 随心笔记：滑动阅读下**也**要能开。
            果冻 2026-09-17 反馈「现在看不到涂鸦面板了」—— 他正在用滑动模式，
            而这里原来有一道 `!this.isScrollReaderMode()` 守卫，点顶栏按钮只会把
            `isDoodleOpen` 置 true、组件却不渲染，表现为「点了没反应」。
            放开之后必须解决「画布吃掉触摸」：滑动模式下默认进浏览态
            （`defaultView` ⇒ `.doodle-canvas-wrap-view` 的 `pointer-events:none`），
            正文照常能滚；要画就点面板里的「绘画」。 */}
        {this.state.isDoodleOpen && this.props.htmlBook?.rendition && (
            <DoodleLayer
              // 用内容 MD5 而不是本地导入时间戳做身份:换设备打开同一本书也能对上
              {...({
                bookKey: getCollabBookKey(this.props.currentBook),
                rendition: this.props.htmlBook.rendition,
                onClose: () => {
                  this.setState({
                    isDoodleOpen: false,
                    isDoodleDrawerOpen: false,
                  });
                },
                // 手机端：工具条收进左抽屉，由阅读器顶栏的「随心笔记」按钮控制开合
                drawerOpen: this.state.isDoodleDrawerOpen,
                onDrawerToggle: () =>
                  this.setState((prev) => ({
                    isDoodleDrawerOpen: !prev.isDoodleDrawerOpen,
                  })),
                // 滑动阅读：默认浏览态（画布不吃触摸），并让画布跟着原生滚动
                // 按「屏」刷新笔迹归属，否则笔迹会粘在屏幕上不跟正文走。
                scrollMode: this.isScrollReaderMode(),
                defaultView: this.isScrollReaderMode(),
                // 顶部条要让开右上角页眉：让位宽度 = 页眉自身宽度 + 右外边距 + 间隙。
                // dockWidth 还没量到时给个保守值，宁可短一点也别压住图标。
                headerRight:
                  (this.props.isSettingLocked ? 300 : 8) +
                  (this.state.dockWidth || 180) +
                  8,
                dark: isDarkReaderTheme(),
              } as any)}
            />
          )}
        {this.props.isSettingOpen && (
          <>
            <SettingDialog />
            <div className="drag-background"></div>
          </>
        )}
        <Toaster
          toastOptions={{
            style: {
              wordWrap: "break-word",
              wordBreak: "break-word",
              whiteSpace: "normal",
              overflowWrap: "break-word",
            },
          }}
        />

        {!isMobile && (
          <>
            <div
              className="left-panel"
              onMouseEnter={() => this.handleEdgeMouseEnter("left")}
              onMouseLeave={() => this.handleEdgeMouseLeave("left")}
              style={this.state.hoverPanel === "left" ? { opacity: 0.5 } : {}}
              onClick={() => {
                this.handleEnterReader("left");
              }}
            >
              <span className="icon-grid panel-icon"></span>
            </div>
            <div
              className="right-panel"
              onMouseEnter={() => this.handleEdgeMouseEnter("right")}
              onMouseLeave={() => this.handleEdgeMouseLeave("right")}
              style={this.state.hoverPanel === "right" ? { opacity: 0.5 } : {}}
              onClick={() => {
                this.handleEnterReader("right");
              }}
            >
              <span className="icon-grid panel-icon"></span>
            </div>
            <div
              className="top-panel"
              onMouseEnter={() => this.handleEdgeMouseEnter("top")}
              style={
                this.state.hoverPanel === "top"
                  ? {
                      opacity: 0.5,
                      marginLeft:
                        this.props.isNavLocked && !this.props.isSettingLocked
                          ? 150
                          : 0,
                    }
                  : {
                      marginLeft:
                        this.props.isNavLocked && !this.props.isSettingLocked
                          ? 150
                          : 0,
                    }
              }
              onMouseLeave={() => this.handleEdgeMouseLeave("top")}
              onClick={() => {
                // 顶部操作面板已迁进左侧目录面板,顶部触发条改为打开左侧面板,
                // 用户从顶部划下来依然能找到退出/书签/全屏。
                this.handleEnterReader("left");
              }}
            >
              <span className="icon-grid panel-icon"></span>
            </div>
            <div
              className="bottom-panel"
              onMouseEnter={() => this.handleEdgeMouseEnter("bottom")}
              onMouseLeave={() => this.handleEdgeMouseLeave("bottom")}
              onClick={() => {
                this.handleEnterReader("bottom");
              }}
              style={
                this.state.hoverPanel === "bottom"
                  ? {
                      opacity: 0.5,
                      marginLeft:
                        this.props.isNavLocked && !this.props.isSettingLocked
                          ? 150
                          : 0,
                    }
                  : {
                      marginLeft:
                        this.props.isNavLocked && !this.props.isSettingLocked
                          ? 150
                          : 0,
                    }
              }
            >
              <span className="icon-grid panel-icon"></span>
            </div>
          </>
        )}

        <div
          className="setting-panel-container"
          onMouseEnter={() => {
            this.cancelLeaveReader("right");
          }}
          onMouseLeave={() => {
            this.scheduleLeaveReader("right");
          }}
          style={
            this.state.isOpenRightPanel
              ? {
                  pointerEvents: "auto",
                }
              : {
                  transform: isMobile ? "translateX(105%)" : "translateX(309px)",
                  pointerEvents: "none",
                }
          }
        >
          <span
            className="panel-close-button"
            onClick={() => this.setState({ isOpenRightPanel: false })}
          >
            ×
          </span>
          <SettingPanel />
        </div>
        <div
          className="navigation-panel-container"
          ref={this.leftPanelRef}
          onTouchStart={this.handleLeftPanelTouchStart}
          onTouchMove={this.handleLeftPanelTouchMove}
          onTouchEnd={this.handleLeftPanelTouchEnd}
          onTouchCancel={this.handleLeftPanelTouchEnd}
          onMouseEnter={() => {
            this.cancelLeaveReader("left");
          }}
          onMouseLeave={() => {
            this.scheduleLeaveReader("left");
          }}
          style={
            this.state.isOpenLeftPanel
              ? {
                  pointerEvents: "auto",
                }
              : {
                  transform: isMobile ? "translateX(-105%)" : "translateX(-309px)",
                  pointerEvents: "none",
                }
          }
        >
          {/* 手机端不再给目录面板放 × 关闭键：收藏夹式抽屉靠「手指左滑收起」
              （见本文件 handleLeftPanelTouch* ），留一个 × 反而挤在右上角。
              桌面端照旧保留。 */}
          {!isMobile && (
            <span
              className="panel-close-button"
              onClick={() => this.setState({ isOpenLeftPanel: false })}
            >
              ×
            </span>
          )}
          <NavigationPanel
            {...({
              totalDuration: this.state.totalDuration,
              currentDuration: this.state.currentDuration,
            } as any)}
          />
        </div>
        {isMobile && (this.state.isOpenLeftPanel || this.state.isOpenRightPanel) && (
          <div
            className="mobile-drawer-overlay"
            onClick={this.handleCloseAllPanels}
          />
        )}
        {/* 唤出菜单时的全屏透明点击捕获层：用户点击屏幕中间阅读的部分即可返回沉浸阅读 */}
        {isMobile &&
          this.state.isOpenBottomPanel &&
          !this.state.isOpenLeftPanel &&
          !this.state.isOpenRightPanel && (
            <div
              className="mobile-reader-menu-backdrop"
              onClick={() => this.setState({ isOpenBottomPanel: false })}
              onTouchEnd={(e) => {
                e.preventDefault();
                this.setState({ isOpenBottomPanel: false });
              }}
            />
          )}
        <div
          className="progress-panel-container"
          /* 展开状态暴露到 DOM：iframe 里的点按处理(mouseEvent.ts)要据此判断
             「这一下是收起工具条还是翻页」。走 data 属性而不是让那边去解析
             transform，避免样式一改就静默失效。 */
          data-open={this.state.isOpenBottomPanel ? "yes" : "no"}
          onMouseEnter={() => {
            this.cancelLeaveReader("bottom");
          }}
          onMouseLeave={() => {
            this.scheduleLeaveReader("bottom");
          }}
          style={
            this.state.isOpenBottomPanel
              ? {
                  transform: "translateY(0%)",
                  ...this.getProgressPanelOffset(),
                }
              : {
                  transform: "translateY(120%)",
                  ...this.getProgressPanelOffset(),
                }
          }
        >
          {!isMobile && (
            <span
              className="panel-close-button panel-close-button-bottom"
              onClick={() => this.setState({ isOpenBottomPanel: false })}
            >
              ×
            </span>
          )}
          <ProgressPanel />
        </div>

        {this.props.currentBook.key && <Viewer {...(renditionProps as any)} />}
        {this.props.isConvertOpen && <ConvertDialog />}
        {this.props.isPdfCropOpen && <PdfCropDialog />}
        {this.props.isOpenPopupOptionDialog && (
          <>
            <PopupOptionDialog />
            <div className="drag-background"></div>
          </>
        )}
        {
          <div
            style={
              this.props.isSpeechOpen
                ? {}
                : {
                    display: "none",
                  }
            }
          >
            <SpeechDialog />
          </div>
        }
      </div>
    );
  }
}

export default Reader;
