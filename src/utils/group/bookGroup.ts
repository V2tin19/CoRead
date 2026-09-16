import { ConfigService } from "../../services";

declare var window: any;

/**
 * 分组（= 上游 Koodo 的「书架」）的公共数据层，个人书架与共读房间共用。
 *
 * 三条设计约定（2026-09-16 与果冻确认）：
 *   1. **多对多**：一本书可以同时在多个分组里，像标签，不做互斥。
 *   2. **不做独立「书架页」**：分组只是个人书架里的一段「标题行 + 这一段书」，
 *      和没分组的书排列在同一个书架容器里。
 *   3. **一套模型两处用**：个人书架读本地配置 shelfList / sortedShelfList，
 *      共读房间读服务端 room.json 的 groups 字段。
 *
 * 兼容性坑：shelfList 里的成员 key 历史上既存过 number（书本 key 是时间戳），
 * 也存过 string（多选批量添加时传的是 string）。所以本文件一律按 String 比较，
 * 否则会出现「明明在分组里却匹配不上」的幽灵 bug。
 */

/** 一个分组：名字 + 成员 key 列表（key = 书本 key 或房间里的文件名） */
export interface BookGroup {
  name: string;
  books: string[];
}

/** 分段结果里的一「段」 */
export interface BookSection<T> {
  /** pinned = 置顶段，group = 真实分组，ungrouped = 未分组段 */
  kind: "pinned" | "group" | "ungrouped";
  /** 分组名；pinned / ungrouped 用下面的保留常量 */
  name: string;
  items: T[];
}

/** 置顶段 / 未分组段的保留 id（不会和用户起的分组名冲突，分组名会被 sanitize） */
export const PINNED_SECTION = "__pinned__";
export const UNGROUPED_SECTION = "__ungrouped__";

/** 分组变化广播：加了书、改了成员关系后，两个书架都靠它重渲染 */
export const GROUPS_CHANGED_EVENT = "coread-groups-changed";
export const GROUPS_SCOPE_PERSONAL = "personal";

/** 折叠状态、聚焦请求存在 readerConfig 里的键名 */
const COLLAPSED_GROUPS_KEY = "collapsedGroups";

/** 分组名长度上限（服务端也用同一档） */
export const MAX_GROUP_NAME_LENGTH = 60;

export function notifyGroupsChanged(scope: string, roomId?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(GROUPS_CHANGED_EVENT, { detail: { scope, roomId } })
  );
}

export function sameKey(a: any, b: any): boolean {
  return String(a) === String(b);
}

/**
 * 分组名清洗：砍掉控制字符与路径/序列化敏感符号、去首尾空格、限长。
 *
 * 禁止符号沿用 sortShelfDialog 里重命名书架时那一套（`[]{}",:/\|<>*?`），
 * 保证新建的分组名和老代码生成的分组名一个规格。
 * 前端做一遍是为了让用户立刻看到非法字符被吞掉，服务端那遍是兜底。
 */
