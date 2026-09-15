import React from "react";
import SettingPanel from "../../containers/panels/settingPanel";
import NavigationPanel from "../../containers/panels/navigationPanel";
import { Toaster } from "react-hot-toast";
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
import SettingDialog from "../../components/dialogs/settingDialog";
import SpeechDialog from "../../components/dialogs/speechDialog";
import PopupOptionDialog from "../../components/dialogs/popupOptionDialog";
import {
  updateDiscordPresence,
  clearDiscordPresence,
} from "../../utils/reader/discordRPC";
import { READING_PANEL_TOGGLE_EVENT } from "../../utils/reader/mouseEvent";
import CollabPanel from "../../containers/collabPanel";
import DoodleLayer from "../../components/doodleLayer";
import collabClient, {
  getCollabBookKey,
} from "../../utils/collab/collabClient";

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
      isOpenRightPanel: this.props.isSettingLocked,
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
      dockWidth: 0,
    };
  }
  componentDidMount() {
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
    // 共读入房联动:滑动阅读下「页」不稳定,笔迹无法跟随、跨设备同步也会丢页,
    // 所以共读模式不提供滑动阅读。入房时正在滑动阅读就自动切到单页。
    this.collabUnsubs = [
      collabClient.on("room-joined", this.handleCollabModeLock),
    ];
  }

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
    window.removeEventListener(
      READING_PANEL_TOGGLE_EVENT,
      this.handleReadingPanelToggle
    );
    this.collabUnsubs.forEach((unsubscribe) => unsubscribe());
    this.collabUnsubs = [];
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
    const update: any = {};
    if (isNarrowScreen) {
      update.isOpenLeftPanel = position === "left";
      update.isOpenRightPanel = position === "right";
      update.isOpenTopPanel = position === "top";
      update.isOpenBottomPanel = position === "bottom";
    } else if (position === "left") {
      update.isOpenLeftPanel = true;
    } else if (position === "right") {
      update.isOpenRightPanel = true;
    } else if (position === "top") {
      update.isOpenTopPanel = true;
    } else if (position === "bottom") {
      update.isOpenBottomPanel = true;
    }
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
    const navLocked = !!this.props.isNavLocked;
    const settingLocked = !!this.props.isSettingLocked;
    return {
      left: navLocked ? "315px" : "0",
      right: settingLocked ? "315px" : "0",
    };
  };
  handleLeaveReader = (position: string) => {    this.cancelLeaveReader(position);
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
  handleLocation = () => {
    let position = this.props.htmlBook.rendition.getPosition();

    configStore.setObjectConfig(
      this.props.currentBook.key,
      position,
      "recordLocation"
    );
  };
  render() {
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
      <div className="viewer">
        <Tooltip id="my-tooltip" style={{ zIndex: 25 }} />

        {!this.props.isHidePageButton && (
          <div
            className="previous-chapter-single-container"
            onClick={async () => {
              if (lock) return;
              lock = true;
              await this.props.htmlBook.rendition.prev();
              this.handleLocation();
              setTimeout(() => (lock = false), throttleTime);
            }}
            style={{
              left: this.props.isNavLocked ? 315 : 15,
            }}
          >
            <span className="icon-dropdown previous-chapter-single"></span>
          </div>
        )}
        <div
          style={{
            position: "absolute",
            bottom: 10,
            right: this.props.isSettingLocked ? 315 : 15,
            display: "flex",
            flexDirection: "column-reverse",
            alignItems: "center",
            gap: "8px",
            zIndex: 10,
          }}
        >
          {!this.props.isHidePageButton && (
            <div
              className="next-chapter-single-container"
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
          {/* 随心笔记(涂鸦):滑动阅读下不显示,滚轮要留给页面滚动 */}
          {!this.isScrollReaderMode() && (
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

        {/* 右上角「页眉」：阅读选项 / 共读 / 更多 三个入口常驻在这里。
            以前这排图标是「裸奔」在正文上的（无底色），而正文首行只从 20px 开始，
            于是图标直接压在文字上。现在给了实底 + 圆角 + 投影的页眉底衬，
            同时把 .html-viewer-page 的 top 提到 56px，正文彻底从页眉下方开始。 */}
        <div
          ref={(ref) => {
            this.dockRef = ref;
          }}
          className={
            "reader-top-dock" +
            (isDarkReaderTheme() ? " reader-top-dock-dark" : "")
          }
          style={{
            right: this.props.isSettingLocked ? 300 : 8,
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
        {this.state.isDoodleOpen &&
          !this.isScrollReaderMode() &&
          this.props.htmlBook?.rendition && (
            <DoodleLayer
              // 用内容 MD5 而不是本地导入时间戳做身份:换设备打开同一本书也能对上
              {...({
                bookKey: getCollabBookKey(this.props.currentBook),
                rendition: this.props.htmlBook.rendition,
                onClose: () => this.setState({ isDoodleOpen: false }),
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
              ? {}
              : {
                  transform: "translateX(309px)",
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
          onMouseEnter={() => {
            this.cancelLeaveReader("left");
          }}
          onMouseLeave={() => {
            this.scheduleLeaveReader("left");
          }}
          style={
            this.state.isOpenLeftPanel
              ? {}
              : {
                  transform: "translateX(-309px)",
                }
          }
        >
          <span
            className="panel-close-button"
            onClick={() => this.setState({ isOpenLeftPanel: false })}
          >
            ×
          </span>
          <NavigationPanel
            {...({
              totalDuration: this.state.totalDuration,
              currentDuration: this.state.currentDuration,
            } as any)}
          />
        </div>
        <div
          className="progress-panel-container"
          onMouseEnter={() => {
            this.cancelLeaveReader("bottom");
          }}
          onMouseLeave={() => {
            this.scheduleLeaveReader("bottom");
          }}
          style={
            this.state.isOpenBottomPanel
              ? this.getProgressPanelOffset()
              : {
                  transform: "translateY(110px)",
                  ...this.getProgressPanelOffset(),
                }
          }
        >
          <span
            className="panel-close-button panel-close-button-bottom"
            onClick={() => this.setState({ isOpenBottomPanel: false })}
          >
            ×
          </span>
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
