// ── 共读服务器地址:前端唯一真源 ─────────────────────────────────────────
//
// 为什么单独放一个文件:
//   打包成桌面端(Electron 的 file://)与安卓端(Capacitor 的 http://localhost)
//   之后,应用没有「同源服务器」可用 —— 共读服务必须由用户自己部署并填地址。
//   这里就是这个地址的读写与解析逻辑,个人中心、共读面板、collabClient 都读它。
//   (不放进 roomBook.ts 是为了避免 collabClient ←→ roomBook 的循环依赖)
//
// ⚠️ 打包产物里不允许出现任何我们自己的服务器地址 —— 因此这里:
//   · 不内置任何默认服务器
//   · 只有「真正的网页部署」才回退到同源 /collab
//   · 用户没填 + 无同源 ⇒ 返回空字符串 ⇒ 应用退化为纯本地阅读器

const SERVER_URL_KEY = "koodo-collab-server-url";

/** 规范化用户输入的地址:去空格、无协议补 http://、去尾部斜杠 */
export function normalizeCollabServerUrl(url: string): string {
  let value = (url || "").trim();
  if (!value) return "";
  // 只填了「192.168.1.5:17390」这种也要能用,默认补 http
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) {
    value = "http://" + value;
  }
  return value.replace(/\/+$/, "");
}

/** 读取用户设置里的地址;没设置过返回空串 */
export function getCollabServerUrlSetting(): string {
  try {
    return localStorage.getItem(SERVER_URL_KEY) || "";
  } catch (e) {
    return "";
  }
}

/** 保存地址,返回规范化后的值;传空串表示清除设置(回到本地阅读器) */
export function saveCollabServerUrlSetting(url: string): string {
  const normalized = normalizeCollabServerUrl(url);
  try {
    if (normalized) {
      localStorage.setItem(SERVER_URL_KEY, normalized);
    } else {
      localStorage.removeItem(SERVER_URL_KEY);
    }
  } catch (e) {
    // 存不进去只影响持久化,本次会话由调用方的内存态兜底
  }
  return normalized;
}

/**
 * 是否是「真正的网页部署」。
 * Electron(file://)与 Capacitor(http://localhost)都是打包客户端,不算 ——
 * 它们的 origin 不是用户的服务器的,不能拿来做同源兜底。
 */
function isWebDeployment(): boolean {
  if (typeof window === "undefined" || !window.location) return false;
  const { protocol, hostname } = window.location;
  if (protocol !== "http:" && protocol !== "https:") return false;
  if (hostname === "localhost" || hostname === "127.0.0.1" || !hostname) {
    return false;
  }
  return true;
}

/**
 * 解析当前生效的共读服务器地址。
 * 优先级:用户设置 > 构建期注入 REACT_APP_COLLAB_URL > 同源 /collab
 * 返回空字符串表示「未配置」—— 调用方据此进入本地阅读器模式。
 */
export function resolveCollabServerUrl(): string {
  const configured = getCollabServerUrlSetting();
  if (configured) return configured;

  const injected = (process.env.REACT_APP_COLLAB_URL || "").trim();
  if (injected) return normalizeCollabServerUrl(injected);

  // 开发环境:配合 src/setupProxy.js,把 /collab 代理到本机共读服务
  if (process.env.NODE_ENV === "development") {
    return typeof window !== "undefined" && window.location
      ? window.location.origin + "/collab"
      : "";
  }

  // 生产:只有真正的网页部署才回退同源;打包客户端一律视为未配置
  return isWebDeployment() ? window.location.origin + "/collab" : "";
}
