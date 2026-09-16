import DatabaseService from "../storage/databaseService";
import collabClient from "../collab/collabClient";
import { ConfigService } from '../../services';
import toast from "react-hot-toast";

// 随心笔记(涂鸦)的存储与定位工具 —— v3:按「页」存 + 画布锚定书页
//
// 一页的身份 = 章节 + 章内第几屏,例如 "OEBPS/chap03.xhtml#p2"
// 坐标按「书页矩形」归一化(0~1),画布严格贴着书页而不是整块屏幕,
// 所以笔迹是「写在纸上」而不是「盖在屏幕上」。
// 每条笔迹额外记 aspect(页面 高/宽) —— 换设备/改字号导致页面比例变化时,
// 渲染端按比例等比缩放,笔迹不会被拉扁。
//
// 存三层:
//   1) 本地(localforage 的 doodles 库)—— 打开就出笔迹,不卡
//   2) 服务端个人云(books/doodles/<bookKey>.json)—— 换设备也看得到
//   3) 共读房间(内存 + rooms-doodles/<roomId>.json)—— 房间里大家共享

const MAX_STROKES_PER_PAGE = 2000;

export interface DoodleStroke {
  id: string;
  /** 画这一笔时所在的页 key。v3 之后新笔迹一定有；历史数据可能没有 */
  pageKey?: string;
  color: string;
  size: number;
  points: number[][];
  createdAt?: number;
  authorName?: string;
  authorId?: string;
  /** 画这一笔时的全书进度(0~1)，用来在页号对不上时就近找页 */
  percentage?: number;
  /** 画这一笔时的页面比例(高/宽)，用来在页面尺寸变化时等比缩放 */
  aspect?: number;
}

export type DoodlePageMap = Record<string, DoodleStroke[]>;

export function newStrokeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function bookRecordKey(bookKey: string) {
  return `doodle-book-${bookKey}`;
}

// ── 定位:当前在哪一页 ────────────────────────────────────────────────
export function getDoodleChapterKey(rendition: any): string {
  try {
    const position = rendition?.getPosition?.();
    if (!position) return "unknown";
    if (position.chapterHref) return String(position.chapterHref);
    if (position.chapterIndex !== undefined) return `chapter-${position.chapterIndex}`;
    if (position.page !== undefined) return `page-${position.page}`;
    return "unknown";
  } catch (e) {
    return "unknown";
  }
}

// 章内第几屏(1 起)。滚动模式下按「屏」算,所以滚动时会换一组笔迹。
export async function getDoodlePageIndex(rendition: any): Promise<number> {
  try {
    const progress = await rendition?.getProgress?.();
    const page = parseInt(String(progress?.currentPage ?? "1"), 10);
    return isNaN(page) || page < 1 ? 1 : page;
  } catch (e) {
    return 1;
  }
}

export async function getDoodlePageKey(rendition: any): Promise<string> {
  const chapterKey = getDoodleChapterKey(rendition);
  const pageIndex = await getDoodlePageIndex(rendition);
  return `${chapterKey}#p${pageIndex}`;
}

// 顺手记一下全书进度,跨端对不上页号时用来就近找
export function getDoodlePercentage(rendition: any): number {
  try {
    const position = rendition?.getPosition?.();
    const value = parseFloat(position?.percentage);
    return isNaN(value) ? 0 : value;
  } catch (e) {
    return 0;
  }
}

// ── 本地读写(整本书一条记录)──────────────────────────────────────────
// 内存缓存：本地存储里「整本书」是一条记录，localforage 每次都要把整条记录
// 反序列化出来。翻页时读一次、落盘时又要读一次再写回去 —— 书越大越慢，
// 而翻页是个高频动作。缓存最近几本书，让本地这一环退化成纯内存操作。
const LOCAL_CACHE = new Map<string, DoodlePageMap>();
const LOCAL_CACHE_MAX_BOOKS = 8;

function clonePageMap(pages: DoodlePageMap): DoodlePageMap {
  const copy: DoodlePageMap = {};
  for (const key of Object.keys(pages || {})) {
    copy[key] = (pages[key] || []).slice();
  }
  return copy;
}

