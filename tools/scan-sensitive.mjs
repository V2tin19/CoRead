#!/usr/bin/env node
/**
 * 敏感信息自检脚本（零依赖）
 *
 * 用途：提交前扫描整个仓库，确认没有「自有服务器信息 / 凭据 / 本机路径」残留。
 *
 * 用法：
 *   node tools/scan-sensitive.mjs                  （或 npm run scan）跳过第三方目录，是提交门槛
 *   node tools/scan-sensitive.mjs --include-vendor （或 npm run scan:all）连 vendor/ 一起扫，
 *                                                   结果只作参考，退出码非 0 属正常
 *
 * 退出码：0 = 干净；1 = 有命中（必须处理后再提交）
 *
 * 为什么默认跳过 vendor/ 与 public/lib/：这两处是第三方固化源码（kookit 上游、pdf.js 等），
 * 我们不维护、也不该为了"扫描通过"去改写它们；而且它们内部天然含上游自己的 CDN 地址与作者
 * 本机路径。这些内容的处置写在 REFACTOR-BRIEF.md 第 5.4 节，不靠本脚本兜底。
 * 想确认第三方目录里到底有什么，用 --include-vendor 看一眼即可。
 *
 * 想追加本项目专属的封禁串，写进 tools/banned-hosts.json（字符串数组）：
 *   ["my-real-host.invalid", "203.0.113.10"]
 * 只放「不该出现的东西」，不要放真实凭据。
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ARGV = process.argv.slice(2);
const INCLUDE_VENDOR = ARGV.includes("--include-vendor") || ARGV.includes("--all");

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "build",
  "coverage",
  "dist",
  ".next",
  ".cache",
]);

// 第三方自带资产目录：内容不由我们维护（见文件头说明）。--include-vendor 时不再跳过。
const SKIP_PATH_PREFIXES = INCLUDE_VENDOR ? [] : ["public/lib/", "vendor/"];

// 依赖锁文件：里面全是 npm 的资助链接与维护者邮箱，不是我们的信息
const SKIP_FILENAMES = new Set(["package-lock.json", "yarn.lock", "npm-shrinkwrap.json"]);

// 允许出现的域名：第三方公开资源、格式规范 URI、搜索引擎、示例地址
const ALLOWED_HOSTS = new Set([
  // 格式规范 / 命名空间 URI
  "w3.org", "www.w3.org", "idpf.org", "www.idpf.org", "daisy.org", "www.daisy.org",
  "unicode.org", "purl.org", "ns.adobe.com", "pubs.opengroup.org",
  "tools.ietf.org", "www.ietf.org", "ietf.org", "opds-spec.org",
  // 开发文档 / 代码托管
  "developer.mozilla.org", "github.com", "raw.githubusercontent.com", "codeload.github.com",
  "unpkg.com", "esm.sh", "cdn.jsdelivr.net", "cdnjs.cloudflare.com",
  "stackoverflow.com", "underscorejs.org", "danml.com", "kripken.github.io",
  "emscripten.org", "support.microsoft.com", "en.wikipedia.org",
  "reactjs.org", "react.dev", "npmjs.com", "www.npmjs.com", "registry.npmjs.org",
  "schema.org", "openstreetmap.org", "meyerweb.com", "www.robotstxt.org", "robotstxt.org",
  // 合法第三方服务（阅读相关）
  "tessdata.projectnaptha.com", "www.gutenberg.org", "manybooks.net",
  "apis.google.com", "www.googleapis.com", "sync.koreader.rocks",
  "beian.miit.gov.cn", "beian.mps.gov.cn",
  // 搜索引擎（「用搜索引擎查这个词」功能）
  "www.google.com", "google.com", "www.baidu.com", "baidu.com", "baike.baidu.com",
  "www.bing.com", "bing.com", "duckduckgo.com", "yandex.com",
  "search.yahoo.com", "search.naver.com",
  // 本机与示例
  "localhost", "127.0.0.1", "your-server.example.com", "example.com", "www.example.com",
  "site.com",
]);

const ALLOWED_EMAIL_DOMAINS = new Set([
  "example.com",
  "users.noreply.github.com",
  "localhost",
]);

const PRIVATE_IP_RE =
  /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|255\.|169\.254\.)/;

// RFC 5737 文档专用网段（192.0.2.0/24、198.51.100.0/24、203.0.113.0/24）——只用于示例
const DOC_IP_RE = /^(192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/;

// 保留给示例/文档用的伪域名后缀与子域
const PSEUDO_TLD_RE = /\.(example|invalid|test|local)$/i;
const PSEUDO_SUBDOMAIN_RE = /\.example\.com$/i;

const PATTERNS = [
  {
    id: "public-ipv4",
    label: "公网 IPv4",
    re: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    allow: (v) => PRIVATE_IP_RE.test(v) || DOC_IP_RE.test(v),
  },
  {
    id: "host",
    label: "非白名单域名",
    re: /https?:\/\/([a-zA-Z0-9._-]+)/g,
    pick: 1,
    allow: (v) => {
      const h = v.toLowerCase().replace(/:\d+$/, "");
      return (
        ALLOWED_HOSTS.has(h) ||
        PRIVATE_IP_RE.test(h) ||
        DOC_IP_RE.test(h) ||
        PSEUDO_TLD_RE.test(h) ||
        PSEUDO_SUBDOMAIN_RE.test(h)
      );
    },
  },
  {
    id: "win-abs-path",
    label: "本机绝对路径",
    re: /\b[A-Za-z]:\\(?:[^\\\s"']+\\?)+/g,
    allow: () => false,
  },
  {
    id: "unix-home-path",
    label: "本机 home 路径",
    re: /(?:\/Users\/|\/home\/)[A-Za-z0-9._-]+/g,
    allow: () => false,
  },
  {
    id: "email",
    label: "邮箱",
    re: /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g,
    pick: 1,
    allow: (v) => ALLOWED_EMAIL_DOMAINS.has(v.toLowerCase()),
  },
  {
    id: "private-key",
    label: "私钥块",
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
    allow: () => false,
  },
  {
    id: "credential-word",
    label: "疑似凭据赋值",
    re: /\b(?:passwd|password|api[_-]?key|access[_-]?token|secret[_-]?key)\b\s*[:=]\s*["'][^"'{}$]{6,}["']/gi,
    allow: () => false,
  },
];

const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".scss",
  ".html", ".md", ".txt", ".yml", ".yaml", ".toml", ".sh", ".env", ".xml",
]);

function loadBanned() {
  const p = path.join(ROOT, "tools", "banned-hosts.json");
  if (!fs.existsSync(p)) return [];
  try {
    const arr = JSON.parse(fs.readFileSync(p, "utf8"));
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string" && x) : [];
  } catch {
    console.warn("[scan] tools/banned-hosts.json 解析失败，已忽略");
    return [];
  }
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = path.relative(ROOT, full).split(path.sep).join("/");
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, out);
      continue;
    }
    if (SKIP_FILENAMES.has(e.name)) { skipped.names++; continue; }
    if (SKIP_PATH_PREFIXES.some((p) => rel.startsWith(p))) { skipped.thirdParty++; continue; }
    if (e.name.endsWith(".min.js") || e.name.endsWith(".min.mjs")) { skipped.minified++; continue; }
    const ext = path.extname(e.name).toLowerCase();
    if (!TEXT_EXT.has(ext) && !e.name.startsWith(".env")) { skipped.nonText++; continue; }
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (st.size > 4 * 1024 * 1024) { skipped.tooLarge++; continue; }
    out.push({ full, rel });
  }
  return out;
}

const skipped = { thirdParty: 0, minified: 0, nonText: 0, tooLarge: 0, names: 0 };

const files = walk(ROOT);
const banned = loadBanned();
const hits = [];

for (const { full, rel } of files) {
  let text;
  try { text = fs.readFileSync(full, "utf8"); } catch { continue; }
  const lines = text.split(/\r?\n/);

  for (const b of banned) {
    lines.forEach((line, i) => {
      if (line.includes(b)) hits.push({ rel, line: i + 1, id: "banned", value: "***（封禁串命中）" });
    });
  }

  for (const p of PATTERNS) {
    lines.forEach((line, i) => {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(line)) !== null) {
        const value = p.pick ? m[p.pick] : m[0];
        if (!p.allow(value)) hits.push({ rel, line: i + 1, id: p.id, value });
        if (!p.re.global) break;
      }
    });
  }
}

const byFile = new Map();
for (const h of hits) {
  if (!byFile.has(h.rel)) byFile.set(h.rel, []);
  byFile.get(h.rel).push(h);
}

console.log(`[scan] 扫描文件数：${files.length}`);
if (!INCLUDE_VENDOR) {
  console.log(
    `[scan] 已跳过：第三方目录 ${skipped.thirdParty} 个文件、压缩产物 ${skipped.minified} 个、` +
      `锁文件 ${skipped.names} 个、非文本 ${skipped.nonText} 个`
  );
  console.log("[scan] 想连第三方目录一起看：npm run scan:all（结果只作参考，不是提交门槛）");
} else {
  console.log("[scan] 已开启 --include-vendor：第三方目录/压缩产物也在扫描范围内（仅供参考）");
}
if (banned.length) console.log(`[scan] 启用封禁串：${banned.length} 条`);
console.log("");

if (hits.length === 0) {
  console.log("[scan] ✅ 未发现敏感信息（公网 IP / 非白名单域名 / 本机路径 / 邮箱 / 凭据 / 私钥）");
  process.exit(0);
}

console.log(`[scan] ❌ 发现 ${hits.length} 处命中，涉及 ${byFile.size} 个文件：`);
for (const [rel, list] of byFile) {
  console.log(`\n  ${rel}`);
  for (const h of list) console.log(`    L${h.line}  [${h.id}]  ${h.value}`);
}
console.log("\n[scan] 原则：真实服务器信息一律删除；示例地址只允许 example.com / 私网段。");
process.exit(1);
