import React from "react";
import "./popupMenu.css";
import { PopupMenuProps, PopupMenuStates } from "./interface";
import { getIframeDoc } from "../../../utils/reader/docUtil";
import { ConfigService, HighlightUtil } from "../../../services";
import {
  getSelection,
  getSelectionSentence,
} from "../../../utils/reader/mouseEvent";
import { createHighlight } from "../../../utils/reader/noteUtil";
import { isMobileRuntime } from "../../../utils/mobileRuntime";
import copy from "copy-text-to-clipboard";
import toast from "react-hot-toast";
import DatabaseService from "../../../utils/storage/databaseService";
import collabClient, { getCollabBookKey } from "../../../utils/collab/collabClient";

declare var window: any;

/** 微信读书精选 6 款柔和护眼高亮颜色 */
const PRESET_COLORS = [
  "#FF6B8B", // 樱花粉 / 浅红
  "#B388FF", // 薰衣草紫
  "#40C4FF", // 晴空蓝
  "#69F0AE", // 薄荷绿
  "#FFD54F", // 暖明黄
  "#FFA726", // 阳光橙
];

class PopupMenu extends React.Component<PopupMenuProps, PopupMenuStates> {
  private highlightUtil: any;

  constructor(props: PopupMenuProps) {
    super(props);
    this.highlightUtil = new HighlightUtil(ConfigService);
    const initialHighlight = this.highlightUtil.getHighlightValue(
      this.props.highlight || "background-#FFD54F"
    );

    const parsedInitialStyle =
      initialHighlight.styleType === "wave"
        ? "wavy"
        : initialHighlight.styleType || "background";

    this.state = {
      deleteKey: "",
      rect: this.props.rect,
      isRightEdge: false,
      showColorPicker: false,
      activeHighlightKey: "",
      currentStyle: parsedInitialStyle,
      currentColor: initialHighlight.color || "#FFD54F",
      arrowLeft: 140,
      isArrowTop: false,
    };
  }
  UNSAFE_componentWillReceiveProps(nextProps: PopupMenuProps) {
    if (nextProps.rect !== this.props.rect) {
      this.setState(
        {
          rect: nextProps.rect,
        },
        () => {
          this.openMenu();
        }
      );
    }
  }

  /** 检测当前选区是否已经落在某个已有高亮中 */
  detectExistingHighlight = () => {
    try {
      const docs = getIframeDoc(
        this.props.currentBook.format,
        this.props.currentBook.key
      );
      for (let i = 0; i < docs.length; i++) {
        const doc = docs[i];
        if (!doc) continue;
        const sel = doc.getSelection();
        if (sel && sel.anchorNode) {
          const parent = (
            sel.anchorNode.nodeType === Node.TEXT_NODE
              ? sel.anchorNode.parentElement
              : sel.anchorNode
          ) as HTMLElement;
          const noteEl = parent?.closest?.(".kookit-note, [data-key]");
          const key = noteEl?.getAttribute("data-key");
          if (key) {
            this.setState({ activeHighlightKey: key });
            DatabaseService.getRecord(key, "notes").then((note: any) => {
              if (note?.color) {
                const parsed = this.highlightUtil.getHighlightValue(note.color);
                const detectedStyle =
                  parsed.styleType === "wave"
                    ? "wavy"
                    : parsed.styleType || "background";
                this.setState({
                  currentStyle: detectedStyle,
                  currentColor: parsed.color || PRESET_COLORS[0],
                });
              }
            });
            return;
          }
        }
      }
    } catch (e) {
      // 容错
    }
    this.setState({ activeHighlightKey: "" });
  };

  /** 计算气泡菜单位置与尖角箭头对齐偏移 */
  getHtmlPosition(rect: any, expanded: boolean) {
    const isMobile = isMobileRuntime() || document.body.clientWidth < 570;
    const MENU_WIDTH = isMobile
      ? Math.min(312, window.innerWidth - 20)
      : 300;
    const MENU_HEIGHT = expanded ? 98 : 52;
    const pageSize = this.props.rendition?.getPageSize() || {
      scrollTop: 0,
      left: 0,
      top: 0,
    };

    const selCenterX = rect.left + rect.width / 2 + (pageSize.left || 0);
    const selTop = rect.top - (pageSize.scrollTop || 0) + (pageSize.top || 0);
    const selBottom = rect.bottom - (pageSize.scrollTop || 0) + (pageSize.top || 0);

    let posX = selCenterX - MENU_WIDTH / 2;
    posX = Math.max(10, Math.min(posX, window.innerWidth - MENU_WIDTH - 10));

    let arrowLeft = selCenterX - posX;
    arrowLeft = Math.max(16, Math.min(arrowLeft, MENU_WIDTH - 16));

    let posY = selTop - MENU_HEIGHT - 12;
    let isArrowTop = false; // false = 箭头在底部指向下方选区

    if (posY < 40) {
      posY = selBottom + 12;
      isArrowTop = true; // true = 箭头在顶部指向上方选区
    }

    return { posX, posY, arrowLeft, isArrowTop, menuWidth: MENU_WIDTH };
  }

