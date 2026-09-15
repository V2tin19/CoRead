import { RenderPosition } from "../domain/render";

/**
 * 阅读进度与阅读时长存储端口定义
 */
export interface IReadingProgressStore {
  /**
   * 获取指定书籍的最后阅读位置
   */
  getProgress(bookKey: string): Promise<RenderPosition | null>;

  /**
   * 保存指定书籍的阅读位置
   */
  saveProgress(bookKey: string, pos: RenderPosition): Promise<void>;

  /**
   * 获取最近阅读书籍 Key 列表
   */
  getRecentBooks(): Promise<string[]>;

  /**
   * 添加/更新书籍到最近阅读列表
   */
  addRecentBook(bookKey: string): Promise<void>;

  /**
   * 获取累计阅读时长（秒）
   */
  getReadingTime(bookKey?: string): Promise<number>;

  /**
   * 记录阅读时长增量（秒）
   */
  recordReadingTime(bookKey: string, seconds: number): Promise<void>;
}
