import { RenderPosition, Chapter, NoteRange, RenderTargetOptions } from "../domain/render";

/**
 * 渲染服务端口定义（契约抽象）
 *
 * 遵循依赖倒置原则：领域层与 UI 层仅依赖本接口，不直接感知具体内核（如 kookit）。
 */
export interface IRenderService {
  /**
   * 打开并渲染电子书
   */
  open(
    file: ArrayBuffer,
    meta: { format: string; name?: string; [key: string]: any },
    target: HTMLElement,
    options?: RenderTargetOptions
  ): Promise<void>;

  /**
   * 跳转至指定章节
   */
  goToChapter(index: number): Promise<void>;

  /**
   * 跳转至指定阅读位置
   */
  goToPosition(pos: RenderPosition): Promise<void>;

  /**
   * 翻至下一页
   */
  next(): Promise<void>;

  /**
   * 翻至上一页
   */
  prev(): Promise<void>;

  /**
   * 获取当前阅读位置（保证数值归一化）
   */
  getPosition(): Promise<RenderPosition>;

  /**
   * 获取目录章节列表
   */
  getChapterList(): Promise<Chapter[]>;

  /**
   * 渲染笔记高亮
   */
  renderNotes(notes: NoteRange[]): Promise<void>;

  /**
   * 高亮选区
   */
  highlight(range: NoteRange, color: string): Promise<void>;

  /**
   * 清除高亮
   */
  clearHighlights(): Promise<void>;

  /**
   * 监听渲染事件
   */
  on(event: string, callback: (...args: any[]) => void): void;

  /**
   * 取消监听
   */
  off(event: string, callback: (...args: any[]) => void): void;

  /**
   * 销毁渲染实例并释放资源
   */
  destroy(): Promise<void>;
}
