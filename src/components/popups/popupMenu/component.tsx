import React from "react";
import "./popupMenu.css";
import PopupOption from "../popupOption";
import ColorOption from "../../colorOption";
import { PopupMenuProps, PopupMenuStates } from "./interface";
import { getIframeDoc } from "../../../utils/reader/docUtil";
import {
  ConfigService,
  HighlightUtil,
} from '../../../services';
import {
  getSelection,
  getSelectionSentence,
} from "../../../utils/reader/mouseEvent";
import { createHighlight } from "../../../utils/reader/noteUtil";
import { isMobileRuntime } from "../../../utils/mobileRuntime";

declare var window: any;

const MENU_WIDTH_DESKTOP = 252;
const MENU_HEIGHT_DESKTOP = 141;
// 触屏下把面板放宽、算得更高一些：图标按钮从 36px 提到 44px（手指友好），
// 6 列排不下 252px。宽度必须同步喂给下面的夹取逻辑，否则菜单会顶出屏幕右边。
// 对应的 CSS 在 popupMenu.css / popupOption.css 的 `.mobile-popup` 段。
const MENU_WIDTH_TOUCH = 300;
const MENU_HEIGHT_TOUCH = 168;

/** 当前形态下面板的实际宽 / 高（用于定位与出界夹取）。 */
const currentMenuWidth = () =>
  isMobileRuntime() ? MENU_WIDTH_TOUCH : MENU_WIDTH_DESKTOP;
const currentMenuHeight = () =>
  isMobileRuntime() ? MENU_HEIGHT_TOUCH : MENU_HEIGHT_DESKTOP;

