import BookModel from "../../../models/Book";
import HtmlBook from "../../../models/HtmlBook";
import { HighlightValue } from "../../../utils/common";

export interface PopupMenuProps {
  currentBook: BookModel;
  isOpenMenu: boolean;
  isChangeDirection: boolean;
  menuMode: string;

  highlight: HighlightValue;
  rendition: any;
  htmlBook: HtmlBook;
  // cfiRange: any;
  rect: any;
  noteKey: string;
  chapterDocIndex: number;
  chapter: string;
  readerMode: string;
  handleNoteKey: (key: string) => void;
  t: (title: string) => string;
  handleOpenMenu: (isOpenMenu: boolean) => void;
  handleMenuMode: (menu: string) => void;
  handleChangeDirection: (isChangeDirection: boolean) => void;
  handleRenderNoteFunc: (renderNoteFunc: () => void) => void;
  handleOriginalText: (originalText: string) => void;
  handleOriginalSentence: (originalSentence: string) => void;
  handleFetchNotes: () => void;
  handleQuoteText?: (quoteText: string) => void;
  handleSpeechDialog?: (isOpen: boolean) => void;
  handleSpeechStartText?: (text: string) => void;
  handleSpeechAutoStart?: (auto: boolean) => void;
  handleHighlight?: (highlight: any) => void;
}
export interface PopupMenuStates {
  deleteKey: string;
  isRightEdge: boolean;
  rect: DOMRect | null;
  showColorPicker: boolean;
  activeHighlightKey: string;
  currentStyle: string;
  currentColor: string;
  arrowLeft: number;
  isArrowTop: boolean;
  posX: number;
  posY: number;
  menuWidth: number;
}
