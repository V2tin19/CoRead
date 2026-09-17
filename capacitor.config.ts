import type { CapacitorConfig } from "@capacitor/cli";

/**
 * 安卓（Capacitor）打包配置
 * ============================================================
 * 壳在 `android/`，由 Turead 时代用 Capacitor 8.4.1 官方模板生成
 * （=模板 + 3 处改动：包名、cleartext、图标底色），已换牌到 CoRead。
 *
 * ⚠️ `android.allowMixedContent: true` 是**必要**的，不是历史包袱：
 *   - 安卓端页面 origin 是 `https://localhost`（Capacitor 8 的 androidScheme 默认 https）
 *   - 而共读服务器通常是 `http://私网IP:17390`
 *   - https 页面请求 http 资源 = mixed content，WebView 默认拦截
 *   ⇒ 与之配套的是 `android/app/src/main/AndroidManifest.xml` 里的
 *     `android:usesCleartextTraffic="true"`，两者要一起开、一起关。
 *   若日后共读改走 HTTPS，这两处应同时收窄。
 *
 * ⚠️ `webDir: "build"` 与 Electron 走同一个产物 —— 不要为了"优化"改输出目录，
 *   否则两条打包链会同时返工。
 */
const config: CapacitorConfig = {
  appId: "com.coread.app",
  appName: "CoRead",
  webDir: "build",
  android: {
    allowMixedContent: true,
  },
};

export default config;