export function sanitizeGroupName(raw: any): string {
  return String(raw == null ? "" : raw)
    .replace(/[\[\]{}",:\/\\|<>*?]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, MAX_GROUP_NAME_LENGTH);
}

/** 读个人书架的全部分组，顺序按 sortedShelfList，未登记的组名排在后面 */
export function readPersonalGroups(): BookGroup[] {
  const map: Record<string, any[]> =
    ConfigService.getAllMapConfig("shelfList") || {};
  const order: string[] = (ConfigService.getAllListConfig("sortedShelfList") ||
    []) as string[];
  const ordered = order.filter((name) => map.hasOwnProperty(name));
  const rest = Object.keys(map).filter((name) => order.indexOf(name) < 0);
  return [...ordered, ...rest]
    .filter((name) => !!sanitizeGroupName(name))
    .map((name) => ({
      name,
      books: (map[name] || []).map((k) => String(k)),
    }));
}

/**
 * 个人书架：把 bookKeys 这组书的分组成员关系**整体**设为 groupNames。
 * 传进来的每个组名都会包含这组书，没传的组名则把这组书移出去。
 * 空数组 = 从所有分组移除（取消分组）。返回新的 shelfList。
 */
export function applyPersonalGroupDiff(
  bookKeys: any[],
  groupNames: string[]
): Record<string, any[]> {
  const keys = bookKeys.map((k) => String(k)).filter(Boolean);
  const wanted = new Set(
    groupNames.map(sanitizeGroupName).filter((name) => !!name)
  );
  const map: Record<string, any[]> =
    ConfigService.getAllMapConfig("shelfList") || {};

  wanted.forEach((name) => {
    if (!map[name]) map[name] = [];
  });

  Object.keys(map).forEach((name) => {
    const current = (map[name] || []).map((k) => String(k));
    let next = current.filter(
      (existing) => !keys.some((k) => sameKey(k, existing)) || wanted.has(name)
    );
    if (wanted.has(name)) {
      keys.forEach((k) => {
        if (!next.some((existing) => sameKey(existing, k))) next.push(k);
      });
    }
    if (next.length === current.length && next.every((v, i) => v === current[i])) {
      return; // 没变化就不写盘，省掉一次同步记录
    }
    // 用 setOneMapConfig 而不是 setAllMapConfig：后者不写 syncRecord，
    // 云同步会看不到这次改动。
    ConfigService.setOneMapConfig(name, next, "shelfList");
    map[name] = next;
  });

  // 新组名登记进 sortedShelfList（保留既有顺序，新组追加到末尾）
  const order: string[] = (ConfigService.getAllListConfig("sortedShelfList") ||
    []) as string[];
  const nextOrder = order.filter((n) => !!n);
  wanted.forEach((name) => {
    if (nextOrder.indexOf(name) < 0) nextOrder.push(name);
  });
  if (nextOrder.length !== order.length) {
    ConfigService.setAllListConfig(nextOrder, "sortedShelfList");
  }

  notifyGroupsChanged(GROUPS_SCOPE_PERSONAL);
  return map;
}

/** 一本书当前所在的全部分组名（多对多，可能多个） */
export function getPersonalGroupsOfBook(bookKey: any): string[] {
  return readPersonalGroups()
    .filter((g) => g.books.some((k) => sameKey(k, bookKey)))
    .map((g) => g.name);
}

/**
 * 把有序的书切成「置顶 / 各分组 / 未分组」若干段。
 *
 * 分段规则（刻意保留两种语义，别合并）：
 *   · 置顶是**位置指令** —— 被置顶的书提到最前，并从它所属的分组段里摘掉，
 *     否则同一本书会在相邻两段里各出现一次，很跳。
 *   · 分组是**归属标签** —— 一本书属于几个组就在几段里各出现一次，
 *     这才让「多对多」有意义。
 *   · 空段直接不产出，所以没有分组时整个分段结果为「未分组一段 = 原样」。
 */
export function segmentByGroup<T>(
  items: T[],
  groups: BookGroup[],
  getKey: (item: T) => any,
  pinnedKeys: any[] = []
): BookSection<T>[] {
  const sections: BookSection<T>[] = [];
  const claimedByPin = new Set<string>();

  if (pinnedKeys.length > 0) {
    const pinned = items.filter((item) =>
      pinnedKeys.some((k) => sameKey(k, getKey(item)))
    );
    if (pinned.length > 0) {
      pinned.forEach((item) => claimedByPin.add(String(getKey(item))));
      sections.push({ kind: "pinned", name: PINNED_SECTION, items: pinned });
    }
  }

  groups.forEach((group) => {
    const members = new Set(group.books.map((k) => String(k)));
    const inGroup = items.filter((item) => {
      const key = String(getKey(item));
      return members.has(key) && !claimedByPin.has(key);
    });
    if (inGroup.length > 0) {
      sections.push({ kind: "group", name: group.name, items: inGroup });
    }
  });

  const grouped = new Set<string>();
  groups.forEach((g) => g.books.forEach((k) => grouped.add(String(k))));
  const rest = items.filter((item) => !grouped.has(String(getKey(item))));
  if (rest.length > 0) {
    sections.push({
      kind: "ungrouped",
      name: UNGROUPED_SECTION,
      items: rest,
    });
  }
  return sections;
}

/**
 * 折叠状态：按「作用域」存一份，个人书架用 personal，房间用房间号。
 * 存成 readerConfig 里的一个对象，避免为每个房间加一个配置键。
 */
export function readCollapsedGroups(scope: string): string[] {
  const all = ConfigService.getReaderConfig(COLLAPSED_GROUPS_KEY) || {};
  const list = all && Array.isArray(all[scope]) ? all[scope] : [];
  return list.map((n: any) => String(n));
}

export function writeCollapsedGroups(scope: string, names: string[]): void {
  const all = ConfigService.getReaderConfig(COLLAPSED_GROUPS_KEY) || {};
  all[scope] = Array.from(new Set(names.map((n) => String(n))));
  ConfigService.setReaderConfig(COLLAPSED_GROUPS_KEY, all);
}

/**
 * 「跳到某个分组」请求。
 *
 * 触发点在别的组件里（详情弹窗的书架标签、启动时的默认分组），而列表组件
 * 可能还没挂载 —— 所以除了发事件，这里还留一份模块级待领取记录，
 * 列表组件挂载时会先领一次。不用 localStorage 是为了避免「上次点了没看，
 * 下次打开还自动跳」。
 */
let pendingFocusGroup: string | null = null;
export const FOCUS_GROUP_EVENT = "coread-focus-group";

export function requestFocusGroup(name: string): void {
  const target = sanitizeGroupName(name);
  if (!target) return;
  pendingFocusGroup = target;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(FOCUS_GROUP_EVENT, { detail: { name: target } })
    );
  }
}

export function consumeFocusGroup(): string | null {
  const name = pendingFocusGroup;
  pendingFocusGroup = null;
  return name;
}

/** 把分组段的标题行滚进可视区，并闪一下高亮（列表组件拿到 focus 请求后调用） */
export function scrollToGroupHeader(container: Element | null, name: string): void {
  if (!container) return;
  const target = container.querySelector(
    `[data-group-name="${CSS.escape(name)}"]`
  ) as HTMLElement | null;
  if (!target) return;
  target.scrollIntoView({ block: "start", behavior: "smooth" });
  target.classList.add("book-group-header-focus");
  setTimeout(() => target.classList.remove("book-group-header-focus"), 1200);
}
