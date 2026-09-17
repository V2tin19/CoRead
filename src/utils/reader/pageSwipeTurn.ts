/**
 * 手机端「跟手翻页」—— 平滑滑动 + 落页吸附
 * ==========================================
 * 果冻的要求（2026-09-17）：**不做拟真翻页，只要平滑滑动，而且必须跟手。**
 *
 * 为什么不能沿用原来的两条路（实测结论，见 .workbuddy/memory/2026-09-17.md §15）：
 *
 * 1. **内核在手机端根本不滑。** kookit 的翻页落点函数 `yt()` 里写死了
 *    `behavior: "sliding"===t && "yes"!==s ? "smooth" : "auto"` —— 我们给内核传
 *    `isMobile:"yes"`，所以永远是 `auto`：一帧到位。实测每次翻页就是一条
 *    `scrollTo({left: 376, behavior:"auto"})`。这就是「极速的闪动」。
 * 2. **浏览器也不会帮我们滑。** 内核给书文档注入的是
 *    `html{overflow:hidden; touch-action:none}`（实测 `compatMode:"BackCompat"`，
 *    `document.scrollingElement === BODY`），原生拖动被彻底关掉；
 *    工程里也没有任何代码在 touchmove 里改 scrollLeft ⇒ 手指拖动时画面纹丝不动。
 * 3. **`pageTurnAnimation.withPageTurnAnimation` 一直是空转。** 它找
 *    `.view-area-page`，而这个类在当前 DOM 里不存在（真实是 `.html-viewer-page`
 *    / `#page-area` + `iframe#kookit-iframe`），`el` 恒为 null ⇒ 整个函数只剩
 *    `await doTurn()`。所以「闪动」里没有它的份，它也没提供过任何平滑。
 *
 * 本模块的做法（不改内核、不改桌面端）：
 *   · **跟手**：touchmove 里直接写 iframe 内 `body.scrollLeft`。书的排版是一条
 *     横向列带（实测 41 页共 `scrollWidth 15388`），相邻页本来就在旁边，
 *     拖到哪儿就显示到哪儿 —— 是真跟手，不是把整个 iframe 平移糊弄。
 *   · **平滑**：抬手后用 rAF 自己缓动到目标页（内核那套 auto 跳动不再参与）。
 *   · **记正当给内核**：不自己维护页码，而是滚动完调一次 `rendition.record()`。
 *     内核的 `Qt()` 是「按当前可见内容反推位置」——它取当前页第一个可见块，
 *     写 text / count / xpath / percentage。所以自己滚动之后再 record，
 *     进度、页码、涂鸦归属、协作广播全都自动对得上。
 *
 * 三条硬约束：
 *   · **一次手势恒定一页**（`pages` 夹在 ±1）。这正是「滑一页跳很多页」的解药。
 *   · 拖动位移超过一页后加阻尼（`OVER_DRAG_DAMP`），给「到头了」的手感，
 *     也保证松手时的回正量很小。
 *   · 桌面端一步不碰：本模块所有入口第一行都是 `isMobileRuntime()` 守卫。
 */

import { isMobileRuntime } from "../mobileRuntime";

/** 判定为横向手势所需的最小位移（px） */
const H_INTENT_PX = 8;
/** 先竖向走了这么多就放弃接管（把竖向留给别的逻辑） */
const V_ABORT_PX = 12;
/** 拖过页宽的这个比例就翻页 */
const TURN_RATIO = 0.22;
/** 或者速度超过这个值（px/ms）就翻页——轻扫也能翻 */
const TURN_VELOCITY = 0.35;
/** 吸附/回弹动画时长 */
const SNAP_MS = 200;
/** 拖过一整页之后的阻尼系数（越小越"拉不动"） */
const OVER_DRAG_DAMP = 0.25;

/**
 * 页步长：**刻意与内核 `yt()` 用同一个口径**（`clientWidth + 偶数化的 clientWidth/12`）。
 *
 * 实测 390×844 视口下 clientWidth=348、间距=28、步长=376，内核落点也正好是
 * 376 的整数倍。跟随内核口径，才能保证我们算出来的目标页是内核认可的页边界 ——
 * 否则 record() 记下来的位置会和实际画面差一页。
 */
function pageStep(body: HTMLElement): number {
  const raw = Math.floor(body.clientWidth / 12);
  const gap = raw % 2 === 0 ? raw : raw - 1;
  return body.clientWidth + gap;
}

