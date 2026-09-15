export const MIME_TYPE_MAP: Record<string, string> = {
  json: "application/json",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  bmp: "image/bmp",
  zip: "application/zip",
  epub: "application/epub+zip",
  txt: "text/plain",
  pdf: "application/pdf",
  mobi: "application/x-mobipocket-ebook",
  azw3: "application/vnd.amazon.ebook",
  azw: "application/vnd.amazon.ebook",
  cbz: "application/x-cbz",
  cbr: "application/x-cbr",
  cbt: "application/x-cbt",
  cb7: "application/x-cb7",
  fb2: "application/x-fictionbook+xml",
  html: "text/html",
  css: "text/css",
  js: "application/javascript",
  xml: "application/xml",
  xhtml: "application/xhtml+xml",
  opf: "application/oebps-package+xml",
  ncx: "application/x-dtbncx+xml",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
  avi: "video/x-msvideo",
  wmv: "video/x-ms-wmv",
  flv: "video/x-flv",
  m3u8: "application/x-mpegURL",
  ts: "video/MP2T",
  "3gp": "video/3gpp",
  "3g2": "video/3gpp2",
  db: "application/x-sqlite3",
};

export const EXTENSION_MAP: Record<string, string> = {
  "application/json": "json",
  "application/zip": "zip",
  "application/epub+zip": "epub",
  "text/plain": "txt",
  "application/pdf": "pdf",
  "application/x-mobipocket-ebook": "mobi",
  "application/vnd.amazon.ebook": "azw3",
  "application/x-cbz": "cbz",
  "application/x-cbr": "cbr",
  "application/x-cbt": "cbt",
  "application/x-cb7": "cb7",
  "application/x-fictionbook+xml": "fb2",
  "text/html": "html",
  "text/css": "css",
  "application/javascript": "js",
  "application/xml": "xml",
  "application/xhtml+xml": "xhtml",
  "application/oebps-package+xml": "opf",
  "application/x-dtbncx+xml": "ncx",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/x-msvideo": "avi",
  "video/x-ms-wmv": "wmv",
  "video/x-flv": "flv",
  "application/x-mpegURL": "m3u8",
  "video/MP2T": "ts",
  "video/3gpp": "3gp",
  "video/3gpp2": "3g2",
  "application/x-sqlite3": "db",
};

export const EmailProviders = [
  "gmail.com",
  "qq.com",
  "163.com",
  "yahoo.com",
  "sina.com",
  "sina.cn",
  "126.com",
  "outlook.com",
  "yeah.net",
  "foxmail.com",
  "hotmail.com",
  "protonmail.com",
  "proton.me",
  "icloud.com",
  "mail.com",
  "live.com",
  "aliyun.com",
  "sohu.com",
  "yandex.com",
  "naver.com",
  "mail.ru",
  "yahoo.co.jp",
  "139.com",
  "189.com",
  "yandex.ru",
  "189.cn",
];

export const Base64 = {
  encode(str: string): string {
    return btoa(unescape(encodeURIComponent(str)));
  },
  decode(str: string): string {
    return decodeURIComponent(escape(atob(str)));
  },
  encodeURL(str: string): string {
    return this.encode(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  },
  decodeURL(str: string): string {
    let s = str.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4 !== 0) {
      s += "=";
    }
    return this.decode(s);
  },
};

export const CommonTool = {
  getMimeType(ext: string): string | undefined {
    return MIME_TYPE_MAP[ext] || (["jpg", "jpeg", "png", "gif", "bmp"].includes(ext) ? `image/${ext}` : undefined);
  },

  getExtension(mime: string): string {
    if (EXTENSION_MAP[mime]) return EXTENSION_MAP[mime];
    if (mime && mime.startsWith("image/")) return mime.split("/")[1];
    return "";
  },

  databaseList: ["books", "notes", "bookmarks", "plugins", "words"],

  configList: [
    "themeColors",
    "readingTime",
    "appVersion",
    "cloudSyncTime",
    "lastSyncTime",
    "recentBooks",
    "koreaderBooks",
    "recentAdd",
    "deletedBooks",
    "favoriteBooks",
    "shelfList",
    "txtParsers",
    "aiModelConfig",
    "readingStats",
    "noteTags",
    "recordLocation",
    "thirdpartyToken",
    "sortedShelfList",
    "kindleDeviceList",
    "thirdpartyToken",
    "opdsCatalogs",
    "opdsCatalogList",
  ],

  copyArrayBuffer(buffer: ArrayBuffer): ArrayBuffer {
    const copy = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(copy).set(new Uint8Array(buffer));
    return copy;
  },

  base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  },

  arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  },

  async generateSHA256Hash(text: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const digest = await crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
    return "";
  },

  getDisableThinkingParams(provider?: string): Record<string, any> {
    const thinkingDisabled = new Set(["anthropic", "zhipu", "doubao", "moonshot", "deepseek"]);
    const enableThinkingFalse = new Set(["qwen", "hunyuan", "siliconflow", "infini"]);
    if (provider && provider !== "custom") {
      if (thinkingDisabled.has(provider)) {
        return { thinking: { type: "disabled" } };
      }
      if (enableThinkingFalse.has(provider)) {
        return { enable_thinking: false };
      }
    }
    return {};
  },

  EmailProviders,
  Base64,
};

export default CommonTool;
