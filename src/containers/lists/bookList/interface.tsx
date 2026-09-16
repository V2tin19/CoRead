import BookModel from "../../../models/Book";
import { RouteComponentProps } from "react-router";
import { BookGroup } from "../../../utils/group/bookGroup";
export interface BookListProps extends RouteComponentProps<any> {
  books: BookModel[];
  mode: string;
  shelfTitle: string;
  searchResults: number[];
  isSearch: boolean;
  isCollapsed: boolean;
  currentPage: number;
  totalPage: number;
  isSelectBook: boolean;
  viewMode: string;
  selectedBooks: string[];

  bookSortCode: { sort: number; order: number };
  noteSortCode: { sort: number; order: number };
  handleAddDialog: (isShow: boolean) => void;
  handleMode: (mode: string) => void;
  handleFetchBooks: () => void;
  handleShelf: (shelfTitle: string) => void;
  handleDeleteDialog: (isShow: boolean) => void;
  handleLoadMore: (isLoadMore: boolean) => void;
  /** 打开「管理分组」弹窗（就是原来那个 sortShelfDialog） */
  handleSortShelfDialog: (isOpen: boolean) => void;
  t: (title: string) => string;
}
export interface BookListState {
  favoriteBooks: number;
  isHideShelfBook: boolean;
  /** 「显示每个书架中的图书数量」——现在用来决定分组标题后面要不要跟数字 */
  isShowShelfBookCount: boolean;
  displayedBooksCount: number;
  isLoadingMore: boolean;
  fullBooksData: BookModel[];
  cardScale: number;
  readingStatusFilter: string;
  /** 个人书架的全部分组（多对多，成员 key 一律存成字符串） */
  groups: BookGroup[];
  /** 被收起的分组名；默认空 = 全部展开 */
  collapsedGroups: string[];
}
