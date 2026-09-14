import BookModel from "../../../models/Book";
import HtmlBookModel from "../../../models/HtmlBook";

export interface NavigationPanelProps {
  currentBook: BookModel;
  htmlBook: HtmlBookModel;

  totalDuration: number;
  /** 当前阅读时长（秒），透传给嵌入的操作面板显示「当前/剩余阅读时间」 */
  currentDuration: number;
  backgroundColor: string;
  isNavLocked: boolean;
  handleFetchBookmarks: () => void;
  handleSearch: (isSearch: boolean) => void;
  handleNavLock: (isNavLocked: boolean) => void;
  t: (title: string) => string;
  renderBookFunc: () => void;
}

export interface NavigationPanelState {
  currentTab: string;
  chapters: any;
  searchState: string;
  searchList: any;
  cover: string;
  isCoverExist: boolean;
  activeSearchKey: string | null;
  collapsedChapters: Set<number>;
}
