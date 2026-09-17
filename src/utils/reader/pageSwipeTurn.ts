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
 *
 * ── 另外两套「纵向拉一把」的手势（2026-09-17 追加）──────────────────────────
 * 它们与前两条无关，共用同一组 `PULL_*` 手感常量（果冻要求「手感一致」）：
 *   1. **分页模式 · 向下拉 = 加/撤书签**（`TOGGLE_BOOKMARK_BY_GESTURE_EVENT`）；
 *   2. **滑动模式 · 贴到章末继续上滑 / 贴到章首继续下滑 = 换章**
 *      （`TURN_CHAPTER_BY_GESTURE_EVENT`）。
 * 两者的「动作」都在这里（跟手平移 `#page-area` + 越阈值回弹），
 * 「判断」都在 `pages/reader` 那一侧（书签库、换章、i18n 提示它才有）。
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
 * 【下拉手势】三套下拉（加标签 / 换下一章 / 换上一章）**共用同一组手感常量** ——
 * 果冻的要求就是「手感可以模仿滑出标签的方式」，所以刻意不做成三份参数。
 */
/** 手指越界多少像素算「够到阈值」 */
const PULL_THRESHOLD = 72;
/** 在这个位移内页面**严格跟手**（1:1 跟手指走） */
const PULL_MAX = 150;
/** 越过 PULL_MAX 之后的阻尼（越小越"拉不动"，给"到头了"的手感） */
const PULL_OVER_DAMP = 0.3;
/** 回弹动画时长 */
const PULL_SNAP_MS = 220;

/**
 * 手势 ⇒ 标签的开关键，由 `pages/reader` 那一侧监听。
 * 约定：**当前页没有标签就加上，已经有就撤掉**（果冻的原话是「再次下滑取消标签」）。
 */
export const TOGGLE_BOOKMARK_BY_GESTURE_EVENT = "coread-toggle-bookmark-by-gesture";

/**
 * 手势 ⇒ 换章的开关键，同样由 `pages/reader` 监听。
 * `detail.dir` = `"next"`（贴到章末继续上滑）/ `"prev"`（贴到章首继续下滑）。
 *
 * 为什么换章不像分页模式的跨章那样直接在这里调 `rendition.next()`：
 * 一是「已经是最后一章 / 第一章」时内核是**静默 return**（`handleNextChapter` 里
 * `chapterDocIndex >= length-1` 只把 percentage 写 1 就返回），用户只会看到
 * 一次拉不动又弹回去，分不清是到头了还是坏了 —— 交给页面层才好给提示；
 * 二是页面层才有 `t()` 和 `toast`。
 */
export const TURN_CHAPTER_BY_GESTURE_EVENT = "coread-turn-chapter-by-gesture";

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
 * 找到 iframe 外面那层「页面壳」—— 下拉手势要跟手下移的是它，不是书文档本身。
 * 真实 DOM 是 `div.html-viewer-page#page-area > iframe#kookit-iframe`，
 * 在 iframe 内部用 `frameElement` 就能拿到自己的壳（同源，拿得到）。
 */
function getPageShell(win: any): HTMLElement | null {
  try {
    const frame: HTMLElement | null =
      win && win.frameElement ? win.frameElement : null;
    if (!frame) return null;
    const shell =
      (frame.closest && frame.closest("#page-area")) || frame.parentElement;
    return (shell as HTMLElement) || null;
  } catch (err) {
    return null;
  }
}

