/**
 * 翻页动效
 * ============
 * 目标：把「点一下、唰地换内容」的机械感换成一次能看见、但绝不拖沓的位移。
 *
 * 两条硬约束（果冻明确要求）：
 *   1. **一定要快**。「出去 60ms + 进来 130ms」≈ 190ms 总时长，
 *      比原生翻页的观感只多一点点，不会让人等。
 *   2. 不能挡住翻页本身。动画全部挂在 **iframe 元素**上（父文档能直接给它加
 *      transition），不去动书里的 DOM —— 书的内容是 epubjs/kookit 在管的，
 *      往 iframe 里注入动画类容易和它自己的渲染打架。
 *
 * 为什么不是「等动画播完再翻」：翻页是异步的（rendition.next() 要等渲染），
 * 真实耗时不确定。所以做成两段：
 *   · 第一段（出去）：立刻位移 + 压暗，让手指感到「这一下被接住了」；
 *   · 第二段（进来）：等内容换好，从反方向滑回原位 + 变亮。
 * 中途内容换了一点也看不出来 —— 因为换的瞬间正好是最暗、位移最大的时刻。
 */

export type TurnDirection = "next" | "prev";

const OUT_MS = 75;
const IN_MS = 140;
const OFFSET_PX = 56;

let activeCleanTimer: any = null;

/**
 * 找到要动画的目标：优先正文 iframe，退化为正文容器。
 *
 * ⚠️ 2026-09-17 实测：`.view-area-page` 这个类**在真实 DOM 里不存在**
 * （`containers/viewer` 渲染出来的是 `div.html-viewer-page#page-area`，
 * iframe 是 `iframe#kookit-iframe`），所以下面两个 query 全部落空、
 * `el` 恒为 null ⇒ 本模块的位移动画其实**一次都没播过**，只剩 `await doTurn()`。
 * 手机端已改走 `pageSwipeTurn.ts`（真正的跟手 + 平滑）；桌面端的翻页观感是既定
 * 基线（键盘/滚轮瞬间换页），按约定不动，因此这里**只留说明、不改选择器**。
 */
function getTurnTarget(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const iframe = document.querySelector(
    ".view-area-page iframe"
  ) as HTMLElement | null;
  if (iframe) return iframe;
  return document.querySelector(".view-area-page") as HTMLElement | null;
}

/** 清掉动画留下的内联样式，避免影响后续布局/缩放等既有逻辑 */
export function clearTurnStyles(el?: HTMLElement | null) {
  const target = el || getTurnTarget();
  if (target) {
    target.style.transition = "";
    target.style.transform = "";
    target.style.opacity = "";
    target.style.willChange = "";
  }
}

/**
 * 包一次翻页动作，给它配上极速平滑位移动效。
 * 纯横向平滑位移，绝不压暗/闪烁（不降 opacity，避免极速闪烁感），跟手自然。
 *
 * @param direction "next" 往左滑（内容向左走），"prev" 往右滑
 * @param doTurn    真正的翻页动作（rendition.next / prev）
 */
export async function withPageTurnAnimation(
  direction: TurnDirection,
  doTurn: () => Promise<unknown> | unknown
): Promise<void> {
  if (activeCleanTimer) {
    clearTimeout(activeCleanTimer);
    activeCleanTimer = null;
    clearTurnStyles();
  }

  const el = getTurnTarget();
  // next = 向前翻 = 新页从右边进来、旧页往左走
  const sign = direction === "next" ? -1 : 1;

  if (el) {
    try {
      el.style.willChange = "transform";
      el.style.transition = `transform ${OUT_MS}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
      el.style.transform = `translateX(${sign * OFFSET_PX}px)`;
    } catch (e) {
      // 忽略：拿不到元素就只做翻页，不做动画
    }
  }

  try {
    await doTurn();
  } finally {
    if (el) {
      try {
        // 先无过渡地跳到反方向的起点，再放开过渡平滑滑回 0 —— 纯位移平滑入场
        el.style.transition = "none";
        el.style.transform = `translateX(${-sign * OFFSET_PX}px)`;
        void el.offsetWidth; // 强制回流，保证进入过渡生效
        el.style.transition = `transform ${IN_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`;
        el.style.transform = "translateX(0)";
        activeCleanTimer = window.setTimeout(() => {
          clearTurnStyles(el);
          activeCleanTimer = null;
        }, IN_MS + 40);
      } catch (e) {
        clearTurnStyles(el);
      }
    }
  }
}

/**
 * 面板/工具栏的统一缓动参数。
 * 收到 200ms 左右 + 出快入慢的曲线，既有位移感又不拖节奏。
 */
export const PANEL_TRANSITION_MS = 200;
