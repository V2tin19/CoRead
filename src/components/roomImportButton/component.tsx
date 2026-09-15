import React from "react";
import "../../components/importLocal/importLocal.css";
import {
  ACTIVE_ROOM_CHANGED_EVENT,
  getActiveCollabRoom,
  listRoomBookNames,
  notifyRoomBooksChanged,
  uploadFileToRoom,
  uploadRoomCover,
  ActiveCollabRoom,
} from "../../utils/collab/roomBook";
import {
  supportedFormats,
  vexPromptAsync,
  getTextRules,
} from "../../utils/common";
import CoverUtil from "../../utils/file/coverUtil";
import { BookHelper } from "../../assets/lib/kookit.min";
import * as Kookit from "../../assets/lib/kookit.min";
import { ConfigService } from '../../services';
import DOMPurify from "dompurify";
import { Readability } from "@mozilla/readability";
import toast from "react-hot-toast";

// 提取房间书的封面:与个人导入同一套 kookit 解析,拿到 base64 后转字节。
// PDF/漫画解析太重,跳过(它们继续用占位封面);失败静默,不影响上传本身。
const ROOM_COVER_SKIP_EXT = ["pdf", "cbz", "cbr", "cbt", "cb7"];
async function extractCoverBytes(
  file: File
): Promise<{ data: ArrayBuffer; ext: string } | null> {
  try {
    const extension = (file.name.split(".").pop() || "").toLowerCase();
    if (!extension || ROOM_COVER_SKIP_EXT.includes(extension)) return null;
    const bookName = file.name.slice(0, file.name.length - extension.length - 1);
    const content = await file.arrayBuffer();
    const rendition = BookHelper.getRendition(
      content,
      {
        format: extension.toUpperCase(),
        readerMode: "",
        charset: "",
        animation: "none",
        convertChinese: ConfigService.getReaderConfig("convertChinese"),
        bookLayout: ConfigService.getReaderConfig("bookLayout"),
        textRules: getTextRules(),
        codeHighlight: ConfigService.getReaderConfig("codeHighlight") || "",
        fullTranslationMode: "no",
        textOrientation: ConfigService.getReaderConfig("textOrientation"),
        parserRegex: "",
        isDarkMode: "no",
        isMobile: "no",
        password: "",
        isScannedPDF: "no",
        isKeepPDFBackground: "no",
      },
      Kookit
    );
    const book = await BookHelper.generateBook(
      bookName,
      extension,
      "room-cover-" + Date.now(),
      file.size,
      "",
      content,
      rendition
    );
    const cover = (book as any).cover;
    if (!cover) return null;
    const result = await CoverUtil.convertCoverBase64(cover);
    if (!result.arrayBuffer || result.arrayBuffer.byteLength === 0) return null;
    return {
      data: result.arrayBuffer,
      ext: result.extension === "jpeg" ? "jpg" : result.extension,
    };
  } catch (e) {
    return null;
  }
}

// 「共同阅读」页面右上角的导入按钮:点主区域选本地文件,下拉三角可从 URL 导入,
// 全部传进当前所在的共读房间,不碰个人书架

interface RoomImportButtonProps {
  t: (key: string) => string;
}

interface RoomImportButtonState {
  room: ActiveCollabRoom | null;
  isMenuVisible: boolean;
  isBusy: boolean;
}

class RoomImportButton extends React.Component<
  RoomImportButtonProps,
  RoomImportButtonState