class PopupMenu extends React.Component<PopupMenuProps, PopupMenuStates> {
  highlighter: any;
  highlightUtil: any;
  timer!: NodeJS.Timeout;
  key: any;
  mode: string;
  showNote: boolean;
  isFirstShow: boolean;
  rect: any;
  constructor(props: PopupMenuProps) {
    super(props);
    this.highlightUtil = new HighlightUtil(ConfigService);
    this.showNote = false;
    this.isFirstShow = false;
    this.highlighter = null;
    this.mode = "";
    this.state = {
      deleteKey: "",
      rect: this.props.rect,
      isRightEdge: false,
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

  handleShowDelete = (deleteKey: string) => {
    this.setState({ deleteKey });
  };
  showMenu = () => {
    let rect = this.state.rect;
    if (!rect) return;
    this.setState({ isRightEdge: false }, () => {
      let { posX, posY } = this.getHtmlPosition(rect);
      this.props.handleOpenMenu(true);
      let popupMenu = document.querySelector(".popup-menu-container");
      popupMenu?.setAttribute("style", `left:${posX}px;top:${posY}px`);
    });
  };
  getHtmlPosition(rect: any) {
    // 触屏面板更宽更高，取当前形态的实际值（下面沿用 MENU_WIDTH / MENU_HEIGHT 这个名字）
    const MENU_WIDTH = currentMenuWidth();
    const MENU_HEIGHT = currentMenuHeight();
    let pageSize = this.props.rendition.getPageSize();
    let posY = rect.bottom - pageSize.scrollTop;
    let posX = rect.left + rect.width / 2;
    // fix popup position when crossing pages
    if (rect.width > pageSize.sectionWidth && rect.left < 0) {
      posX = rect.left + rect.width;
    }
    if (
      rect.top < MENU_HEIGHT &&
      pageSize.height - rect.top - rect.height < MENU_HEIGHT &&
      this.props.readerMode !== "scroll"
    ) {
      this.props.handleChangeDirection(true);
      posY = rect.top + 16 + pageSize.top;
    } else if (
      pageSize.height - rect.height < MENU_HEIGHT &&
      pageSize.height - rect.height > -10
    ) {
      this.props.handleChangeDirection(true);
      posY = rect.top - pageSize.scrollTop + 16;
    } else if (
      rect.height - pageSize.height > 0 &&
      this.props.readerMode === "scroll"
    ) {
      posY = 40;
    } else if (posY < pageSize.height - MENU_HEIGHT + pageSize.top) {
      this.props.handleChangeDirection(true);
      posY = posY + 16 + pageSize.top;
    } else {
      posY = posY - rect.height - MENU_HEIGHT + pageSize.top;
    }
    posX = posX - MENU_WIDTH / 2 + pageSize.left;
    if (
      this.props.currentBook.format === "PDF" &&
      this.props.readerMode === "double" &&
      this.props.chapterDocIndex % 2 === 1 &&
      !ConfigService.getAllListConfig("convertPDFBooks").includes(
        this.props.currentBook.key
      )
    ) {
      posX = posX + pageSize.sectionWidth + pageSize.gap;
    }
    if (
      this.props.currentBook.format === "PDF" &&
      this.props.readerMode === "scroll" &&
      !ConfigService.getAllListConfig("convertPDFBooks").includes(
        this.props.currentBook.key
      ) &&
      posY < 0
    ) {
      posY = posY + this.props.chapterDocIndex * pageSize.sectionHeight;
    }
    if (posY < 0) {
      posY = 16;
    }
    if (posY > pageSize.height - MENU_HEIGHT) {
      posY = pageSize.height - MENU_HEIGHT;
    }
    if (
      this.props.readerMode === "scroll" &&
      this.props.currentBook.format === "PDF"
    ) {
      posX = posX - pageSize.scrollLeft;
    }
    return {
      posX: Math.min(Math.max(12, posX), window.innerWidth - 12 - MENU_WIDTH),
      posY,
    } as any;
  }

  openMenu = () => {
    this.setState({ deleteKey: "" });
    let docs = getIframeDoc(this.props.currentBook.format);
    let sel: Selection | null = null;
    for (let i = 0; i < docs.length; i++) {
      let doc = docs[i];
      if (!doc) continue;
      if (
        this.props.currentBook.format === "PDF" &&
        !ConfigService.getAllListConfig("convertPDFBooks").includes(
          this.props.currentBook.key
        )
      ) {
        let targetIframe = doc?.defaultView?.frameElement;
        let id = targetIframe?.getAttribute("id") || "";
        let chapterDocIndex = id ? parseInt(id.split("-").reverse()[0]) : 0;
        if (chapterDocIndex !== this.props.chapterDocIndex) {
          continue;
        }
      }

      sel = doc.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        break;
      }
    }
    this.props.handleChangeDirection(false);
    if (this.props.isOpenMenu) {
      this.props.handleMenuMode("");
      this.props.handleOpenMenu(false);
      this.props.handleNoteKey("");
    }
    if (!sel) return;
    if (sel.isCollapsed) {
      this.props.isOpenMenu && this.props.handleOpenMenu(false);
      this.props.handleMenuMode("menu");
      this.props.handleNoteKey("");
      return;
    }

    const selectAction = ConfigService.getReaderConfig("selectAction");
    if (selectAction && selectAction !== "") {
      this.handleSelectAction(selectAction, sel);
      return;
    }

    this.showMenu();
    this.props.handleMenuMode("menu");
  };

  handleDigest = async () => {
    await createHighlight({
      currentBook: this.props.currentBook,
      htmlBook: this.props.htmlBook,
      chapterDocIndex: this.props.chapterDocIndex,
      chapter: this.props.chapter,
      color: this.highlightUtil.formatHighlightValue(this.props.highlight),
      t: this.props.t,
      onNoteClick: (event: Event) => {
        const el = (event.target as HTMLElement) || (event.currentTarget as HTMLElement);
        const key = el?.getAttribute("data-key") || (el as any)?.dataset?.key;
        if (key) {
          this.props.handleNoteKey(key);
          this.props.handleMenuMode("note");
          this.props.handleOpenMenu(true);
        }
      },
      onSuccess: () => {
        this.props.handleOpenMenu(false);
        this.props.handleFetchNotes();
        this.props.handleMenuMode("");
      },
    });
  };

  handleNote = async () => {
    await createHighlight({
      currentBook: this.props.currentBook,
      htmlBook: this.props.htmlBook,
      chapterDocIndex: this.props.chapterDocIndex,
      chapter: this.props.chapter,
      color:
        this.highlightUtil.getNoteHighlightString() ||
        this.highlightUtil.formatHighlightValue(this.props.highlight),
      t: this.props.t,
      onNoteClick: (event: Event) => {
        const el = (event.target as HTMLElement) || (event.currentTarget as HTMLElement);
        const key = el?.getAttribute("data-key") || (el as any)?.dataset?.key;
        if (key) {
          this.props.handleNoteKey(key);
          this.props.handleMenuMode("note");
          this.props.handleOpenMenu(true);
        }
      },
      onSuccess: () => {
        this.props.handleOpenMenu(false);
        this.props.handleFetchNotes();
        this.props.handleMenuMode("");
        let docs = getIframeDoc(this.props.currentBook.format);
        for (let i = 0; i < docs.length; i++) {
          let doc = docs[i];
          if (!doc) continue;
          doc.getSelection()?.empty();
        }
      },
    });
  };

  handleSelectAction = async (action: string, sel: Selection) => {
    const format = this.props.currentBook.format;
    const text = getSelection(format);
    if (!text) return;

    switch (action) {
      case "translation":
        this.props.handleOriginalText(text);
        this.props.handleMenuMode("trans");
        this.props.handleOpenMenu(true);
        break;
      case "dict":
        this.props.handleOriginalText(text);
        this.props.handleOriginalSentence(getSelectionSentence(format));
        this.props.handleMenuMode("dict");
        this.props.handleOpenMenu(true);
        break;
      case "highlight":
        await createHighlight({
          currentBook: this.props.currentBook,
          htmlBook: this.props.htmlBook,
          chapterDocIndex: this.props.chapterDocIndex,
          chapter: this.props.chapter,
          color: this.highlightUtil.formatHighlightValue(this.props.highlight),
          t: this.props.t,
          onSuccess: () => {
            this.props.handleOpenMenu(false);
          },
        });
        break;
      case "note":
        await this.handleNote();
        break;
      case "speaker":
        const msg = new SpeechSynthesisUtterance();
        msg.text = text;
        if (window.speechSynthesis && window.speechSynthesis.getVoices) {
          msg.voice = window.speechSynthesis.getVoices()[0];
          window.speechSynthesis.speak(msg);
        }
        break;
      default:
        this.showMenu();
        this.props.handleMenuMode("menu");
        break;
    }
  };

  render() {
    const PopupProps = {
      chapterDocIndex: this.props.chapterDocIndex,
      chapter: this.props.chapter,
    };
    const ColorProps = {
      handleDigest: this.handleDigest,
    };
    return (
      <div>
        <div
          className={
            "popup-menu-container" + (isMobileRuntime() ? " mobile-popup" : "")
          }
          style={this.props.isOpenMenu ? {} : { display: "none" }}
          // 手机上点这个菜单的那一下，系统会认为「点在了选区外面」从而先清掉选区，
          // 等 onClick 跑到时已经读不到选中内容了（表现为菜单点了没反应）。
          // 拦掉 mousedown 的默认行为即可保住选区。
          // ⚠️ 只拦 mousedown，**不要**连 touchstart 一起拦 —— 拦了 touchstart
          // 会连带取消合成出来的 click，按钮就真的点不动了。
          onMouseDown={(event) => event.preventDefault()}
        >
          <div
            className="popup-menu-box"
            style={this.props.menuMode === "menu" ? {} : { display: "none" }}
          >
            <PopupOption {...(PopupProps as any)} />
          </div>
          <div
            className="popup-color-box"
            style={this.props.menuMode === "menu" ? {} : { display: "none" }}
          >
            <ColorOption {...(ColorProps as any)} />
          </div>
        </div>
      </div>
    );
  }
}

export default PopupMenu;