  showMenu = (expanded?: boolean) => {
    const rect = this.state.rect;
    if (!rect) return;
    const isExpanded =
      expanded !== undefined ? expanded : this.state.showColorPicker;
    const { posX, posY, arrowLeft, isArrowTop, menuWidth } =
      this.getHtmlPosition(rect, isExpanded);

    this.setState({ arrowLeft, isArrowTop });
    this.props.handleOpenMenu(true);

    const popupMenu = document.querySelector(
      ".wx-bubble-container"
    ) as HTMLElement;
    if (popupMenu) {
      popupMenu.style.left = `${posX}px`;
      popupMenu.style.top = `${posY}px`;
      popupMenu.style.width = `${menuWidth}px`;
    }
  };

  openMenu = () => {
    // 微信读书规范：长按选中文本时，默认绝不展开颜色选择器！
    this.setState({ showColorPicker: false });
    this.detectExistingHighlight();

    let docs = getIframeDoc(
      this.props.currentBook.format,
      this.props.currentBook.key
    );
    let sel: Selection | null = null;
    for (let i = 0; i < docs.length; i++) {
      let doc = docs[i];
      if (!doc) continue;
      sel = doc.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        break;
      }
    }

    if (!sel || sel.isCollapsed) {
      if (this.props.isOpenMenu) {
        this.closeMenu();
      }
      return;
    }

