import { NoteRange } from "../domain/render";

/**
 * 笔记、书签与标注存储端口定义
 */
export interface INoteStore {
  getAllNotes(bookKey?: string): Promise<NoteRange[]>;
  getNote(key: string): Promise<NoteRange | null>;
  saveNote(note: NoteRange): Promise<void>;
  deleteNote(key: string): Promise<void>;

  getAllBookmarks(bookKey?: string): Promise<any[]>;
  saveBookmark(bookmark: any): Promise<void>;
  deleteBookmark(key: string): Promise<void>;
}