function cacheLocalBook(bookKey: string, pages: DoodlePageMap) {
  if (!bookKey) return;
  // 最近使用排在后面（Map 保序），超出上限就丢最久没碰的那本
  LOCAL_CACHE.delete(bookKey);
  LOCAL_CACHE.set(bookKey, clonePageMap(pages));
  while (LOCAL_CACHE.size > LOCAL_CACHE_MAX_BOOKS) {
    const oldest = LOCAL_CACHE.keys().next().value;
    if (oldest === undefined) break;
    LOCAL_CACHE.delete(oldest);
  }
}

export async function loadLocalDoodles(bookKey: string): Promise<DoodlePageMap> {
  if (!bookKey) return {};
  const cached = LOCAL_CACHE.get(bookKey);
  if (cached) return clonePageMap(cached);
  try {
    const record = await DatabaseService.getRecord(
      bookRecordKey(bookKey),
      "doodles"
    );
    if (record && record.pages && typeof record.pages === "object") {
      const pages = record.pages as DoodlePageMap;
      cacheLocalBook(bookKey, pages);
      return clonePageMap(pages);
    }
  } catch (e) {
    // 读不到按空处理
  }
  cacheLocalBook(bookKey, {});
  return {};
}

export async function saveLocalDoodlePage(
  bookKey: string,
  pageKey: string,
  strokes: DoodleStroke[]
): Promise<void> {
  if (!bookKey || !pageKey) return;
  const pages = await loadLocalDoodles(bookKey);
  if (strokes.length > 0) {
    pages[pageKey] = strokes.slice(-MAX_STROKES_PER_PAGE);
  } else {
    delete pages[pageKey];
  }
  await saveLocalDoodleBook(bookKey, pages);
}

/** 整本一次性覆盖写本地（去重修复、批量整理时用；日常只走 saveLocalDoodlePage） */
export async function saveLocalDoodleBook(
  bookKey: string,
  pages: DoodlePageMap
): Promise<void> {
  if (!bookKey) return;
  // 先更新内存缓存再写盘：写盘是异步的，翻页不该等它 —— 等落盘完成才更新缓存的话，
  // 刚画完就翻页再翻回来，读到的是旧缓存（笔迹「消失」一下再回来）。
  cacheLocalBook(bookKey, pages);
  const key = bookRecordKey(bookKey);
  const record = { key, bookKey, pages, updatedAt: Date.now() };
  try {
    const existing = await DatabaseService.getRecord(key, "doodles");
    if (existing) {
      await DatabaseService.updateRecord(record, "doodles", false);
    } else {
      await DatabaseService.saveRecord(record, "doodles", false);
    }
  } catch (e) {
    console.error("保存随心笔记到本地失败:", e);
  }
}

// ── 历史脏数据修复:同一笔迹散落在多页 ────────────────────────────────
//
// 背景：v2 的换页逻辑把「上一页的笔迹」并进了新页，并且把这一坨存到了新页 key 下。
// 结果是一笔会被复制到它后面（也可能前面）的每一页上，用户翻页时会看到
// 「上一页的笔记还在」。
//
// 判断一笔到底属于哪一页：每笔都记了 percentage（画它时的全书进度 = 该页页首进度）。
// 一页上只要还有「只出现在这一页」的笔迹，就能算出这一页的进度锚点；
// 同章内再按页号线性插值，把没有独有笔迹的页也补上锚点。
// 然后拿笔迹自己的 percentage 去比——离哪一页的锚点最近就留在哪一页。
//
// 安全性：只会从「同一笔 id 已经出现过的多个页」里保留一个，绝不会凭空删掉
// 只存在于一页的笔迹。
export function parseDoodlePageKey(
  pageKey: string
): { chapter: string; page: number } | null {
  const match = /^(.*)#p(\d+)$/.exec(pageKey || "");
  if (!match) return null;
  return { chapter: match[1], page: parseInt(match[2], 10) };
}

