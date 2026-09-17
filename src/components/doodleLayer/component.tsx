import React from "react";
import "./doodleLayer.css";
import { saveAs } from "file-saver";
import toast from "react-hot-toast";
import {
  collectAllDoodlePages,
  collectFuzzyStrokes,
  getDoodlePageKey,
  getDoodlePageSpan,
  getDoodlePercentage,
  isDoodleLiveEnabled,
  isDoodleSyncEnabled,
  loadDoodlePage,
  newStrokeId,
  parseDoodlePageKey,
  saveDoodlePage,
  DoodleStroke,
} from "../../utils/file/doodleUtil";
import collabClient from "../../utils/collab/collabClient";
import { getOrCreateDisplayName } from "../../utils/collab/roomBook";
import { isMobileRuntime } from "../../utils/mobileRuntime";

// 随心笔记(涂鸦)浮层 —— v3
//
// 三件事跟 v2 不同：
//
// 1) 画布锚在「书页」上，不再是整块屏幕。
//    v2 的 canvas 是 position:fixed inset:0，坐标按窗口归一化 —— 笔记其实写在
//    「屏幕」上：开个侧栏、改个窗口大小，笔记就跟正文错位，视觉上也不像写在纸上。
//    v3 把画布贴到 #page-area（真正的书页容器）的实际矩形上，坐标按书页归一化。
//
// 2) 一页笔记就是一页。v2 的换页逻辑把「上一页的笔迹」并进了新页并回写到新页
//    key 下，导致翻页后上一页的笔记还在，而且会顺着章节一路复制下去。
//    现在每条笔迹自带 pageKey，换页时只带「本次换页期间新画的」笔迹。
//
// 3) 多人共读时能分清是谁画的：笔迹按作者分色列出图例，可以单独显示/隐藏某人，
//    还能看到「房间里还有几页有别人的笔记」。开关在共读面板的「同步涂鸦」。
//
// 3.1) 工具条从「屏幕底部悬浮」搬到「顶部页眉」。
//    底部那条原来会压住正文最后几行（用户反馈「画板挡住电子书内容」）。
//    现在它是一条高 38px 的顶部条（窄屏 34px，与右上角页眉同高），
//    小于正文起始留白 42px（.html-viewer-page 的 top:42px），所以永远不遮字。
//    右边界让开右上角常驻图标（宽度由阅读器实测下发），页眉变成
//    「[涂鸦控制条] [共读/更多/…]」一条。原来第二行的作者图例 / 本页笔数 /
//    共读状态不删，全部压成同一行的紧凑信息簇（窄屏整条可横向滚动）。
//
// 定位：pageKey = 章节 + 章内第几屏。坐标 0~1 归一化；每条笔迹额外记 aspect
// (页面 高/宽)，页面比例变了就等比缩放，不会把笔迹拉扁。

const COLORS = ["#1f1f1f", "#e5484d", "#3b82f6", "#22c55e", "#f59e0b"];
// 四档笔刷：2 是「更细」那一档
const SIZES = [2, 4, 8, 16];
// 翻页检测：翻章/翻页事件为主，轮询兜底（滚动模式不一定触发事件）
const PAGE_POLL_MS = 1500;
// 书页矩形跟随：开合侧栏、缩放、窗口变化都会挪书页，画布要跟着走
const ANCHOR_POLL_MS = 400;
const SAVE_DEBOUNCE_MS = 400;
// 「一笔一划」实时同步：画的过程中按这个间隔把新增的点推给同伴
const LIVE_SYNC_MS = 50;

interface DoodleAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface DoodleLayerProps {
  bookKey: string;
  rendition: any;
  onClose: () => void;
  /** 工具条右边界（px）：要让开右上角那排常驻图标，否则两条会叠在一起。
   *  由阅读器实测 #reader-top-dock 的宽度后下发，拿不到就退回默认值。 */
  headerRight?: number;
  /** 是否处于「滑动阅读」模式（readerMode === "scroll"）。
   *  为真说明正文滚动是原生的（容器是外层 `#page-area`），画布不能吃掉触摸，
   *  否则书就翻不动了 —— 所以这种情况下默认进「浏览态」，并且要在滚动时
   *  按屏刷新笔迹归属。 */
  scrollMode?: boolean;
  /** 初始是否「浏览态」。滑动阅读下传 true：一进来就吃掉触摸的话，
   *  用户第一下滚动会发现书页拖不动。 */
  defaultView?: boolean;
  /** 深色纸张下换成深色底衬，跟阅读器页眉保持一致 */
  dark?: boolean;
  /** 手机端：工具条收进左侧抽屉，展开状态由阅读器（顶栏的「随心笔记」按钮）持有 */
  drawerOpen?: boolean;
  /** 手机端：请求开合抽屉（关闭键、遮罩、左边缘把手共用） */
  onDrawerToggle?: () => void;
}

interface DoodleLayerState {
  mode: "draw" | "view";
  color: string;
  size: number;
  strokes: DoodleStroke[];
  pageKey: string;
  isSaving: boolean;
  /** 书页矩形的视口坐标；null = 还没量到，退回整屏 */
  anchor: DoodleAnchor | null;
  /** 当前书页的 高/宽 —— 新笔迹记下来，用于跨设备等比还原 */
  pageAspect: number;
  /** 被手动隐藏的作者 id（只想看某一两个人的笔迹时用） */
  hiddenAuthors: string[];
  /** 房间里除自己以外、有笔迹的页数 */
  peerPages: number;
  /** 导出弹窗开关 */
  exportOpen: boolean;
  /** 导出弹窗里的全书统计；null = 还在算 */
  exportSummary: DoodleExportSummary | null;
  /** 导出进行中（生成图片/读存储时有耗时，按钮要禁用防连点） */
  exportBusy: boolean;
}

/** 导出弹窗里显示的全书统计（打开时才去算） */
interface DoodleExportSummary {
  pages: number;
  strokes: number;
  authors: string[];
}

interface DoodleAuthor {
  id: string;
  name: string;
  color: string;
  count: number;
}

// 同一 id 的笔迹只留一份（后到的覆盖先到的）
function dedupeById(strokes: DoodleStroke[]): DoodleStroke[] {
  const byId = new Map<string, DoodleStroke>();
  const noId: DoodleStroke[] = [];
  for (const stroke of strokes) {
    if (!stroke) continue;
    if (stroke.id) byId.set(stroke.id, stroke);
    else noId.push(stroke);
  }
  return Array.from(byId.values()).concat(noId);
}

// 房间里有哪些页上有「别人的」笔迹
function collectPeerPages(
  doodles: Record<string, any[]>,
  bookKey: string,
  myId: string
): Set<string> {
  const pages = new Set<string>();
  for (const pageKey of Object.keys(doodles || {})) {
    const hasPeer = (doodles[pageKey] || []).some(
      (stroke) =>
        stroke &&
        (!stroke.bookKey || stroke.bookKey === bookKey) &&
        stroke.authorId &&
        stroke.authorId !== myId
    );
    if (hasPeer) pages.add(pageKey);
  }
  return pages;
}

// 页 key → 这一页的笔迹的缓存上限。翻回去时直接上屏，不用等磁盘/网络；
// 上限 60 页：大书长时间阅读时，翻过的页会一直累积，不淘汰内存只涨不落。
const PAGE_CACHE_MAX = 60;

