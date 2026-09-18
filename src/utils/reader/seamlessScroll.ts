/**
 * 竖向滑动阅读模式下的「无缝连章」管理器
 * ========================================
 * 目标：在垂直连续滚动模式下，滑到章末不再整页硬切，
 * 而是平滑直接追加下一章内容，中间以浅色横线分割，实现无缝连续阅读。
 */

import { getIframeDoc } from "./docUtil";

/** 加载单章的正文 HTML，自动剥离 html/head 并替换图片资源 URL */
export async function loadChapterBodyHtml(itemOrDoc: any): Promise<string> {
  if (!itemOrDoc) return "";
  const item = (itemOrDoc && itemOrDoc.text) ? itemOrDoc.text : itemOrDoc;
  let chapterText = "";
  try {
    if (item && typeof item.load === "function") {
      const chapterUrl = await item.load();
      const res = await fetch(chapterUrl);
      const blob = await res.blob();
      chapterText = await blob.text();
    } else if (typeof item === "string") {
      chapterText = item;
    } else if (item && typeof item.text === "string") {
      chapterText = item.text;
    }
  } catch (e) {
    console.warn("Failed to load chapter text", e);
    return "";
  }

  if (!chapterText) return "";

  try {
    const parser = new DOMParser();
    const parsedDoc = parser.parseFromString(chapterText, "text/html");

    // 预解析静态资源（例如 epub 图片）
    if (item && typeof item.loadAsset === "function") {
      const imgList = Array.from(parsedDoc.querySelectorAll("img, image"));
      for (const el of imgList) {
        const src = el.getAttribute("src");
        if (src && !src.startsWith("blob:") && !src.startsWith("data:")) {
          try {
            const assetUrl = await item.loadAsset(src);
            if (assetUrl) el.setAttribute("src", assetUrl);
          } catch {}
        }
        const href = el.getAttribute("xlink:href");
        if (href && !href.startsWith("blob:") && !href.startsWith("data:")) {
          try {
            const assetUrl = await item.loadAsset(href);
            if (assetUrl) el.setAttribute("xlink:href", assetUrl);
          } catch {}
        }
      }
    }

    return parsedDoc.body ? parsedDoc.body.innerHTML : chapterText;
  } catch (e) {
    return chapterText;
  }
}

export class SeamlessScrollManager {
  private pageArea: HTMLElement | null = null;
  private rendition: any = null;
  private onChapterChange: ((index: number, title: string) => void) | null = null;
  private isAppending = false;
  private lastAppendedIndex = -1;
  private appendedIndices = new Set<number>();
  private scrollHandler: (() => void) | null = null;
  private bookFormat = "";
  private bookKey = "";

  attach(params: {
    pageArea: HTMLElement;
    rendition: any;
    format: string;
    bookKey: string;
    initialChapterIndex: number;
    onChapterChange?: (index: number, title: string) => void;
  }) {
    this.detach();

    this.pageArea = params.pageArea;
    this.rendition = params.rendition;
    this.bookFormat = params.format;
    this.bookKey = params.bookKey;
    this.lastAppendedIndex = params.initialChapterIndex;
    this.appendedIndices.clear();
    this.onChapterChange = params.onChapterChange || null;

    if (!this.pageArea) return;

    this.scrollHandler = () => {
      this.handleScroll();
    };

    this.pageArea.addEventListener("scroll", this.scrollHandler, { passive: true });
  }

  detach() {
    if (this.pageArea && this.scrollHandler) {
      this.pageArea.removeEventListener("scroll", this.scrollHandler);
      this.scrollHandler = null;
    }
    this.pageArea = null;
    this.rendition = null;
    this.onChapterChange = null;
    this.isAppending = false;
    this.appendedIndices.clear();
    this.lastAppendedIndex = -1;
  }

  getLastAppendedIndex(): number {
    return this.lastAppendedIndex;
  }

  reset(currentChapterIndex: number) {
    this.lastAppendedIndex = currentChapterIndex;
    this.appendedIndices.clear();
    this.isAppending = false;
  }

  private async handleScroll() {
    if (!this.pageArea || !this.rendition || this.isAppending) return;

    const { scrollTop, clientHeight, scrollHeight } = this.pageArea;

    // 1. 视口滚动靠近底部（剩余 600px 内）时，预先拼接下一章
    if (scrollTop + clientHeight >= scrollHeight - 600) {
      await this.appendNextChapter();
    }

    // 2. 检查当前视口中心落在哪个章节，通知更新当前章节标题与页码
    this.updateActiveChapter();
  }

