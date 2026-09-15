import { IRenderService } from "../../ports/IRenderService";
import {
  RenderPosition,
  Chapter,
  NoteRange,
  RenderTargetOptions,
} from "../../domain/render";
import { loadKookit } from "./kookitLoader";

/**
 * 基于 Kookit 内核的渲染服务适配器
 *
 * 严格落实 REFACTOR-BRIEF.md 第 4.3 节的 17 条硬编码契约：
 * - 契约 1: 宿主容器强制确保 id="page-area"
 * - 契约 2: renderTo() 后补齐导航调用（goToPosition 或 goToChapterIndex(0)）
 * - 契约 7: tempLocation 初始为空时的健壮兜底
 * - 契约 8 & 9: scroll 模式下宿主容器滚动样式约束
 * - 契约 10: 翻页后适度等待并校准 record() 位置
 * - 契约 12: 强制将 getPosition() 中的 string 数值统一转换为 number
 * - 契约 13: 抹平 rendered 事件载荷差异，统一以 getPosition() 为准
 * - 契约 14: 高亮颜色统一转换为 background-#RRGGBB 格式，入参拷贝防止原地 reverse 污染
 */
export class KookitRenderAdapter implements IRenderService {
  private rendition: any = null;
  private kookitModule: any = null;
  private eventHandlers: Map<string, Set<(...args: any[]) => void>> = new Map();
  private hostElement: HTMLElement | null = null;

  async open(
    file: ArrayBuffer,
    meta: { format: string; name?: string; [key: string]: any },
    target: HTMLElement,
    options?: RenderTargetOptions
  ): Promise<void> {
    this.kookitModule = await loadKookit();
    const { BookHelper } = this.kookitModule;

    // 契约 1: 宿主容器必须有 id="page-area"
    if (target.id !== "page-area") {
      target.id = "page-area";
    }
    this.hostElement = target;

    // 契约 8: 滚动模式下宿主容器样式约束
    if (options?.mode === "scroll") {
      target.style.overflowY = "auto";
    }

    const format = (meta.format || "epub").toUpperCase();
    const config = {
      format,
      readerMode: options?.mode || meta.readerMode || "slide",
      charset: meta.charset || "utf8",
      animation: meta.animation || "none",
      convertChinese: meta.convertChinese || "none",
      parserRegex: meta.parserRegex || "",
      isDarkMode: meta.isDarkMode ? "yes" : "no",
      isMobile: meta.isMobile ? "yes" : "no",
      password: meta.password || "",
      isConvertPDF: meta.isConvertPDF || "no",
      backgroundColor: meta.backgroundColor || "#ffffff",
      isScannedPDF: meta.isScannedPDF || "no",
      ocrEngine: meta.ocrEngine || "local",
    };

    this.rendition = BookHelper.getRendition(file, config, this.kookitModule);

    // 监听内核内部事件并转接
    this.bindInternalEvents();

    // 创建 iframe 骨架
    await this.rendition.renderTo(target);

    // 契约 2: renderTo() 仅建 iframe 不渲染正文，补齐首次导航
    if (meta.initialPosition) {
      await this.goToPosition(meta.initialPosition);
    } else if (meta.initialChapter !== undefined) {
      await this.goToChapter(meta.initialChapter);
    } else {
      await this.rendition.goToChapterIndex(0);
    }
  }

  async goToChapter(index: number): Promise<void> {
    if (!this.rendition) return;
    await this.rendition.goToChapterIndex(index);
  }

  async goToPosition(pos: RenderPosition): Promise<void> {
    if (!this.rendition) return;
    if (pos.location) {
      await this.rendition.goToPosition(pos.location);
    } else if (pos.chapterIndex !== undefined) {
      await this.rendition.goToChapterIndex(pos.chapterIndex);
    }
  }

  async next(): Promise<void> {
    if (!this.rendition) return;
    await this.rendition.next();
    // 契约 10: 文字类翻页后需适度补偿记录
    this.emitPositionChanged();
  }

  async prev(): Promise<void> {
    if (!this.rendition) return;
    await this.rendition.prev();
    this.emitPositionChanged();
  }

