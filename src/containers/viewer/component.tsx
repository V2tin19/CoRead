import React from "react";
import { ViewerProps, ViewerState } from "./interface";
import { withRouter } from "react-router-dom";
import BookUtil from "../../utils/file/bookUtil";
import PopupMenu from "../../components/popups/popupMenu";
import Background from "../../components/background";
import StyleUtil from "../../utils/reader/styleUtil";
import "./index.css";
import { htmlMouseEvent } from "../../utils/reader/mouseEvent";
import ImageViewer from "../../components/imageViewer";
import { getIframeDoc } from "../../utils/reader/docUtil";
import PopupBox from "../../components/popups/popupBox";
import Note from "../../models/Note";
import PageWidget from "../pageWidget";
import {
  getPageWidth,
  getParserRegex,
  getPdfPassword,
  getServerRegion,
  getTextRules,
  throttle,
} from "../../utils/common";
import _ from "underscore";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import * as Kookit from "../../assets/lib/kookit.min";
import PopupRefer from "../../components/popups/popupRefer";
import {
  ocrEngineList,
  ocrTesseractLangList,
} from "../../constants/dropdownList";
import DatabaseService from "../../utils/storage/databaseService";
import { getOcrResult, getOcrResultV2 } from "../../utils/request/reader";
import { BookHelper } from "../../assets/lib/kookit.min";
import {
  parseWithMineruAgent,
  parseWithSystemOCR,
} from "../../utils/request/common";
import collabClient, { getCollabBookKey } from "../../utils/collab/collabClient";
import toast from "react-hot-toast";
import {
  sanitizeRemoteNote,
  sanitizeRemoteNoteKey,
} from "../../utils/collab/remoteNote";
declare var window: any;
let lock = false; //prevent from clicking too fasts