// ── 跨设备页号兼容:按「全书进度」就近收编笔迹 ────────────────────────
// pageKey = 章节 + 章内页号,但每个设备的分页数都不一样(屏幕大小/字号/
// 单双页模式),同一本给我的第 5 屏可能是同伴的第 9 屏 —— 按页号精确匹配,
// 同伴的笔迹就会「看不见」。好在每条笔迹都记了画它时的全书进度(percentage,
// 取的是当时那一屏的页首进度),同一章里进度离「我这一屏的页首」最近的笔迹,
// 就认定它属于这一屏。
// 窗口必须收在 ±半屏以内:相邻两屏的页首正好差一个屏宽,±半屏在数学上
// 保证每条笔迹只会落在唯一一页,不会渗到隔壁页(否则翻到下一页,
// 上一页的涂鸦还挂着,不像一本真的书)。
// 注意:模糊匹配进来的笔迹只用于展示,不写回本地/云端(否则同一笔会以
// 不同 pageKey 在各端互相复制,越翻越多)。
export function collectFuzzyStrokes(
  source: DoodlePageMap,
  chapterKey: string,
  pctStart: number,
  span: number
): DoodleStroke[] {
  const out: DoodleStroke[] = [];
  if (!chapterKey || !isFinite(pctStart) || !(span > 0)) return out;
  const half = span * 0.52; // 略宽于半屏,吸收百分比舍入误差
  for (const key of Object.keys(source || {})) {
    const parsed = parseDoodlePageKey(key);
    if (!parsed || parsed.chapter !== chapterKey) continue;
    for (const stroke of source[key] || []) {
      if (!stroke || !stroke.id) continue;
      const p = Number(stroke.percentage);
      if (!isFinite(p)) continue;
      if (Math.abs(p - pctStart) <= half) out.push(stroke);
    }
  }
  return out;
}

// 本章占全书多大的比例。
// 口径必须和 handleRecord 写 percentage 时用的**完全一致**：
//   totalSize = Σ over 所有 chapterDoc ( item.text ? item.text.size || 1 : 1 )
//   percentage = Σ(本章之前的 size)/totalSize + (本章 size/totalSize) * 章内可见块比例
// 所以这里也用 getChapterDoc() + 同一个 size 兜底公式，得到的才是同一把尺子。
// （不能用 getChapterSizes()：它用的是 item.text.length 兜底，拿不到 size 时和
//   handleRecord 的分母不是一回事，算出来的比例会偏。）
export function getDoodleChapterShare(rendition: any): number {
  try {
    const docs: any[] = rendition?.getChapterDoc?.() || [];
    const position = rendition?.getPosition?.() || {};
    const index = parseInt(String(position.chapterDocIndex ?? "-1"), 10);
    if (
      !docs.length ||
      !isFinite(index) ||
      index < 0 ||
      index >= docs.length
    ) {
      return 0;
    }
    const sizeOf = (item: any) => (item && item.text ? item.text.size || 1 : 1);
    let total = 0;
    for (const item of docs) total += sizeOf(item);
    if (!(total > 0)) return 0;
    const share = sizeOf(docs[index]) / total;
    return isFinite(share) && share > 0 ? share : 0;
  } catch (e) {
    return 0;
  }
}

// 一「屏」占多少**全书**进度（0~1）。双页模式一屏跨两页，所以乘 pagesPerView。
//
// ⚠️ 单位必须和 percentage 对齐：percentage 是**全书百分比**（见上面 handleRecord 的
// 算法），所以窗口宽度也只能是全书百分比。
//
// 曾经的坑（症状：某一页画的涂鸦，翻到本章任何一页都还在）：
//   这里原来直接拿 getProgress().totalPage 当分母。但 CoRead 从不给渲染内核传
//   isShowTotalPage（kookit 里默认 "no"），此时 getProgress().totalPage 返回的是
//   **本章**的屏数，不是全书页数。于是
//       span_old = 屏数 / 本章屏数     ← 分母是本章
//   而比的是全书百分比 —— 单位差了「全书章数」这个量级：
//   一本 30 章的小说，span_old ≈ 0.2，×0.52 之后每页的收编窗口高达全书的 ±10%，
//   而一章才占全书 3%，等于把整章笔迹都收进来了。
//   现在改成「一屏占全书多少」= 屏数 × 本章占比 / 本章屏数。
//
// 拿不到章节占比时返回 0（= 关闭模糊收编）。宁可少认（最多看不到同伴跨设备笔迹），
// 也不能乱认（那会让上一页的涂鸦粘在下一页上，直接毁掉「一页就是一张纸」的体感）。
export async function getDoodlePageSpan(rendition: any): Promise<number> {
  try {
    const progress = await rendition?.getProgress?.();
    const chapterPages = parseInt(String(progress?.totalPage ?? "0"), 10);
    if (!isFinite(chapterPages) || chapterPages <= 0) return 0;
    const mode = ConfigService.getReaderConfig("readerMode") || "double";
    const pagesPerView = mode === "double" ? 2 : 1;
    const chapterShare = getDoodleChapterShare(rendition);
    if (!(chapterShare > 0)) return 0;
    const span = (pagesPerView * chapterShare) / chapterPages;
    return isFinite(span) && span > 0 ? span : 0;
  } catch (e) {
    return 0;
  }
}

