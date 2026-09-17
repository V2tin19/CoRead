import React from "react";
import "./popupNote.css";
import Note from "../../../models/Note";
import _ from "underscore";
import { PopupNoteProps, PopupNoteState } from "./interface";
import NoteTag from "../../noteTag";
import { Trans } from "react-i18next";
import toast from "react-hot-toast";
import { getIframeDoc } from "../../../utils/reader/docUtil";
import { ensureSelectionAlive } from "../../../utils/reader/mouseEvent";
import {
  HighlightUtil,
} from '../../../services';
import {
  configStore,
  readingProgressStore,
  noteStore,
} from "../../../core/ports/stores";
import DatabaseService from "../../../utils/storage/databaseService";
import ColorOption from "../../colorOption";
import copy from "copy-text-to-clipboard";
import collabClient, {
  getCollabBookKey,
} from "../../../utils/collab/collabClient";
import { getOrCreateDisplayName } from "../../../utils/collab/roomBook";
class PopupNote extends React.Component<PopupNoteProps, PopupNoteState> {
  highlightUtil: any;
  constructor(props: PopupNoteProps) {
    super(props);
    this.highlightUtil = new HighlightUtil(configStore);
    this.state = { tag: [], text: "", note: null };
  }
  async componentDidMount() {
    let textArea: any = document.querySelector(".editor-box");
    textArea && textArea.focus();
    if (this.props.noteKey) {
      let note: Note = await DatabaseService.getRecord(
        this.props.noteKey,
        "notes"
      );
      if (!note) {
        // 记录不在库里。两个来源：
        //   1) 老版本遗留的「孤儿高亮」—— 当年 noteStore.saveNote 用
        //      updateRecord 写新记录（静默 no-op），高亮画出来了但笔记没入库；
        //   2) 打开编辑器前后被同伴 / 另一个标签页删掉。
        // 老实现这里直接 note.text 会抛 TypeError，而 componentDidMount 是
        // async 生命周期、没人接这个 promise ⇒ 只在控制台留一条
        // unhandled rejection，界面停在一个「看着能用、点确认必报
        // 未找到对应笔记」的假编辑器上。现在明确退出，不留假状态。
        console.warn("[note] record not found for key", this.props.noteKey);
        toast.error("这条笔记的数据已丢失，请重新选中文字再记一次");
        this.closeEditorWithoutDelete();
        return;
      }
      this.setState({
        text: note.text,
        tag: note.tag,
        note: note,
      });
      textArea.value = note.notes;
      let { styleType, color } = this.highlightUtil.getHighlightValue(
        note.color || "background-#FEF3CD"
      );
      this.props.handleHighlight({
        styleType,
        color,
      });
    } else {
      let docs = getIframeDoc(this.props.currentBook.format);
      let text = "";
      for (let i = 0; i < docs.length; i++) {
        let doc = docs[i];
        if (!doc) continue;
        // 手机上点菜单那一下会清掉选区，先把快照恢复回来，否则摘录是空的
        ensureSelectionAlive(doc);
        text = doc.getSelection()?.toString() || "";
        if (text) {
          break;
        }
      }
      if (!text) return;

      text = text.replace(/\s\s/g, "");
      text = text.replace(/\r/g, "");
      text = text.replace(/\n/g, "");
      text = text.replace(/\t/g, "");
      text = text.replace(/\f/g, "");
      this.setState({ text });
    }
  }
  handleTag = (tag: string[]) => {
    this.setState({ tag });
  };

