/**
 * 配置存储端口定义（依赖倒置抽象）
 *
 * 规范应用配置、阅读器个性化设置、书籍独立样式的存取接口，
 * 底层适配器对接 LocalStorage 或其他本地存储。
 */
export interface IConfigStore {
  getItem(key: string): string | null;
  setItem(key: string, val: string): void;
  removeItem(key: string): void;

  getReaderConfig(key: string): any;
  setReaderConfig(key: string, val: any, sync?: boolean): void;

  getAllObjectConfig(category: string): Record<string, any>;
  setAllObjectConfig(obj: Record<string, any>, category: string): void;
  getObjectConfig(key: string, category: string, defaultValue?: any): any;
  setObjectConfig(key: string, val: any, category: string, sync?: boolean): void;
  deleteObjectConfig(key: string, category: string): void;

  getAllListConfig(category: string): any[];
  setAllListConfig(list: any[], category: string, sync?: boolean): void;
  setListConfig(item: any, category: string): void;
  deleteListConfig(item: any, category: string): void;

  getAllMapConfig(category: string): Record<string, any[]>;
  setAllMapConfig(map: Record<string, any[]>, category: string): void;
  getMapConfig(key: string, category: string): any[];
  setMapConfig(key: string, item: any, category: string): void;
  setOneMapConfig(key: string, val: any[], category: string, sync?: boolean): void;
  deleteFromMapConfig(key: string, item: any, category: string): void;
}
