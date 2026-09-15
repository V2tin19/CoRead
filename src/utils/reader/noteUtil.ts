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

  let range = JSON.stringify(
    await htmlBook.rendition.getHightlightCoords(chapterDocIndex)
  );

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
