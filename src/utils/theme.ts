import { ConfigService } from "../services";
import { reloadManager } from "./common";
import { syncNativeThemeSource } from "./reader/launchUtil";

/**
 * 外观（白天 / 黑夜）统一入口
 * ============================================================
 * 本 fork 把上游的「追随系统」模式去掉了，只剩两种外观：
 *   - `light` 默认模式
 *   - `night` 黑夜模式
 * 未设置时按 `DEFAULT_SKIN`（黑夜）走 —— 深色是项目所有者认可的默认观感。
 *
 * 历史数据里如果还存着 `system`，这里一次性解析成 light/night，
 * 之后配置里就只会有这两种值。
 */
export type AppSkin = "light" | "night";

/** 未设置时的默认外观 */
export const DEFAULT_SKIN: AppSkin = "night";

const DARK_BG = "rgba(44,47,49,1)";
const DARK_TEXT = "rgba(255,255,255,1)";
const LIGHT_BG = "rgba(255,255,255,1)";
const LIGHT_TEXT = "rgba(0,0,0,1)";

/** 读出当前外观；顺手把遗留的 "system" 归一化掉 */
export function resolveAppSkin(): AppSkin {
  const raw = ConfigService.getReaderConfig("appSkin");
  if (!raw || raw === "system") {
    const isOSNight = ConfigService.getReaderConfig("isOSNight") === "yes";
    return isOSNight ? "night" : DEFAULT_SKIN;
  }
  return raw === "night" ? "night" : "light";
}

/** 当前是不是深色外观（组件里要自己算颜色时用它） */
export function isDarkModeNow(): boolean {
  return resolveAppSkin() === "night";
}

/** 应用外观：写配置 + 同步系统窗口色 + 刷新管理器 */
export function applySkin(skin: AppSkin) {
  ConfigService.setReaderConfig("appSkin", skin);
  try {
    syncNativeThemeSource(skin);
  } catch (error) {
    // 网页端没有主进程，syncNativeThemeSource 自己会判 isElectron，这里只是兜底
    console.error("[theme] 同步系统主题失败:", error);
  }
  if (skin === "night") {
    ConfigService.setReaderConfig("backgroundColor", DARK_BG);
    ConfigService.setReaderConfig("textColor", DARK_TEXT);
  } else {
    ConfigService.setReaderConfig("backgroundColor", LIGHT_BG);
    ConfigService.setReaderConfig("textColor", LIGHT_TEXT);
  }
  reloadManager();
}

/** 白天 / 黑夜互切，返回切换后的外观 */
export function toggleSkin(): AppSkin {
  const next: AppSkin = isDarkModeNow() ? "light" : "night";
  applySkin(next);
  return next;
}
