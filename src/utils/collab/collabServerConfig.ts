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
const SERVER_TOKEN_KEY = "koodo-collab-server-token";

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

/** 读取用户设置里的鉴权 Token；没设置过返回空串 */
export function getCollabServerTokenSetting(): string {
  try {
    return localStorage.getItem(SERVER_TOKEN_KEY) || "";
  } catch (e) {
    return "";
  }
}

/** 保存鉴权 Token；传空串表示清除设置 */
export function saveCollabServerTokenSetting(token: string): string {
  const value = (token || "").trim();
  try {
    if (value) {
      localStorage.setItem(SERVER_TOKEN_KEY, value);
    } else {
      localStorage.removeItem(SERVER_TOKEN_KEY);
    }
  } catch (e) {
    // 忽略异常
  }
  return value;
}

/**
 * 解析当前生效的共读鉴权 Token。
 * 优先级: 用户设置 > 构建期注入 REACT_APP_COLLAB_TOKEN
 */
export function resolveCollabServerToken(): string {
  const configured = getCollabServerTokenSetting();
  if (configured) return configured;
  return (process.env.REACT_APP_COLLAB_TOKEN || "").trim();
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

export interface CollabServerTestResult {
  ok: boolean;
  message: string;
  hint?: string;
  latencyMs?: number;
  rooms?: number;
  clients?: number;
  uptime?: number;
  tokenStatus?: "valid" | "invalid" | "not_required" | "none";
}

/**
 * 测试与指定共读服务器的连通性与 Token 有效性
 */
export async function testCollabServerConnection(
  rawUrl: string,
  rawToken?: string
): Promise<CollabServerTestResult> {
  const url = normalizeCollabServerUrl(rawUrl);
  const token = (rawToken || "").trim();

  if (!url) {
    return {
      ok: false,
      message: "请先填写共读服务器地址",
      hint: "形如 https://your-server.example.com/collab 或 http://192.168.1.5:17390",
    };
  }

  const startTime = Date.now();

  // 1. 基础网络连通与 /health 检查
  let healthData: any = null;
  let latencyMs = 0;
  try {
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), 7000)
      : null;

    const response = await fetch(`${url}/health`, {
      method: "GET",
      signal: controller?.signal,
    });
    if (timeoutId) clearTimeout(timeoutId);

    latencyMs = Date.now() - startTime;

    if (!response.ok) {
      // 如果 /health 返回 404，检查是否漏填了 /collab
      if (response.status === 404 && !url.endsWith("/collab")) {
        try {
          const probeCollab = await fetch(`${url}/collab/health`, {
            method: "GET",
          });
          if (probeCollab.ok) {
            return {
              ok: false,
              message: `服务器响应 404，但检测到 /collab/health 可用`,
              hint: `💡 建议将服务器地址末尾补上 /collab，形如：${url}/collab`,
            };
          }
        } catch {
          // ignore
        }
        return {
          ok: false,
          message: `服务器返回 HTTP 404（未找到服务）`,
          hint: "若通过 Nginx 反代部署，请确保地址包含 /collab 前缀（例如 https://域名/collab）；若直连 Node 端口，请确认服务端已启动。",
        };
      }

      return {
        ok: false,
        message: `服务器返回异常状态码：HTTP ${response.status}`,
        hint: "请检查服务器 Nginx 反代配置或服务端运行日志。",
      };
    }

    try {
      healthData = await response.json();
    } catch {
      healthData = {};
    }
  } catch (error: any) {
    const isTimeout = error?.name === "AbortError";
    const isMobile =
      typeof window !== "undefined" &&
      Boolean((window as any).Capacitor || (window as any).ReactNativeWebView);

    if (isTimeout) {
      return {
        ok: false,
        message: "连接超时（7 秒内无响应）",
        hint: "请检查服务器 IP/域名是否正确、云服务器安全组/防火墙是否放行对应端口（如 17390 或 443）。",
      };
    }

    // fetch failed (CORS / 网络不通 / 证书不信任 / 协议限制)
    let hint =
      "请检查服务器地址是否正确、Node 服务是否已启动并监听对应网卡。";
    if (
      typeof window !== "undefined" &&
      window.location?.protocol === "https:" &&
      url.startsWith("http://")
    ) {
      hint =
        "⚠️ 浏览器安全限制：HTTPS 页面中无法请求 HTTP 服务器（Mixed Content 限制）。请使用 HTTPS 部署共读服务。";
    } else if (isMobile) {
      hint =
        "⚠️ 手机端常见原因：\n1. 跨域拦截：安卓端（https://localhost）跨域请求，需在服务端环境变量配置 COLLAB_ALLOWED_ORIGIN=https://localhost,http://localhost\n2. 若直连 IP，需服务端 COLLAB_HOST=0.0.0.0 且防火墙放行 17390 端口。";
    } else {
      hint =
        "⚠️ 常见原因：跨域（CORS）被拦截，请确保服务端配置了 COLLAB_ALLOWED_ORIGIN；或者服务端未启动 / 证书无效。";
    }

    return {
      ok: false,
      message: "无法连接服务器（Fetch Failed）",
      hint,
    };
  }

  // 2. Token 校验阶段
  try {
    const authHeaders: Record<string, string> = token
      ? { "x-collab-token": token }
      : {};

    const verifyRes = await fetch(`${url}/auth/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({ ping: true }),
    });

    if (verifyRes.status === 401) {
      return {
        ok: false,
        message: `连接通畅（${latencyMs}ms），但 Token 错误或未授权 (401)`,
        hint: "请核对服务端 COLLAB_TOKEN 配置，或在输入框中填写正确的鉴权 Token。",
        tokenStatus: "invalid",
        rooms: healthData?.rooms,
        clients: healthData?.clients,
        uptime: healthData?.uptime,
      };
    }

    if (verifyRes.ok) {
      return {
        ok: true,
        message: `连接成功（延迟 ${latencyMs}ms）`,
        hint: `服务运行正常${
          token ? "，Token 校验通过" : "（无需鉴权）"
        }。当前在线房间: ${healthData?.rooms ?? 0}，客户端: ${
          healthData?.clients ?? 0
        }`,
        tokenStatus: token ? "valid" : "not_required",
        rooms: healthData?.rooms,
        clients: healthData?.clients,
        uptime: healthData?.uptime,
      };
    }

    // 若服务端是旧版本（404 没有 /auth/verify），退回使用 POST /rooms 探活
    if (verifyRes.status === 404) {
      const probeRooms = await fetch(`${url}/rooms`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({ clientId: "__ping_probe__" }),
      });

      if (probeRooms.status === 401) {
        return {
          ok: false,
          message: `连接通畅（${latencyMs}ms），但 Token 错误或未授权 (401)`,
          hint: "请核对服务端 COLLAB_TOKEN 配置，或在输入框中填写正确的鉴权 Token。",
          tokenStatus: "invalid",
          rooms: healthData?.rooms,
          clients: healthData?.clients,
          uptime: healthData?.uptime,
        };
      }
    }
  } catch {
    // 即使 Token 探测异常，健康检查也是通过的
  }

  return {
    ok: true,
    message: `连接成功（延迟 ${latencyMs}ms）`,
    hint: `服务正常响应。当前在线房间: ${healthData?.rooms ?? 0}，客户端: ${
      healthData?.clients ?? 0
    }`,
    tokenStatus: token ? "valid" : "none",
    rooms: healthData?.rooms,
    clients: healthData?.clients,
    uptime: healthData?.uptime,
  };
}

