import { IConfigStore } from "../../ports/IConfigStore";
import { ConfigService } from "../../../services/configService";

/**
 * 基于 LocalStorage 与 ConfigService 的纯净本地配置适配器
 *
 * 保证数据键名与现有 LocalStorage 历史数据 100% 兼容。
 */
export class LocalConfigStore implements IConfigStore {
  getItem(key: string): string | null {
    return ConfigService.getItem(key);
  }

  setItem(key: string, val: string): void {
    ConfigService.setItem(key, val);
  }

  removeItem(key: string): void {
    ConfigService.removeItem(key);
  }

  getReaderConfig(key: string): any {
    return ConfigService.getReaderConfig(key);
  }

  setReaderConfig(key: string, val: any, sync = true): void {
    ConfigService.setReaderConfig(key, val, sync);
  }

  getAllObjectConfig(category: string): Record<string, any> {
    return ConfigService.getAllObjectConfig(category);
  }

  setAllObjectConfig(obj: Record<string, any>, category: string): void {
    ConfigService.setAllObjectConfig(obj, category);
  }

  getObjectConfig(key: string, category: string, defaultValue?: any): any {
    return ConfigService.getObjectConfig(key, category, defaultValue);
  }

  setObjectConfig(key: string, val: any, category: string, sync = true): void {
    ConfigService.setObjectConfig(key, val, category, sync);
  }

  deleteObjectConfig(key: string, category: string): void {
    ConfigService.deleteObjectConfig(key, category);
  }

  getAllListConfig(category: string): any[] {
    return ConfigService.getAllListConfig(category);
  }

  setAllListConfig(list: any[], category: string, sync = true): void {
    ConfigService.setAllListConfig(list, category, sync);
  }

  setListConfig(item: any, category: string): void {
    ConfigService.setListConfig(item, category);
  }

  deleteListConfig(item: any, category: string): void {
    ConfigService.deleteListConfig(item, category);
  }

  getAllMapConfig(category: string): Record<string, any[]> {
    return ConfigService.getAllMapConfig(category);
  }

  setAllMapConfig(map: Record<string, any[]>, category: string): void {
    ConfigService.setAllMapConfig(map, category);
  }

  getMapConfig(key: string, category: string): any[] {
    return ConfigService.getMapConfig(key, category);
  }

  setMapConfig(key: string, item: any, category: string): void {
    ConfigService.setMapConfig(key, item, category);
  }

  setOneMapConfig(key: string, val: any[], category: string, sync = true): void {
    ConfigService.setOneMapConfig(key, val, category, sync);
  }

  deleteFromMapConfig(key: string, item: any, category: string): void {
    ConfigService.deleteFromMapConfig(key, item, category);
  }
}