class Viewer extends React.Component<ViewerProps, ViewerState> {
  private resizeHandler: (() => void) | null = null;
  private _pendingRerender = false;
  private collabUnsubs: Array<() => void> = [];
  private isApplyingRemoteLocation = false;
  // 上一次广播的位置指纹(不含 timestamp),防止 rendered+page-changed 双发
  private lastBroadcastLocationKey = "";
  private lastResizeWidth = 0;
  lock: boolean;
  constructor(props: ViewerProps) {
    super(props);
    this.state = {
      cfiRange: null,
      contents: null,
      rect: null,
      key: "",
      isFirst: true,
      chapterTitle:
        ConfigService.getObjectConfig(
          this.props.currentBook.key,
          "recordLocation",
          {}
        ).chapterTitle || "",
      isDisablePopup: ConfigService.getReaderConfig("isDisablePopup") === "yes",
      isTouch: ConfigService.getReaderConfig("isTouch") === "yes",
      chapterDocIndex: parseInt(
        ConfigService.getObjectConfig(
          this.props.currentBook.key,
          "recordLocation",
          {}
        ).chapterDocIndex || 0
      ),
      pageOffset: "",
      pageWidth: "",
      chapter: "",
      rendition: null,
    };
    this.lock = false;
  }
  UNSAFE_componentWillMount() {
    this.props.handleFetchBookmarks();
    this.props.handleFetchNotes();
    this.props.handleFetchBooks();
    this.props.handleFetchPlugins();
  }
  componentDidMount() {
    this.handleRenderBook();
    //make sure page width is always 12 times, section = Math.floor(element.clientWidth / 12), or text will be blocked
    this.setState(
      getPageWidth(
        this.props.readerMode,
        this.props.scale,
        parseInt(this.props.margin),
        this.props.isNavLocked,
        this.props.isSettingLocked
      )
    );
    this.props.handleRenderBookFunc(this.handleRenderBook);
    this.collabUnsubs = [
      collabClient.on("page-change", this.handleRemotePageChange),
      collabClient.on("note-created", this.handleRemoteNoteCreated),
      collabClient.on("note-updated", this.handleRemoteNoteUpdated),
      collabClient.on("note-deleted", this.handleRemoteNoteDeleted),
    ];
    this.lastResizeWidth = window.innerWidth;
    this.resizeHandler = throttle(() => {
      // 手机上软键盘弹出/收起只改变视口高度:宽度不变时无需重新分页,
      // 否则整书重渲染会销毁 iframe 并抢回焦点,把输入框的键盘反复顶掉
      if (
        window.innerWidth === this.lastResizeWidth &&
        document.body.clientWidth < 570
      ) {
        return;
      }
      this.lastResizeWidth = window.innerWidth;
      this.setState(
        getPageWidth(
          this.props.readerMode,
          this.props.scale,
          parseInt(this.props.margin),
          this.props.isNavLocked,
          this.props.isSettingLocked
        )
      );
      if (lock) {
        this._pendingRerender = true;
      } else {
        this.handleRenderBook();
      }
    });
    window.addEventListener("resize", this.resizeHandler);
  }
  componentWillUnmount() {
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }
    this.collabUnsubs.forEach((unsubscribe) => unsubscribe());
    this.collabUnsubs = [];
  }
  async UNSAFE_componentWillReceiveProps(nextProps: ViewerProps) {
    if (
      nextProps.margin !== this.props.margin ||
      nextProps.scale !== this.props.scale ||
      nextProps.readerMode !== this.props.readerMode ||
      nextProps.isNavLocked !== this.props.isNavLocked ||
      nextProps.isSettingLocked !== this.props.isSettingLocked
    ) {
      this.setState(
        getPageWidth(
          nextProps.readerMode,
          nextProps.scale,
          parseInt(nextProps.margin),
          nextProps.isNavLocked,
          nextProps.isSettingLocked
        )
      );
    }
  }
  handleHighlight = async (rendition: any) => {
    if (!rendition) return;
    let highlighters: any = await DatabaseService.getRecordsByBookKey(
      this.props.currentBook.key,
      "notes"
    );
    if (!highlighters) return;
    let highlightersByChapter = highlighters.filter((item: Note) => {
      let cfi = JSON.parse(item.cfi);
      if (cfi.cfi) {
        // epub from 1.5.2 or older
        return (
          item.chapter ===
          rendition.getChapterDoc()[this.state.chapterDocIndex].label
        );
      } else if (cfi.fingerprint) {
        // pdf from 1.7.4 or older
        return cfi.page - 1 === this.state.chapterDocIndex;
      } else {
        return item.chapterIndex === this.state.chapterDocIndex;
      }
    });
    if (this.props.currentBook.format === "PDF") {
      highlightersByChapter = highlightersByChapter.map((item: Note) => {
        let cfi = JSON.parse(item.cfi);
        if (cfi.fingerprint) {
          item.chapterIndex = cfi.page - 1;
          cfi.chapterDocIndex = cfi.page - 1 + "";
          cfi.chapterHref = "title" + (cfi.page - 1);
          item.cfi = JSON.stringify(cfi);
        }

        return item;
      });
    }
    await rendition.renderHighlighters(
      highlightersByChapter,
      this.handleNoteClick
    );
    if (
      this.props.currentBook.format === "PDF" &&
      (this.props.readerMode === "double" ||
        this.props.readerMode === "scroll") &&
      !ConfigService.getAllListConfig("convertPDFBooks").includes(
        this.props.currentBook.key
      )
    ) {
      let highlightersByChapter = highlighters.filter((item: Note) => {
        let cfi = JSON.parse(item.cfi);
        if (cfi.fingerprint) {
          // pdf from 1.7.4 or older
          return cfi.page === this.state.chapterDocIndex;
        } else {
          return item.chapterIndex === this.state.chapterDocIndex + 1;
        }
      });
      if (this.props.currentBook.format === "PDF") {
        highlightersByChapter = highlightersByChapter.map((item: Note) => {
          let cfi = JSON.parse(item.cfi);
          if (cfi.fingerprint) {
            item.chapterIndex = cfi.page - 1;
            cfi.chapterDocIndex = cfi.page - 1 + "";
            cfi.chapterHref = "title" + (cfi.page - 1);
            item.cfi = JSON.stringify(cfi);
          }

          return item;
        });
      }
      await rendition.renderHighlighters(
        highlightersByChapter,
        this.handleNoteClick
      );
    }
  };
  handleNoteClick = (event: Event) => {
    this.props.handleNoteKey((event.target as any).dataset.key);
    this.props.handleMenuMode("note");
    this.props.handleOpenMenu(true);
  };
  handleRenderBook = async () => {
    if (lock) return;
    let { key, path, format, name } = this.props.currentBook;
    this.props.handleHtmlBook(null);
    if (this.state.rendition) {
      this.state.rendition.removeContent();
    }
    if (
      ConfigService.getAllListConfig("seperateStyleBooks").includes(
        this.props.currentBook?.key
      )
    ) {
      window.currentBookKey = this.props.currentBook.key;
      this.props.handleBackgroundColor(
        ConfigService.getReaderConfig("backgroundColor") || ""
      );
    }
    let isCacheExsit = await BookUtil.isBookExist("cache-" + key, "zip", path);
    BookUtil.fetchBook(
      isCacheExsit ? "cache-" + key : key,
      isCacheExsit ? "zip" : format.toLowerCase(),
      true,
      path
    ).then(async (result: any) => {
      const crop = ConfigService.getObjectConfig(
        this.props.currentBook.key,
        "pdfCrop",
        null
      );
      let pdfCrop;
      if (crop) {
        const top = Number(crop.top) || 0;
        const bottom = Number(crop.bottom) || 0;
        const left = Number(crop.left) || 0;
        const right = Number(crop.right) || 0;
        if (top !== 0 || bottom !== 0 || left !== 0 || right !== 0) {
          pdfCrop = { top, bottom, left, right };
        }
      }
      const ocrLangKey =
        this.props.currentBook.description.indexOf("scanned") > -1
          ? "scannedOcrLang"
          : "textOcrLang";
      const ocrEngineKey =
        this.props.currentBook.description.indexOf("scanned") > -1
          ? "scannedOcrEngine"
          : "textOcrEngine";
      let rendition = BookHelper.getRendition(
        result,
        {
          format: isCacheExsit ? "CACHE" : format,
          readerMode: this.props.readerMode,
          charset: this.props.currentBook.charset,
          // 触屏设备默认启用轻量滑动动画(用户在设置里改过则尊重设置)
          animation:
            ConfigService.getReaderConfig("animation") ||
            (typeof window !== "undefined" && "ontouchstart" in window
              ? "sliding"
              : "none"),
          convertChinese: ConfigService.getReaderConfig("convertChinese"),
          bookLayout: ConfigService.getReaderConfig("bookLayout") || "",
          textRules: getTextRules(this.props.currentBook.key),
          codeHighlight: ConfigService.getReaderConfig("codeHighlight") || "",
          parserRegex: getParserRegex(
            this.props.currentBook.format,
            this.props.currentBook.key
          ),
          fullTranslationMode:
            ConfigService.getAllListConfig("fullTranslationBooks").includes(
              this.props.currentBook.key
            ) && this.props.isAuthed
              ? ConfigService.getReaderConfig("fullTranslationMode")
              : "no",
          textOrientation: ConfigService.getReaderConfig("textOrientation"),
          isDarkMode:
            ConfigService.getReaderConfig("backgroundColor") ===
            "rgba(44,47,49,1)"
              ? "yes"
              : "no",
          backgroundColor: ConfigService.getReaderConfig("backgroundColor"),
          isMobile: "no",
          isIndent: ConfigService.getReaderConfig("isIndent"),
          isHyphenation: ConfigService.getReaderConfig("isHyphenation"),
          isStartFromEven: ConfigService.getReaderConfig("isStartFromEven"),
          isAllowScript: ConfigService.getReaderConfig("isAllowScript"),
          isBionic: ConfigService.getReaderConfig("isBionic"),
          password: getPdfPassword(this.props.currentBook),
          pdfCrop,
          scale: parseFloat(this.props.scale),
          isConvertPDF: ConfigService.getAllListConfig(
            "convertPDFBooks"
          ).includes(this.props.currentBook.key)
            ? "yes"
            : "no",
          ocrLang: ConfigService.getReaderConfig(ocrLangKey)
            ? ConfigService.getReaderConfig(ocrLangKey)
            : ConfigService.getReaderConfig(ocrEngineKey) === "tesseract"
              ? ocrTesseractLangList.find(
                  (item) => item.lang === ConfigService.getReaderConfig("lang")
                )?.value || "chi_sim"
              : ConfigService.getReaderConfig(ocrEngineKey)
                ? ocrEngineList.find(
                    (item) =>
                      item.value === ConfigService.getReaderConfig(ocrEngineKey)
                  )?.lang || "general"
                : "standard_v5_mobile",
          externalWorker: {
            recognize:
              ConfigService.getReaderConfig(ocrEngineKey) === "system-ocr"
                ? parseWithSystemOCR
                : ConfigService.getReaderConfig(ocrEngineKey) ===
                    "mineru-official-agent"
                  ? parseWithMineruAgent
                  : ConfigService.getReaderConfig(ocrLangKey) === "accurate"
                    ? getOcrResultV2
                    : getOcrResult,
          },
          ocrEngine: ConfigService.getReaderConfig(ocrEngineKey) || "paddle",
          serverRegion:
            getServerRegion() === "china" && this.props.isAuthed
              ? "china"
              : "global",
          paraSpacingValue:
            ConfigService.getReaderConfig("paraSpacingValue") || "1.5",
          titleSizeValue:
            ConfigService.getReaderConfig("titleSizeValue") || "1.2",
          isScannedPDF:
            this.props.currentBook.description.indexOf("scanned") > -1
              ? "yes"
              : "no",
          isKeepPDFBackground: ConfigService.getReaderConfig(
            "isKeepPDFBackground"
          ),
        },
        Kookit
      );
      if (this.props.currentBook.format === "TXT") {
        let bookLocation = ConfigService.getObjectConfig(
          this.props.currentBook.key,
          "recordLocation",
          {}
        );
        await rendition.renderTo(
          document.getElementById("page-area"),
          bookLocation
        );
      } else {
        await rendition.renderTo(document.getElementById("page-area"));
      }

      await this.handleRest(rendition);
      this.props.handleReadingState(true);

      ConfigService.setListConfig(this.props.currentBook.key, "recentBooks");
      document.title = name + " - Koodo Reader";
    });
  };

  handleRest = async (rendition: any) => {
    htmlMouseEvent(
      rendition,
      this.props.currentBook.key,
      this.props.readerMode,
      this.props.currentBook.format,
      this.props.handleScale,
      this.props.renderBookFunc
    );
    let chapters = rendition.getChapter();
    let chapterDocs = rendition.getChapterDoc();
    let flattenChapters = rendition.flatChapter(chapters);
    this.props.handleHtmlBook({
      key: this.props.currentBook.key,
      chapters,
      flattenChapters,
      rendition: rendition,
    });
    this.setState({ rendition });
    if (
      this.props.currentBook.format === "PDF" &&
      !ConfigService.getAllListConfig("convertPDFBooks").includes(
        this.props.currentBook.key
      )
    ) {
      //ignore
    } else {
      StyleUtil.addDefaultCss(this.props.currentBook.key);
      await StyleUtil.applyReaderFonts(rendition);
    }

    let bookLocation: {
      text: string;
      count: string;
      chapterTitle: string;
      chapterDocIndex: string;
      chapterHref: string;
      percentage: string;
      cfi: string;
      page: string;
      xpath: string;
    } = ConfigService.getObjectConfig(
      this.props.currentBook.key,
      "recordLocation",
      {}
    );
    if (chapterDocs.length > 0) {
      if (
        ConfigService.getReaderConfig("isEnableKoReaderSync") === "yes" &&
        bookLocation.xpath
      ) {
        await rendition.goToXpath(bookLocation.xpath);
      } else {
        await rendition.goToPosition(
          JSON.stringify({
            text: bookLocation.text || "",
            chapterTitle: bookLocation.chapterTitle || "",
            page: bookLocation.page || "",
            chapterDocIndex: bookLocation.chapterDocIndex || 0,
            chapterHref: bookLocation.chapterHref || "",
            count: bookLocation.hasOwnProperty("cfi")
              ? "ignore"
              : bookLocation.count || 0,
            percentage: bookLocation.percentage,
            cfi: bookLocation.cfi,
            isFirst: true,
          })
        );
      }
    }
    rendition.on("rendered", async () => {
      this.handleLocation();
      let bookLocation: {
        text: string;
        count: string;
        chapterTitle: string;
        chapterDocIndex: string;
        chapterHref: string;
      } = ConfigService.getObjectConfig(
        this.props.currentBook.key,
        "recordLocation",
        {}
      );

      let chapter =
        bookLocation.chapterTitle ||
        (this.props.htmlBook && this.props.htmlBook.flattenChapters[0]
          ? ""
          : "Unknown chapter");
      let chapterDocIndex = 0;
      if (bookLocation.chapterDocIndex) {
        chapterDocIndex = parseInt(bookLocation.chapterDocIndex);
      } else {
        chapterDocIndex =
          bookLocation.chapterTitle && this.props.htmlBook
            ? _.findLastIndex(
                this.props.htmlBook.flattenChapters.map((item) => {
                  item.label = item.label.trim();
                  return item;
                }),
                {
                  label: bookLocation.chapterTitle.trim(),
                }
              )
            : 0;
      }
      this.props.handleCurrentChapter(chapter);
      this.props.handleCurrentChapterIndex(chapterDocIndex);

      this.setState({
        chapter,
        chapterDocIndex,
      });
      if (
        this.props.currentBook.format === "PDF" &&
        !ConfigService.getAllListConfig("convertPDFBooks").includes(
          this.props.currentBook.key
        )
      ) {
        //ignore
      } else {
        StyleUtil.addDefaultCss(this.props.currentBook.key);
        await StyleUtil.applyReaderFonts(rendition);
      }
      // rendition.tranformText();
      this.handleBindGesture();
      await this.handleHighlight(rendition);
      lock = true;
      setTimeout(() => {
        lock = false;
        if (this._pendingRerender) {
          this._pendingRerender = false;
          this.handleRenderBook();
        }
      }, 1000);
      return false;
    });
    // 章「内」翻页只触发 page-changed，不触发 rendered（kookit 的 next() 只在
    // 跨章/跳转时才 fire rendered）。位置广播若只挂 rendered，领读在同一章里
    // 翻页其他端永远收不到 —— 症状是「跨章节才同步，章内翻页没反应」。
    // rendered+page-changed 双发的重复广播由 handleLocation 的指纹去重挡掉。
    rendition.on("page-changed", async () => {
      this.handleLocation();
    });
    if (
      this.props.currentBook.format === "TXT" &&
      rendition.format !== "CACHE"
    ) {
      if (
        flattenChapters.length > 0 &&
        flattenChapters[0].label === "Chapter 0"
      ) {
        return;
      }
      setTimeout(async () => {
        await rendition.refreshContent();
        let chapters = rendition.getChapter();
        let flattenChapters = rendition.flatChapter(chapters);
        this.props.handleHtmlBook({
          key: this.props.currentBook.key,
          chapters,
          flattenChapters,
          rendition: rendition,
        });
      }, 1000);
    }
  };

  handleLocation = () => {
    if (!this.props.htmlBook) {
      return;
    }
    let position = this.props.htmlBook.rendition.getPosition();
    ConfigService.setObjectConfig(
      this.props.currentBook.key,
      position,
      "recordLocation"
    );
    if (this.isApplyingRemoteLocation) {
      return;
    }
    // 去重:章内翻页会先发 page-changed、翻章时 rendered+page-changed 一起到,
    // 内容没变就不重复广播(timestamp 每次都变,不能整包比较)
    const positionKey = [
      position.chapterHref,
      position.chapterDocIndex,
      position.page,
      position.count,
      position.percentage,
      position.text,
    ].join("|");
    if (positionKey === this.lastBroadcastLocationKey) {
      return;
    }
    this.lastBroadcastLocationKey = positionKey;
    collabClient
      .broadcastLocation(getCollabBookKey(this.props.currentBook), position)
      .catch((error) => console.warn("Failed to broadcast location", error));
  };
  // 领读锚点内容是否已经在本屏可见。
  // 大屏一页能看到小屏好几页:领读翻了一页,锚点往往还在跟读端当前视野里,
  // 这时候不该再翻页 —— 对齐的是「阅读进度」,不是「翻页动作」。
  // 用领读页首文本去跟读端文档里找块,块的主体落在当前可视范围内即算可见。
  isAnchorVisible = (location: any): boolean => {
    const raw = String(location?.text || "").trim();
    if (raw.length < 8) return false;
    const docs = getIframeDoc(
      this.props.currentBook.format,
      this.props.currentBook.key
    );
    const doc = docs && docs[0];
    if (!doc || !doc.body) return false;
    const norm = (s: string) => String(s || "").replace(/\s+/g, "");
    const target = norm(raw).slice(0, 60);
    if (!target) return false;
    const body = doc.body;
    const horizontal = body.scrollWidth > body.clientWidth + 4;
    const blocks = doc.body.querySelectorAll(
      "h1,h2,h3,h4,h5,h6,p,div,ul,dl,ol,li,dt,dd,pre,blockquote,address"
    );
    for (const node of Array.from(blocks)) {
      const block = node as HTMLElement;
      const t = norm(block.textContent || "");
      if (!t || !t.includes(target)) continue;
      if (horizontal) {
        const left = block.offsetLeft;
        const right = left + (block.offsetWidth || 1);
        if (
          right > body.scrollLeft + 8 &&
          left < body.scrollLeft + body.clientWidth - 8
        ) {
          return true;
        }
      } else {
        const top = block.offsetTop;
        const bottom = top + (block.offsetHeight || 1);
        if (
          bottom > body.scrollTop + 8 &&
          top < body.scrollTop + body.clientHeight - 8
        ) {
          return true;
        }
      }
    }
    return false;
  };
  handleRemotePageChange = async (event: {
    senderId: string;
    location: any;
  }) => {
    if (!event?.location || event.senderId === collabClient.clientId) return;
    if (!collabClient.isInRoom(getCollabBookKey(this.props.currentBook)))
      return;
    if (!this.props.htmlBook?.rendition) return;
    // 默认不跟随：共读时不该被别人翻页拽走自己的阅读位置。
    // 只有本人打开「跟随领读」、且这次翻页确实来自房间领读时，才跟着翻。
    // （领读在共读面板的在线成员里指定，服务端下发。）
    if (!collabClient.followLeader) return;
    if (!collabClient.leaderId || event.senderId !== collabClient.leaderId)
      return;
    // 锚点内容已在当前视野里:阅读进度本就对齐,不翻页,只给个提示
    if (this.isAnchorVisible(event.location)) {
      toast.success("已在领读进度附近", {
        id: "collab-follow",
        duration: 1000,
      });
      return;
    }
    this.isApplyingRemoteLocation = true;
    try {
      await this.props.htmlBook.rendition.goToPosition(
        JSON.stringify(event.location)
      );
      ConfigService.setObjectConfig(
        this.props.currentBook.key,
        event.location,
        "recordLocation"
      );
      // 轻提示:让跟随的人确认「同步成功了」,1 秒即逝不打扰阅读
      toast.success("已跟随领读翻页", { id: "collab-follow", duration: 1000 });
    } catch (error) {
      console.warn("Failed to apply remote location", error);
    } finally {
      // kookit 翻页动画 320ms + record 落位置,300ms 太短:跟随动作自身触发的
      // 广播会把领读的位置原样弹回来。放宽到 1 秒。
      setTimeout(() => {
        this.isApplyingRemoteLocation = false;
      }, 1000);
    }
  };
  handleRemoteNoteCreated = async (event: { senderId: string; note: Note }) => {
    if (!event?.note || event.senderId === collabClient.clientId) return;
    const collabKey = getCollabBookKey(this.props.currentBook);
    if (
      !collabClient.isInRoom(collabKey) ||
      event.note.bookKey !== collabKey
    )
      return;
    // 网络来的笔记：字段白名单 + 限长 + 净化之后才落库 / 交给渲染器。
    // （createOneNote 会把 range 和 notes 直接塞进 iframe 的 DOM，不能原样信）
    const safe = sanitizeRemoteNote(event.note);
    if (!safe) return;
    const existing = await DatabaseService.getRecord(safe.key, "notes");
    if (existing) return;
    // 传输中的 bookKey 是内容 md5,落地时改写为本机 key,笔记才能挂到本地这本书下
    const localNote = {
      ...safe,
      bookKey: this.props.currentBook.key,
    } as Note;
    await DatabaseService.saveRecord(localNote, "notes", false);
    if (this.props.htmlBook?.rendition) {
      await this.props.htmlBook.rendition.createOneNote(
        localNote,
        this.handleNoteClick
      );
    }
    this.props.handleFetchNotes();
  };
  handleRemoteNoteUpdated = async (event: { senderId: string; note: Note }) => {
    if (!event?.note || event.senderId === collabClient.clientId) return;
    const collabKey = getCollabBookKey(this.props.currentBook);
    if (
      !collabClient.isInRoom(collabKey) ||
      event.note.bookKey !== collabKey
    )
      return;
    const safe = sanitizeRemoteNote(event.note);
    if (!safe) return;
    const localNote = {
      ...safe,
      bookKey: this.props.currentBook.key,
    } as Note;
    const existing = await DatabaseService.getRecord(safe.key, "notes");
    if (existing) {
      await DatabaseService.updateRecord(localNote, "notes", false);
    } else {
      await DatabaseService.saveRecord(localNote, "notes", false);
    }
    if (this.props.htmlBook?.rendition) {
      this.props.htmlBook.rendition.removeOneNote(
        localNote.key,
        localNote.chapterIndex
      );
      await this.props.htmlBook.rendition.createOneNote(
        localNote,
        this.handleNoteClick
      );
    }
    this.props.handleFetchNotes();
  };
  handleRemoteNoteDeleted = async (event: {
    senderId: string;
    noteKey: string;
    chapterDocIndex?: number;
  }) => {
    if (!event?.noteKey || event.senderId === collabClient.clientId) return;
    // 只接受简单标识符，避免拿任意字符串去查/删本地笔记
    const noteKey = sanitizeRemoteNoteKey(event.noteKey);
    if (!noteKey) return;
    const existing = await DatabaseService.getRecord(noteKey, "notes");
    if (!existing || existing.bookKey !== this.props.currentBook.key) return;
    await DatabaseService.deleteRecord(noteKey, "notes", false);
    if (this.props.htmlBook?.rendition) {
      this.props.htmlBook.rendition.removeOneNote(
        noteKey,
        event.chapterDocIndex ?? existing.chapterIndex
      );
    }
    this.props.handleFetchNotes();
  };
  handleBindGesture = () => {
    let docs = getIframeDoc(
      this.props.currentBook.format,
      this.props.currentBook.key
    );
    for (let i = 0; i < docs.length; i++) {
      let doc = docs[i];
      if (!doc) continue;
      doc.addEventListener("click", () => {
        this.props.handleLeaveReader("left");
        this.props.handleLeaveReader("right");
        this.props.handleLeaveReader("top");
        this.props.handleLeaveReader("bottom");
      });
      doc.addEventListener("pointerup", (event) => {
        if (
          this.props.currentBook.format === "PDF" &&
          !ConfigService.getAllListConfig("convertPDFBooks").includes(
            this.props.currentBook.key
          )
        ) {
          let ownerDoc = (event.target as HTMLElement).ownerDocument;
          let targetIframe = ownerDoc?.defaultView?.frameElement;
          let id = targetIframe?.getAttribute("id") || "";
          let chapterDocIndex = id ? parseInt(id.split("-").reverse()[0]) : 0;
          this.setState({ chapterDocIndex });
        }

        if (this.state.isDisablePopup) {
          if (doc!.getSelection()!.toString().trim().length === 0) {
            let rect = doc!
              .getSelection()!
              .getRangeAt(0)
              .getBoundingClientRect();
            this.setState({ rect });
          }
        }
        if (this.state.isDisablePopup) return;
        let selection = doc!.getSelection();
        if (!selection || selection.rangeCount === 0) return;

        var rect = selection.getRangeAt(0).getBoundingClientRect();
        this.setState({ rect });
      });
      doc.addEventListener("contextmenu", (event) => {
        if (
          this.props.currentBook.format === "PDF" &&
          !ConfigService.getAllListConfig("convertPDFBooks").includes(
            this.props.currentBook.key
          )
        ) {
          let ownerDoc = (event.target as HTMLElement).ownerDocument;
          let targetIframe = ownerDoc?.defaultView?.frameElement;
          let id = targetIframe?.getAttribute("id") || "";
          let chapterDocIndex = id ? parseInt(id.split("-").reverse()[0]) : 0;
          this.setState({ chapterDocIndex });
        }
        if (document.location.href.indexOf("localhost") === -1) {
          event.preventDefault();
        }

        if (!this.state.isDisablePopup && !this.state.isTouch) return;

        if (
          !doc!.getSelection() ||
          doc!.getSelection()!.toString().trim().length === 0
        ) {
          return;
        }
        let selection = doc!.getSelection();

        if (!selection || selection.rangeCount === 0) return;
        var rect = selection.getRangeAt(0).getBoundingClientRect();
        this.setState({ rect });
      });
    }
  };
  render() {
    return (
      <>
        {this.props.htmlBook ? (
          <PopupMenu
            {...({
              rendition: this.props.htmlBook.rendition,
              rect: this.state.rect,
              chapterDocIndex: this.state.chapterDocIndex,
              chapter: this.state.chapter,
            } as any)}
          />
        ) : null}
        {this.props.htmlBook ? (
          <PopupRefer
            {...({
              rendition: this.props.htmlBook.rendition,
              chapterDocIndex: this.state.chapterDocIndex,
            } as any)}
          />
        ) : null}
        {this.props.isOpenMenu &&
        this.props.htmlBook &&
        (this.props.menuMode === "dict" ||
          this.props.menuMode === "trans" ||
          this.props.menuMode === "assistant" ||
          this.props.menuMode === "note") ? (
          <PopupBox
            {...({
              rendition: this.props.htmlBook.rendition,
              rect: this.state.rect,
              chapterDocIndex: this.state.chapterDocIndex,
              chapter: this.state.chapter,
            } as any)}
          />
        ) : null}
        {this.props.htmlBook && this.props.currentBook.format !== "PDF" && (
          <ImageViewer
            {...({
              isShow: this.props.isShow,
              rendition: this.props.htmlBook.rendition,
              handleEnterReader: this.props.handleEnterReader,
              handleLeaveReader: this.props.handleLeaveReader,
            } as any)}
          />
        )}
        <div
          className={
            this.props.readerMode === "scroll"
              ? "html-viewer-page scrolling-html-viewer-page"
              : "html-viewer-page"
          }
          id="page-area"
          style={
            this.props.readerMode === "scroll" &&
            document.body.clientWidth >= 570
              ? {
                  // marginLeft: this.state.pageOffset,
                  // marginRight: this.state.pageOffset,
                  paddingLeft: "0px",
                  paddingRight: "0px",
                  left: this.state.pageOffset,
                  width: this.state.pageWidth,
                }
              : {
                  left: this.state.pageOffset,
                  width: this.state.pageWidth,
                }
          }
        ></div>
        <PageWidget />
        {this.props.isHideBackground ? null : this.props.currentBook.key ? (
          <Background />
        ) : null}
      </>
    );
  }
}
export default withRouter(Viewer as any);