class DoodleLayer extends React.Component<DoodleLayerProps, DoodleLayerState> {
  private canvasRef: HTMLCanvasElement | null = null;
  private drawing = false;
  private currentPoints: number[][] = [];
  private saveTimer: any = null;
  private pollTimer: any = null;
  private anchorTimer: any = null;
  // 滑动阅读专用：正文滚动容器（外层 #page-area）的 scroll 监听与节流定时器
  private scrollTarget: HTMLElement | null = null;
  private scrollHandler: (() => void) | null = null;
  private scrollThrottleTimer: any = null;
  private resizeObserver: ResizeObserver | null = null;
  // 翻页切换的并发闸门（见 switchPageIfNeeded）
  private switching = false;
  // 切换进行中又收到翻页请求：记下来，等这一轮结束再补一次，避免快速连翻漏页
  private switchPending = false;
  // 页 key → 这一页的笔迹。翻回去时直接上屏，不用等磁盘/网络
  private pageCache = new Map<string, DoodleStroke[]>();
  // 本次切页期间「新冒出来」的笔迹 id（自己刚画的 + 同伴刚广播来的）。
  // 后台把这一页的真实数据取回来时会整体覆盖 state，这些还没进存储的必须保住。
  private carriedIds = new Set<string>();
  // 正在切换的目标页 key。页面视觉上已经翻过去了、但 state 还没提交的这段窗口里
  // 新画的笔迹，应该算在新页头上（否则用户会看到刚画的一笔"闪一下就没了"）
  private switchTargetKey = "";
  // 「仅展示」笔迹（跨设备页号对不上、按进度收编进来的）。它们不属于本页的
  // 存储,落盘/撤销/清空时都要剔除,否则会以本页 pageKey 复制进存储
  private displayOnlyIds = new Set<string>();
  private destroyed = false;
  // 房间里有别人笔迹的页集合（换页时从服务端刷新，实时事件里增量维护）
  private peerPageSet = new Set<string>();

  // ── 「一笔一划」实时同步用的状态 ──────────────────────────────────
  // 正在画的这一笔的 id（下笔时就定下来，收笔时复用，同伴那边才能把
  // 「过程中的增量」和「最终完整笔迹」对上号）
  private liveId = "";
  // 已经推送给同伴的点数：下次只推 liveSentCount 之后的
  private liveSentCount = 0;
  // 这一笔的推送序号（单调递增）。同伴按它丢弃乱序/重复的包
  private liveRev = 0;
  private liveLastSentAt = 0;
  // 这一笔落在哪一页（下笔当时定的；翻页途中的笔算目标页）
  private livePageKey = "";

  private resizeHandler = () => {
    this.syncAnchor(true);
  };
  // Esc 关导出弹窗：弹窗是浮层，没有 Esc 会让人觉得「卡住了」
  private escapeHandler = (event: KeyboardEvent) => {
    if (event.key === "Escape" && this.state.exportOpen) {
      this.closeExport();
    }
  };
  private pageChangeHandler = () => {
    this.switchPageIfNeeded();
  };
  private remoteDoodleHandler = (event: any) => {
    this.handleRemoteDoodle(event);
  };

  constructor(props: DoodleLayerProps) {
    super(props);
    this.state = {
      // 滑动阅读下默认「浏览态」：画布不吃触摸，页面照常能滚（详见 props 的说明）。
      mode: props.defaultView ? "view" : "draw",
      color: COLORS[0],
      size: SIZES[1],
      strokes: [],
      pageKey: "",
      isSaving: false,
      anchor: null,
      pageAspect: 0,
      hiddenAuthors: [],
      peerPages: 0,
      exportOpen: false,
      exportSummary: null,
      exportBusy: false,
    };
  }