    this.showMenu(false);
    this.props.handleMenuMode("menu");
  };

  closeMenu = () => {
    this.props.handleOpenMenu(false);
    this.props.handleMenuMode("");
    this.props.handleNoteKey("");
    this.setState({ showColorPicker: false, activeHighlightKey: "" });
    const docs = getIframeDoc(
      this.props.currentBook.format,
      this.props.currentBook.key
    );
    for (let i = 0; i < docs.length; i++) {
      docs[i]?.getSelection()?.empty();
    }
  };

  /** 复制选中文本 */
  handleCopy = () => {
    let text = getSelection(this.props.currentBook.format);
    if (!text) return;
    if (
      this.props.currentBook.format === "PDF" &&
      !ConfigService.getAllListConfig("convertPDFBooks").includes(
        this.props.currentBook.key
      )
    ) {
      text = text.split("\n").join(" ").trim();
    }
    copy(text);
    this.closeMenu();
    toast.success(this.props.t("Copying successful") || "已复制");
  };

  /** 点击“划线”或“删除划线” */
  handleToggleHighlight = async () => {
    // 场景 A：如果当前选区已经划线，点击“删除划线”
    if (this.state.activeHighlightKey) {
      const key = this.state.activeHighlightKey;
      try {
        await DatabaseService.deleteRecord(key, "notes");
        this.props.htmlBook?.rendition?.removeOneNote(
          key,
          this.props.chapterDocIndex
        );
        collabClient.broadcastNoteDelete(
          getCollabBookKey(this.props.currentBook),
          key
        );
        this.props.handleFetchNotes();
        toast.success("已删除划线");
      } catch (err) {
        console.warn("删除划线异常:", err);
      }
      this.closeMenu();
      return;
    }

    // 场景 B：未划线时点击“划线”：立即生成划线并展开颜色与标注线选择器
    const styleType = this.state.currentStyle || "background";
    const color = this.state.currentColor || PRESET_COLORS[0];
    const fullColor = `${styleType}-${color}`;

    const note = await createHighlight({
      currentBook: this.props.currentBook,
      htmlBook: this.props.htmlBook,
      chapterDocIndex: this.props.chapterDocIndex,
      chapter: this.props.chapter,
      color: fullColor,
      t: this.props.t,
      onNoteClick: (event: Event) => {
        const el =
          (event.target as HTMLElement) ||
          (event.currentTarget as HTMLElement);
        const k = el?.getAttribute("data-key") || (el as any)?.dataset?.key;
        if (k) {
          this.props.handleNoteKey(k);
          this.props.handleMenuMode("note");
          this.props.handleOpenMenu(true);
        }
      },
      onSuccess: () => {
        this.props.handleFetchNotes();
      },
    });

    if (note) {
      this.setState(
        {
          activeHighlightKey: note.key,
          showColorPicker: true,
        },
        () => {
          this.showMenu(true);
        }
      );
    }
  };

  /** 切换标注线样式（背景、直线、波浪） */
  handleChangeStyle = (newStyle: string) => {
    this.setState({ currentStyle: newStyle }, async () => {
      const key = this.state.activeHighlightKey;
      const color = this.state.currentColor;
      const fullColor = `${newStyle}-${color}`;
      this.props.handleHighlight?.({ styleType: newStyle, color });
      this.highlightUtil.saveNoteHighlightValue({
        styleType: newStyle,
        color,
      });

      if (key) {
        const note: any = await DatabaseService.getRecord(key, "notes");
        if (note) {
          this.props.htmlBook?.rendition?.removeOneNote(
            key,
            note.chapterDocIndex
          );
          note.color = fullColor;
          await DatabaseService.updateRecord(note, "notes");
          await this.props.htmlBook?.rendition?.createOneNote(
            note,
            (event: Event) => {
              const el =
                (event.target as HTMLElement) ||
                (event.currentTarget as HTMLElement);
              const k =
                el?.getAttribute("data-key") || (el as any)?.dataset?.key;
              if (k) {
                this.props.handleNoteKey(k);
                this.props.handleMenuMode("note");
                this.props.handleOpenMenu(true);
              }
            }
          );
          collabClient.broadcastNoteUpdate(
            getCollabBookKey(this.props.currentBook),
            note
          );
          this.props.handleFetchNotes();
        }
      }
    });
  };

  /** 切换标注颜色 */
  handleChangeColor = (newColor: string) => {
    this.setState({ currentColor: newColor }, async () => {
      const key = this.state.activeHighlightKey;
      const styleType = this.state.currentStyle;
      const fullColor = `${styleType}-${newColor}`;
      this.props.handleHighlight?.({ styleType, color: newColor });
      this.highlightUtil.saveNoteHighlightValue({
        styleType,
        color: newColor,
      });

      if (key) {
        const note: any = await DatabaseService.getRecord(key, "notes");
        if (note) {
          this.props.htmlBook?.rendition?.removeOneNote(
            key,
            note.chapterDocIndex
          );
          note.color = fullColor;
          await DatabaseService.updateRecord(note, "notes");
          await this.props.htmlBook?.rendition?.createOneNote(
            note,
            (event: Event) => {
              const el =
                (event.target as HTMLElement) ||
                (event.currentTarget as HTMLElement);
              const k =
                el?.getAttribute("data-key") || (el as any)?.dataset?.key;
              if (k) {
                this.props.handleNoteKey(k);
                this.props.handleMenuMode("note");
                this.props.handleOpenMenu(true);
              }
            }
          );
          collabClient.broadcastNoteUpdate(
            getCollabBookKey(this.props.currentBook),
            note
          );
          this.props.handleFetchNotes();
        }
      }
    });
  };

  /** 点击背景遮罩关闭气泡菜单并清除选区 */
  handleBackdropDismiss = (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    this.closeMenu();
  };

  /** 点击“写想法”：无缝唤起笔记/想法编辑器 */
  handleWriteIdea = () => {
    if (this.state.activeHighlightKey) {
      this.props.handleNoteKey(this.state.activeHighlightKey);
    } else {
      this.props.handleNoteKey("");
    }
    this.props.handleMenuMode("note");
    this.props.handleOpenMenu(true);
  };

  /** 点击“AI 问书” */
  handleAskAI = () => {
    const text = getSelection(this.props.currentBook.format);
    if (!text) return;
    this.props.handleQuoteText?.(text);
    this.props.handleMenuMode("assistant");
    this.props.handleOpenMenu(true);
  };

  /** 点击“听当前” */
  handleListenCurrent = () => {
    const text =
      getSelectionSentence(this.props.currentBook.format) ||
      getSelection(this.props.currentBook.format);
    if (!text) return;

    this.props.handleSpeechStartText?.(text);
    this.props.handleSpeechAutoStart?.(true);
    this.props.handleSpeechDialog?.(true);
    this.closeMenu();
  };

  render() {
    if (!this.props.isOpenMenu || this.props.menuMode !== "menu") {
      return null;
    }

    const {
      showColorPicker,
      activeHighlightKey,
      currentStyle,
      currentColor,
      arrowLeft,
      isArrowTop,
    } = this.state;
    const isHighlighted = Boolean(activeHighlightKey);

    return (
      <>
        {/* 全屏透明背景遮罩：点击屏幕其他区域立即关闭气泡菜单 */}
        <div
          className="wx-bubble-backdrop"
          onPointerDown={this.handleBackdropDismiss}
        />
        <div
          className="popup-menu-container wx-bubble-container"
          onMouseDown={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
        >
        {/* 上箭头（当胶囊位于选区下方时显示，尖角朝上） */}
        {isArrowTop && (
          <div
            className="wx-bubble-arrow wx-arrow-up"
            style={{ left: `${arrowLeft}px` }}
          />
        )}

        <div className="wx-bubble-card">
          {/* 第一排动作项 */}
          <div className="wx-main-actions">
            {/* 1. 复制 */}
            <button
              type="button"
              className="wx-action-btn"
              onClick={this.handleCopy}
            >
              <span className="wx-btn-icon">
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </span>
              <span className="wx-btn-label">复制</span>
            </button>

            {/* 2. 划线 / 删除划线 */}
            <button
              type="button"
              className={`wx-action-btn ${isHighlighted ? "is-del" : ""}`}
              onClick={this.handleToggleHighlight}
            >
              <span className="wx-btn-icon">
                {isHighlighted ? (
                  // 删除划线图标：A 带斜杠
                  <span className="wx-icon-a-del">
                    <span className="wx-letter-a">A</span>
                    <span className="wx-slash-line" />
                  </span>
                ) : (
                  // 划线图标：A 带下划线
                  <span className="wx-icon-a-line">
                    <span className="wx-letter-a">A</span>
                    <span className="wx-under-line" />
                  </span>
                )}
              </span>
              <span className="wx-btn-label">
                {isHighlighted ? "删除划线" : "划线"}
              </span>
            </button>

            {/* 3. 写想法 */}
            <button
              type="button"
              className="wx-action-btn"
              onClick={this.handleWriteIdea}
            >
              <span className="wx-btn-icon">
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
              </span>
              <span className="wx-btn-label">写想法</span>
            </button>

            {/* 4. AI 问书 */}
            <button
              type="button"
              className="wx-action-btn"
              onClick={this.handleAskAI}
            >
              <span className="wx-btn-icon">
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </span>
              <span className="wx-btn-label">AI 问书</span>
            </button>

            {/* 5. 听当前 */}
            <button
              type="button"
              className="wx-action-btn"
              onClick={this.handleListenCurrent}
            >
              <span className="wx-btn-icon">
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
              </span>
              <span className="wx-btn-label">听当前</span>
            </button>
          </div>

          {/* 第二排：标注线与颜色选择栏（仅点击划线后展示） */}
          {showColorPicker && (
            <div className="wx-color-palette-row">
              {/* 左侧标注线样式组 */}
              <div className="wx-styles-bar">
                {/* 1. 背景色块 A */}
                <button
                  type="button"
                  className={`wx-style-tab ${
                    currentStyle === "background" ? "active" : ""
                  }`}
                  onClick={() => this.handleChangeStyle("background")}
                  title="背景高亮"
                >
                  <span className="wx-style-box wx-style-bg-box">A</span>
                </button>

                {/* 2. 下划线 A */}
                <button
                  type="button"
                  className={`wx-style-tab ${
                    currentStyle === "underline" ? "active" : ""
                  }`}
                  onClick={() => this.handleChangeStyle("underline")}
                  title="直线下划线"
                >
                  <span className="wx-style-box wx-style-underline-box">
                    <span>A</span>
                    <span className="wx-solid-line" />
                  </span>
                </button>

                {/* 3. 波浪线 A */}
                <button
                  type="button"
                  className={`wx-style-tab ${
                    currentStyle === "wavy" || currentStyle === "wave" ? "active" : ""
                  }`}
                  onClick={() => this.handleChangeStyle("wavy")}
                  title="波浪下划线"
                >
                  <span className="wx-style-box wx-style-wave-box">
                    <span>A</span>
                    <svg
                      className="wx-wavy-svg"
                      viewBox="0 0 16 4"
                      fill="none"
                    >
                      <path
                        d="M0 2 Q 2 0, 4 2 T 8 2 T 12 2 T 16 2"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        fill="none"
                      />
                    </svg>
                  </span>
                </button>
              </div>

              {/* 细分隔线 */}
              <div className="wx-palette-divider" />

              {/* 右侧预设颜色圆点组 */}
              <div className="wx-colors-bar">
                {PRESET_COLORS.map((c) => {
                  const isSelected =
                    currentColor.toLowerCase() === c.toLowerCase();
                  return (
                    <button
                      key={c}
                      type="button"
                      className={`wx-color-circle ${
                        isSelected ? "selected" : ""
                      }`}
                      style={{ backgroundColor: c }}
                      onClick={() => this.handleChangeColor(c)}
                    >
                      {isSelected && (
                        <span className="wx-check-icon">✓</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 下箭头（当胶囊位于选区上方时显示，尖角朝下） */}
        {!isArrowTop && (
          <div
            className="wx-bubble-arrow wx-arrow-down"
            style={{ left: `${arrowLeft}px` }}
          />
        )}
      </div>
    </>
    );
  }
}

export default PopupMenu;
