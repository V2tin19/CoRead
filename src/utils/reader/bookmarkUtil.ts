/**
 * 手机端「下拉页面 = 加 / 撤标签」的落点逻辑
 * ==========================================
 * 果冻的要求（2026-09-17）：
 *   手指往下滑 → 阅读页跟手往下 → 越过阈值后**留下标签并回弹**；再次下滑取消标签。
 *
 * 分工：
 *   · `pageSwipeTurn.ts` 负责「动作」——识别纵向下拉、平移页面壳、越阈值回弹，
 *     然后无条件派发 `TOGGLE_BOOKMARK_BY_GESTURE_EVENT`；
 *   · 本模块负责「判断」——这一页到底该加还是该撤。
 *     只有这一层同时握有**当前阅读位置**和**书签库**。
 *
 * 为什么不复用 `operationPanel` 现成的 `handleAddBookmark`：
 *   1. 它只加不撤（果冻明确要「再次下滑取消」）；
 *   2. 它读位置时漏了 `await`：
 *      `readingProgressStore.getProgress()` 返回的是 **Promise**，
 *      取 `.percentage` / `.text` / `.page` 恒为 undefined ⇒ 判重条件
 *      （`percentage` 与 `page` 两两相等）**恒真** ⇒ 一本书只能存下第一个书签，
 *      第二次点按钮必定弹「书签已存在」。
 *      这里不把这个坑复刻一遍：位置一律取 `rendition.getPosition()` 的活值。
 *      （桌面端那条按钮逻辑一行没动，属于既有行为，不在本次改动范围。）
 *
 * 位置指纹（存进 `Bookmark.cfi`）取 `chapterDocIndex + count + page`：
 *   内核 `handleRecord()` 落位置时，
 *     `count` = 当前页第一个可见块在「整章块列表」里的下标（分页模式走这条）；
 *     `page`  = 整页滚动模式下的页码（滚动模式走这条，此时 count 是旧值）。
 *   两者合起来唯一标识一页；而 `timestamp` 每次都变、`xpath` 又依赖重排，
 *   所以**不能**直接 `JSON.stringify(整个 location)` 当指纹（那样同页也永远对不上）。
 */

import Bookmark from "../../models/Bookmark";
import DatabaseService from "../storage/databaseService";
import toast from "react-hot-toast";

export type GestureBookmarkResult = "added" | "removed" | "failed";

/** 与 operationPanel 同一套清洗规则，保证标签预览文本的观感一致 */
function normalizeText(input: string): string {
  return (input || "")
    .replace(/\s\s/g, "")
    .replace(/\r/g, "")
    .replace(/\n/g, "")
    .replace(/\t/g, "")
    .replace(/\f/g, "");
}

/** 把「当前页」压成一个稳定的短字符串（用于高可靠快速比对） */
export function placeSignature(location: any): string {
  if (!location) return "";
  const chapter = location.chapterDocIndex ?? location.chapterIndex ?? "";
  const count = location.count ?? "";
  const page = location.page ?? "";
  return "c" + chapter + "|n" + count + "|p" + page;
}

/** 从书签对象或 CFI 字符串中安全提取指纹字符串 */
export function getBookmarkSignature(bookmarkOrLocation: any): string {
  if (!bookmarkOrLocation) return "";
  if (typeof bookmarkOrLocation === "string") {
    if (bookmarkOrLocation.startsWith("c") && bookmarkOrLocation.includes("|")) {
      return bookmarkOrLocation;
    }
    try {
      const parsed = JSON.parse(bookmarkOrLocation);
      return getBookmarkSignature(parsed);
    } catch {
      return bookmarkOrLocation;
    }
  }
  if (bookmarkOrLocation.signature) {
    return bookmarkOrLocation.signature;
  }
  if (bookmarkOrLocation.cfi) {
    return getBookmarkSignature(bookmarkOrLocation.cfi);
  }
  return placeSignature(bookmarkOrLocation);
}

/**
 * 在「当前页」上加/撤一个书签。
 *
 * @param bookKey   当前书的 key
 * @param rendition 内核 rendition（`htmlBook.rendition`，即 GeneralRender 实例）
 * @param t         i18n 取词函数（由调用方传入，本模块不持有 React 上下文）
 */
export async function toggleBookmarkByGesture(params: {
  bookKey: string;
  rendition: any;
  t: (key: string) => string;
}): Promise<GestureBookmarkResult> {
  const { bookKey, rendition, t } = params;
  if (!bookKey || !rendition) {
    return "failed";
  }

  try {
    // 先把「当前页」记准再取位置：
    // 手势翻页是我们自己滚 + `record()`，点击翻章是内核记的 —— 再记一次，
    // 保证标签落在**肉眼所见的那一页**，而不是上一页。
    // （`record()` 自带 100ms 重入闸，重复调用是安全的。）
    if (typeof rendition.record === "function") {
      await rendition.record();
    }

    const location: any =
      typeof rendition.getPosition === "function"
        ? rendition.getPosition() || {}
        : {};
    const signature = placeSignature(location);

    const records = await DatabaseService.getRecordsByBookKey(
      bookKey,
      "bookmarks"
    );
    const existed = (records || []).filter(
      (item: any) =>
        item &&
        (getBookmarkSignature(item) === signature || item.cfi === signature)
    );

    if (existed.length > 0) {
      // 这一页已经有标签 ⇒ 撤掉（果冻要的「再次下滑取消标签」）
      for (let i = 0; i < existed.length; i++) {
        await DatabaseService.deleteRecord(existed[i].key, "bookmarks");
      }
      toast.success(t("Bookmark removed"));
      return "removed";
    }

    let text = normalizeText(location.text || "");
    if (!text && typeof rendition.visibleText === "function") {
      text = normalizeText((await rendition.visibleText()).join(" "));
    }

    // 保存完整的可跳转 location 对象（包含 signature 指纹），保证目录列表点击能精准跳转
    const locationData = {
      ...location,
      signature,
      chapterDocIndex: String(location.chapterDocIndex ?? 0),
      chapterTitle: location.chapterTitle || "",
      chapterHref: location.chapterHref || "",
      count: location.count || "ignore",
      page: location.page || "",
      percentage: location.percentage || "",
      text: text.substr(0, 200),
    };

    const bookmark = new Bookmark(
      bookKey,
      JSON.stringify(locationData),
      text.substr(0, 200),
      location.percentage ?? "",
      location.chapterTitle ?? ""
    );
    await DatabaseService.saveRecord(bookmark, "bookmarks");
    toast.success(t("Bookmark added"));
    return "added";
  } catch (err) {
    // 加/撤标签失败不该影响阅读：静默返回，绝不把异常抛回手势链
    return "failed";
  }
}