  // ── 画布锚点：量出书页矩形 ──────────────────────────────────────────
  measureAnchor(): DoodleAnchor | null {
    if (typeof document === "undefined") return null;
    const el = document.getElementById("page-area");
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    // 书还没渲染出来时 rect 是 0，这种时候宁可退回整屏应急
    if (rect.width < 80 || rect.height < 80) return null;
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  // 书页动了（开侧栏 / 改缩放 / 改窗口）就重新贴上去，并重绘
  syncAnchor(force = false) {
    if (this.destroyed) return;
    const anchor = this.measureAnchor();
    const prev = this.state.anchor;
    const changed =
      force ||
      !anchor !== !prev ||
      (anchor &&
        prev &&
        (Math.abs(anchor.left - prev.left) > 1 ||
          Math.abs(anchor.top - prev.top) > 1 ||
          Math.abs(anchor.width - prev.width) > 1 ||
          Math.abs(anchor.height - prev.height) > 1));
    if (!changed) return;
    const aspect = anchor ? anchor.height / anchor.width : 0;
    this.setState({ anchor, pageAspect: aspect }, () => this.redrawAll());
  }

  // ── 翻页：旧的收起来，新的装进来 ────────────────────────────────────
  // 时序上分两拍，核心是「翻页不等 IO」：
  //   第 1 拍（同步）：换 key，把上一页的笔迹立刻从画布上撤掉；
  //                    命中 pageCache 就直接把新页画上（翻回去是瞬时的）。
  //   第 2 拍（异步）：后台把新页的完整数据（本地 + 云端 + 房间）取回来再覆盖一次。
  // v3 之前的坑：整段串在 await 上（先落盘 → 再读盘 → 再拉云端），
  // 所以翻页后上一页的笔记还会在屏幕上停一两秒，翻回去也要等一两秒才出来。
  //
  // switching 是并发闸门：rendered 事件、page-changed 事件、轮询三路都会触发本函数，
  // 并发执行时后返回的旧请求会覆盖新页的笔迹。
  // 存一页快照，并把最久没碰的挤出去（Map 保序：重设即排到队尾）
  cachePage(key: string, strokes: DoodleStroke[]) {
    if (!key) return;
    this.pageCache.delete(key);
    this.pageCache.set(key, strokes.slice());
    while (this.pageCache.size > PAGE_CACHE_MAX) {
      const oldest = this.pageCache.keys().next().value;
      if (oldest === undefined) break;
      this.pageCache.delete(oldest);
    }
  }

  switchPageIfNeeded = async (force = false) => {
    if (this.destroyed) return;
    if (this.switching) {
      this.switchPending = true;
      return;
    }
    this.switching = true;
    this.switchTargetKey = "";
    this.carriedIds = new Set();
    try {
      this.syncAnchor();
      const nextKey = await getDoodlePageKey(this.props.rendition);
      if (!nextKey) return;
      if (!force && nextKey === this.state.pageKey) return;
      // 从这里开始页面已经翻过去了，之后画的笔迹都算新页的
      this.switchTargetKey = nextKey;

      const prevKey = this.state.pageKey;
      const prevStrokes = this.state.strokes;
      // 离开这一页时留个快照 —— 下次翻回来直接从这里出笔迹
      if (prevKey) this.cachePage(prevKey, prevStrokes);

      // 第 1 拍：立刻换页。缓存里有就先画上，没有就先空着 ——
      // 但无论哪种情况，上一页的笔迹都必须马上从画布上消失。
      const cached = this.pageCache.get(nextKey);
      this.setState(
        { pageKey: nextKey, strokes: cached ? cached.slice() : [] },
        () => this.redrawAll()
      );

      // 上一页落盘（本地写 + 云端 POST 两次 IO）扔后台，不挡翻页
      if (prevKey) {
        void this.persistStrokes(prevKey, prevStrokes);
      }

      // 第 2 拍：后台补齐这一页的真实数据。
      // 跨设备兼容:每台设备的分页数都不一样(屏幕/字号/单双页),光按页号
      // 匹配会漏掉同伴的笔迹 —— 这里按全书进度把「就在这一屏附近」的笔迹
      // 也一并展示(本地+云端在 loadDoodlePage 内收编,房间笔迹在下面补)。
      const chapterKey = parseDoodlePageKey(nextKey)?.chapter || "";
      const fuzzyCtx =
        chapterKey && isFinite(getDoodlePercentage(this.props.rendition))
          ? {
              chapterKey,
              pctStart: getDoodlePercentage(this.props.rendition),
              span: await getDoodlePageSpan(this.props.rendition),
            }
          : undefined;
      const pageData = await loadDoodlePage(
        this.props.bookKey,
        nextKey,
        fuzzyCtx
      );
      const strokes = pageData.strokes;
      // 这些笔迹只是「进度上恰好落在这一屏」,不落盘
      const displayOnlyIds = new Set(pageData.displayOnlyIds);
      if (this.destroyed) return;
      // 这中间用户又翻了页，这份结果已经过期
      if (this.state.pageKey !== nextKey) return;

      let merged = strokes;
      let needsSave = false;
      // 共读开着的话，再把房间里这一页的笔迹并进来（按 id 去重）
      if (isDoodleSyncEnabled() && collabClient.isInRoom()) {
        try {
          const roomDoodles = await collabClient.fetchRoomDoodles();
          this.peerPageSet = collectPeerPages(
            roomDoodles,
            this.props.bookKey,
            this.authorId()
          );
          const remote = roomDoodles[nextKey] || [];
          if (remote.length > 0) {
            const seen = new Set(merged.map((stroke) => stroke.id));
            // 房间笔迹要按书隔离，否则同一房间换书后会串页
            const extra = remote.filter(
              (stroke) =>
                !seen.has(stroke.id) &&
                (!(stroke as any).bookKey ||
                  (stroke as any).bookKey === this.props.bookKey)
            );
            if (extra.length > 0) {
              merged = merged.concat(extra);
              needsSave = true; // 房间笔迹也存一份到自己名下：退出房间后仍看得到
            }
          }
          // 房间笔迹的模糊收编(页号对不上的那些):只展示、不落盘,
          // 避免同一笔以不同 pageKey 在各端存储间互相复制。
          if (fuzzyCtx && fuzzyCtx.span > 0) {
            const seenFuzzy = new Set(merged.map((stroke) => stroke.id));
            const fuzzyExtra = collectFuzzyStrokes(
              roomDoodles,
              fuzzyCtx.chapterKey,
              fuzzyCtx.pctStart,
              fuzzyCtx.span
            ).filter(
              (stroke) =>
                !seenFuzzy.has(stroke.id) &&
                (!(stroke as any).bookKey ||
                  (stroke as any).bookKey === this.props.bookKey)
            );
            for (const stroke of fuzzyExtra) {
              displayOnlyIds.add(stroke.id);
            }
            if (fuzzyExtra.length > 0) {
              merged = merged.concat(fuzzyExtra);
            }
          }
        } catch (e) {
          // 拉不到房间笔迹就用本地的
        }
      } else {
        // 没开同步 / 不在房间：不存在"同伴的页"这个概念，清掉旧计数
        this.peerPageSet = new Set();
      }
      // 记住本页的「仅展示」集合,所有写路径(落盘/撤销/清空)都要剔除它们
      this.displayOnlyIds = displayOnlyIds;
      if (this.destroyed) return;
      if (this.state.pageKey !== nextKey) return;

      // 这套数据是「翻页那一刻」的，之后新冒出来的笔迹（自己刚画的、
      // 同伴刚广播来的）还只活在 state 里，得单独捞出来带过去
      const carried = this.state.strokes.filter(
        (stroke) => stroke.id && this.carriedIds.has(stroke.id)
      );
      if (carried.length > 0) needsSave = true;

      const nextStrokes = dedupeById(merged.concat(carried));
      this.cachePage(nextKey, nextStrokes);
      this.setState(
        {
          strokes: nextStrokes,
          peerPages: this.peerPageSet.size,
        },
        () => {
          this.redrawAll();
          // 只在这一页真的多出了笔迹（房间带来的 / 换页途中画的）时才回写，
          // 避免把「空页」写成删除动作。
          if (needsSave && nextStrokes.length > 0) {
            void saveDoodlePage(
              this.props.bookKey,
              nextKey,
              nextStrokes.filter(
                (stroke) => !this.displayOnlyIds.has(stroke.id)
              )
            );
          }
        }
      );
    } finally {
      this.switching = false;
      this.switchTargetKey = "";
      // 切换过程中被挡掉的翻页请求，这里补一次（快速连翻时不会漏页）
      if (this.switchPending && !this.destroyed) {
        this.switchPending = false;
        void this.switchPageIfNeeded();
      }
    }
  };

  // 落盘。显式传入 pageKey/strokes，避免 await 期间 this.state 已变导致存错页。
  // removedIds 用来告知服务端「这些笔迹被删了」，否则服务端只做并集删不掉。
  persistStrokes = async (
    pageKey?: string,
    strokes?: DoodleStroke[],
    removedIds: string[] = []
  ) => {
    const key = pageKey !== undefined ? pageKey : this.state.pageKey;
    // 「仅展示」笔迹不属于本页存储,写回前必须剔除,否则会在本页 pageKey
    // 下复制出一份,越翻越多
    const data = (strokes !== undefined ? strokes : this.state.strokes).filter(
      (stroke) => !this.displayOnlyIds.has(stroke.id)
    );
    if (!key) return;
    if (!this.destroyed) this.setState({ isSaving: true });
    await saveDoodlePage(this.props.bookKey, key, data, removedIds);
    if (!this.destroyed) this.setState({ isSaving: false });
  };

  scheduleSave = (removedIds: string[] = []) => {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    const key = this.state.pageKey;
    const strokes = this.state.strokes;
    this.saveTimer = setTimeout(() => {
      if (this.destroyed) return;
      this.persistStrokes(key, strokes, removedIds);
    }, SAVE_DEBOUNCE_MS);
  };

  // ── 共读同步 ─────────────────────────────────────────────────────
  authorId = (): string => {
    return collabClient.clientId || "local";
  };

  syncEnabled = (): boolean => {
    return isDoodleSyncEnabled() && collabClient.isInRoom();
  };

  // stroke 带上时表示「撤销的就是这一笔」——服务端据此精确删除，
  // 不带的话服务端只能猜最后一笔（老行为，且会和别人的笔迹打架）。
  broadcast = (
    op: "add" | "undo" | "clear",
    stroke?: DoodleStroke
  ) => {
    if (!this.syncEnabled()) return;
    collabClient
      .broadcastDoodle(this.props.bookKey, {
        // 以笔迹自己的页身份为准：切页途中的 add/undo 不能落到旧页头上
        pageKey: (stroke && stroke.pageKey) || this.state.pageKey,
        op,
        stroke,
        authorId: this.authorId(),
        authorName: getOrCreateDisplayName(),
      })
      .catch((error) => console.warn("广播涂鸦失败:", error));
  };

  handleRemoteDoodle = (event: any) => {
    if (!event || this.destroyed || !this.syncEnabled()) return;
    // 不是这本书的笔迹：同一房间换书后章节路径可能撞名，必须按书过滤
    if (event.bookKey && event.bookKey !== this.props.bookKey) return;
    if (event.senderId === collabClient.clientId) return;

    // 同伴在别的页画了：当前页不动，但记下「那页有笔记」，给大家一个提示
    if (event.pageKey !== this.state.pageKey) {
      if (
        (event.op === "add" || event.op === "append") &&
        event.authorId &&
        event.authorId !== this.authorId() &&
        !this.peerPageSet.has(event.pageKey)
      ) {
        this.peerPageSet.add(event.pageKey);
        this.setState({ peerPages: this.peerPageSet.size });
      }
      return;
    }

    this.setState(
      (prev) => {
        if (event.op === "add" && event.stroke) {
          // 收笔的完整笔迹是权威版本。若同伴那边已经通过 append 建了一条
          // 「正在画」的同 id 笔迹，这里要原地替换（补全），而不是当成重复忽略。
          const idx = prev.strokes.findIndex((s) => s.id === event.stroke.id);
          const finalStroke = { ...event.stroke, bookKey: event.bookKey };
          if (idx >= 0) {
            const next = prev.strokes.slice();
            next[idx] = finalStroke;
            return { strokes: next };
          }
          // 切页途中收到的：同样记下来，别被随后的「补齐」覆盖掉
          if (this.switchTargetKey) this.carriedIds.add(event.stroke.id);
          return { strokes: [...prev.strokes, finalStroke] };
        }
        if (event.op === "append" && event.stroke && event.stroke.id) {
          // 「一笔一划」：同伴正在写的这一笔，分片推过来的新增点。
          // from = 这一笔此前已有几点，rev = 单调序号（用来丢乱序/重复包）。
          const incoming = event.stroke;
          const from = Math.max(0, Number(event.from) || 0);
          const rev = Number(event.rev) || 0;
          const idx = prev.strokes.findIndex((s) => s.id === incoming.id);
          if (idx < 0) {
            // 第一次收到这一笔：必须从第 0 点开始，否则前半段缺失、画出来是断的，
            // 这种情况就等收笔时的完整 add
            if (from > 0) return null;
            if (this.switchTargetKey) this.carriedIds.add(incoming.id);
            return {
              strokes: [
                ...prev.strokes,
                {
                  ...incoming,
                  bookKey: event.bookKey,
                  points: (incoming.points || []).slice(),
                  rev,
                } as any,
              ],
            };
          }
          const existing: any = prev.strokes[idx];
          if (typeof existing.rev === "number" && existing.rev >= rev) return null;
          const mergedPoints = (existing.points || [])
            .slice(0, from)
            .concat(incoming.points || []);
          const next = prev.strokes.slice();
          next[idx] = {
            ...existing,
            ...incoming,
            bookKey: event.bookKey,
            points: mergedPoints,
            rev,
          } as any;
          return { strokes: next };
        }
        if (event.op === "undo") {
          // 精确按 id 删（新协议）；老服务端不带 id 时退回「删该作者最后一笔」
          const targetId = event.stroke && event.stroke.id;
          if (targetId) {
            if (!prev.strokes.some((s) => s.id === targetId)) return null;
            return {
              strokes: prev.strokes.filter((s) => s.id !== targetId),
            };
          }
          let target = -1;
          for (let i = prev.strokes.length - 1; i >= 0; i--) {
            if (prev.strokes[i]?.authorId === event.authorId) {
              target = i;
              break;
            }
          }
          if (target < 0) return null;
          return { strokes: prev.strokes.filter((_, i) => i !== target) };
        }
        if (event.op === "clear") {
          // 只清对方自己的笔迹
          return {
            strokes: prev.strokes.filter(
              (stroke) => stroke.authorId !== event.authorId
            ),
          };
        }
        return null;
      },
      () => this.redrawAll()
    );
  };

  // ── 指针事件 ─────────────────────────────────────────────────────
  handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (this.state.mode !== "draw") return;
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    (event.target as HTMLCanvasElement).setPointerCapture?.(event.pointerId);
    this.drawing = true;
    this.currentPoints = [this.normalizedPoint(event)];
    // 「一笔一划」：下笔就把这一笔的 id 定下来。同伴那边靠同一个 id 把
    // 「过程中的增量」和「收笔的完整笔迹」接成同一笔，不会画成两笔。
    this.liveId = newStrokeId();
    this.liveSentCount = 0;
    this.liveRev = 0;
    this.liveLastSentAt = 0;
    this.livePageKey = this.switchTargetKey || this.state.pageKey;
  };

  handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!this.drawing || this.state.mode !== "draw") return;
    event.preventDefault();
    this.currentPoints.push(this.normalizedPoint(event));
    const ctxInfo = this.getCanvasContext();
    if (!ctxInfo) return;
    const { ctx, width } = ctxInfo;
    const box = this.getFitBox(width, ctxInfo.height);
    const points = this.currentPoints;
    if (points.length < 2) return;

    const scale = width / 1000;
    ctx.strokeStyle = this.state.color;
    ctx.lineWidth = Math.max(0.6, this.state.size * scale);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const prev = points[points.length - 2];
    const curr = points[points.length - 1];
    ctx.beginPath();
    ctx.moveTo(box.ox + prev[0] * box.w, box.oy + prev[1] * box.h);
    ctx.lineTo(box.ox + curr[0] * box.w, box.oy + curr[1] * box.h);
    ctx.stroke();

    // 顺手把新增的点推给同伴，让字「一笔一划」地出现在对方屏幕上
    this.streamLivePoints();
  };

  // 「一笔一划」：节流地把「这一笔从上次推送之后新增的点」广播出去。
  // 只推增量（不是整笔重发），收笔时再发一次完整笔迹作为权威版本。
  streamLivePoints = () => {
    if (!this.syncEnabled() || !isDoodleLiveEnabled()) return;
    if (!this.liveId || !this.livePageKey) return;
    if (this.currentPoints.length <= this.liveSentCount) return;
    const now = Date.now();
    if (now - this.liveLastSentAt < LIVE_SYNC_MS) return;
    const from = this.liveSentCount;
    const delta = this.currentPoints.slice(from);
    this.liveSentCount = this.currentPoints.length;
    this.liveLastSentAt = now;
    this.liveRev += 1;
    collabClient
      .broadcastDoodle(this.props.bookKey, {
        pageKey: this.livePageKey,
        op: "append",
        from,
        rev: this.liveRev,
        stroke: {
          id: this.liveId,
          pageKey: this.livePageKey,
          authorId: this.authorId(),
          authorName: getOrCreateDisplayName(),
          color: this.state.color,
          size: this.state.size,
          points: delta,
          createdAt: Date.now(),
          percentage: getDoodlePercentage(this.props.rendition),
          aspect: this.state.pageAspect > 0 ? this.state.pageAspect : undefined,
        },
      })
      .catch(() => {
        // 实时增量失败无所谓：收笔时的完整笔迹会补上
      });
  };

  handlePointerUp = () => {
    if (!this.drawing) return;
    this.drawing = false;
    // 这一笔的 id 在下笔时已定；收笔沿用它，同伴那边就能把实时增量接成同一笔
    const strokeId = this.liveId || newStrokeId();
    this.liveId = "";
    this.liveSentCount = 0;
    this.liveRev = 0;
    this.livePageKey = "";
    if (this.currentPoints.length === 0) return;
    const stroke: DoodleStroke = {
      id: strokeId,
      // 笔迹自己带上「我是哪一页的」——换页去重的依据。
      // 切页途中（视觉上已翻页、state 还没提交）按目标页算。
      pageKey: this.switchTargetKey || this.state.pageKey,
      authorId: this.authorId(),
      authorName: getOrCreateDisplayName(),
      color: this.state.color,
      size: this.state.size,
      points: this.currentPoints,
      createdAt: Date.now(),
      percentage: getDoodlePercentage(this.props.rendition),
      aspect: this.state.pageAspect > 0 ? this.state.pageAspect : undefined,
    };
    this.currentPoints = [];
    // 切页途中画的：记下 id，等这一页的数据从存储里补齐时别把它覆盖掉
    if (this.switchTargetKey) this.carriedIds.add(stroke.id);
    this.setState(
      (prev) => ({ strokes: [...prev.strokes, stroke] }),
      () => {
        this.scheduleSave();
        this.broadcast("add", stroke);
      }
    );
  };

  // 翻页：画布会吞掉点击，所以工具栏上给上一页/下一页两个按钮
  handleTurnPage = async (direction: "prev" | "next") => {
    try {
      // 这里不等落盘：翻页后 switchPageIfNeeded 会把上一页的笔迹连同 key
      // 一起丢给后台去存（await 落盘会让按钮明显慢一拍）
      if (direction === "prev") {
        await this.props.rendition.prev();
      } else {
        await this.props.rendition.next();
      }
      await this.switchPageIfNeeded();
    } catch (e) {
      // 翻页失败忽略
    }
  };

  handleUndo = () => {
    // 只撤销自己画的最后一笔：共读房间里不该把别人的笔迹撤掉
    const myId = this.authorId();
    let target = -1;
    for (let i = this.state.strokes.length - 1; i >= 0; i--) {
      const stroke = this.state.strokes[i];
      if (!stroke.authorId || stroke.authorId === myId) {
        target = i;
        break;
      }
    }
    if (target < 0) return;
    const removed = this.state.strokes[target];
    const kept = this.state.strokes.filter((_, i) => i !== target);
    this.setState({ strokes: kept }, () => {
      this.redrawAll();
      // 告诉服务端删掉这一笔，否则云端只做并集，撤销结果同步不出去
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.persistStrokes(this.state.pageKey, kept, [removed.id]);
      // 撤销的若是「仅展示」笔迹(它真正的归属页不是当前页),
      // 要对它自带的 pageKey 发一次删除,才能真正从存储里撤掉
      if (this.displayOnlyIds.has(removed.id) && removed.pageKey) {
        void saveDoodlePage(this.props.bookKey, removed.pageKey, [], [
          removed.id,
        ]);
      }
      // 广播时带上被撤销的笔：服务端才能精确删（且只删我的）
      this.broadcast("undo", removed);
    });
  };

  handleClear = () => {
    // 只清自己画的：共读房间里不该把别人的笔迹也抹掉
    const myId = this.authorId();
    const removed = this.state.strokes.filter(
      (stroke) => !stroke.authorId || stroke.authorId === myId
    );
    const removedIds = removed.map((stroke) => stroke.id);
    const kept = this.state.strokes.filter(
      (stroke) => stroke.authorId && stroke.authorId !== myId
    );
    this.setState({ strokes: kept }, () => {
      this.redrawAll();
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.persistStrokes(this.state.pageKey, kept, removedIds);
      // 「仅展示」笔迹归属在别的 pageKey 下,按各自真正的页发删除
      const foreignIdsByPage = new Map<string, string[]>();
      for (const stroke of removed) {
        if (
          this.displayOnlyIds.has(stroke.id) &&
          stroke.pageKey &&
          stroke.pageKey !== this.state.pageKey
        ) {
          const list = foreignIdsByPage.get(stroke.pageKey) || [];
          list.push(stroke.id);
          foreignIdsByPage.set(stroke.pageKey, list);
        }
      }
      for (const [pageKey, ids] of foreignIdsByPage) {
        void saveDoodlePage(this.props.bookKey, pageKey, [], ids);
      }
      this.broadcast("clear");
    });
  };

  // ── 导出（只读，不动存储）───────────────────────────────────────────
  // 「书页 + 涂鸦」合成图是不做的：涂鸦层是独立 canvas，画布读不到 iframe 里的
  // 正文（跨文档 + 没有 html2canvas 这类工具）。所以给的是：
  //   1) 透明底 PNG —— 直接叠在截图/PDF 上就是「带笔记的那一页」
  //   2) 书页底色 PNG —— 想要一张能直接发出去的图时用
  //   3) SVG —— 矢量，可再编辑
  //   4) 全书 JSON —— 备份/排查用，按页分组，和存储里的口径一致
  openExport = async () => {
    this.setState({ exportOpen: true, exportSummary: null, exportBusy: true });
    try {
      const { pages, totalStrokes, authors } = await collectAllDoodlePages(
        this.props.bookKey
      );
      if (this.destroyed) return;
      this.setState({
        exportSummary: {
          pages: Object.keys(pages).length,
          strokes: totalStrokes,
          authors,
        },
        exportBusy: false,
      });
    } catch (e) {
      if (this.destroyed) return;
      this.setState({
        exportSummary: { pages: 0, strokes: 0, authors: [] },
        exportBusy: false,
      });
    }
  };

  closeExport = () => {
    this.setState({ exportOpen: false });
  };

  // 导出用的离屏画布：尺寸取「屏幕上那块书页」的像素尺寸 × dpr。
  // getFitBox 的换算是相对同一套 width/height 做的，所以导出的构图和屏幕上一致。
  buildExportCanvas(fill: string | null): HTMLCanvasElement | null {
    const anchor = this.state.anchor;
    const width = Math.round(anchor?.width || this.canvasRef?.clientWidth || 0);
    const height = Math.round(
      anchor?.height || this.canvasRef?.clientHeight || 0
    );
    if (width < 8 || height < 8) return null;
    const dpr = Math.min(
      4,
      Math.max(2, Math.round(window.devicePixelRatio || 1))
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, width, height);
    }
    this.paintStrokes(ctx, width, height, this.visibleStrokes());
    return canvas;
  }

  exportFileName(ext: string): string {
    const safe = (this.state.pageKey || "page")
      .replace(/[\\/:*?"<>|#]+/g, "_")
      .replace(/^_+/, "");
    return `随心笔记_${safe || "page"}.${ext}`;
  }

  handleExportPagePng = async (transparent: boolean) => {
    if (this.state.exportBusy) return;
    this.setState({ exportBusy: true });
    try {
      const canvas = this.buildExportCanvas(
        transparent ? null : this.props.dark ? "#2c2f31" : "#ffffff"
      );
      if (!canvas) {
        toast.error("书页还没渲染好，稍等一下再导出");
        return;
      }
      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((result) => resolve(result), "image/png")
      );
      if (!blob) {
        toast.error("生成图片失败，请重试");
        return;
      }
      saveAs(blob, this.exportFileName("png"));
    } catch (e) {
      toast.error("导出图片失败，请重试");
    } finally {
      if (!this.destroyed) this.setState({ exportBusy: false });
    }
  };

  handleExportPageSvg = () => {
    if (this.state.exportBusy) return;
    const width = Math.round(this.state.anchor?.width || 0);
    const height = Math.round(this.state.anchor?.height || 0);
    if (width < 8 || height < 8) {
      toast.error("书页还没渲染好，稍等一下再导出");
      return;
    }
    const box = this.getFitBox(width, height);
    const scale = width / 1000;
    const esc = (value: string) =>
      String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/"/g, "&quot;");
    const parts: string[] = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    ];
    for (const stroke of this.visibleStrokes()) {
      if (!stroke || !stroke.points || stroke.points.length === 0) continue;
      const points = stroke.points.map(
        ([x, y]) =>
          `${(box.ox + x * box.w).toFixed(2)},${(box.oy + y * box.h).toFixed(2)}`
      );
      // 单点笔迹补一小段，否则 polyline 画不出东西
      if (points.length === 1) {
        points.push(
          `${(box.ox + stroke.points[0][0] * box.w + 0.6).toFixed(2)},${(
            box.oy +
            stroke.points[0][1] * box.h +
            0.6
          ).toFixed(2)}`
        );
      }
      parts.push(
        `  <polyline fill="none" stroke="${esc(
          stroke.color || "#1f1f1f"
        )}" stroke-width="${Math.max(0.6, stroke.size * scale).toFixed(
          2
        )}" stroke-linecap="round" stroke-linejoin="round" points="${points.join(
          " "
        )}" />`
      );
    }
    parts.push("</svg>");
    const blob = new Blob([parts.join("\n")], {
      type: "image/svg+xml;charset=utf-8",
    });
    saveAs(blob, this.exportFileName("svg"));
  };

  handleExportBookJson = async () => {
    if (this.state.exportBusy) return;
    this.setState({ exportBusy: true });
    try {
      const { pages, totalStrokes, authors } = await collectAllDoodlePages(
        this.props.bookKey
      );
      const pageCount = Object.keys(pages).length;
      if (pageCount === 0) {
        toast.error("这本书还没有任何随心笔记");
        return;
      }
      const payload = {
        type: "coread-doodle-export",
        version: 1,
        exportedAt: new Date().toISOString(),
        bookKey: this.props.bookKey,
        pageCount,
        totalStrokes,
        authors,
        pages,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const safeBook = (this.props.bookKey || "book")
        .replace(/[\\/:*?"<>|#]+/g, "_")
        .slice(0, 60);
      saveAs(blob, `随心笔记_${safeBook}_全书.json`);
    } catch (e) {
      toast.error("导出失败，请重试");
    } finally {
      if (!this.destroyed) this.setState({ exportBusy: false });
    }
  };

  // 图例里点一下：单独显示 / 隐藏某人的笔迹
  toggleAuthor = (authorId: string) => {
    this.setState(
      (prev) => ({
        hiddenAuthors: prev.hiddenAuthors.includes(authorId)
          ? prev.hiddenAuthors.filter((id) => id !== authorId)
          : prev.hiddenAuthors.concat(authorId),
      }),
      () => this.redrawAll()
    );
  };

  // ── 生命周期 ─────────────────────────────────────────────────────
  async componentDidMount() {
    window.addEventListener("resize", this.resizeHandler);
    document.addEventListener("keydown", this.escapeHandler);
    try {
      this.props.rendition?.on?.("rendered", this.pageChangeHandler);
      this.props.rendition?.on?.("page-changed", this.pageChangeHandler);
    } catch (e) {
      // 老版本 rendition 没有事件也没关系，下面还有轮询
    }
    collabClient.on("doodle", this.remoteDoodleHandler);

    // 书页矩形会变（开合侧栏、改缩放、翻页重排），能观察到就立刻跟，观察不到靠轮询
    const pageArea = document.getElementById("page-area");
    if (pageArea && typeof ResizeObserver !== "undefined") {
      try {
        this.resizeObserver = new ResizeObserver(() => this.syncAnchor());
        this.resizeObserver.observe(pageArea);
      } catch (e) {
        this.resizeObserver = null;
      }
    }

    this.syncAnchor(true);
    await this.switchPageIfNeeded(true);
    this.pollTimer = setInterval(() => this.switchPageIfNeeded(), PAGE_POLL_MS);
    this.anchorTimer = setInterval(() => this.syncAnchor(), ANCHOR_POLL_MS);

    // 滑动阅读：正文的滚动是原生的（滚动容器是外层 `#page-area`，iframe 内部不滚），
    // 滚动时画布的视口矩形**不变** ⇒ ResizeObserver 不会响、`syncAnchor` 也不动，
    // 笔迹就会「粘」在屏幕上（正文从底下滚过去）。
    // 这里监听滚动并节流刷新：`switchPageIfNeeded` 会按「屏」重新归属笔迹
    // （滑动模式下 `pageKey` 的页号就是屏号，见 doodleUtil.getDoodlePageIndex），
    // 滚回原来的屏时笔迹会原样回来。
    if (this.props.scrollMode) {
      const scroller = document.getElementById("page-area");
      if (scroller) {
        this.scrollTarget = scroller;
        this.scrollHandler = () => {
          if (this.scrollThrottleTimer) return;
          this.scrollThrottleTimer = setTimeout(() => {
            this.scrollThrottleTimer = null;
            this.syncAnchor();
            void this.switchPageIfNeeded();
          }, 240);
        };
        scroller.addEventListener("scroll", this.scrollHandler, {
          passive: true,
        });
      }
    }
  }

  async componentWillUnmount() {
    // 先取一份当前状态快照：卸载后 this.state 不可靠，落盘要用快照
    const snapshotPageKey = this.state.pageKey;
    const snapshotStrokes = this.state.strokes;
    this.destroyed = true;
    window.removeEventListener("resize", this.resizeHandler);
    document.removeEventListener("keydown", this.escapeHandler);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.anchorTimer) clearInterval(this.anchorTimer);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.scrollThrottleTimer) clearTimeout(this.scrollThrottleTimer);
    if (this.scrollHandler && this.scrollTarget) {
      this.scrollTarget.removeEventListener("scroll", this.scrollHandler);
      this.scrollHandler = null;
      this.scrollTarget = null;
    }
    if (this.resizeObserver) {
      try {
        this.resizeObserver.disconnect();
      } catch (e) {
        // 忽略
      }
      this.resizeObserver = null;
    }
    try {
      this.props.rendition?.off?.("rendered", this.pageChangeHandler);
      this.props.rendition?.off?.("page-changed", this.pageChangeHandler);
    } catch (e) {
      // 忽略
    }
    collabClient.off("doodle", this.remoteDoodleHandler);
    // 关闭前把最后一笔落盘（用快照，不再 setState，避免卸载后更新组件）
    if (snapshotPageKey) {
      await saveDoodlePage(
        this.props.bookKey,
        snapshotPageKey,
        snapshotStrokes.filter(
          (stroke) => !this.displayOnlyIds.has(stroke.id)
        )
      );
    }
  }

  // ── 画布 ─────────────────────────────────────────────────────────
  getCanvasContext() {
    const canvas = this.canvasRef;
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const ratio = window.devicePixelRatio || 1;
    const { clientWidth, clientHeight } = canvas;
    if (clientWidth === 0 || clientHeight === 0) return null;
    if (
      canvas.width !== Math.round(clientWidth * ratio) ||
      canvas.height !== Math.round(clientHeight * ratio)
    ) {
      // 注意：改 canvas.width/height 会清空画布内容。
      // 这里只是改尺寸，真正的重绘交给调用方（resize 处理函数会补一次 redrawAll），
      // 否则把窗口拖到另一块不同 DPR 的显示器上时笔迹会突然消失。
      canvas.width = Math.round(clientWidth * ratio);
      canvas.height = Math.round(clientHeight * ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { ctx, width: clientWidth, height: clientHeight };
  }

  // 笔迹归一化坐标要落到哪个矩形里。
  // 同一页、同一设备时就是整块书页（恒等映射）；页面比例变了（换设备 / 改字号 /
  // 改窗口）时按「等比缩放 + 顶部对齐 + 水平居中」放进去，至少不会把笔迹拉扁，
  // 也能保持它相对页眉/首行的位置。
  getFitBox(width: number, height: number) {
    const current = this.state.pageAspect || height / width;
    const all = this.state.strokes;
    let stored = 0;
    for (let i = all.length - 1; i >= 0; i--) {
      const aspect = Number(all[i].aspect);
      if (isFinite(aspect) && aspect > 0) {
        stored = aspect;
        break;
      }
    }
    if (
      !stored ||
      !isFinite(current) ||
      current <= 0 ||
      Math.abs(stored - current) / current <= 0.02
    ) {
      return { ox: 0, oy: 0, w: width, h: height };
    }
    const w = Math.min(width, height / stored);
    const h = w * stored;
    return { ox: (width - w) / 2, oy: 0, w, h };
  }

  // 当前页要画的笔迹（按图例的显隐过滤）
  visibleStrokes(): DoodleStroke[] {
    const hidden = this.state.hiddenAuthors;
    if (hidden.length === 0) return this.state.strokes;
    const hiddenSet = new Set(hidden);
    return this.state.strokes.filter(
      (stroke) => !hiddenSet.has(stroke.authorId || "")
    );
  }

  // 这一页上有哪些作者画过
  authorList(): DoodleAuthor[] {
    const myId = this.authorId();
    const map = new Map<string, DoodleAuthor>();
    for (const stroke of this.state.strokes) {
      const id = stroke.authorId || "";
      const existing = map.get(id);
      if (existing) {
        existing.count += 1;
        continue;
      }
      map.set(id, {
        id,
        name: !id || id === myId ? "我" : stroke.authorName || "同伴",
        color: stroke.color || COLORS[0],
        count: 1,
      });
    }
    return Array.from(map.values());
  }

  // 把一组笔迹按归一化坐标画进任意 2D 上下文。
  // 屏幕画布（redrawAll）和「导出 PNG」共用这一段 —— 导出结果和屏幕上看到的一致。
  paintStrokes(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    strokes: DoodleStroke[]
  ) {
    const box = this.getFitBox(width, height);
    const scale = width / 1000;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of strokes) {
      if (!stroke || !stroke.points || stroke.points.length === 0) continue;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = Math.max(0.6, stroke.size * scale);
      ctx.beginPath();
      const first = stroke.points[0];
      ctx.moveTo(box.ox + first[0] * box.w, box.oy + first[1] * box.h);
      for (const [x, y] of stroke.points.slice(1)) {
        ctx.lineTo(box.ox + x * box.w, box.oy + y * box.h);
      }
      // 单击也会生成只有一个点的笔迹，补一小段保证可见
      if (stroke.points.length === 1) {
        ctx.lineTo(box.ox + first[0] * box.w + 0.1, box.oy + first[1] * box.h + 0.1);
      }
      ctx.stroke();
    }
  }

  // 把当前页的全部笔迹按归一化坐标重画到画布上
  redrawAll() {
    const ctxInfo = this.getCanvasContext();
    if (!ctxInfo) return;
    const { ctx, width, height } = ctxInfo;
    ctx.clearRect(0, 0, width, height);
    this.paintStrokes(ctx, width, height, this.visibleStrokes());
  }

  normalizedPoint(event: { clientX: number; clientY: number }): number[] {
    const canvas = this.canvasRef!;
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    return [x, y];
  }

  /** 当前是不是「手机版式」。判据和阅读器一致：安卓壳/触屏窄屏 或 视口很窄，
   *  这样在浏览器里把窗口拉窄调试时看到的就是手机版式。 */
  isMobileLayout(): boolean {
    if (isMobileRuntime()) return true;
    return (
      typeof document !== "undefined" && document.body.clientWidth < 570
    );
  }

  /**
   * 工具条的内容。桌面端铺成一条横贯页眉的条（可横向滚动），
   * 手机端则整块搬进左侧抽屉里自动换行 —— 内容是同一份，只有外壳不同，
   * 免得两套布局各改一半、后面加按钮时漏掉一处。
   */
  renderToolbarRow() {
    const isView = this.state.mode === "view";
    const authors = this.authorList();
    const hiddenSet = new Set(this.state.hiddenAuthors);
    const visibleCount = this.visibleStrokes().length;
    const canUndo = this.state.strokes.some(
      (stroke) => !stroke.authorId || stroke.authorId === this.authorId()
    );
    return (
      <div className="doodle-toolbar-row">
        <div className="doodle-toolbar-group">
          <div
            className="doodle-tool-btn doodle-tool-square"
            title="上一页"
            onClick={() => this.handleTurnPage("prev")}
          >
            ‹
          </div>
          <div
            className="doodle-tool-btn doodle-tool-square"
            title="下一页"
            onClick={() => this.handleTurnPage("next")}
          >
            ›
          </div>
        </div>
        <span className="doodle-divider" />
        <div className="doodle-toolbar-group">
          {COLORS.map((color) => (
            <div
              key={color}
              className={
                this.state.color === color
                  ? "doodle-color-dot active"
                  : "doodle-color-dot"
              }
              style={{ backgroundColor: color }}
              title="画笔颜色"
              onClick={() => this.setState({ color })}
            />
          ))}
        </div>
        <span className="doodle-divider" />
        <div className="doodle-toolbar-group">
          {SIZES.map((size) => (
            <div
              key={size}
              className={
                this.state.size === size
                  ? "doodle-size-dot active"
                  : "doodle-size-dot"
              }
              title="画笔粗细"
              onClick={() => this.setState({ size })}
            >
              <span
                style={{
                  width: Math.max(4, size * 1.2),
                  height: Math.max(4, size * 1.2),
                }}
              />
            </div>
          ))}
        </div>
        <span className="doodle-divider" />
        <div className="doodle-toolbar-group">
          <div
            className={
              !isView ? "doodle-tool-btn doodle-tool-active" : "doodle-tool-btn"
            }
            title="画笔模式：可以书写"
            onClick={() => {
              this.setState({ mode: "draw" });
            }}
          >
            绘画
          </div>
          <div
            className={
              isView ? "doodle-tool-btn doodle-tool-active" : "doodle-tool-btn"
            }
            title="浏览模式：笔迹只显示，不挡点字/选中"
            onClick={() => {
              this.setState({ mode: "view" });
            }}
          >
            浏览
          </div>
        </div>
        <span className="doodle-divider" />
        <div className="doodle-toolbar-group">
          <div
            className={
              canUndo ? "doodle-tool-btn" : "doodle-tool-btn doodle-tool-disabled"
            }
            title="撤销自己画的最后一笔"
            onClick={this.handleUndo}
          >
            撤销
          </div>
          <div
            className="doodle-tool-btn"
            title="清空自己在这一页的笔迹（别人画的不动）"
            onClick={this.handleClear}
          >
            清空
          </div>
          <div
            className="doodle-tool-btn"
            title="导出这一页的涂鸦 / 全书笔记数据"
            onClick={this.openExport}
          >
            导出
          </div>
          <div
            className="doodle-tool-btn doodle-tool-close"
            title="关闭随心笔记"
            onClick={this.props.onClose}
          >
            关闭
          </div>
        </div>

        {/* 原第二行信息（本页笔数 / 作者图例 / 共读状态）压成同行信息簇。
            多人共读时就靠它分清「谁画的」，并能单独只看某个人。 */}
        <span className="doodle-divider" />
        <div className="doodle-toolbar-group doodle-info-group">
          <span className="doodle-info-text">本页 {visibleCount} 笔</span>
          {this.state.isSaving && (
            <span className="doodle-info-text doodle-info-dim">保存中…</span>
          )}
          {authors.map((author) => (
            <span
              key={author.id || "me"}
              className={
                hiddenSet.has(author.id)
                  ? "doodle-author-chip doodle-author-chip-off"
                  : "doodle-author-chip"
              }
              title={
                hiddenSet.has(author.id)
                  ? "点击显示这个人的笔迹"
                  : "点击只看其他人（隐藏此人笔迹）"
              }
              onClick={() => this.toggleAuthor(author.id)}
            >
              <i
                className="doodle-author-dot"
                style={{ backgroundColor: author.color }}
              />
              {author.name}
              <em>{author.count}</em>
            </span>
          ))}
          {this.syncEnabled() ? (
            <span
              className="doodle-info-text doodle-info-sync"
              title={
                isDoodleLiveEnabled()
                  ? "笔迹正在房间里实时同步：同伴画的时候你能看着一笔一划写出来"
                  : "笔迹正在房间里同步：收笔后整笔出现（可在共读面板开启「一笔一划」）"
              }
            >
              共读同步中
              {isDoodleLiveEnabled() ? " · 实时" : ""}
              {this.state.peerPages > 0
                ? ` · 另有 ${this.state.peerPages} 页有同伴笔记`
                : ""}
            </span>
          ) : (
            <span
              className="doodle-info-text doodle-info-dim"
              title="想让同伴看到你的笔迹：共读面板 →「同步涂鸦」"
            >
              未同步涂鸦
            </span>
          )}
        </div>
      </div>
    );
  }

  render() {
    const isMobileLayout = this.isMobileLayout();
    const drawerOpen = Boolean(this.props.drawerOpen);
    const { anchor } = this.state;
    const visibleCount = this.visibleStrokes().length;
    return (
      <>
        {/* 画布层：严格贴在书页矩形上（量不到书页时退回整屏应急） */}
        <div className="doodle-layer">
          <div
            className={
              "doodle-canvas-wrap" +
              (this.state.mode === "view" ? " doodle-canvas-wrap-view" : "")
            }
            style={
              anchor
                ? {
                    left: anchor.left,
                    top: anchor.top,
                    width: anchor.width,
                    height: anchor.height,
                  }
                : { left: 0, top: 0, right: 0, bottom: 0 }
            }
          >
            <canvas
              ref={(ref) => {
                this.canvasRef = ref;
              }}
              className="doodle-canvas"
              onPointerDown={this.handlePointerDown}
              onPointerMove={this.handlePointerMove}
              onPointerUp={this.handlePointerUp}
              onPointerLeave={this.handlePointerUp}
              onContextMenu={(event) => event.preventDefault()}
            />
          </div>
        </div>

        {isMobileLayout ? (
          /* ── 手机端：工具条收进左侧抽屉 ────────────────────────────
             以前它是一条常驻在视口顶部的横条，一直压着正文（用户反馈
             「涂鸦面板一直挂在顶部」）。现在和「目录」用同一套交互：
             左侧滑出、遮罩点一下收起、随时能再唤出来。
             收起后画布照旧可写，所以再给一个左边缘的小把手负责唤出，
             否则收起抽屉之后就再也找不回控件了。 */
          <>
            {/* 状态胶囊：贴在阅读区左上角，很小一个，点一下唤出这块面板。
                绿点 = 绘画态（笔迹会吃掉触摸），黑点 = 浏览态（点字/选中正常）。
                关闭随心笔记时整个组件卸载，胶囊随之消失 —— 不用另外维护可见性。 */}
            <div
              className={
                "doodle-status-pill" +
                (this.state.mode === "draw" ? " doodle-status-pill-draw" : "")
              }
              title={
                this.state.mode === "draw"
                  ? "随心笔记：绘画中 · 点一下打开面板"
                  : "随心笔记：浏览中 · 点一下打开面板"
              }
              onClick={this.props.onDrawerToggle}
            >
              <span className="doodle-status-dot" />
            </div>
            {!drawerOpen && (
              <div
                className="doodle-drawer-handle"
                title="随心笔记"
                onClick={this.props.onDrawerToggle}
              >
                <span className="icon-edit" />
                {visibleCount > 0 && (
                  <em className="doodle-drawer-handle-badge">
                    {visibleCount}
                  </em>
                )}
              </div>
            )}
            {drawerOpen && (
              <div
                className="doodle-drawer-mask"
                onClick={this.props.onDrawerToggle}
              />
            )}
            <div
              className={
                "doodle-drawer" +
                (drawerOpen ? " doodle-drawer-open" : "") +
                (this.props.dark ? " doodle-drawer-dark" : "")
              }
              /* 抽屉整体滑出/滑回，不用卸载的方式切换 —— 卸载会把「当前选中的
                 颜色 / 粗细 / 绘画模式」一起丢掉，收起再打开就回到默认值。 */
              aria-hidden={!drawerOpen}
            >
              <div className="doodle-drawer-head">
                <span className="doodle-drawer-title">随心笔记</span>
                <span
                  className="doodle-drawer-close"
                  title="收起"
                  onClick={this.props.onDrawerToggle}
                >
                  ×
                </span>
              </div>
              <div className="doodle-drawer-body">{this.renderToolbarRow()}</div>
              <div className="doodle-drawer-hint">
                收起后仍可继续书写；点页面左边缘的小图标可以再唤出这块面板。
              </div>
            </div>
          </>
        ) : (
          /* ── 桌面端：保持原样，工具条贴在右上角页眉所在的水平带上 ──
             它压在「边缘触发条」之上，否则顶部那条透明的面板触发条会把
             工具栏的点击吞掉（这是审查时发现的老问题）。 */
          <div className="doodle-toolbar-layer">
            <div
              className="doodle-toolbar-slot"
              style={{
                right:
                  this.props.headerRight != null ? this.props.headerRight : 8,
              }}
            >
              <div
                className={
                  "doodle-toolbar" +
                  (this.props.dark ? " doodle-toolbar-dark" : "")
                }
              >
                {this.renderToolbarRow()}
              </div>
            </div>
          </div>
        )}

        {/* 导出弹窗：独立成层（不挂在工具条那层里），这样它的 z-index 不受
            父层叠上下文限制，永远压在所有阅读器浮层之上。 */}
        {this.state.exportOpen && (
          <div className="doodle-export-mask" onClick={this.closeExport}>
            <div
              className={
                "doodle-export-panel" +
                (this.props.dark ? " doodle-export-panel-dark" : "")
              }
              onClick={(event) => event.stopPropagation()}
            >
              <div className="doodle-export-head">
                <span className="doodle-export-title">导出随心笔记</span>
                <span
                  className="doodle-export-close"
                  title="关闭"
                  onClick={this.closeExport}
                >
                  ×
                </span>
              </div>
              <div className="doodle-export-info">
                {this.state.exportSummary
                  ? `本页 ${visibleCount} 笔 · 全书 ${
                      this.state.exportSummary.pages
                    } 页 / ${this.state.exportSummary.strokes} 笔${
                      this.state.exportSummary.authors.length
                        ? ` · ${this.state.exportSummary.authors.join("、")}`
                        : ""
                    }`
                  : "正在统计全书笔记…"}
              </div>
              <div className="doodle-export-list">
                <button
                  className="doodle-export-item"
                  disabled={this.state.exportBusy}
                  onClick={() => this.handleExportPagePng(true)}
                >
                  <b>当前页 · PNG（透明底）</b>
                  <em>
                    只导出笔迹，不带书页底色。直接叠在截图或 PDF 上，就是「带笔记的那一页」。
                  </em>
                </button>
                <button
                  className="doodle-export-item"
                  disabled={this.state.exportBusy}
                  onClick={() => this.handleExportPagePng(false)}
                >
                  <b>当前页 · PNG（带底色）</b>
                  <em>
                    按当前阅读背景（浅色纸 / 深色纸）铺一层底，出来就是一张能直接发出去的图。
                  </em>
                </button>
                <button
                  className="doodle-export-item"
                  disabled={this.state.exportBusy}
                  onClick={this.handleExportPageSvg}
                >
                  <b>当前页 · SVG（矢量）</b>
                  <em>笔迹是矢量路径，放大不糊，也能拿去再编辑。</em>
                </button>
                <button
                  className="doodle-export-item"
                  disabled={this.state.exportBusy}
                  onClick={this.handleExportBookJson}
                >
                  <b>全书 · JSON</b>
                  <em>
                    按页分组的原始数据（本地+云端合并去重），用于备份或排查；纯导出，不会改动笔迹。
                  </em>
                </button>
              </div>
              <div className="doodle-export-note">
                导出的是「当前显示的这一份」：被作者图例隐藏的人，笔迹不会出现在图片里。
              </div>
            </div>
          </div>
        )}
      </>
    );
  }
}

export default DoodleLayer;