/** 把「页面壳」纵向平移（下拉回弹用），同样是 rAF 缓动 */
function animateTranslateY(
  el: HTMLElement,
  from: number,
  to: number,
  ms: number
): Promise<void> {
  return new Promise<void>((resolve) => {
    const t0 = performance.now();
    const ease = (p: number) => 1 - Math.pow(1 - p, 3);
    const tick = (now: number) => {
      const p = Math.max(0, Math.min(1, (now - t0) / Math.max(1, ms)));
      el.style.transform = `translateY(${from + (to - from) * ease(p)}px)`;
      if (p < 1) {
        requestAnimationFrame(tick);
      } else {
        el.style.transform = "";
        el.style.transition = "";
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
 *
 * **两种阅读模式各管一套手势（同一个监听器里分叉，不会互相抢）：**
 *   · 分页（single / double）：横拖跟手翻页 + 下滑加/撤标签（见 §H / §J）；
 *   · 滑动（scroll）：纵向滚动完全交回原生，**只在「已经贴到章末/章首还要继续拖」时**
 *     接管成换章（`TURN_CHAPTER_BY_GESTURE_EVENT`）。手感与「下拉加标签」共用同一组
 *     PULL_* 常量，也就是果冻要的「模仿滑出标签的方式」。
 */
export function bindPageSwipeTurn(
  rendition: any,
  doc: any,
  readerMode: string
): void {
  if (!isMobileRuntime()) {
    return;
  }
  if (!doc || !doc.body || !rendition) {
    return;
  }
  // 当前阅读模式挂在 doc 上，**每次调用都刷新**：万一内核复用了同一个 iframe
  // （没重建 doc）而用户刚切了「视图模式」，手势读到的也一定是最新模式。
  // 分页模式与滑动模式的手势是两套（见 onMove 里的分叉），读错了会互相打架。
  const modeStr: "scroll" | "paged" = readerMode === "scroll" ? "scroll" : "paged";
  (doc as any).__coreadSwipeTurnMode = modeStr;
  if ((doc as any).__coreadSwipeTurnBound) {
    return;
  }
  (doc as any).__coreadSwipeTurnBound = true;

  /** 取「此刻」的阅读模式（不是绑定那一刻的），理由见上 */
  const isScrollMode = () => (doc as any).__coreadSwipeTurnMode === "scroll";

  const body = doc.body as HTMLElement;
  const win: any = doc.defaultView || window;
  let mode: "idle" | "h" | "v" | "pull" | "done" = "idle";
  let startX = 0;
  let startY = 0;
  let origin = 0;
  let startT = 0;
  let busy = false;
  /**
   * 横向拖动时**未经阻尼**的手指位移（正=往后翻）。
   * 🔴 必须用这个判阈值，不能用 `body.scrollLeft` 的实际变化量：
   * 本章最后一页继续往后拖时会走「橡皮筋」分支（只走 0.35 倍），
   * 实测拖 100px 实际只挪 35px，折算比例 0.093 —— 永远够不到 0.22 的阈值，
   * 于是 `pages` 恒为 0，跨章那一下永远不触发（这就是「跨章只能点、不能滑」）。
   * 用原始手指位移判阈值，跟手阻尼只负责观感，两件事分开。
   */
  let rawMove = 0;
  /** 纵向「拉一把」要平移的那层壳（iframe 外层 #page-area） */
  let pullEl: HTMLElement | null = null;
  /** 这次纵向拉拽属于哪一种：加撤标签 / 换下一章 / 换上一章 */
  let pullKind: "bookmark" | "next" | "prev" = "bookmark";
  /**
   * 拉拽位移的**基准手指位置**（`clientY`）。
   * 分页模式在手势起点设一次；滑动模式在「贴到章末/章首那一刻」设 ——
   * 后者是因为滚到底之前手指已经走了很长一段路，不重设基准的话
   * 一贴边 dy 就是几百像素，阈值瞬间满足，滚到底那一下会凭空换章。
   */
  let pullBaseY = 0;
  /** 拉拽过程中当前的视觉位移（**带符号**，回弹时要用它当起点） */
  let pullY = 0;
  /** 本次下拉是否已经越过阈值并触发过（保证一次手势只触发一次） */
  let pullTriggered = false;

  /**
   * 滑动阅读：判断这次纵向拖动是不是「已经贴到本章顶/底、还要继续拖」。
   * 是的话把要平移的壳挂到 `pullEl` 上并返回方向，否则返回空串（交回原生滚动）。
   *
   * 🔴 边界判据**刻意比内核严一档**，保证触发时内核一定走「换章」分支：
   *   · `next()` 要求 `|scrollHeight - scrollTop - clientHeight| < 20` ⇒ 我们用 `<= 2`；
   *   · `prev()` 要求 `scrollTop === 0`（**严格等于**）⇒ 我们用 `<= 0`。
   *   宽一档的话内核会去走「滚一屏」分支，表现为拉了却只滚半页。
   */
  const pickScrollPull = (dy: number): "next" | "prev" | "" => {
    const shell = getPageShell(win);
    if (!shell) {
      return "";
    }
    const maxTop = Math.max(0, shell.scrollHeight - shell.clientHeight);
    const top = shell.scrollTop;
    if (dy < 0) {
      // 手指上滑 = 内容往上走 = 往本章后面读；贴到最底才接管
      if (maxTop <= 0 || maxTop - top > 2) {
        return "";
      }
    } else {
      // 手指下滑 = 往回读；贴到最顶才接管
      if (top > 0) {
        return "";
      }
    }
    pullEl = shell;
    return dy < 0 ? "next" : "prev";
  };

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
    rawMove = 0;
    pullEl = null;
    pullBaseY = t.clientY;
    pullY = 0;
    pullTriggered = false;
    pullKind = "bookmark";
  };

  const onMove = (e: TouchEvent) => {
    if (
      mode === "v" ||
      mode === "done" ||
      busy ||
      !e.touches ||
      e.touches.length !== 1
    ) {
      return;
    }
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if (mode === "idle") {
      const verticalIntent =
        Math.abs(dy) > V_ABORT_PX && Math.abs(dy) >= Math.abs(dx);

      if (isScrollMode()) {
        // ── 滑动阅读模式 ────────────────────────────────────────────────
        // 实测：滚动容器是**外层 `#page-area`**（`overflow-y:auto`，scrollHeight 29767 /
        // clientHeight 778），iframe 被内核撑到整篇高度、内部 body 根本不滚
        // （body.clientHeight === body.scrollHeight === 29765）。
        // 所以这里只认「贴到章末/章首还要继续拖」这一种情形，其余一律不接管，
        // 让原生滚动照常工作（否则正常阅读的滑动会被吃掉）。
        if (!verticalIntent) return;
        const kind = pickScrollPull(dy);
        if (!kind) {
          // 还没贴边 ⇒ 这次移动不归我们，但**刻意不锁死**（不置 "v"）：
          // 用户「一路滚到章末、手指还没抬就继续拖」时，下一帧就能接上换章。
          // 置 "v" 的话必须松手再拖一次才生效，手感上会像"第一次没反应"。
          return;
        }
        // 划选中不接管（长按选词后往下拖是扩大选区）
        const selScroll = doc.getSelection && doc.getSelection();
        if (selScroll && String(selScroll).length > 0) {
          mode = "v";
          return;
        }
        // 位移基准重设在「贴边那一刻」（理由见 pullBaseY 的声明）
        pullBaseY = t.clientY;
        pullKind = kind;
        mode = "pull";
      } else if (verticalIntent) {
        if (dy <= 0) {
          mode = "v"; // 上滑不归我们管，交回原来的逻辑
          return;
        }
        // 正在划选文字时不接管：长按选词后的「往下拖」是扩大选区，
        // 跟我们的下拉长得一样，必须让位给选区（否则拖一下就多一个书签）。
        const pullingSel = doc.getSelection && doc.getSelection();
        if (pullingSel && String(pullingSel).length > 0) {
          mode = "v";
          return;
        }
        // 下滑 ⇒「下拉加标签」：整页跟手下移，越过阈值就落标签并回弹
        const shell = getPageShell(win);
        if (!shell) {
          mode = "v";
          return;
        }
        pullKind = "bookmark";
        pullEl = shell;
        mode = "pull";
      } else if (Math.abs(dx) <= H_INTENT_PX || Math.abs(dx) <= Math.abs(dy)) {
        return;
      } else {
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
    }

    if (mode === "pull") {
      // 压掉原生默认：分页模式下是浏览器的下拉刷新／overscroll；
      // 滑动模式下这一步更关键 —— 它是**唯一**能压住外层 #page-area 继续滚动的开关
      // （实测：iframe 里 preventDefault 后外层 scrollTop 纹丝不动，见 2026-09-17 探针）。
      e.preventDefault();
      // 前 PULL_MAX 像素严格跟手（1:1 跟手指走，观感才是"页面被拽下来了"），
      // 再往下加阻尼，给"拉到头"的手感。
      // 三种拉拽统一按「离基准的手指位移」算；反向拖回去就跟着缩回来（不会出负拉伸）。
      const rawPdy = t.clientY - pullBaseY;
      const signedPdy =
        pullKind === "next" ? Math.min(0, rawPdy) : Math.max(0, rawPdy);
      const dist = Math.abs(signedPdy);
      const y = dist <= PULL_MAX ? dist : PULL_MAX + (dist - PULL_MAX) * PULL_OVER_DAMP;
      // 「换下一章」是手指上滑 ⇒ 整页跟着往上走（负）；加标签 / 换上一章都是向下为正
      pullY = pullKind === "next" ? -y : y;
      if (pullEl) {
        pullEl.style.transition = "none";
        pullEl.style.transform = `translateY(${pullY}px)`;
      }
      if (!pullTriggered && dist >= PULL_THRESHOLD) {
        pullTriggered = true;
        try {
          // 交给 pages/reader 那一侧去做决定 —— 书签库与换章都在它手里
          (win.parent || window).dispatchEvent(
            pullKind === "bookmark"
              ? new CustomEvent(TOGGLE_BOOKMARK_BY_GESTURE_EVENT)
              : new CustomEvent(TURN_CHAPTER_BY_GESTURE_EVENT, {
                  detail: { dir: pullKind },
                })
          );
        } catch (err) {
          /* 跨窗口派发失败不影响回弹 */
        }
        // 越过阈值即刻生效 + 回弹，手感像「拉到头，咔哒一下」
        if (pullEl) {
          animateTranslateY(pullEl, pullY, 0, PULL_SNAP_MS);
        }
        mode = "done";
      }
      return;
    }

    e.preventDefault();

    // 手指左移 => 内容左移 => 往后翻（rawMove 是手指原始位移，跟手用阻尼后的）
    rawMove = -dx;
    const step = pageStep(body);
    let move = rawMove;
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
    if (mode === "pull") {
      // 没够到阈值就松手：整页弹回去，不加标签也不换章（pullY 带符号，别判 >0）
      const el = pullEl;
      const y = pullY;
      mode = "idle";
      pullEl = null;
      pullY = 0;
      if (el && y !== 0) {
        animateTranslateY(el, y, 0, PULL_SNAP_MS);
      }
      return;
    }
    if (mode === "done") {
      // 阈值已经在 move 阶段处理过了（派发了事件 + 回弹），这里只需收尾
      mode = "idle";
      pullEl = null;
      pullY = 0;
      return;
    }
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
      // 🔴 阈值必须按**未阻尼的手指位移**算，不能按 `from - origin`（实际滚动量）：
      // 本章最后一页继续往后拖走橡皮筋分支，只落实 0.35 倍位移，
      // 拖 100px 只挪 35px ⇒ 折算比例 0.09，永远够不到 0.22 ⇒ pages 恒 0 ⇒
      // 跨章那一下永远不触发（这就是「跨章只能点、不能滑」的根因）。
      const move = rawMove;
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
    // 拉拽被打断（来电、多指）时也要把壳弹回去，别让它卡在偏移位置。
    // （"done" 不用管：那一步的回弹动画已经在 onMove 里起来了，再起一次会往回跳）
    if (mode === "pull" && pullEl && pullY !== 0) {
      animateTranslateY(pullEl, pullY, 0, PULL_SNAP_MS);
    }
    pullEl = null;
    pullY = 0;
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
