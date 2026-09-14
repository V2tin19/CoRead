import DOMPurify from "dompurify";

// 房间笔记是「别人发过来的」，落地前必须过一道关。
//
// 为什么需要：接收端会把 note.range 交给 rendition.createOneNote()，
// 渲染库内部 JSON.parse(note.range) 后按字符范围把笔记插进 iframe 的 DOM；
// note.notes / note.text 也会参与渲染。而笔记内容来自别人的选中文本，
// 里面出现 <script> 这类字面量是完全可能的。
//
// 这里不做「猜这条是不是攻击」，只做三件事：
//   1) 字段白名单 —— 只放行 Note 模型认得的字段，其余一律丢掉；
//   2) 长度上限 —— 单字段都不许无限长（防内存/磁盘被灌爆）；
//   3) 文本净化 —— notes 走一遍 DOMPurify；range 必须是「纯数字嵌套数组」。
// 只要 range 不合法，这条笔记就整条丢弃（本地正常生成的笔记 range 一定是
// 数字数组，丢掉说明它本来就会让渲染库抛错）。

const MAX_TEXT = 20000;
const MAX_RANGE = 20000;
const MAX_TAG = 5;
const MAX_RANGE_NUMBERS = 5000;

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

// range 的合法形状:kookit 用 rangy 存选区,实际是
//   { characterRange: { start: 123, end: 456 }, backward: false, characterOptions: {...} }
// 即「数字/布尔组成的浅对象嵌套」。以前只接受纯数字数组,把每一笔正常的
// 远端笔记/高亮都整条误杀了 —— 症状就是「笔记和高亮从来没同步成功过」。
// 现在接受 数字/布尔/null/数组/普通对象 的嵌套,仍保留深度与数量上限,
// 字符串值一律拒绝(渲染端只需要数字,不需要任何文本)。
function sanitizeRange(raw: string): string {
  if (!raw) return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(0, MAX_RANGE));
  } catch (e) {
    return "";
  }
  let count = 0;
  const ok = (node: unknown, depth: number): boolean => {
    if (depth > 6) return false;
    if (typeof node === "number") {
      if (!isFinite(node)) return false;
      count += 1;
      return count <= MAX_RANGE_NUMBERS;
    }
    if (typeof node === "boolean" || node === null) return true;
    if (Array.isArray(node)) {
      return node.length <= 64 && node.every((item) => ok(item, depth + 1));
    }
    if (typeof node === "object") {
      const entries = Object.entries(node as Record<string, unknown>);
      if (entries.length > 24) return false;
      return entries.every(
        ([key, value]) => key.length <= 40 && ok(value, depth + 1)
      );
    }
    return false;
  };
  if (!ok(parsed, 0)) return "";
  if (count === 0) return "";
  return JSON.stringify(parsed);
}

function sanitizeDate(value: any): {
  year: number;
  month: number;
  day: number;
} {
  const pick = (v: unknown) => {
    const n = Number(v);
    return isFinite(n) && n >= 0 && n < 100000 ? n : 0;
  };
  if (!value || typeof value !== "object") {
    return { year: 0, month: 0, day: 0 };
  }
  return {
    year: pick(value.year),
    month: pick(value.month),
    day: pick(value.day),
  };
}

/** 校验/净化一条来自房间的笔记；不合法返回 null（调用方应直接丢弃） */
export function sanitizeRemoteNote(note: any): any | null {
  if (!note || typeof note !== "object") return null;
  const key = str(note.key, 200);
  if (!key || !/^[0-9A-Za-z_-]{1,200}$/.test(key)) return null;
  const range = sanitizeRange(str(note.range, MAX_RANGE));
  if (!range) return null;
  const chapterIndex = Number(note.chapterIndex);
  if (!isFinite(chapterIndex) || chapterIndex < 0 || chapterIndex > 100000) {
    return null;
  }
  return {
    key,
    bookKey: str(note.bookKey, 200),
    chapter: str(note.chapter, 500),
    chapterIndex,
    text: DOMPurify.sanitize(str(note.text, MAX_TEXT)),
    cfi: str(note.cfi, 500),
    range,
    notes: DOMPurify.sanitize(str(note.notes, MAX_TEXT)),
    percentage: str(note.percentage, 32),
    color: str(note.color, 32),
    tag: Array.isArray(note.tag)
      ? note.tag
          .filter((item: any) => typeof item === "string")
          .slice(0, MAX_TAG)
          .map((item: string) => item.slice(0, 40))
      : [],
    authorName: str(note.authorName, 40),
    authorId: str(note.authorId, 64),
    createdAt:
      typeof note.createdAt === "number" && isFinite(note.createdAt)
        ? note.createdAt
        : Date.now(),
    date: sanitizeDate(note.date),
  };
}

/** 房间发来的笔记 key（删除/更新用）：只接受简单标识符 */
export function sanitizeRemoteNoteKey(value: unknown): string {
  const key = str(value, 200);
  return /^[0-9A-Za-z_-]{1,200}$/.test(key) ? key : "";
}