  private updateActiveChapter() {
    if (!this.pageArea || !this.onChapterChange) return;
    const docs = getIframeDoc(this.bookFormat, this.bookKey);
    const doc = docs && docs[0];
    if (!doc || !doc.body) return;

    const sections = Array.from(
      doc.body.querySelectorAll(".coread-seamless-chapter")
    ) as HTMLElement[];

    if (sections.length === 0) return;

    const viewportMiddle = this.pageArea.scrollTop + this.pageArea.clientHeight * 0.35;

    // 从后往前找最接近视口上方的章节
    for (let i = sections.length - 1; i >= 0; i--) {
      const sec = sections[i];
      if (sec.offsetTop <= viewportMiddle) {
        const idx = parseInt(sec.dataset.chapterDocIndex || "-1", 10);
        const title = sec.dataset.chapterTitle || "";
        if (idx >= 0 && title) {
          this.onChapterChange(idx, title);
        }
        break;
      }
    }
  }

  async appendNextChapter(): Promise<boolean> {
    if (this.isAppending || !this.rendition || !this.pageArea) return false;

    const chapterList: any[] = this.rendition.chapterDocList || [];
    const nextIndex = this.lastAppendedIndex + 1;

    if (nextIndex >= chapterList.length) {
      // 已经到全书最后一章，底部可保留轻量提示
      this.ensureEndNotice();
      return false;
    }

    if (this.appendedIndices.has(nextIndex)) return false;

    this.isAppending = true;
    try {
      const docs = getIframeDoc(this.bookFormat, this.bookKey);
      const doc = docs && docs[0];
      if (!doc || !doc.body) return false;

      const nextDocItem = chapterList[nextIndex];
      const title =
        nextDocItem.label ||
        nextDocItem.title ||
        `第 ${nextIndex + 1} 章`;

      const bodyHtml = await loadChapterBodyHtml(nextDocItem.text);
      if (!bodyHtml) return false;

      // 创建无缝章节外层容器
      const container = doc.createElement("div");
      container.className = "coread-seamless-chapter";
      container.dataset.chapterDocIndex = String(nextIndex);
      container.dataset.chapterTitle = title;
      container.style.cssText = "position: relative; width: 100%; box-sizing: border-box;";

      // 浅色横线分割 + 居中章节名称标识
      const divider = doc.createElement("div");
      divider.className = "coread-seamless-divider";
      divider.style.cssText = [
        "margin: 48px auto 28px auto",
        "padding-top: 18px",
        "border-top: 1px solid rgba(128, 128, 128, 0.22)",
        "text-align: center",
        "font-size: 13px",
        "color: rgba(128, 128, 128, 0.65)",
        "letter-spacing: 0.5px",
        "user-select: none",
        "width: 90%",
        "max-width: 600px",
      ].join("; ");
      divider.textContent = title;

      const content = doc.createElement("div");
      content.className = "coread-seamless-content";
      content.innerHTML = bodyHtml;

      container.appendChild(divider);
      container.appendChild(content);
      doc.body.appendChild(container);

      // 动态撑开 iframe 高度，确保能够顺畅继续向下滚动
      const frame = (doc.defaultView?.frameElement as HTMLElement) || null;
      const targetHeight = Math.max(doc.body.scrollHeight + 300, 1000);
      if (frame) {
        frame.style.height = `${targetHeight}px`;
        (frame as any).height = `${targetHeight}px`;
      }

      this.appendedIndices.add(nextIndex);
      this.lastAppendedIndex = nextIndex;
      return true;
    } catch (err) {
      console.warn("Failed to append next chapter seamlessly", err);
      return false;
    } finally {
      this.isAppending = false;
    }
  }

  private ensureEndNotice() {
    const docs = getIframeDoc(this.bookFormat, this.bookKey);
    const doc = docs && docs[0];
    if (!doc || !doc.body || doc.getElementById("coread-end-of-book")) return;

    const notice = doc.createElement("div");
    notice.id = "coread-end-of-book";
    notice.style.cssText = [
      "margin: 60px auto 40px auto",
      "text-align: center",
      "font-size: 13px",
      "color: rgba(128, 128, 128, 0.45)",
      "user-select: none",
      "border-top: 1px dashed rgba(128, 128, 128, 0.2)",
      "padding-top: 16px",
      "width: 60%",
    ].join("; ");
    notice.textContent = "— 全书完 —";
    doc.body.appendChild(notice);
  }
}

export const seamlessScrollManager = new SeamlessScrollManager();
