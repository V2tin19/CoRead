import toast from "react-hot-toast";
import Note from "../../models/Note";
import { configStore, readingProgressStore, noteStore } from "../../core/ports/stores";
import { getIframeDoc } from "./docUtil";
import collabClient, { getCollabBookKey } from "../collab/collabClient";
import { getOrCreateDisplayName } from "../collab/roomBook";

export interface DigestParams {
  currentBook: any;
  htmlBook: any;
  chapterDocIndex: number;
  chapter: string;
  color: string;
  t: (key: string) => string;
  onNoteClick?: (event: Event) => void;
  onSuccess?: () => void;
}

export async function createHighlight(params: DigestParams): Promise<void> {
  const {
    currentBook,
    htmlBook,
    chapterDocIndex,
    chapter,
    onNoteClick,
    onSuccess,
  } = params;
  let color = params.color;

  if (!htmlBook) return;

  // 契约 14: 高亮颜色必须严格编码为 styleType-#RRGGBB 格式，默认 background-#RRGGBB
  if (color && !color.includes("-") && color.startsWith("#")) {
    color = `background-${color}`;
  }

  let bookKey = currentBook.key;
  let bookLocation: any = readingProgressStore.getProgressSync(bookKey) || {};
  let cfi = JSON.stringify(bookLocation);

  if (
    currentBook.format === "PDF" &&
    !configStore.getAllListConfig("convertPDFBooks").includes(currentBook.key)
  ) {
    let pdfLocation = htmlBook.rendition.getPositionByChapter(chapterDocIndex);
    cfi = JSON.stringify(pdfLocation);
  }

  let percentage = bookLocation.percentage ? bookLocation.percentage : "0";
  let docs = getIframeDoc(currentBook.format, currentBook.key);
  let text = "";
  for (let i = 0; i < docs.length; i++) {
    let doc = docs[i];
    if (!doc) continue;
    text = doc.getSelection()?.toString() || "";
    if (text) break;
  }
  if (!text) return;

  text = text.replace(/\s\s/g, "");
  text = text.replace(/\r/g, "");
  text = text.replace(/\n/g, "");
  text = text.replace(/\t/g, "");
  text = text.replace(/\f/g, "");

  // ⚠️ range 取不到就别落库（与 popupNote.createNote 同款防线）。
  // getHighlightCoords 是 `rangy.saveCharacterRanges(doc.body)[0]`，拿不到选区时
  // 返回 undefined，而 JSON.stringify(undefined) 仍是 undefined ⇒ 记录带着
  // range=undefined 入库。之后 kookit 的 renderHighlighters 会对整本书的每条笔记
  // 做 `JSON.parse(item.range)`（那行没有 try 保护）⇒ 抛错 ⇒ **这本书的高亮和
  // 笔记全部渲染不出来**。一条坏记录连坐整本书，代价太大。
  // 判据与 kookit 自己的校验保持一致（characterRange.start / end 必须为数字）。
  const rawCoords: any = await htmlBook.rendition.getHightlightCoords(
    chapterDocIndex
  );
  const charRange = rawCoords?.characterRange;
  if (
    !charRange ||
    typeof charRange.start !== "number" ||
    typeof charRange.end !== "number" ||
    charRange.end <= charRange.start
  ) {
    console.warn("[note] empty selection range, skip creating note");
    toast.error("没有取到选中的文字，请重新选中后再试");
    return;
  }
  let range = JSON.stringify(rawCoords);

  let highlight = new Note(
    bookKey,
    chapter,
    chapterDocIndex,
    text,
    cfi,
    range,
    "",
    percentage,
    color,
    [],
    // 共读作者信息(个人使用时这两个字段不影响任何现有逻辑)
    getOrCreateDisplayName(),
    collabClient.clientId
  );

  await noteStore.saveNote(highlight);
  await htmlBook.rendition.createOneNote(highlight, onNoteClick ?? (() => {}));
  collabClient
    .broadcastNote(getCollabBookKey(currentBook), highlight)
    .catch((error) => console.warn("Failed to broadcast note", error));
  onSuccess?.();
}
