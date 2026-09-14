import Book from "../../../models/Book";

export interface ModeControlProps {
  renderBookFunc: () => void;
  t: (title: string) => string;
  readerMode: string;
  currentBook: Book;
  handleReaderMode: (readerMode: string) => void;
}

export interface ModeControlState {
  /** 是否在共读房间中:共读模式下滑动阅读被禁用 */
  inRoom: boolean;
}
