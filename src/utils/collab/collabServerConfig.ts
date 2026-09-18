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

/** 清洗 Token：剔除不可见 Unicode 字符、首尾引号/反引号、markdown 符号及误复制的前缀标签 */
export function cleanCollabToken(raw: string): string {
  let val = (raw || "")
    .replace(/[\u200B-\u200D\uFEFF\u00A0\u2060]/g, "")
    .trim();
  // 剥除两端的单双引号或反引号：如 `token`、"token"、'token'
  val = val.replace(/^[`"']+|[`"']+$/g, "").trim();
  // 剥除 markdown 表格两端的竖线如 | token |
  val = val.replace(/^\|+|\|+$/g, "").trim();
  // 剥除常见的键名前缀，如 "COLLAB_TOKEN="、"共读 token:"、"token:"、"密钥:" 等
  val = val.replace(
    /^(?:COLLAB_TOKEN|共读\s*token|服务\s*token|密钥|token)\s*[:=：|]\s*/i,
    ""
  ).trim();
  val = val.replace(/^token\s*[:=：|]\s*/i, "").trim();
  return val;
}

/** 保证 HTTP Header 值的安全（必须是 ISO-8859-1，杜绝 fetch 报 non ISO-8859-1 code point） */
export function toSafeHeaderValue(val: string): string {
  if (!val) return "";
  const cleaned = cleanCollabToken(val);
  // 如果依然含有非 ISO-8859-1 字符，尝试 encodeURIComponent，防止 fetch 崩溃
  if (/[^\x00-\xFF]/.test(cleaned)) {
    try {
      return encodeURIComponent(cleaned);
    } catch {
      return cleaned.replace(/[^\x00-\xFF]/g, "");
    }
  }
  return cleaned;
}

/** 读取用户设置里的鉴权 Token；没设置过返回空串 */
export function getCollabServerTokenSetting(): string {
  try {
    return cleanCollabToken(localStorage.getItem(SERVER_TOKEN_KEY) || "");
  } catch (e) {
    return "";
  }
}

/** 保存鉴权 Token；传空串表示清除设置 */
export function saveCollabServerTokenSetting(token: string): string {
  const value = cleanCollabToken(token);
  try {
    if (value) {
      localStorage.setItem(SERVER_TOKEN_KEY, value);
    } else {
      localStorage.removeItem(SERVER_TOKEN_KEY);
    }
  } catch (e) {
    // 存不进去只影响持久化,本次会话由调用方的内存态兜底
  }
  return value;
}

/**
 * 解析当前生效的共读鉴权 Token。
 * 优先级: 用户设置 > 构建期注入 REACT_APP_COLLAB_TOKEN
 */
export function resolveCollabServerToken(): string {
  const configured = getCollabServerTokenSetting();
  if (configured) return toSafeHeaderValue(configured);
  return toSafeHeaderValue((process.env.REACT_APP_COLLAB_TOKEN || "").trim());
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
    if (isMobile) {
      hint =
        "⚠️ 手机端连接失败核心排查：\n" +
        "1. Nginx 开启了网页密码（Basic Auth）会拦截跨域预检（OPTIONS），请在 Nginx 的 location /collab/ 块中配置 auth_basic off;\n" +
        "2. 地址是否缺少 /collab 后缀？（若走 Nginx 反代，应填写为 " +
        (url.endsWith("/collab") ? url : url + "/collab") +
        "）\n" +
        "3. 服务端环境变量需配置 COLLAB_ALLOWED_ORIGIN=https://localhost,http://localhost";
    } else if (
      typeof window !== "undefined" &&
      window.location?.protocol === "https:" &&
      url.startsWith("http://")
    ) {
      hint =
        "⚠️ 浏览器安全限制：HTTPS 页面中无法请求 HTTP 服务器（Mixed Content 限制）。请使用 HTTPS 部署共读服务或在安卓 App 中使用。";
    } else {
      hint =
        "⚠️ 常见原因：跨域（CORS）被拦截，请确保服务端配置了 COLLAB_ALLOWED_ORIGIN；或 Nginx Basic Auth 拦截了跨域预检。";
    }

    return {
      ok: false,
      message: "无法连接服务器（Fetch Failed）",
      hint,
    };
  }

  // 2. Token 校验阶段
  const cleanedToken = cleanCollabToken(token);
  if (cleanedToken && /[^\x00-\x7F]/.test(cleanedToken)) {
    return {
      ok: false,
      message: "Token 格式无效（包含中文字符）",
      hint: "Token 必须是由英文、数字或英文字符组成的密钥。请勿填入房间名、昵称或误复制的中文字符。",
      tokenStatus: "invalid",
      rooms: healthData?.rooms,
      clients: healthData?.clients,
      uptime: healthData?.uptime,
    };
  }

  if (cleanedToken) {
    try {
      const authHeaders: Record<string, string> = {
        "x-collab-token": toSafeHeaderValue(cleanedToken),
      };

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
          hint: `服务运行正常，Token 校验通过。当前在线房间: ${
            healthData?.rooms ?? 0
          }，客户端: ${healthData?.clients ?? 0}`,
          tokenStatus: "valid",
          rooms: healthData?.rooms,
          clients: healthData?.clients,
          uptime: healthData?.uptime,
        };
      }

      // 若服务端是旧版本（404 没有 /auth/verify），退回使用幂等的 leave 接口探活（避免多建空房间）
      if (verifyRes.status === 404) {
        const probeRooms = await fetch(`${url}/rooms/__PING_PROBE__/leave`, {
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
    } catch (tokenErr: any) {
      return {
        ok: false,
        message: `Token 校验请求异常（${latencyMs}ms）`,
        hint: `服务器可达，但鉴权请求出错: ${
          tokenErr?.message || String(tokenErr)
        }`,
        tokenStatus: "invalid",
        rooms: healthData?.rooms,
        clients: healthData?.clients,
        uptime: healthData?.uptime,
      };
    }
  }

  return {
    ok: true,
    message: `连接成功（延迟 ${latencyMs}ms）`,
    hint: `服务运行正常（未配置 Token，处于无鉴权模式）。当前在线房间: ${
      healthData?.rooms ?? 0
    }，客户端: ${healthData?.clients ?? 0}`,
    tokenStatus: "not_required",
    rooms: healthData?.rooms,
    clients: healthData?.clients,
    uptime: healthData?.uptime,
  };
}