> {
  private fileInputRef: React.RefObject<HTMLInputElement>;

  constructor(props: RoomImportButtonProps) {
    super(props);
    this.fileInputRef = React.createRef();
    this.state = {
      room: getActiveCollabRoom(),
      isMenuVisible: false,
      isBusy: false,
    };
  }

  componentDidMount() {
    window.addEventListener(
      ACTIVE_ROOM_CHANGED_EVENT,
      this.handleActiveRoomChanged
    );
  }

  componentWillUnmount() {
    window.removeEventListener(
      ACTIVE_ROOM_CHANGED_EVENT,
      this.handleActiveRoomChanged
    );
  }

  handleActiveRoomChanged = () => {
    this.setState({ room: getActiveCollabRoom() });
  };

  toggleMenu = (event: React.MouseEvent) => {
    event.stopPropagation();
    this.setState((prev) => ({ isMenuVisible: !prev.isMenuVisible }));
  };

  closeMenu = () => {
    this.setState({ isMenuVisible: false });
  };

  pickFiles = () => {
    this.closeMenu();
    this.fileInputRef.current?.click();
  };

  handleFiles = async (files: FileList | null) => {
    const room = getActiveCollabRoom();
    if (!files || files.length === 0 || !room) return;
    if (this.state.isBusy) return;
    this.setState({ isBusy: true });
    try {
      const existingNames = await listRoomBookNames(room.roomId);
      for (const file of Array.from(files)) {
        if (existingNames.includes(file.name)) {
          if (!window.confirm(`房间书架已有《${file.name}》,覆盖上传?`)) {
            continue;
          }
        }
        await uploadFileToRoom(room.roomId, file);
        // 上传成功后顺手提取封面传上去,房间书架才能显示真封面
        {
          toast.loading("正在提取封面...", { id: "room-cover" });
          const cover = await extractCoverBytes(file);
          if (cover) {
            await uploadRoomCover(room.roomId, file.name, cover.data, cover.ext);
          }
          toast.dismiss("room-cover");
        }
      }
      notifyRoomBooksChanged(room.roomId);
    } finally {
      this.setState({ isBusy: false });
      if (this.fileInputRef.current) {
        this.fileInputRef.current.value = "";
      }
    }
  };

  // ── URL 导入:与个人「导入图书 → From URL」同款逻辑 ────────────────────
  decodeHtmlEntities = (value: string) => {
    if (!value) return "";
    const doc = new DOMParser().parseFromString(value, "text/html");
    return doc.documentElement.textContent || value;
  };

  escapeHtml = (value: string) => {
    return (value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  makeUrlsAbsolute = (rootDoc: Document, baseUrl: string) => {
    const toAbs = (value: string | null) => {
      if (!value) return value;
      if (value.startsWith("data:")) return value;
      try {
        return new URL(value, baseUrl).toString();
      } catch {
        return value;
      }
    };
    rootDoc.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      const next = toAbs(href);
      if (next) a.setAttribute("href", next);
    });
    rootDoc.querySelectorAll("img[src]").forEach((img) => {
      const src = img.getAttribute("src");
      const next = toAbs(src);
      if (next) img.setAttribute("src", next);
    });
    ["data-src", "data-original", "data-lazy-src"].forEach((attr) => {
      rootDoc.querySelectorAll(`img[${attr}]`).forEach((img) => {
        const value = img.getAttribute(attr);
        const next = toAbs(value);
        if (next) img.setAttribute("src", next);
      });
    });
    rootDoc.querySelectorAll("link[href]").forEach((l) => {
      const href = l.getAttribute("href");
      const next = toAbs(href);
      if (next) l.setAttribute("href", next);
    });
  };

  fetchImageAsDataUrl = async (imageUrl: string) => {
    if (!imageUrl || imageUrl.startsWith("data:")) {
      return imageUrl || null;
    }
    if (imageUrl.startsWith("blob:")) {
      return null;
    }
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) return null;
      const blob = await response.blob();
      const contentType = (
        response.headers.get("content-type") ||
        blob.type ||
        ""
      ).toLowerCase();
      if (contentType && !contentType.startsWith("image/")) {
        return null;
      }
      return await CoverUtil.blobToBase64(blob);
    } catch {
      return null;
    }
  };

  resolveImageUrl = (img: HTMLImageElement) => {
    const candidates = [
      img.getAttribute("src"),
      img.getAttribute("data-src"),
      img.getAttribute("data-original"),
      img.getAttribute("data-lazy-src"),
    ].filter(Boolean) as string[];
    for (const value of candidates) {
      if (value.startsWith("data:")) {
        if (value.length > 200) return value;
        continue;
      }
      if (!value.startsWith("blob:")) return value;
    }
    return null;
  };

  embedImagesAsBase64 = async (rootDoc: Document, toastId: string) => {
    const images = Array.from(rootDoc.querySelectorAll("img"));
    const total = images.length;
    if (total === 0) return;
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const imageUrl = this.resolveImageUrl(img);
      if (!imageUrl) continue;
      if (imageUrl.startsWith("data:")) {
        img.setAttribute("src", imageUrl);
        continue;
      }
      const dataUrl = await this.fetchImageAsDataUrl(imageUrl);
      if (dataUrl) {
        img.setAttribute("src", dataUrl);
        img.removeAttribute("data-src");
        img.removeAttribute("data-original");
        img.removeAttribute("data-lazy-src");
        img.removeAttribute("srcset");
      }
      const pct = Math.round(((i + 1) / total) * 100);
      toast.loading(this.props.t("Downloading") + ": " + pct + "%", {
        id: toastId,
      });
    }
  };

  // 把网页正文抽出来做成一本干净的 html 书,返回可直接上传的 File
  convertHtmlUrlToFile = async (
    url: string,
    urlFileName: string,
    toastId: string
  ) => {
    toast.loading(this.props.t("Downloading") + ": 0%", { id: toastId });
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const contentType = (
      response.headers.get("content-type") || ""
    ).toLowerCase();
    const looksLikeHtml =
      contentType.includes("text/html") ||
      contentType.includes("application/xhtml+xml") ||
      contentType.includes("text/plain") ||
      contentType.includes("application/xml") ||
      contentType.includes("text/xml") ||
      !contentType;
    if (!looksLikeHtml) {
      throw new Error(
        this.props.t("Unsupported file format") + ": " + (contentType || "unknown")
      );
    }
    const htmlText = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, "text/html");

    let extracted: any = null;
    try {
      const reader = new Readability(doc);
      extracted = reader.parse();
    } catch (e) {
      extracted = null;
    }

    const rawTitle =
      extracted?.title ||
      doc.title ||
      (urlFileName || "book").replace(/\.[^/.]+$/, "") ||
      "book";
    const decodedTitle = this.decodeHtmlEntities(rawTitle).trim() || "book";
    const extractedContent =
      extracted?.content || doc.body?.innerHTML || "";
    const contentDoc = parser.parseFromString(extractedContent, "text/html");
    if (contentDoc?.body) {
      this.makeUrlsAbsolute(contentDoc, url);
      await this.embedImagesAsBase64(contentDoc, toastId);
    }

    const sanitizedBody = DOMPurify.sanitize(
      contentDoc.body?.innerHTML || extractedContent,
      { USE_PROFILES: { html: true } }
    );
    const safeTitle = this.escapeHtml(decodedTitle);
    const finalHtmlFileName = `${decodedTitle.replace(/[/\\?%*:|"<>]/g, "-")}.html`;
    const finalHtml = `<!doctype html><html><head><meta charset="utf-8"/><title>${safeTitle}</title></head><body>${sanitizedBody}</body></html>`;
    return new File([new TextEncoder().encode(finalHtml)], finalHtmlFileName, {
      type: "text/html",
    });
  };

  handleURLImport = async (event: React.MouseEvent) => {
    event.stopPropagation();
    this.closeMenu();
    const room = getActiveCollabRoom();
    if (!room) return;
    if (this.state.isBusy) return;

    const url = await vexPromptAsync(
      this.props.t("Enter book download URL or article URL"),
      "https://"
    );
    if (!url || typeof url !== "string") return;
    const trimmedUrl = url.trim();
    if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")) {
      toast.error(this.props.t("Please enter a valid http or https URL"));
      return;
    }

    this.setState({ isBusy: true });
    const toastId = "room-url-download";
    try {
      let fileName = decodeURIComponent(
        trimmedUrl.split("?")[0].split("/").pop() || "book"
      );
      const ext = "." + fileName.split(".").pop()?.toLowerCase();
      let file: File;
      const isDirectFormat =
        supportedFormats
          .filter((item) => item !== ".html" && item !== ".htm")
          .includes(ext) && fileName.includes(".");
      if (isDirectFormat) {
        toast.loading(this.props.t("Downloading") + ": 0%", { id: toastId });
        const response = await fetch(trimmedUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        toast.dismiss(toastId);
        file = new File([blob], fileName);
      } else {
        file = await this.convertHtmlUrlToFile(trimmedUrl, fileName, toastId);
        toast.dismiss(toastId);
      }
      await uploadFileToRoom(room.roomId, file);
      notifyRoomBooksChanged(room.roomId);
    } catch (error) {
      toast.dismiss(toastId);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      toast.error(this.props.t("Import failed") + ": " + errorMessage);
      console.error("Room URL import error:", error);
    } finally {
      this.setState({ isBusy: false });
    }
  };

  render() {
    const { room, isBusy } = this.state;
    if (!room) return null;
    return (
      <div
        className="import-from-local"
        onClick={this.pickFiles}
        style={{ cursor: isBusy ? "default" : "pointer" }}
      >
        <div className="more-import-option" onClick={this.toggleMenu}>
          <span className="dropdown-triangle" />
          {this.state.isMenuVisible && (
            <div className="more-options-dropdown" onMouseLeave={this.closeMenu}>
              <div className="more-option-item" onClick={this.pickFiles}>
                <span className="more-option-text">本地文件</span>
              </div>
              <div className="more-option-item" onClick={this.handleURLImport}>
                <span className="more-option-text">从 URL 导入</span>
              </div>
            </div>
          )}
        </div>
        <div className="animation-mask-local" />
        <span>{isBusy ? "导入中..." : "导入图书到房间"}</span>
        <input
          ref={this.fileInputRef}
          type="file"
          accept={supportedFormats.join(",")}
          multiple
          style={{ display: "none" }}
          onChange={(e) => this.handleFiles(e.target.files)}
        />
      </div>
    );
  }
}

export default RoomImportButton;
