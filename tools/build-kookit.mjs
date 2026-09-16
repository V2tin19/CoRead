#!/usr/bin/env node
/**
 * CoRead 渲染内核构建脚本
 *
 * 职责：
 *   从 vendor/kookit/ 纯 TypeScript 源码构建可重现的纯净 ESM Bundle，
 *   输出到 src/vendor/kookit.esm.js。
 *   完全脱敏，消除上游作者硬编码本地绝对路径，严格保持外部依赖共享。
 *
 * 用法：
 *   先装内核自己的构建依赖（只装一次，node_modules 不进仓库）：
 *     cd vendor/kookit && npm ci
 *   然后回仓库根目录：
 *     node tools/build-kookit.mjs
 */

import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const VENDOR_KOOKIT = path.join(ROOT, "vendor", "kookit");
const vendorRequire = createRequire(path.join(VENDOR_KOOKIT, "package.json"));

/**
 * 构建依赖装在 vendor/kookit/node_modules 下（不在根 node_modules 里，
 * 因为内核的 rollup 版本与宿主工程不同）。
 * 全新克隆的仓库里这个目录不存在 —— 直接 require 只会甩一段 loader 栈，
 * 看不出该干什么，所以这里自己先判一次并给出可执行的下一步。
 */
const VENDOR_DEPS = [
  "rollup",
  "@rollup/plugin-node-resolve",
  "@rollup/plugin-commonjs",
  "@rollup/plugin-typescript",
  "@rollup/plugin-json",
  "@rollup/plugin-terser",
];
const missing = VENDOR_DEPS.filter((m) => {
  try {
    vendorRequire.resolve(m);
    return false;
  } catch {
    return true;
  }
});
if (missing.length) {
  console.error(
    [
      "",
      "[build-kookit] ❌ 内核构建依赖没装，无法继续。",
      "  缺：" + missing.join(" / "),
      "  它们属于 vendor/kookit 自己的 devDependencies（内核用的 rollup 版本与宿主工程不同），",
      "  所以不在根 node_modules 里，得单独装一次：",
      "",
      "      cd vendor/kookit && npm ci",
      "",
      "  装完回到仓库根目录重跑：node tools/build-kookit.mjs",
      "  （vendor/kookit/node_modules 在 .gitignore 里，不会进仓库）",
      "",
    ].join("\n")
  );
  process.exit(1);
}

const { rollup } = vendorRequire("rollup");
const resolve = vendorRequire("@rollup/plugin-node-resolve").default || vendorRequire("@rollup/plugin-node-resolve");
const commonjs = vendorRequire("@rollup/plugin-commonjs").default || vendorRequire("@rollup/plugin-commonjs");
const typescript = vendorRequire("@rollup/plugin-typescript").default || vendorRequire("@rollup/plugin-typescript");
const json = vendorRequire("@rollup/plugin-json").default || vendorRequire("@rollup/plugin-json");
const terser = vendorRequire("@rollup/plugin-terser").default || vendorRequire("@rollup/plugin-terser");

const OUTPUT_DIR = path.join(ROOT, "src", "vendor");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "kookit.esm.js");

async function build() {
  console.log("[build-kookit] 开始从 vendor/kookit 构建 ESM Bundle...");
  const startTime = Date.now();

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const externalList = [
    "mammoth",
    "jszip",
    "underscore",
    "marked",
    "mhtml2html",
    "js-untar",
    "fflate",
    "rangy/lib/rangy-core.js",
    "rangy/lib/rangy-textrange",
    "chardet",
  ];

  const inputOptions = {
    input: path.join(VENDOR_KOOKIT, "src", "index.ts"),
    external: externalList,
    plugins: [
      resolve({
        browser: true,
        rootDir: VENDOR_KOOKIT,
        moduleDirectories: [
          path.join(VENDOR_KOOKIT, "node_modules"),
          path.join(ROOT, "node_modules"),
        ],
      }),
      commonjs({
        include: [/node_modules/],
      }),
      json(),
      typescript({
        tsconfig: path.join(VENDOR_KOOKIT, "tsconfig.json"),
      }),
      terser({
        format: {
          comments: false,
        },
      }),
    ],
    onwarn(warning, warn) {
      if (warning.code === "CIRCULAR_DEPENDENCY" || warning.code === "EVAL") {
        return;
      }
      warn(warning);
    },
  };

  const outputOptions = {
    file: OUTPUT_FILE,
    format: "es",
    name: "Kookit",
    sourcemap: false,
  };

  const bundle = await rollup(inputOptions);
  await bundle.write(outputOptions);
  await bundle.close();

  const stat = fs.statSync(OUTPUT_FILE);
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(
    `[build-kookit] ✅ 成功构建: ${path.relative(ROOT, OUTPUT_FILE)} (${(stat.size / 1024).toFixed(1)} KB, 耗时 ${duration}s)`
  );
}

build().catch((err) => {
  console.error("[build-kookit] ❌ 构建失败:", err);
  process.exit(1);
});