function maxScrollOffset(body: HTMLElement): number {
  return Math.max(0, body.scrollWidth - body.clientWidth);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 用 rAF 把 scrollLeft 从 from 缓动到 to（ease-out cubic，收尾不拖泥带水）。
 * 不动 CSS transition：书正文的滚动容器是 body，给它挂 transition 会波及所有
 * 定位类滚动（含跨章重排后的归零），rAF 只影响这一次动画。
 */
function animateScrollLeft(
  el: HTMLElement,
  from: number,
  to: number,
  ms: number
): Promise<void> {
  return new Promise<void>((resolve) => {
    if (Math.abs(to - from) < 1) {
      el.scrollLeft = to;
      resolve();
      return;
    }
    const t0 = performance.now();
    const ease = (p: number) => 1 - Math.pow(1 - p, 3);
    const tick = (now: number) => {
      // ⚠️ 必须夹到 [0,1]：rAF 回调拿到的时间戳是「本帧开始时刻」，可能比注册时的
      // performance.now() 还早几毫秒。不夹的话首帧 p<0 → (1-p)^3>1 → ease<0，
      // 会在动画起点反向多走十几像素（实测 376→363 这种回跳），看着就是一帧抖动。
      const p = Math.max(0, Math.min(1, (now - t0) / Math.max(1, ms)));
      el.scrollLeft = from + (to - from) * ease(p);
      if (p < 1) {
        requestAnimationFrame(tick);
      } else {
        el.scrollLeft = to;
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });
}

/**
 * 手机端「平滑翻一页」。点按分区（左右三分之一点击）也走这里，
 * 让点击翻页和滑动翻页的观感一致。
 *
 * @returns true  = 已经在同一篇文档内平滑滑过去，并且已经 record() 记好位置
 *          false = 到本章头/尾了，需要调用方交回内核处理跨章（content 整体替换，
 *                  做不了位移动画，只能硬切）
 */
export async function smoothPageTurn(
  rendition: any,
  doc: any,
  dir: "next" | "prev"
): Promise<boolean> {
  if (!isMobileRuntime() || !doc || !doc.body || !rendition) {
    return false;
  }
  const body = doc.body as HTMLElement;
  const step = pageStep(body);
  const max = maxScrollOffset(body);
  if (step <= 0 || max <= 0) {
    return false; // 不是横向分页（单页/滚动），交回内核
  }
  const cur = Math.round(body.scrollLeft / step) * step;
  const target = dir === "next" ? cur + step : cur - step;
  if (target < 0 || target > max || Math.abs(target - cur) < 1) {
    return false; // 本章首尾，交给内核翻章
  }
  await animateScrollLeft(body, body.scrollLeft, target, SNAP_MS);
  // 内核按「当前可见内容」重新记账：进度 / 页码 / 涂鸦归属 / 协作广播都靠它。
  // 注意 record() 自带 100ms 重入闸（源码里的 ft），所以动画时长(200ms)天然错开，
  // 连续翻页不会互相吞掉。
  await rendition.record();
  return true;
}

/**
 * 绑定触摸拖动。由 `mouseEvent.bindHtmlEvent` 在拿到 iframe 文档时调用，
 * 每个文档只绑一次（调用方用 WeakSet 兜底）。
 *
 * 手机端启用后，Hammer 的 swipe 必须同时关掉（见 mouseEvent.ts）——
 * 否则一次滑动会被两边各消费一次，直接翻两页。
 */
export function bindPageSwipeTurn(
  rendition: any,
  doc: any,
  readerMode: string
): void {
  if (!isMobileRuntime()) {
    return;
  }
  if (readerMode === "scroll") {
    return; // 滑动阅读本身就是滚动，别再抢
  }
  if (!doc || !doc.body || !rendition) {
    return;
  }
  if ((doc as any).__coreadSwipeTurnBound) {
    return;
  }
  (doc as any).__coreadSwipeTurnBound = true;

  const body = doc.body as HTMLElement;
  const win: any = doc.defaultView || window;
  let mode: "idle" | "h" | "v" = "idle";
  let startX = 0;
  let startY = 0;
  let origin = 0;
  let startT = 0;
  let busy = false;

  const onStart = (e: TouchEvent) => {
    if (busy || !e.touches || e.touches.length !== 1) {
      mode = "v";
      return;
    }
    const t = e.touches[0];
    mode = "idle";
    startX = t.clientX;
    startY = t.clientY;
    startT = performance.now();
    origin = body.scrollLeft;
  };

  const onMove = (e: TouchEvent) => {
    if (mode === "v" || busy || !e.touches || e.touches.length !== 1) {
      return;
    }
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if (mode === "idle") {
      if (Math.abs(dy) > V_ABORT_PX && Math.abs(dy) >= Math.abs(dx)) {
        mode = "v";
        return;
      }
      if (Math.abs(dx) <= H_INTENT_PX || Math.abs(dx) <= Math.abs(dy)) {
        return;
      }
      // 正在划选文字时不接管（选区是另一套交互）
      const sel = doc.getSelection && doc.getSelection();
      if (sel && String(sel).length > 0) {
        mode = "v";
        return;
      }
      // 长按起手：安卓上「按住不动 → 拖」是选词手势（长按阈值约 500ms），
      // 不是翻页。真的滑动会在几十毫秒内越过 H_INTENT_PX，所以「已经按了
      // 450ms 还几乎没位移」就放行给原生选区，别把选词抢成翻页。
      if (performance.now() - startT > 450 && Math.abs(dx) < 24) {
        mode = "v";
        return;
      }
      mode = "h";
      // 内核的笔记/脚注处理器靠这个标志区分「划动」和「点按」，
      // 不设的话划过笔记图标会弹菜单（内核自己的触摸实现里有这一步）。
      (win as any).isSwiping = true;
    }

    e.preventDefault();

    // 手指左移 => 内容左移 => 往后翻
    const step = pageStep(body);
    let move = -dx;
    const overshoot = Math.abs(move) - step;
    if (overshoot > 0) {
      move = Math.sign(move) * (step + overshoot * OVER_DRAG_DAMP);
    }
    const max = maxScrollOffset(body);
    let target = origin + move;
    if (target < 0) {
      target *= 0.35; // 首页往前拖：橡皮筋
    } else if (target > max) {
      target = max + (target - max) * 0.35; // 末页往后拖：橡皮筋
    }
    body.scrollLeft = target;
  };

  const onEnd = async () => {
    if (mode !== "h") {
      mode = "idle";
      (win as any).isSwiping = false;
      return;
    }
    mode = "idle";
    busy = true;
    try {
      const step = pageStep(body);
      const max = maxScrollOffset(body);
      const from = body.scrollLeft;
      const dt = Math.max(1, performance.now() - startT);
      const move = from - origin;
      const ratio = move / step;
      const velocity = move / dt;

      let pages = 0;
      if (ratio >= TURN_RATIO || velocity >= TURN_VELOCITY) {
        pages = 1;
      } else if (ratio <= -TURN_RATIO || velocity <= -TURN_VELOCITY) {
        pages = -1;
      }

      // 起点页（内核落点都是步长整数倍，这里先归一到网格，避免误差累积）
      const originPage = clamp(Math.round(origin / step) * step, 0, max);
      const target = clamp(originPage + pages * step, 0, max);

      if (pages !== 0 && Math.abs(target - originPage) >= 1) {
        // 同一篇文档内：跟手 → 平滑滑到目标页
        await animateScrollLeft(body, from, target, SNAP_MS);
        await rendition.record();
      } else if (pages !== 0) {
        // 已在本文档首/尾，位移翻不动了 => 交给内核跨章（内容整体替换，硬切）
        if (pages > 0) {
          await rendition.next();
        } else {
          await rendition.prev();
        }
      } else {
        // 没到阈值：平滑回弹
        await animateScrollLeft(body, from, originPage, SNAP_MS);
      }
    } catch (err) {
      // 翻页失败不该卡住交互：至少把位置归位，别让页面停在半页上
      try {
        const step = pageStep(body);
        const max = maxScrollOffset(body);
        body.scrollLeft = clamp(Math.round(origin / step) * step, 0, max);
      } catch (e) {
        /* 忽略 */
      }
    } finally {
      busy = false;
      (win as any).isSwiping = false;
    }
  };

  const onCancel = () => {
    mode = "idle";
    busy = false;
    (win as any).isSwiping = false;
  };

  doc.addEventListener("touchstart", onStart, { passive: true });
  // 必须非 passive：横向拖动时要 preventDefault，否则浏览器会插入自己的手势处理
  doc.addEventListener("touchmove", onMove, { passive: false });
  doc.addEventListener("touchend", onEnd, { passive: true });
  doc.addEventListener("touchcancel", onCancel, { passive: true });
}
