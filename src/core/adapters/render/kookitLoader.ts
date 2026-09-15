/**
 * Kookit 内核动态安全加载器
 *
 * 契约 5 强制约束：
 *   PDF / 漫画依赖外部全局对象 window.pdfjsLib。
 *   必须先把 pdfjsLib 挂载到 window，再动态 import() 内核模块，顺序不可颠倒。
 */

let kookitModulePromise: Promise<any> | null = null;

export async function ensurePdfjs(): Promise<any> {
  if (typeof window === "undefined") return null;

  if ((window as any).pdfjsLib) {
    return (window as any).pdfjsLib;
  }

  try {
    // 动态载入本地 pdf.js（通过运行时 import 避免构建期静态解析）
    const runtimeImport = new Function("u", "return import(u)");
    const pdfjs = await runtimeImport("/lib/pdfjs/pdf.mjs").catch(() => {
      // 兼容测试环境或直接静态服务路径
      return runtimeImport("/public/lib/pdfjs/pdf.mjs");
    });

    if (pdfjs) {
      (window as any).pdfjsLib = pdfjs;
      if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = "/lib/pdfjs/pdf.worker.mjs";
      }
    }
    return (window as any).pdfjsLib;
  } catch (err) {
    console.warn("[kookitLoader] 预加载 pdfjsLib 异常（非 PDF 阅读场景可忽略）:", err);
    return null;
  }
}

export async function loadKookit(): Promise<any> {
  if (kookitModulePromise) {
    return kookitModulePromise;
  }

  kookitModulePromise = (async () => {
    // 1. 契约 5: 先保证 pdfjsLib 挂载
    await ensurePdfjs();

    // 2. 动态导入自建纯净内核 Bundle
    const kookit = await import("../../vendor/kookit.esm");
    return kookit;
  })();

  return kookitModulePromise;
}
