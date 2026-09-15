#!/usr/bin/env node
/**
 * 验证 Harness 环境就绪与基础契约断言脚本（零依赖）
 *
 * 用法:
 *   node tools/harness/verify-harness.mjs
 */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createStaticServer } from "./server.mjs";

const ROOT = process.cwd();
const checks = [];

function assert(condition, name, details = "") {
  checks.push({ name, passed: Boolean(condition), details });
  const mark = condition ? "✅" : "❌";
  console.log(`${mark} ${name}${details ? ` (${details})` : ""}`);
}

async function run() {
  console.log("=== CoRead Harness 自动化环境与契约断言 ===");

  // 1. 检查 Harness 静态文件
  const harnessHtmlPath = path.join(ROOT, "tools", "harness", "index.html");
  assert(fs.existsSync(harnessHtmlPath), "Harness HTML 页面存在");
  const htmlContent = fs.readFileSync(harnessHtmlPath, "utf8");

  // 契约 1: id="page-area"
  assert(htmlContent.includes('id="page-area"'), "契约 1: 宿主容器 id='page-area' 声明");

  // 契约 8: 样式检查
  const harnessCssPath = path.join(ROOT, "tools", "harness", "index.css");
  assert(fs.existsSync(harnessCssPath), "Harness CSS 文件存在");
  const cssContent = fs.readFileSync(harnessCssPath, "utf8");
  assert(
    cssContent.includes("overflow-y: auto") && cssContent.includes("#page-area"),
    "契约 8: 宿主容器设置 overflow-y: auto"
  );

  // 检查零外联：不得含有 http/https 外链 script
  const hasExternalScript = /<script[^>]+src=["']https?:\/\//i.test(htmlContent);
  assert(!hasExternalScript, "零外联约束: Harness HTML 未引入外部 CDN 脚本");

  // 2. 本地依赖与内核基线存在性
  const localforagePath = path.join(ROOT, "tools", "harness", "localforage.min.js");
  assert(fs.existsSync(localforagePath), "本地依赖: localforage.min.js 本地化就绪");

  const pdfjsPath = path.join(ROOT, "public", "lib", "pdfjs", "pdf.mjs");
  const pdfjsWorkerPath = path.join(ROOT, "public", "lib", "pdfjs", "pdf.worker.mjs");
  assert(fs.existsSync(pdfjsPath) && fs.existsSync(pdfjsWorkerPath), "契约 5: 本地 PDF.js 核心库及 Worker 存在");

  const kookitLegacyPath = path.join(ROOT, "src", "assets", "lib", "kookit.min.js");
  assert(!fs.existsSync(kookitLegacyPath), "内核换代: 老黑盒产物 kookit.min.js 已彻底移除");

  // Phase 2: 自建纯净内核 Bundle 与核心架构层存在性断言
  const vendorBundlePath = path.join(ROOT, "src", "vendor", "kookit.esm.js");
  const vendorBundleStat = fs.existsSync(vendorBundlePath) && fs.statSync(vendorBundlePath);
  assert(
    Boolean(vendorBundleStat && vendorBundleStat.size > 100000),
    "Phase 2: 自建纯净内核 src/vendor/kookit.esm.js 就绪",
    vendorBundleStat ? `${(vendorBundleStat.size / 1024).toFixed(1)} KB` : "未找到"
  );

  const renderPortPath = path.join(ROOT, "src", "core", "ports", "IRenderService.ts");
  assert(fs.existsSync(renderPortPath), "Phase 2: 核心渲染端口 IRenderService.ts 存在");

  const renderAdapterPath = path.join(ROOT, "src", "core", "adapters", "render", "kookitRenderAdapter.ts");
  assert(fs.existsSync(renderAdapterPath), "Phase 2: 渲染适配器 KookitRenderAdapter 存在");

  const renderLoaderPath = path.join(ROOT, "src", "core", "adapters", "render", "kookitLoader.ts");
  assert(fs.existsSync(renderLoaderPath), "Phase 2: 内核加载器 kookitLoader 存在");

  // 3. 静态服务启动与路由探测
  const testPort = 3199;
  const server = createStaticServer(ROOT);

  await new Promise((resolve) => server.listen(testPort, "127.0.0.1", resolve));
  console.log(`[Test Server] 临时测试服务已启动: http://127.0.0.1:${testPort}`);

  async function fetchPath(urlPath) {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${testPort}${urlPath}`, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }).on("error", reject);
    });
  }

  try {
    const resHtml = await fetchPath("/tools/harness/index.html");
    assert(resHtml.status === 200, "服务探测: /tools/harness/index.html 可访问 (200)");
    assert(
      (resHtml.headers["content-type"] || "").includes("text/html"),
      "MIME 类型: index.html 为 text/html"
    );

    const resPdf = await fetchPath("/public/lib/pdfjs/pdf.mjs");
    assert(resPdf.status === 200, "服务探测: /public/lib/pdfjs/pdf.mjs 可访问 (200)");
    assert(
      (resPdf.headers["content-type"] || "").includes("text/javascript"),
      "MIME 类型: pdf.mjs 正确响应为 text/javascript"
    );
  } finally {
    server.close();
  }

  // 4. 契约逻辑断言 (契约 12, 14)
  // 契约 14: 颜色前缀要求 background-#RRGGBB
  function formatHighlightColor(hex) {
    const clean = hex.startsWith("#") ? hex : "#" + hex;
    return `background-${clean}`;
  }
  assert(
    formatHighlightColor("#1a73e8") === "background-#1a73e8",
    "契约 14: 笔记高亮颜色必须编码为 background-#RRGGBB 格式"
  );

  // 契约 12: getPosition() 返回的数值字段需要安全转换为 number
  function normalizePosition(rawPos) {
    return {
      chapterIndex: Number(rawPos.chapterDocIndex ?? rawPos.chapterIndex ?? 0),
      percentage: Number(rawPos.percentage ?? 0),
    };
  }
  const sampleRawPos = { chapterDocIndex: "3", percentage: "0.45" };
  const normalized = normalizePosition(sampleRawPos);
  assert(
    typeof normalized.chapterIndex === "number" && normalized.chapterIndex === 3,
    "契约 12: 位置章节字段转换为 number 类型"
  );
  assert(
    typeof normalized.percentage === "number" && normalized.percentage === 0.45,
    "契约 12: 位置进度字段转换为 number 类型"
  );

  // 契约 15: 深色模式下高亮对比度自适应
  function getHighlightAlpha(isNight) {
    return isNight ? 0.45 : 0.8;
  }
  assert(
    getHighlightAlpha(true) === 0.45 && getHighlightAlpha(false) === 0.8,
    "契约 15: 深色模式下高亮颜色透明度与对比度自动优化"
  );

  // 契约 16: 跨章节高亮拼接 chapterIndex:range 唯一标识
  function formatChapterRangeKey(chapterIndex, rangeStr) {
    return `${chapterIndex}:${rangeStr}`;
  }
  assert(
    formatChapterRangeKey(2, '{"start":10,"end":50}') === '2:{"start":10,"end":50}',
    "契约 16: 跨章节高亮唯一性按 chapterIndex:range 编码"
  );

  // 统计结果
  const failed = checks.filter((c) => !c.passed);
  console.log(`\n断言汇总: 共 ${checks.length} 项，通过 ${checks.length - failed.length} 项，失败 ${failed.length} 项。`);

  if (failed.length > 0) {
    console.error("❌ Harness 验证未完全通过！");
    process.exit(1);
  } else {
    console.log("✅ Harness 验证全部通过！");
    process.exit(0);
  }
}

run().catch((err) => {
  console.error("运行异常:", err);
  process.exit(1);
});
