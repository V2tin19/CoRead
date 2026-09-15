import { StyleKeys } from "./kookitConfig";

declare var window: any;

export class ConfigService {
  static getItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  static setItem(key: string, val: string): void {
    try {
      localStorage.setItem(key, val);
    } catch (e) {
      console.error("ConfigService.setItem failed:", e);
    }
  }

  static removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.error("ConfigService.removeItem failed:", e);
    }
  }

  static getReaderConfig(key: string): any {
    if (
      StyleKeys.includes(key) &&
      typeof window !== "undefined" &&
      window.currentBookKey &&
      this.getAllListConfig("seperateStyleBooks").includes(window.currentBookKey)
    ) {
      return this.getObjectConfig(window.currentBookKey, "seperateStyleConfig", {})[key];
    }
    const raw = this.getItem("readerConfig");
    try {
      return raw ? JSON.parse(raw)[key] : undefined;
    } catch {
      return undefined;
    }
  }

  static setReaderConfig(key: string, val: any, sync = true): void {
    if (
      StyleKeys.includes(key) &&
      typeof window !== "undefined" &&
      window.currentBookKey &&
      this.getAllListConfig("seperateStyleBooks").includes(window.currentBookKey)
    ) {
      const current = this.getObjectConfig(window.currentBookKey, "seperateStyleConfig", {});
      current[key] = val;
      this.setObjectConfig(window.currentBookKey, current, "seperateStyleConfig", sync);
      return;
    }
    let config: Record<string, any> = {};
    try {
      config = JSON.parse(this.getItem("readerConfig") || "{}");
    } catch {
      config = {};
    }
    config[key] = val;
    this.setItem("readerConfig", JSON.stringify(config));
    if (sync) {
      this.setSyncRecord(
        { type: "config", catergory: "readerConfig", name: "browser", key },
        { operation: "update", time: Date.now() }
      );
    }
  }

  static getAllListConfig(key: string): any[] {
    const raw = this.getItem(key);
    if (!raw || raw === "{}") return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  static setAllListConfig(list: any[], key: string, sync = true): void {
    this.setItem(key, JSON.stringify(list));
    if (sync) {
      this.setSyncRecord(
        { type: "config", catergory: "listConfig", name: "general", key },
        { operation: "update", time: Date.now() }
      );
    }
  }

  static setListConfig(item: any, key: string): void {
    const list = this.getAllListConfig(key);
    const idx = list.indexOf(item);
    if (idx > -1) {
      list.splice(idx, 1);
    }
    list.unshift(item);
    this.setAllListConfig(list, key);
  }

  static deleteListConfig(item: any, key: string): void {
    const list = this.getAllListConfig(key);
    const idx = list.indexOf(item);
    if (idx > -1) {
      list.splice(idx, 1);
      this.setAllListConfig(list, key);
    }
  }

  static getAllObjectConfig(name: string): Record<string, any> {
    const raw = this.getItem(name);
    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  static setAllObjectConfig(obj: Record<string, any>, name: string): void {
    this.setItem(name, JSON.stringify(obj));
  }

  static getObjectConfig(key: string, name: string, defaultVal?: any): any {
    const obj = this.getAllObjectConfig(name);
    return obj[key] !== undefined ? obj[key] : defaultVal;
  }

  static setObjectConfig(key: string, val: any, name: string, sync = true): void {
    const obj = this.getAllObjectConfig(name);
    obj[key] = val;
    this.setAllObjectConfig(obj, name);
    if (sync) {
      this.setSyncRecord(
        { type: "config", catergory: "objectConfig", name, key },
        { operation: "update", time: Date.now() }
      );
    }
  }

  static deleteObjectConfig(key: string, name: string): void {
    const obj = this.getAllObjectConfig(name);
    delete obj[key];
    this.setAllObjectConfig(obj, name);
    this.setSyncRecord(
      { type: "config", catergory: "objectConfig", name, key },
      { operation: "delete", time: Date.now() }
    );
  }

  static getAllMapConfig(name: string): Record<string, any[]> {
    const raw = this.getItem(name);
    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  static setAllMapConfig(map: Record<string, any[]>, name: string): void {
    this.setItem(name, JSON.stringify(map));
  }

  static getMapConfig(key: string, name: string): any[] {
    return this.getAllMapConfig(name)[key] || [];
  }

  static setMapConfig(key: string, item: any, name: string): void {
    const map = this.getAllMapConfig(name);
    if (!map[key]) {
      map[key] = [];
    }
    if (item && !map[key].includes(item)) {
      map[key].unshift(item);
    }
    this.setSyncRecord(
      { type: "config", catergory: "mapConfig", name, key },
      { operation: "update", time: Date.now() }
    );
    this.setAllMapConfig(map, name);
  }

  static setOneMapConfig(key: string, val: any[], name: string, sync = true): void {
    const map = this.getAllMapConfig(name);
    map[key] = val;
    if (sync) {
      this.setSyncRecord(
        { type: "config", catergory: "mapConfig", name, key },
        { operation: "update", time: Date.now() }
      );
    }
    this.setAllMapConfig(map, name);
  }

  static deleteFromMapConfig(key: string, item: any, name: string): void {
    const map = this.getAllMapConfig(name);
    if (map[key]) {
      const idx = map[key].indexOf(item);
      if (idx > -1) {
        map[key].splice(idx, 1);
        this.setSyncRecord(
          { type: "config", catergory: "mapConfig", name, key },
          { operation: "update", time: Date.now() }
        );
        this.setAllMapConfig(map, name);
      }
    }
  }

  static deleteFromAllMapConfig(item: any, name: string): void {
    const map = this.getAllMapConfig(name);
    Object.keys(map).forEach((key) => {
      const idx = map[key].indexOf(item);
      if (idx > -1) {
        map[key].splice(idx, 1);
        this.setSyncRecord(
          { type: "config", catergory: "mapConfig", name, key },
          { operation: "update", time: Date.now() }
        );
      }
    });
    this.setAllMapConfig(map, name);
  }

  static deleteMapConfig(key: string, name: string): void {
    const map = this.getAllMapConfig(name);
    delete map[key];
    this.setSyncRecord(
      { type: "config", catergory: "mapConfig", name, key },
      { operation: "delete", time: Date.now() }
    );
    this.setAllMapConfig(map, name);
  }

  static getFromAllMapConfig(item: any, name: string): string[] {
    const map = this.getAllMapConfig(name);
    const result: string[] = [];
    for (const key in map) {
      if (map[key] && map[key].includes(item)) {
        result.push(key);
      }
    }
    return result;
  }

  static getSyncRecord(record: { type: string; catergory: string; name: string; key: string }): any {
    const compositeKey = `${record.type}.${record.catergory}.${record.name}.${record.key}`;
    try {
      return JSON.parse(this.getItem("syncRecord") || "{}")[compositeKey] || { operation: "", time: 0 };
    } catch {
      return { operation: "", time: 0 };
    }
  }

  static getAllSyncRecord(): Record<string, any> {
    try {
      return JSON.parse(this.getItem("syncRecord") || "{}");
    } catch {
      return {};
    }
  }

  static setSyncRecord(
    record: { type: string; catergory: string; name: string; key: string },
    op: { operation: string; time: number }
  ): void {
    const compositeKey = `${record.type}.${record.catergory}.${record.name}.${record.key}`;
    try {
      const records = JSON.parse(this.getItem("syncRecord") || "{}");
      records[compositeKey] = op;
      this.setItem("syncRecord", JSON.stringify(records));
    } catch (e) {
      console.error("ConfigService.setSyncRecord failed:", e);
    }
  }

  static setAllSyncRecord(records: Record<string, any>): void {
    this.setItem("syncRecord", JSON.stringify(records));
  }
}

export default ConfigService;