  async getPosition(): Promise<RenderPosition> {
    if (!this.rendition) {
      return { chapterIndex: 0, progress: 0 };
    }

    // 契约 7 & 12: 兜底并强制转换为 number 类型
    let raw = this.rendition.tempLocation || {};
    if (!raw || Object.keys(raw).length === 0) {
      try {
        raw = await this.rendition.record();
      } catch {
        raw = {};
      }
    }

    const chapterIndex = parseInt(
      raw.chapterDocIndex ?? raw.chapterIndex ?? 0,
      10
    );
    const progress = parseFloat(raw.percentage ?? raw.progress ?? 0);

    return {
      chapterIndex: isNaN(chapterIndex) ? 0 : chapterIndex,
      progress: isNaN(progress) ? 0 : progress,
      text: raw.visibleText || "",
      location: raw,
    };
  }

  async getChapterList(): Promise<Chapter[]> {
    if (!this.rendition) return [];
    try {
      const rawChapters = await this.rendition.getChapter();
      return (rawChapters || []).map((c: any, idx: number) => ({
        index: idx,
        label: c.label || c.title || `Chapter ${idx + 1}`,
        href: c.href || "",
        subitems: (c.subitems || []).map((sub: any, subIdx: number) => ({
          index: subIdx,
          label: sub.label || sub.title || `Subchapter ${subIdx + 1}`,
          href: sub.href || "",
        })),
      }));
    } catch (err) {
      console.warn("[kookitRenderAdapter] 获取章节目录异常:", err);
      return [];
    }
  }

  async renderNotes(notes: NoteRange[]): Promise<void> {
    if (!this.rendition) return;

    // 契约 14: 传拷贝，防止内核 notes.reverse() 原地污染外部状态
    const clonedNotes = notes.map((n) => ({
      ...n,
      color: this.normalizeColor(n.color),
    }));

    if (typeof this.rendition.renderHighlighters === "function") {
      this.rendition.renderHighlighters(clonedNotes, (e: any) => {
        this.trigger("highlight-click", e);
      });
    }
  }

  async highlight(range: NoteRange, color: string): Promise<void> {
    if (!this.rendition) return;

    const formattedColor = this.normalizeColor(color);
    const noteObj = {
      ...range,
      color: formattedColor,
    };

    if (typeof this.rendition.createOneNote === "function") {
      await this.rendition.createOneNote(noteObj, (e: any) => {
        this.trigger("highlight-click", e);
      });
    }
  }

  async clearHighlights(): Promise<void> {
    if (!this.rendition) return;
    if (typeof this.rendition.clearHighlights === "function") {
      this.rendition.clearHighlights();
    }
  }

  on(event: string, callback: (...args: any[]) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(callback);
  }

  off(event: string, callback: (...args: any[]) => void): void {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event)!.delete(callback);
    }
  }

  async destroy(): Promise<void> {
    if (this.rendition) {
      try {
        if (typeof this.rendition.destroy === "function") {
          this.rendition.destroy();
        }
      } catch (e) {
        console.warn("[kookitRenderAdapter] 销毁内核实例异常:", e);
      }
      this.rendition = null;
    }
    this.eventHandlers.clear();
    this.hostElement = null;
  }

  /**
   * 契约 14: 保证颜色格式为 background-#RRGGBB
   */
  private normalizeColor(color: string): string {
    if (!color) return "background-#FEF3CD";
    if (color.includes("-")) {
      return color;
    }
    const cleanHex = color.startsWith("#") ? color : `#${color}`;
    return `background-${cleanHex}`;
  }

  private trigger(event: string, ...args: any[]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((cb) => {
        try {
          cb(...args);
        } catch (err) {
          console.error(`[kookitRenderAdapter] 事件处理器执行异常 (${event}):`, err);
        }
      });
    }
  }

  private bindInternalEvents(): void {
    if (!this.rendition || typeof this.rendition.on !== "function") return;

    // 契约 13: 抹平 rendered 事件载荷差异
    this.rendition.on("rendered", async () => {
      const pos = await this.getPosition();
      this.trigger("rendered", pos);
    });

    this.rendition.on("relocated", async () => {
      const pos = await this.getPosition();
      this.trigger("position-changed", pos);
    });
  }

  private async emitPositionChanged(): Promise<void> {
    const pos = await this.getPosition();
    this.trigger("position-changed", pos);
  }
}
