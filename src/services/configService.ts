import { configStore } from "../core/ports/stores";

/**
 * 门面类 ConfigService：向后兼容既有代码调用，内部全部委托给 core/ports 中的 configStore。
 */
export class ConfigService {
  static getItem(key: string): string | null {
    return configStore.getItem(key);
  }

  static setItem(key: string, val: string): void {
    configStore.setItem(key, val);
  }

  static removeItem(key: string): void {
    configStore.removeItem(key);
  }

  static getReaderConfig(key: string): any {
    return configStore.getReaderConfig(key);
  }

  static setReaderConfig(key: string, val: any, sync = true): void {
    configStore.setReaderConfig(key, val, sync);
  }

  static getAllListConfig(key: string): any[] {
    return configStore.getAllListConfig(key);
  }

  static setAllListConfig(list: any[], key: string, sync = true): void {
    configStore.setAllListConfig(list, key, sync);
  }

  static setListConfig(item: any, key: string): void {
    configStore.setListConfig(item, key);
  }

  static deleteListConfig(item: any, key: string): void {
    configStore.deleteListConfig(item, key);
  }

  static getAllObjectConfig(name: string): Record<string, any> {
    return configStore.getAllObjectConfig(name);
  }

  static setAllObjectConfig(obj: Record<string, any>, name: string): void {
    configStore.setAllObjectConfig(obj, name);
  }

  static getObjectConfig(key: string, name: string, defaultVal?: any): any {
    return configStore.getObjectConfig(key, name, defaultVal);
  }

  static setObjectConfig(key: string, val: any, name: string, sync = true): void {
    configStore.setObjectConfig(key, val, name, sync);
  }

  static deleteObjectConfig(key: string, name: string): void {
    configStore.deleteObjectConfig(key, name);
  }

  static getAllMapConfig(name: string): Record<string, any[]> {
    return configStore.getAllMapConfig(name);
  }

  static setAllMapConfig(map: Record<string, any[]>, name: string): void {
    configStore.setAllMapConfig(map, name);
  }

  static getMapConfig(key: string, name: string): any[] {
    return configStore.getMapConfig(key, name);
  }

  static setMapConfig(key: string, item: any, name: string): void {
    configStore.setMapConfig(key, item, name);
  }

  static setOneMapConfig(key: string, val: any[], name: string, sync = true): void {
    configStore.setOneMapConfig(key, val, name, sync);
  }

  static deleteFromMapConfig(key: string, item: any, name: string): void {
    configStore.deleteFromMapConfig(key, item, name);
  }

  static deleteFromAllMapConfig(item: any, name: string): void {
    configStore.deleteFromAllMapConfig(item, name);
  }

  static deleteMapConfig(key: string, name: string): void {
    configStore.deleteMapConfig(key, name);
  }

  static getFromAllMapConfig(item: any, name: string): string[] {
    return configStore.getFromAllMapConfig(item, name);
  }

  static getSyncRecord(record: { type: string; catergory: string; name: string; key: string }): any {
    return configStore.getSyncRecord(record);
  }

  static getAllSyncRecord(): Record<string, any> {
    return (configStore as any).getAllSyncRecord?.() || {};
  }

  static setSyncRecord(
    record: { type: string; catergory: string; name: string; key: string },
    op: { operation: string; time: number }
  ): void {
    configStore.setSyncRecord(record, op);
  }

  static setAllSyncRecord(records: Record<string, any>): void {
    (configStore as any).setAllSyncRecord?.(records);
  }

  static getAllConfig(): Record<string, any> {
    const readerConfig = this.getItem("readerConfig");
    try {
      return readerConfig ? JSON.parse(readerConfig) : {};
    } catch {
      return {};
    }
  }

  static clearAllConfig(): void {
    this.removeItem("readerConfig");
  }
}

export default ConfigService;
