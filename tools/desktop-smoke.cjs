/**
 * 桌面端冒烟测试（不打包，直接拿 build/ 起一个 Electron 实例）
 * ============================================================
 * 用法： node tools/desktop-smoke.cjs
 *
 * 实现说明：探测代码必须在 Electron 主进程里执行（普通 node 里
 * require("electron") 只会拿到可执行文件路径），所以真正的探测逻辑
 * 在 main.js 的 COREAD_SMOKE 分支里，这个脚本只负责：
 *   1. 用 COREAD_SMOKE=1 启动 electron
 *   2. 等它把报告写到磁盘
 *   3. 把结论打印出来
 *
 * 检查项：页面是否跑在 app://coread、pdfjsLib 是否注入、
 * window.require 是否可用、IndexedDB 是否可写、静态资源是否 200、
 * select-book（导入）通道是否注册。
 */
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, ".workbuddy", "desktop-smoke");
const REPORT = path.join(OUT_DIR, "smoke-report.json");
const PNG = path.join(OUT_DIR, "smoke.png");

function electronBin() {
  const p = path.join(ROOT, "node_modules", "electron");
  if (process.platform === "win32") return path.join(p, "dist", "electron.exe");
  if (process.platform === "darwin") {
    return path.join(p, "dist", "Electron.app", "Contents", "MacOS", "Electron");
  }
  return path.join(p, "dist", "electron");
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (fs.existsSync(REPORT)) fs.unlinkSync(REPORT);

  const env = {
    ...process.env,
    COREAD_FORCE_PROD: "1", // 让 main.js 直接加载 build/ 产物
    COREAD_SMOKE: "1",
    COREAD_SMOKE_OUT: REPORT,
    COREAD_SMOKE_PNG: PNG,
  };
  // 坑：VS Code / 终端环境里常常带着 ELECTRON_RUN_AS_NODE=1，
  // 继承过来会让 electron 退化成纯 node 进程（require("electron") 拿不到 app）。
  delete env.ELECTRON_RUN_AS_NODE;

  // 本机 GPU 进程起不来（GPU process isn't usable），必须关掉硬件加速。
  // 这些开关只在冒烟测试时加，正式版不要带。
  const child = spawn(
    electronBin(),
    [ROOT, "--no-sandbox", "--disable-gpu", "--in-process-gpu", "--disable-software-rasterizer"],
    { env, stdio: ["ignore", "pipe", "pipe"] }
  );
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d.toString()));
  child.stdout.on("data", () => {});

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (fs.existsSync(REPORT)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  try {
    child.kill();
  } catch (e) {
    /* ignore */
  }

  if (!fs.existsSync(REPORT)) {
    console.error("✗ 冒烟测试超时，没有产出报告。stderr:\n" + stderr.slice(-2000));
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(REPORT, "utf-8"));
  fs.writeFileSync(
    path.join(OUT_DIR, "smoke-console.txt"),
    (report.consoleErrors || []).join("\n"),
    "utf-8"
  );
  console.log(JSON.stringify(report, null, 2));
  console.log(report.allPass ? "\n✓ 冒烟测试通过" : "\n✗ 冒烟测试未通过");
  if (report.error) console.error("错误：", report.error);
  process.exit(report.allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
