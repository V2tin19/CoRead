import React from "react";
import "./popupNote.css";
import Note from "../../../models/Note";
import _ from "underscore";
import { PopupNoteProps, PopupNoteState } from "./interface";
import NoteTag from "../../noteTag";
import { Trans } from "react-i18next";
import toast from "react-hot-toast";
import { getIframeDoc } from "../../../utils/reader/docUtil";
import {
  ConfigService,
  HighlightUtil,
} from '../../../services';
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
    this.highlightUtil = new HighlightUtil(ConfigService);
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
    this.props.handleNoteKey((event.target as any).dataset.key);
    this.props.handleMenuMode("note");
    this.props.handleOpenMenu(true);
  };
  async createNote() {
    let notes = (document.querySelector(".editor-box") as HTMLInputElement)
      .value;

    if (this.props.noteKey) {
      let newNote = await DatabaseService.getRecord(
        this.props.noteKey,
        "notes"
      );
      newNote.notes = notes;
      newNote.tag = this.state.tag;
      newNote.color =
        this.highlightUtil.formatHighlightValue(this.props.highlight) ||
        newNote.color;
      DatabaseService.updateRecord(newNote, "notes").then(() => {
        collabClient
          .broadcastNoteUpdate(getCollabBookKey(this.props.currentBook), newNote)
          .catch((error) => console.warn("Failed to broadcast note", error));
        this.props.handleOpenMenu(false);
        this.props.handleFetchNotes();
        this.props.handleMenuMode("");
        this.props.handleNoteKey("");
        this.props.handleShowPopupNote(false);
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
      });
    } else {
      let cfi = JSON.stringify(
        ConfigService.getObjectConfig(
          this.props.currentBook.key,
          "recordLocation",
          {}
        )
      );
      if (
        this.props.currentBook.format === "PDF" &&
        !ConfigService.getAllListConfig("convertPDFBooks").includes(
          this.props.currentBook.key
        )
      ) {
        let bookLocation = this.props.htmlBook.rendition.getPositionByChapter(
          this.props.chapterDocIndex
        );
        cfi = JSON.stringify(bookLocation);
      }
      let bookKey = this.props.currentBook.key;
      let range = JSON.stringify(
        await this.props.htmlBook.rendition.getHightlightCoords(
          this.props.chapterDocIndex
        )
      );

      let percentage = ConfigService.getObjectConfig(
        this.props.currentBook.key,
        "recordLocation",
        {}
      ).percentage
        ? ConfigService.getObjectConfig(
            this.props.currentBook.key,
            "recordLocation",
            {}
          ).percentage
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
      DatabaseService.saveRecord(note, "notes").then(async () => {
        collabClient
          .broadcastNote(getCollabBookKey(this.props.currentBook), note)
          .catch((error) => console.warn("Failed to broadcast note", error));
        this.props.handleOpenMenu(false);
        this.props.handleFetchNotes();
        this.props.handleMenuMode("");
        await this.props.htmlBook.rendition.createOneNote(
          note,
          this.handleNoteClick
        );
      });
    }
  }
  handleUpdateHighlight = () => {};
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
