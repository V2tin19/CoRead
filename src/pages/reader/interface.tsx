import BookModel from "../../models/Book";
import BookmarkModel from "../../models/Bookmark";
import HtmlBookModel from "../../models/HtmlBook";
export interface ReaderProps {
  history?: any;
  currentBook: BookModel;
  percentage: number;
  t: (title: string) => string;
  htmlBook: HtmlBookModel;
  /** 本书全部书签（redux）。手机端顶栏的小旗按它比对「当前页有没有书签」 */
  bookmarks: BookmarkModel[];
  isNavLocked: boolean;
  isSettingLocked: boolean;
  isConvertOpen: boolean;
  isPdfCropOpen: boolean;
  isSpeechOpen: boolean;
  isOpenPopupOptionDialog: boolean;
  isSearch: boolean;
  isAuthed: boolean;
  isHidePageButton: boolean;
  isSettingOpen: boolean;
  isHideMenuButton: boolean;
  isHideAudiobookButton: boolean;
  isHideAIButton: boolean;
  isHidePDFConvertButton: boolean;
  isHideScaleButton: boolean;
  readerMode: string;
  scale: string;
  handleFetchNotes: () => void;
  handleReaderMode: (readerMode: string) => void;
  handleConvertDialog: (isConvertOpen: boolean) => void;
  handlePdfCropDialog: (isPdfCropOpen: boolean) => void;
  handleSpeechDialog: (isSpeechOpen: boolean) => void;
  handleMenuMode: (menuMode: string) => void;
  handleOriginalText: (originalText: string) => void;
  handleFetchBooks: () => void;
  handleOpenMenu: (isOpen: boolean) => void;
  handleFetchBookmarks: () => void;
  handleFetchPercentage: (currentBook: BookModel) => void;
  handleReadingBook: (book: BookModel) => void;
  handleScale: (scale: string) => void;
  renderBookFunc: () => void;
  handleFetchAuthed: () => void;
  handleFetchUserInfo: () => Promise<any>;
  handleSetting: (isSettingOpen: boolean) => void;
}

export interface ReaderState {
  isOpenRightPanel: boolean;
  isOpenTopPanel: boolean;
  isOpenBottomPanel: boolean;
  isOpenLeftPanel: boolean;
  isTouch: boolean;
  isPreventTrigger: boolean;
  hoverPanel: string;
  scale: string;
  isShowScale: boolean;
  isCollabOpen: boolean;
  isDoodleOpen: boolean;
  /** 随心笔记在手机端的左抽屉是否展开（桌面端不使用，桌面固定常显工具条） */
  isDoodleDrawerOpen: boolean;
  /** 手机端顶栏的小旗：当前这一页在书签库里已经有了（桌面端不使用） */
  isViewBookmarked: boolean;
  /** 右上角页眉(#reader-top-dock)实测宽度：涂鸦工具条要按它让开位置 */
  dockWidth: number;
  totalDuration: number;
  currentDuration: number;
}