  // 把时间戳格式化成"刚刚 / N 分钟前 / MM-DD HH:mm"
  formatNoteTime(timestamp?: number): string {
    if (!timestamp || !Number.isFinite(timestamp)) return "";
    const diff = Date.now() - timestamp;
    if (diff < 0) return "";
    const minute = 60 * 1000;
    if (diff < minute) return this.props.t("just now");
    if (diff < 60 * minute) {
      return `${Math.floor(diff / minute)}${this.props.t("min ago")}`;
    }
    const d = new Date(timestamp);
    const pad = (n: number) => String(n).padStart(2, "0");
    const isToday =
      d.getFullYear() === new Date().getFullYear() &&
      d.getMonth() === new Date().getMonth() &&
      d.getDate() === new Date().getDate();
    const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return isToday
      ? hhmm
      : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hhmm}`;
  }

  handleNoteClick = (event: Event) => {
    const el = (event.target as HTMLElement) || (event.currentTarget as HTMLElement);
    const key = el?.getAttribute("data-key") || (el as any)?.dataset?.key;
    if (key) {
      this.props.handleNoteKey(key);
      this.props.handleMenuMode("note");
      this.props.handleOpenMenu(true);
    }
  };
  async createNote() {
    let notes =
      (document.querySelector(".editor-box") as HTMLInputElement)?.value || "";

    if (this.props.noteKey) {
      const snapshot = this.state.note;
      // 记录可能在编辑期间消失（同伴删除 / 另一个标签页清掉）。
      // mount 时拿到的 state.note 是完整的 Note（含 range / cfi），用它按
      // **同一个 key** 补写回去 —— 用户刚敲进去的内容不能因为一条网络消息就丢，
      // 高亮与笔记的 key 关联也保持不变。
      const existing = await DatabaseService.getRecord(
        this.props.noteKey,
        "notes"
      );
      if (!existing && !snapshot) {
        // 连快照都没有 = 孤儿高亮（来龙去脉见 componentDidMount 里的注释），
        // 没有 range 也就无从重建，只能请用户重记一次。
        toast.error("这条笔记的数据已丢失，请重新选中文字再记一次");
        this.closeEditorWithoutDelete();
        return;
      }
      const isRecreated = !existing;
      let newNote: Note = (existing || { ...(snapshot as any) }) as Note;
      newNote.notes = notes;
      newNote.tag = this.state.tag;
      newNote.color =
        this.highlightUtil.formatHighlightValue(this.props.highlight) ||
        newNote.color;
      if (isRecreated) {
        // 记录不在库里 → 必须 insert；直接 updateRecord 会静默丢掉这条笔记
        await DatabaseService.saveRecord(newNote, "notes");
        collabClient
          .broadcastNote(getCollabBookKey(this.props.currentBook), newNote)
          .catch((error) => console.warn("Failed to broadcast note", error));
      } else {
        await DatabaseService.updateRecord(newNote, "notes");
        collabClient
          .broadcastNoteUpdate(getCollabBookKey(this.props.currentBook), newNote)
          .catch((error) => console.warn("Failed to broadcast note", error));
      }
      this.props.handleOpenMenu(false);
      this.props.handleFetchNotes();
      this.props.handleMenuMode("");
      this.props.handleNoteKey("");
      this.props.handleShowPopupNote(false);
      toast.success(this.props.t("Update successful") || "笔记已保存");
      if (this.props.htmlBook && this.props.htmlBook.rendition) {
        this.props.htmlBook.rendition.removeOneNote(
          this.props.noteKey,
          this.props.chapterDocIndex
        );
        this.props.htmlBook.rendition.createOneNote(
          newNote,
          this.handleNoteClick
        );
      }
    } else {
      let cfi = JSON.stringify(
        configStore.getObjectConfig(
          this.props.currentBook.key,
          "recordLocation",
          {}
        )
      );
      if (
        this.props.currentBook.format === "PDF" &&
        !configStore.getAllListConfig("convertPDFBooks").includes(
          this.props.currentBook.key
        )
      ) {
        let bookLocation = this.props.htmlBook.rendition.getPositionByChapter(
          this.props.chapterDocIndex
        );
        cfi = JSON.stringify(bookLocation);
      }
      let bookKey = this.props.currentBook.key;
      let rendition = this.props.htmlBook?.rendition;
      let getCoords =
        rendition?.getHighlightCoords || rendition?.getHightlightCoords;
      if (!getCoords) {
        // 老实现只 console.warn 就 return —— 用户点「确认」什么反应都没有，
        // 既没保存也没提示，是最难排查的一类静默失效。这里必须让用户看见。
        console.warn("Rendition highlight coords method missing");
        toast.error("当前阅读模式不支持记笔记（如 PDF 双页模式）");
        return;
      }
      // ⚠️ 取不到选区必须在**落库之前**拦住。
      // getHighlightCoords 内部是 `rangy.saveCharacterRanges(doc.body)[0]`，
      // 没选中文字时返回 undefined ⇒ JSON.stringify(undefined) 仍是 undefined，
      // 笔记会带着 range=undefined 入库；下次打开这本书，kookit 的
      // renderHighlighters 会对每条笔记做 `JSON.parse(item.range)`（那一行没有
      // try 保护）⇒ 直接抛错，**整本书的高亮和笔记全都渲染不出来**。
      // 一条坏笔记连坐整本书，所以这里必须先验证再写。
      // 校验形状与 kookit 自己的判据保持一致（range.characterRange.start/end 为数字）。
      const rawCoords: any = await getCoords.call(
        rendition,
        this.props.chapterDocIndex
      );
      const charRange = rawCoords?.characterRange;
      if (
        !charRange ||
        typeof charRange.start !== "number" ||
        typeof charRange.end !== "number" ||
        charRange.end <= charRange.start
      ) {
        toast.error("没有取到选中的文字，请重新选中后再记笔记");
        return;
      }
      let range = JSON.stringify(rawCoords);

      let rawPercentage =
        readingProgressStore.getProgressSync(this.props.currentBook.key)
          ?.percentage;
      let percentage =
        rawPercentage !== undefined && rawPercentage !== null
          ? String(rawPercentage)
          : "0";

      let color =
        this.highlightUtil.formatHighlightValue(this.props.highlight) ||
        "background-#FEF3CD";
      let tag = this.state.tag;

      let note = new Note(
        bookKey,
        this.props.chapter,
        this.props.chapterDocIndex,
        this.state.text,
        cfi,
        range,
        notes,
        percentage,
        color,
        tag,
        // 共读作者信息:昵称来自「个人设置」,clientId 用于判断"是不是我"
        getOrCreateDisplayName(),
        collabClient.clientId
      );
      await DatabaseService.saveRecord(note, "notes");
      collabClient
        .broadcastNote(getCollabBookKey(this.props.currentBook), note)
        .catch((error) => console.warn("Failed to broadcast note", error));
      this.props.handleOpenMenu(false);
      this.props.handleFetchNotes();
      this.props.handleMenuMode("");
      toast.success(this.props.t("Addition successful") || "笔记已保存");
      if (rendition) {
        await rendition.createOneNote(
          note,
          this.handleNoteClick
        );
      }
    }
  }
  handleUpdateHighlight = () => {};

  // 关掉编辑器但**不删笔记**。
  // 注意不能用下面的 handleClose()：它在 noteKey 有值时会 deleteRecord，
  // 而我们要处理的正是「noteKey 有值但记录已经不在」的场景。
  closeEditorWithoutDelete = () => {
    this.props.handleOpenMenu(false);
    this.props.handleMenuMode("");
    this.props.handleNoteKey("");
    this.props.handleShowPopupNote(false);
  };

  handleClose = () => {
    if (this.props.noteKey) {
      DatabaseService.deleteRecord(this.props.noteKey, "notes").then(() => {
        collabClient
          .broadcastNoteDelete(
            getCollabBookKey(this.props.currentBook),
            this.props.noteKey,
            this.props.chapterDocIndex
          )
          .catch((error) => console.warn("Failed to broadcast note", error));
        toast.success(this.props.t("Deletion successful"));
        this.props.handleMenuMode("");
        this.props.handleFetchNotes();
        this.props.handleNoteKey("");
        if (this.props.htmlBook && this.props.htmlBook.rendition) {
          this.props.htmlBook.rendition.removeOneNote(
            this.props.noteKey,
            this.props.chapterDocIndex
          );
        }

        this.props.handleOpenMenu(false);
        this.props.handleShowPopupNote(false);
      });
    } else {
      this.props.handleOpenMenu(false);
      this.props.handleMenuMode("");
      this.props.handleNoteKey("");
    }
  };

  render() {
    const colorOptionProps = {
      handleDigest: this.handleUpdateHighlight,
      isEdit: true,
      noteItem: this.state.note,
    };
    let note = this.state.note;

    // 共读场景下展示"这条笔记是谁做的"。个人笔记没有作者字段,这一行不出现。
    const renderAuthor = () => {
      if (!note) return null;
      const authorName = (note as any).authorName;
      const authorId = (note as any).authorId;
      if (!authorName && !authorId) return null;
      // 判断是不是自己做的:作者设备 id 与当前 clientId 一致
      const isMine = Boolean(authorId) && authorId === collabClient.clientId;
      const label = authorName || authorId || "";
      const time = this.formatNoteTime((note as any).createdAt);
      return (
        <div className="note-author">
          <span className={"note-author-badge" + (isMine ? " is-mine" : "")}>
            {isMine ? this.props.t("Me") : this.props.t("Collaborator")}
          </span>
          <span className="note-author-name" title={authorId || ""}>
            {label}
          </span>
          {time && <span className="note-author-time">{time}</span>}
        </div>
      );
    };

    const renderNoteEditor = () => {
      return (
        <div className="note-editor">
          <div className="note-original-text">{this.state.text}</div>
          {renderAuthor()}
          <div className="editor-box-parent">
            <textarea
              className="editor-box"
              style={{ height: "calc(100% - 90px)" }}
            />
          </div>
          <ColorOption {...(colorOptionProps as any)} />
          <div
            className="note-tags"
            style={{
              position: "absolute",
              bottom: "35px",
              height: "40px",
              width: "calc(100% - 40px)",
            }}
          >
            <NoteTag
              {...({
                handleTag: this.handleTag,
                tag: this.props.noteKey && note ? note.tag : [],
              } as any)}
            />
          </div>

          <div className="note-button-container">
            <span
              className="book-manage-title"
              onClick={() => {
                copy(this.state.text);
                toast.success(this.props.t("Copying successful"));
              }}
            >
              <Trans>Copy quotes</Trans>
            </span>
            <span
              className="book-manage-title"
              onClick={() => {
                this.handleClose();
              }}
            >
              {this.props.noteKey ? (
                <Trans>Delete</Trans>
              ) : (
                <Trans>Cancel</Trans>
              )}
            </span>
            <span
              className="book-manage-title"
              onClick={() => {
                this.createNote();
              }}
            >
              <Trans>Confirm</Trans>
            </span>
          </div>
        </div>
      );
    };
    return renderNoteEditor();
  }
}
export default PopupNote;