function medianOf(values: number[]): number | null {
  const list = values
    .filter((value) => typeof value === "number" && isFinite(value))
    .sort((a, b) => a - b);
  if (list.length === 0) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 === 1
    ? list[mid]
    : (list[mid - 1] + list[mid]) / 2;
}

export function dedupeBookPages(pages: DoodlePageMap): {
  pages: DoodlePageMap;
  removed: Record<string, string[]>;
} {
  const pageKeys = Object.keys(pages || {});
  const ownerPages = new Map<string, string[]>();
  for (const key of pageKeys) {
    for (const stroke of pages[key] || []) {
      if (!stroke || !stroke.id) continue;
      const owners = ownerPages.get(stroke.id);
      if (!owners) {
        ownerPages.set(stroke.id, [key]);
      } else if (!owners.includes(key)) {
        owners.push(key);
      }
    }
  }
  const duplicated = Array.from(ownerPages.values()).some(
    (owners) => owners.length > 1
  );
  if (!duplicated) return { pages, removed: {} };

  // 候选页按「章 + 页号」排序：同分时保留页号更小的那一页
  // （串页 bug 主要是向前扩散的，原始页通常在前）
  for (const [id, owners] of ownerPages) {
    if (owners.length < 2) continue;
    owners.sort((a, b) => {
      const pa = parseDoodlePageKey(a);
      const pb = parseDoodlePageKey(b);
      if (!pa || !pb) return a.localeCompare(b);
      if (pa.chapter !== pb.chapter) return pa.chapter.localeCompare(pb.chapter);
      return pa.page - pb.page;
    });
    ownerPages.set(id, owners);
  }

  const ratioOfPage = new Map<string, number>();
  for (const key of pageKeys) {
    const solo = (pages[key] || []).filter(
      (stroke) =>
        stroke && stroke.id && (ownerPages.get(stroke.id)?.length || 0) === 1
    );
    const value = medianOf(solo.map((stroke) => Number(stroke.percentage)));
    if (value !== null && isFinite(value)) ratioOfPage.set(key, value);
  }

  // 同章内按页号插值 / 外推，给没有独有笔迹的页补锚点
  const byChapter = new Map<string, { key: string; page: number }[]>();
  for (const key of pageKeys) {
    const parsed = parseDoodlePageKey(key);
    if (!parsed) continue;
    const list = byChapter.get(parsed.chapter) || [];
    list.push({ key, page: parsed.page });
    byChapter.set(parsed.chapter, list);
  }
  for (const list of byChapter.values()) {
    list.sort((a, b) => a.page - b.page);
    const known = list.filter((item) => ratioOfPage.has(item.key));
    if (known.length < 2) continue;
    const first = known[0];
    const last = known[known.length - 1];
    const span = Math.max(1, last.page - first.page);
    const step =
      (ratioOfPage.get(last.key)! - ratioOfPage.get(first.key)!) / span;
    for (const item of list) {
      if (ratioOfPage.has(item.key)) continue;
      const before = [...known].reverse().find((k) => k.page < item.page);
      const after = known.find((k) => k.page > item.page);
      if (before && after) {
        const total = after.page - before.page;
        const t = total === 0 ? 0 : (item.page - before.page) / total;
        ratioOfPage.set(
          item.key,
          ratioOfPage.get(before.key)! +
            t * (ratioOfPage.get(after.key)! - ratioOfPage.get(before.key)!)
        );
      } else if (before) {
        ratioOfPage.set(
          item.key,
          ratioOfPage.get(before.key)! + step * (item.page - before.page)
        );
      } else if (after) {
        ratioOfPage.set(
          item.key,
          ratioOfPage.get(after.key)! - step * (after.page - item.page)
        );
      }
    }
  }

  const cleaned: DoodlePageMap = {};
  const removed: Record<string, string[]> = {};
  for (const key of pageKeys) {
    const kept: DoodleStroke[] = [];
    for (const stroke of pages[key] || []) {
      if (!stroke || !stroke.id) continue;
      const owners = ownerPages.get(stroke.id) || [key];
      if (owners.length < 2) {
        kept.push(stroke);
        continue;
      }
      const target = Number(stroke.percentage);
      let best = owners[0];
      let bestScore = Number.POSITIVE_INFINITY;
      for (const candidate of owners) {
        const ratio = ratioOfPage.get(candidate);
        const score =
          ratio === undefined || !isFinite(target)
            ? Number.POSITIVE_INFINITY
            : Math.abs(ratio - target);
        if (score < bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      if (best === key) {
        kept.push(stroke);
      } else {
        if (!removed[key]) removed[key] = [];
        removed[key].push(stroke.id);
      }
    }
    if (kept.length > 0) cleaned[key] = kept;
  }
  return { pages: cleaned, removed };
}

// ── 服务端个人云(换端可见)────────────────────────────────────────────
// 本地与云端按 stroke.id 取并集(单页版,loadDoodlePage 用的是这个逻辑)。
// 返回 merged=合并结果,pending=本地独有(需要补传)的笔迹。
export function mergeDoodleStrokes(
  cloudStrokes: DoodleStroke[],
  localStrokes: DoodleStroke[]
): { merged: DoodleStroke[]; pending: DoodleStroke[] } {
  const byId = new Map<string, DoodleStroke>();
  for (const stroke of cloudStrokes || []) {
    if (stroke && stroke.id) byId.set(stroke.id, stroke);
  }
  const pending: DoodleStroke[] = [];
  for (const stroke of localStrokes || []) {
    if (!stroke || !stroke.id) continue;
    if (!byId.has(stroke.id)) {
      byId.set(stroke.id, stroke);
      pending.push(stroke);
    }
  }
  return { merged: Array.from(byId.values()), pending };
}

// 本地 + 云端按页取并集(同 id 以云端为准)。loadDoodlePage 与「导出全书」共用，
// 保证两条路看到的是同一份数据。
function mergeLocalAndCloud(
  local: DoodlePageMap,
  cloud: DoodlePageMap | null
): DoodlePageMap {
  const combined: DoodlePageMap = {};
  for (const key of Object.keys(local || {})) {
    combined[key] = (local[key] || []).slice();
  }
  if (cloud) {
    for (const key of Object.keys(cloud)) {
      const byId = new Map<string, DoodleStroke>();
      for (const stroke of cloud[key] || []) {
        if (stroke && stroke.id) byId.set(stroke.id, stroke);
      }
      for (const stroke of combined[key] || []) {
        if (stroke && stroke.id && !byId.has(stroke.id)) {
          byId.set(stroke.id, stroke);
        }
      }
      combined[key] = Array.from(byId.values());
    }
  }
  return combined;
}

// ── 导出：整理出「这本书的全部涂鸦」──────────────────────────────────
// 本地 + 云端取并集后跑去重，返回按页 key 分组的干净数据（导出 JSON 备份用）。
export async function collectAllDoodlePages(bookKey: string): Promise<{
  pages: DoodlePageMap;
  totalStrokes: number;
  authors: string[];
}> {
  const local = await loadLocalDoodles(bookKey);
  let cloud: DoodlePageMap | null = null;
  try {
    cloud = await collabClient.fetchBookDoodles(bookKey);
  } catch (e) {
    cloud = null;
  }
  const { pages } = dedupeBookPages(mergeLocalAndCloud(local, cloud));
  let totalStrokes = 0;
  const authors = new Set<string>();
  for (const key of Object.keys(pages)) {
    for (const stroke of pages[key] || []) {
      if (!stroke || !stroke.id) continue;
      totalStrokes += 1;
      authors.add(stroke.authorName || stroke.authorId || "我");
    }
  }
  return { pages, totalStrokes, authors: Array.from(authors) };
}

// 读某一页:本地 + 云端取并集,并顺手跑一遍历史脏数据去重。
// 不能只看云端 —— 离线时画的笔迹只落了本地,如果因为「云端整本书有数据但
// 没有这一页」就把本地丢掉,那笔永远同步不上去,用户体感是"白画了"。
// fuzzy 传入时(共读/多设备场景),同一章里进度落在当前页范围内的笔迹
// 也会一并返回,但这部分只用于展示:displayOnlyIds 列出它们的 id,
// 调用方落盘时必须把这几笔剔除(否则同一笔会以不同 pageKey 在各端复制)。
export async function loadDoodlePage(
  bookKey: string,
  pageKey: string,
  fuzzy?: { chapterKey: string; pctStart: number; span: number }
): Promise<{ strokes: DoodleStroke[]; displayOnlyIds: Set<string> }> {
  const local = await loadLocalDoodles(bookKey);

  let cloud: DoodlePageMap | null = null;
  try {
    cloud = await collabClient.fetchBookDoodles(bookKey);
  } catch (e) {
    // 云端不可达:只用本地
    cloud = null;
  }

  const { pages: cleanPages, removed } = dedupeBookPages(
    mergeLocalAndCloud(local, cloud)
  );

  // 有历史脏数据就就地修：本地重写一遍，云端把这些重复笔迹删掉（尽力而为）
  if (Object.keys(removed).length > 0) {
    const localClean: DoodlePageMap = {};
    for (const key of Object.keys(local)) {
      if (cleanPages[key] && cleanPages[key].length > 0) {
        localClean[key] = cleanPages[key];
      }
    }
    void saveLocalDoodleBook(bookKey, localClean).then(() => {
      for (const key of Object.keys(removed)) {
        if (!local[key]) continue;
        void collabClient.saveBookDoodlePage(bookKey, key, [], removed[key]);
      }
    });
  }

  const pageStrokes = cleanPages[pageKey] || [];

  // 跨设备页号对不上:按进度把同章「就在这一屏附近」的笔迹收进来展示。
  // 只拼在返回值上,不进入 upload/去重写回逻辑 —— 那会让同一笔以不同
  // pageKey 在各端存储里互相复制。
  const displayOnlyIds = new Set<string>();
  let displayStrokes = pageStrokes;
  if (fuzzy && fuzzy.span > 0 && isFinite(fuzzy.pctStart)) {
    const seen = new Set(pageStrokes.map((s) => s.id));
    const extras = [
      ...collectFuzzyStrokes(local, fuzzy.chapterKey, fuzzy.pctStart, fuzzy.span),
      ...(cloud
        ? collectFuzzyStrokes(
            cloud,
            fuzzy.chapterKey,
            fuzzy.pctStart,
            fuzzy.span
          )
        : []),
    ].filter(
      (stroke) =>
        !seen.has(stroke.id) &&
        (!(stroke as any).bookKey || (stroke as any).bookKey === bookKey)
    );
    if (extras.length > 0) {
      for (const stroke of extras) displayOnlyIds.add(stroke.id);
      displayStrokes = pageStrokes.concat(extras);
    }
  }

  // 本地有、云端没有的,顺手补传上去,别让离线笔迹永远留在本地
  if (cloud) {
    const synced = syncedIdsFor(bookKey, pageKey);
    // 云端已有的笔迹 = 已经同步过了，记下来，后面落盘时不必重传
    for (const stroke of cloud[pageKey] || []) {
      if (stroke && stroke.id) synced.add(stroke.id);
    }
    const pending = pageStrokes.filter(
      (stroke) => stroke && stroke.id && !synced.has(stroke.id)
    );
    if (pending.length > 0) {
      const pageCopy = pageStrokes;
      void collabClient
        .saveBookDoodlePage(bookKey, pageKey, pending)
        .then((ok) => {
          // 成功才记入「已同步」；失败就留着，下次落盘再带上去
          if (ok) {
            for (const stroke of pageCopy) {
              if (stroke && stroke.id) synced.add(stroke.id);
            }
          }
        });
    }
  }
  return { strokes: displayStrokes, displayOnlyIds };
}

// 写某一页:本地 + 云端各存一份。
// removedIds 传给服务端做真正的删除(不传的话服务端只做并集,删不掉)。
//
// 只把「还没同步过的那几笔」传上去，不再整页重传：
// 一页画得密（客户端上限 2000 笔）时整页 JSON 会撞上服务端请求体上限，
// 于是云端从此再也同步不上、还毫无提示 —— 这是「白画一场」的主要来源。
export async function saveDoodlePage(
  bookKey: string,
  pageKey: string,
  strokes: DoodleStroke[],
  removedIds: string[] = []
): Promise<void> {
  await saveLocalDoodlePage(bookKey, pageKey, strokes);
  const synced = syncedIdsFor(bookKey, pageKey);
  const delta = strokes.filter(
    (stroke) => stroke && stroke.id && !synced.has(stroke.id)
  );
  // 没有新增、也没有删除：这一页早就同步过了，一个请求都不用发
  if (delta.length === 0 && removedIds.length === 0) return;
  const ok = await collabClient.saveBookDoodlePage(
    bookKey,
    pageKey,
    delta,
    removedIds
  );
  if (ok) {
    for (const stroke of delta) synced.add(stroke.id);
    for (const id of removedIds) synced.delete(id);
  } else {
    notifyDoodleSyncFailure();
  }
}

// ── 云端同步状态：哪些笔迹已经写进服务端 ────────────────────────────────
// 落盘时只上传「没同步过的」，靠的就是这张表。按「书::页」分组，进程内有效。
const SYNCED_STROKE_IDS = new Map<string, Set<string>>();

function syncedIdsFor(bookKey: string, pageKey: string): Set<string> {
  const key = `${bookKey}::${pageKey}`;
  let set = SYNCED_STROKE_IDS.get(key);
  if (!set) {
    set = new Set<string>();
    SYNCED_STROKE_IDS.set(key, set);
  }
  return set;
}

// 同步失败要让人看得见（但要节流，别一失败就刷屏）。
let lastSyncFailAt = 0;
function notifyDoodleSyncFailure() {
  const now = Date.now();
  if (now - lastSyncFailAt < 8000) return;
  lastSyncFailAt = now;
  toast.error("笔记暂时同步到云端失败，已存在本地；联网后会自动补传", {
    id: "doodle-sync-fail",
    duration: 4000,
  });
}

// ── 共读房间「同步涂鸦」开关 ─────────────────────────────────────────
const DOODLE_SYNC_KEY = "koodo-doodle-collab-sync";

export function isDoodleSyncEnabled(): boolean {
  try {
    // 默认开:进房就是想互相看到笔记,不想要的人手动关一次即可(记住选择)
    return localStorage.getItem(DOODLE_SYNC_KEY) !== "off";
  } catch (e) {
    return true;
  }
}

export function setDoodleSyncEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(DOODLE_SYNC_KEY, enabled ? "on" : "off");
  } catch (e) {
    // localStorage 不可用时忽略
  }
}

// ── 「一笔一划」实时同步开关 ───────────────────────────────────────────
// 打开后，画的过程中会按 ~50ms 节流把新增的点推给同伴，同伴看着字一笔笔
// 写出来（像真人写在你面前），而不是收笔时整笔啪地冒出来。
// 代价是网络请求变多（一笔约 10~40 个很小的请求），弱网/大房间可关掉。
const DOODLE_LIVE_KEY = "koodo-doodle-live-sync";

export function isDoodleLiveEnabled(): boolean {
  try {
    // 默认开：这是「模仿现实」的体验开关，用户没关过就是想要
    return localStorage.getItem(DOODLE_LIVE_KEY) !== "off";
  } catch (e) {
    return true;
  }
}

export function setDoodleLiveEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(DOODLE_LIVE_KEY, enabled ? "on" : "off");
  } catch (e) {
    // localStorage 不可用时忽略
  }
}
