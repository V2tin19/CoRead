import { isElectron } from "react-device-detect";

declare var window: any;

const TOKEN_STORAGE_KEY = "co_tokens";
const DEVICE_UUID_KEY = "co_device_uuid";

export class TokenService {
  static async getAllToken(): Promise<string> {
    if (isElectron) {
      try {
        const { ipcRenderer } = window.require("electron");
        return await ipcRenderer.invoke("decrypt-data");
      } catch {
        return localStorage.getItem(TOKEN_STORAGE_KEY) || "{}";
      }
    }
    return localStorage.getItem(TOKEN_STORAGE_KEY) || "{}";
  }

  static async saveAllToken(tokenStr: string): Promise<void> {
    if (isElectron) {
      try {
        const { ipcRenderer } = window.require("electron");
        await ipcRenderer.invoke("encrypt-data", { token: tokenStr });
        return;
      } catch {
        localStorage.setItem(TOKEN_STORAGE_KEY, tokenStr);
        return;
      }
    }
    localStorage.setItem(TOKEN_STORAGE_KEY, tokenStr);
  }

  static async getToken(key: string): Promise<string | null> {
    try {
      const all = await this.getAllToken();
      const parsed = JSON.parse(all || "{}");
      return parsed[key] ?? null;
    } catch {
      return null;
    }
  }

  static async setToken(key: string, value: string): Promise<void> {
    try {
      const all = await this.getAllToken();
      const parsed = JSON.parse(all || "{}");
      parsed[key] = value;
      await this.saveAllToken(JSON.stringify(parsed));
    } catch (e) {
      console.error("TokenService.setToken failed:", e);
    }
  }

  static async deleteToken(key: string): Promise<void> {
    try {
      const all = await this.getAllToken();
      const parsed = JSON.parse(all || "{}");
      delete parsed[key];
      await this.saveAllToken(JSON.stringify(parsed));
    } catch (e) {
      console.error("TokenService.deleteToken failed:", e);
    }
  }

  static async getFingerprint(): Promise<string> {
    let uuid = localStorage.getItem(DEVICE_UUID_KEY);
    if (!uuid) {
      uuid =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : "device-" + Math.random().toString(36).substring(2, 15);
      localStorage.setItem(DEVICE_UUID_KEY, uuid);
    }
    return uuid;
  }
}

export default TokenService;
