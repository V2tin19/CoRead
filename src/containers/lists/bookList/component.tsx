import React from "react";
import "./booklist.css";
import BookCardItem from "../../../components/bookCardItem";
import BookListItem from "../../../components/bookListItem";
import BookCoverItem from "../../../components/bookCoverItem";
import BookModel from "../../../models/Book";
import { BookListProps, BookListState } from "./interface";
import { ConfigService } from '../../../services';
import { Redirect, withRouter } from "react-router-dom";
import ViewMode from "../../../components/viewMode";
import SelectBook from "../../../components/selectBook";
import { Trans } from "react-i18next";
import Book from "../../../models/Book";
import { isElectron } from "react-device-detect";
import DatabaseService from "../../../utils/storage/databaseService";
import { throttle } from "../../../utils/common";
import BookGroupHeader from "../../../components/bookGroupHeader";
import {
  BookGroup,
  FOCUS_GROUP_EVENT,
  GROUPS_CHANGED_EVENT,
  GROUPS_SCOPE_PERSONAL,
  consumeFocusGroup,
  readCollapsedGroups,
  readPersonalGroups,
  scrollToGroupHeader,
  segmentByGroup,
  writeCollapsedGroups,
} from "../../../utils/group/bookGroup";
declare var window: any;
let currentBookMode = "home";
function getBookCountPerPage() {
  const container = document.querySelector(
    ".book-list-container"
  ) as HTMLElement;
  if (!container) return 24; // fallback
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;
  const bookWidth = 133;
  const bookHeight = 201;
  const columns = Math.max(1, Math.floor(containerWidth / bookWidth));
  const rows = Math.max(1, Math.floor(containerHeight / bookHeight)) + 2;
  return columns * rows;
}

class BookList extends React.Component<BookListProps, BookListState> {
  private scrollContainer: React.RefObject<HTMLUListElement>;
  private visibilityChangeHandler: ((event: Event) => void) | null = null;
  private resizeHandler: (() => void) | null = null;

  constructor(props: BookListProps) {
    super(props);
    this.scrollContainer = React.createRef();
    this.state = {
      favoriteBooks: Object.keys(
        ConfigService.getAllListConfig("favoriteBooks")
      ).length,
      isHideShelfBook:
        ConfigService.getReaderConfig("isHideShelfBook") === "yes",
      isShowShelfBookCount:
        ConfigService.getReaderConfig("isShowShelfBookCount") === "yes",
      displayedBooksCount: 24,
      isLoadingMore: false,
      fullBooksData: [], // 存储从数据库加载的完整书籍数据
      cardScale: parseFloat(ConfigService.getReaderConfig("cardScale") || "1"),
      readingStatusFilter: "",
      groups: readPersonalGroups(),
      collapsedGroups: readCollapsedGroups(GROUPS_SCOPE_PERSONAL),
    };
  }
  UNSAFE_componentWillMount() {
    this.props.handleFetchBooks();
  }

  async componentDidMount() {
    if (!this.props.books || !this.props.books[0]) {
      return <Redirect to="manager/empty" />;
    }
    this.setState({
      displayedBooksCount: getBookCountPerPage(),
    });

    // 保存 resize 监听器引用（节流，避免拖拽窗口时频繁触发）
    this.resizeHandler = throttle(() => {
      //recount the book count per page when the window is resized
      this.props.handleFetchBooks();
    });
    window.addEventListener("resize", this.resizeHandler);

    // 设置滚动监听器
    this.setupScrollListener();

    // 保存 visibilitychange 监听器引用
    this.visibilityChangeHandler = async (event) => {
      if (document.visibilityState === "visible" && !isElectron) {
        await this.handleFinishReading();
      }
    };
    document.addEventListener("visibilitychange", this.visibilityChangeHandler);

    if (isElectron) {
      const { ipcRenderer } = window.require("electron");
      ipcRenderer.on("reading-finished", async (event: any, config: any) => {
        this.handleFinishReading();
      });
    }

    // 初始加载完整的书籍数据
    await this.loadFullBooksData();

    // 分组变了（别处弹窗加了书/改了成员关系）就重新读一遍本地配置
    window.addEventListener(GROUPS_CHANGED_EVENT, this.handleGroupsChanged);
    // 别处（详情弹窗的书架标签、启动时的默认分组）要求「跳到某个分组」
    window.addEventListener(FOCUS_GROUP_EVENT, this.handleFocusGroup);
    // 挂载前就已经发过的聚焦请求也别丢：requestFocusGroup 会留一份待领取记录
    this.handleFocusGroup();
  }

  componentWillUnmount() {
    // 清理滚动监听器
    this.cleanupScrollListener();

    window.removeEventListener(GROUPS_CHANGED_EVENT, this.handleGroupsChanged);
    window.removeEventListener(FOCUS_GROUP_EVENT, this.handleFocusGroup);

    // 清理 resize 监听器
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }

    // 清理 visibilitychange 监听器
    if (this.visibilityChangeHandler) {
      document.removeEventListener(
        "visibilitychange",
        this.visibilityChangeHandler
      );
      this.visibilityChangeHandler = null;
    }

    // 清理 IPC 监听器
    if (isElectron) {
      const { ipcRenderer } = window.require("electron");
      ipcRenderer.removeAllListeners("reading-finished");
    }
  }

  componentDidUpdate(prevProps: BookListProps, prevState: BookListState) {
    // 当书籍列表更新时，重置显示数量
    if (
      prevProps.books !== this.props.books ||
      prevProps.searchResults !== this.props.searchResults ||
      prevProps.isSearch !== this.props.isSearch ||
      prevProps.mode !== this.props.mode ||
      prevProps.shelfTitle !== this.props.shelfTitle
    ) {
      this.setState({
        displayedBooksCount: getBookCountPerPage(),
        isLoadingMore: false,
      });
      this.props.handleLoadMore(false);
      // 滚动到顶部
      if (this.scrollContainer.current) {
        this.scrollContainer.current.scrollTop = 0;
      }
      // 重新加载完整的书籍数据
      this.loadFullBooksData();
    }
    // 阅读状态筛选变化时，重新加载完整书籍数据
    if (prevState.readingStatusFilter !== this.state.readingStatusFilter) {
      this.loadFullBooksData();
    }
  }

  /** 分组数据变化 → 重新读本地配置（就地重渲染，不做任何跳转） */
  handleGroupsChanged = (event?: Event) => {
    const detail = (event as CustomEvent)?.detail || {};
    // 只认个人书架这一路；房间书架的广播与这里无关
    if (detail.scope && detail.scope !== GROUPS_SCOPE_PERSONAL) return;
    this.setState({
      groups: readPersonalGroups(),
      collapsedGroups: readCollapsedGroups(GROUPS_SCOPE_PERSONAL),
    });
  };

  /**
   * 「跳到某个分组」：先展开它（收起状态下滚过去也看不到东西），
   * 等下一帧再把标题行滚进视野并闪一下。
   */
  handleFocusGroup = (event?: Event) => {
    const detail = (event as CustomEvent)?.detail || {};
    const name = detail.name || consumeFocusGroup();
    if (!name) return;
    const collapsedGroups = this.state.collapsedGroups.filter(
      (item) => item !== name
    );
    if (collapsedGroups.length !== this.state.collapsedGroups.length) {
      writeCollapsedGroups(GROUPS_SCOPE_PERSONAL, collapsedGroups);
    }
    this.setState({ collapsedGroups }, () => {
      const container = this.scrollContainer.current;
      window.requestAnimationFrame(() => scrollToGroupHeader(container, name));
    });
  };

  toggleGroupCollapse = (name: string) => {
    const collapsed = this.state.collapsedGroups.includes(name)
      ? this.state.collapsedGroups.filter((item) => item !== name)
      : [...this.state.collapsedGroups, name];
    this.setState({ collapsedGroups: collapsed });
    writeCollapsedGroups(GROUPS_SCOPE_PERSONAL, collapsed);
  };

  /** 头部那个「一个开关」：有任意一段展开着就全部收起，否则全部展开 */
  isAllGroupsCollapsed = (groups: BookGroup[]) => {
    const names = groups.map((group) => group.name);
    return (
      names.length > 0 &&
      names.every((name) => this.state.collapsedGroups.includes(name))
    );
  };

  toggleAllGroups = () => {
    const collapsed = this.isAllGroupsCollapsed(this.state.groups)
      ? []
      : this.state.groups.map((group) => group.name);
    this.setState({ collapsedGroups: collapsed });
    writeCollapsedGroups(GROUPS_SCOPE_PERSONAL, collapsed);
  };

  // 从数据库加载完整的书籍数据
  loadFullBooksData = async () => {    const { books } = this.handleBooks();
    const displayedBooks = books.slice(0, this.state.displayedBooksCount);

    const fullBooksData: Book[] = [];
    for (let i = 0; i < displayedBooks.length; i++) {
      const book = await DatabaseService.getRecord(
        displayedBooks[i].key,
        "books"
      );
      if (book) {
        fullBooksData.push(book);
      }
    }

    this.setState({ fullBooksData });
  };
  handleFinishReading = async () => {
    if (!this.scrollContainer.current) return;
    if (
      this.scrollContainer.current &&
      this.scrollContainer.current.scrollTop > 100
    ) {
      //ignore if the scroll is not at top
    } else {
      this.props.handleFetchBooks();
    }
  };

  setupScrollListener = () => {
    const scrollContainer = this.scrollContainer.current;
    if (scrollContainer) {
      scrollContainer.addEventListener("scroll", this.handleScroll);
    }
  };

  cleanupScrollListener = () => {
    const scrollContainer = this.scrollContainer.current;
    if (scrollContainer) {
      scrollContainer.removeEventListener("scroll", this.handleScroll);
    }
  };

  handleScroll = () => {
    const scrollContainer = this.scrollContainer.current;
    if (!scrollContainer || this.state.isLoadingMore) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    // 当滚动到底部附近时触发加载更多
    if (scrollTop + clientHeight >= scrollHeight - 300) {
      this.loadMoreBooks();
    }
  };

  loadMoreBooks = () => {
    const { books } = this.handleBooks();
    const { displayedBooksCount } = this.state;

    if (displayedBooksCount >= books.length) {
      return; // 已经显示所有图书
    }

    this.setState({ isLoadingMore: true });
    this.props.handleLoadMore(true);
    // 异步加载更多书籍数据
    setTimeout(async () => {
      const newDisplayedBooksCount = Math.min(
        displayedBooksCount + getBookCountPerPage(),
        books.length
      );

      // 加载新增的书籍数据
      const newBooks = books.slice(displayedBooksCount, newDisplayedBooksCount);
      const newFullBooksData: Book[] = [];
      for (let i = 0; i < newBooks.length; i++) {
        const book = await DatabaseService.getRecord(newBooks[i].key, "books");
        if (book) {
          newFullBooksData.push(book);
        }
      }

      this.setState({
        displayedBooksCount: newDisplayedBooksCount,
        isLoadingMore: false,
        fullBooksData: [...this.state.fullBooksData, ...newFullBooksData],
      });
    }, 100);
  };

  handleKeyFilter = (items: any[], arr: string[]) => {
    let itemArr: any[] = [];
    arr.forEach((item) => {
      items.forEach((subItem: any) => {
        if (subItem.key === item) {
          itemArr.push(subItem);
        }
      });
    });
    return itemArr;
  };

  handleShelf(items: any, shelfTitle: string) {
    if (!shelfTitle) return items;
    let currentShelfTitle = shelfTitle;
    let currentShelfList = ConfigService.getMapConfig(
      currentShelfTitle,
      "shelfList"
    );
    let shelfItems = items.filter((item: { key: number }) => {
      return currentShelfList.indexOf(item.key) > -1;
    });
    return shelfItems;
  }

  //get the searched books according to the index
  handleIndexFilter = (items: any, arr: number[]) => {
    let itemArr: any[] = [];
    arr.forEach((item) => {
      items[item] && itemArr.push(items[item]);
    });
    return itemArr;
  };
  handleFilterShelfBook = (items: BookModel[]) => {
    return items.filter((item) => {
      return (
        ConfigService.getFromAllMapConfig(item.key, "shelfList").length === 0
      );
    });
  };
  handleCardScaleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const scale = parseFloat(e.target.value);
    this.setState({ cardScale: scale });
    ConfigService.setReaderConfig("cardScale", String(scale));
  };

  filterBooksByReadingStatus = (books: Book[], status: string): Book[] => {
    if (!status) return books;
    return books.filter((book) => {
      const record = ConfigService.getObjectConfig(
        book.key,
        "recordLocation",
        {}
      );
      const percentage: string =
        record && record.percentage ? record.percentage : "";
      if (status === "unread") {
        return !percentage || percentage === "0";
      } else if (status === "reading") {
        return percentage && percentage !== "0" && percentage !== "1";
      } else if (status === "finished") {
        return percentage === "1";
      }
      return true;
    });
  };

  /** 渲染一段里的书卡（三种视图共用），sectionName 只用来拼 React key */
  private renderSectionBooks = (
    items: BookModel[],
    sectionName: string,
    orderIndex: Map<string, number>,
    allBooks: BookModel[]
  ) => {
    return items.map((item: BookModel, index: number) => {
      // bookIndex 取这本书在「整个可见列表」里的下标（不是段内下标）：shift 连选
      // 靠它算区间，段内下标会让跨段的连选错位。
      const bookIndex = orderIndex.has(String(item.key))
        ? (orderIndex.get(String(item.key)) as number)
        : index;
      const common = {
        book: item,
        isSelected: this.props.selectedBooks.indexOf(item.key) > -1,
        allBooks,
        bookIndex,
      };
      const itemKey = sectionName + "|" + String(item.key);
      return this.props.viewMode === "list" ? (
        <BookListItem key={itemKey} {...({ ...common } as any)} />
      ) : this.props.viewMode === "card" ? (
        <BookCardItem
          key={itemKey}
          {...({ ...common, cardScale: this.state.cardScale } as any)}
        />
      ) : (
        <BookCoverItem key={itemKey} {...({ ...common } as any)} />
      );
    });
  };

  renderBookList = (books: Book[], bookMode: string) => {
    if (books.length === 0 && !this.props.isSearch) {
      return <Redirect to="/manager/empty" />;
    }
    if (bookMode !== currentBookMode) {
      currentBookMode = bookMode;
    }

    // 使用状态中已加载的完整书籍数据，并按当前过滤后的 books 顺序/范围进行裁剪
    const filteredKeys = new Set(books.map((b) => b.key));
    const displayedBooks = this.props.isSearch
      ? books
      : this.state.fullBooksData.filter((b) => filteredKeys.has(b.key));

    const orderIndex = new Map<string, number>();
    displayedBooks.forEach((book, index) => {
      if (!orderIndex.has(String(book.key))) {
        orderIndex.set(String(book.key), index);
      }
    });

    // 只有在「我的图书」这一页才分段；搜索/收藏/隐藏分组书这些视图保持原样。
    // 一个分组都没有时整条分段逻辑直接跳过 —— 没分组的老用户界面零变化。
    const groups = this.state.groups;
    if (bookMode !== "home" || groups.length === 0) {
      return this.renderSectionBooks(
        displayedBooks,
        "all",
        orderIndex,
        displayedBooks
      );
    }

    const sections = segmentByGroup(
      displayedBooks,
      groups,
      (book: BookModel) => book.key,
      ConfigService.getAllListConfig("topBooks")
    );

    // 分组都在、但这一段里一本书都没命中（比如当前是搜索/阅读状态筛选，
    // 或者这些分组的书全都已经被过滤掉了）：那就别硬塞一个孤零零的
    // 「未分组」标题，退回原来的平铺列表更干净。
    if (!sections.some((section) => section.kind !== "ungrouped")) {
      return this.renderSectionBooks(
        displayedBooks,
        "all",
        orderIndex,
        displayedBooks
      );
    }

    const nodes: React.ReactNode[] = [];
    sections.forEach((section) => {
      const collapsed =
        section.kind !== "pinned" &&
        this.state.collapsedGroups.includes(section.name);
      nodes.push(
        <BookGroupHeader
          key={"header-" + section.name}
          kind={section.kind}
          label={
            section.kind === "pinned"
              ? this.props.t("Pin to top")
              : section.kind === "ungrouped"
                ? this.props.t("Ungrouped")
                : section.name
          }
          count={section.items.length}
          showCount={this.state.isShowShelfBookCount}
          collapsed={collapsed}
          groupName={section.kind === "group" ? section.name : undefined}
          onToggle={() => {
            if (section.kind !== "pinned") {
              this.toggleGroupCollapse(section.name);
            }
          }}
        />
      );
      if (!collapsed) {
        nodes.push(
          ...this.renderSectionBooks(
            section.items,
            section.name,
            orderIndex,
            displayedBooks
          )
        );
      }
    });
    return nodes;
  };
  handleBooks = () => {
    let bookMode = this.props.isSearch
      ? "search"
      : this.props.shelfTitle
        ? "shelf"
        : this.props.mode === "favorite"
          ? "favorite"
          : this.state.isHideShelfBook
            ? "hide"
            : "home";
    let books =
      bookMode === "search"
        ? this.props.searchResults
        : bookMode === "shelf"
          ? this.handleShelf(this.props.books, this.props.shelfTitle)
          : bookMode === "favorite"
            ? this.handleKeyFilter(
                this.props.books,
                ConfigService.getAllListConfig("favoriteBooks")
              )
            : bookMode === "hide"
              ? this.handleFilterShelfBook(this.props.books)
              : this.props.books;
    if (this.state.readingStatusFilter) {
      books = this.filterBooksByReadingStatus(
        books,
        this.state.readingStatusFilter
      );
    }
    const topBookKeys: string[] = ConfigService.getAllListConfig("topBooks");
    if (topBookKeys.length > 0) {
      const topSet = new Set(topBookKeys);
      const topBooks = [...topBookKeys]
        .map((key) => books.find((b) => b.key === key))
        .filter(Boolean) as Book[];
      const restBooks = books.filter((b) => !topSet.has(b.key));
      books = [...topBooks, ...restBooks];
    }
    return {
      books,
      bookMode,
    };
  };

  render() {
    if (
      (this.state.favoriteBooks === 0 && this.props.mode === "favorite") ||
      !this.props.books ||
      !this.props.books[0]
    ) {
      return <Redirect to="/manager/empty" />;
    }
    const { books, bookMode } = this.handleBooks();
    return (
      <>
        <div
          className="book-list-header"
          style={
            this.props.isCollapsed
              ? { width: "calc(100% - 70px)", left: "70px" }
              : {}
          }
        >
          <SelectBook />

          <div
            style={this.props.isSelectBook ? { display: "none" } : {}}
            className="book-list-header-right"
          >
            {this.props.viewMode === "card" && (
              <input
                type="range"
                min="0.6"
                max="2"
                step="0.05"
                value={this.state.cardScale}
                onChange={this.handleCardScaleChange}
                className="book-card-scale-slider"
                title="Adjust cover size"
              />
            )}
            {bookMode === "home" && this.state.groups.length > 0 && (
              <>
                {/* 「一个折叠开关」：全部收起 / 全部展开，按当前状态自动换文案 */}
                <div
                  className="book-list-total-page book-list-group-toggle"
                  onClick={this.toggleAllGroups}
                >
                  {this.isAllGroupsCollapsed(this.state.groups) ? (
                    <Trans i18nKey="Expand all">展开全部分组</Trans>
                  ) : (
                    <Trans i18nKey="Collapse all">收起全部分组</Trans>
                  )}
                </div>
                {/* 分组管理（改名 / 删除 / 拖动排序）复用 sortShelfDialog，
                    它本来就在 manager 里挂着，只是一直没有入口 */}
                <div
                  className="book-list-total-page book-list-group-toggle"
                  onClick={() => this.props.handleSortShelfDialog(true)}
                >
                  <Trans i18nKey="Manage groups">管理分组</Trans>
                </div>
              </>
            )}
            <div className="book-list-total-page">
              <Trans i18nKey="Total books" count={books.length}>
                {"Total " + books.length + " books"}
              </Trans>
            </div>
            <select
              className="lang-setting-dropdown"
              value={this.state.readingStatusFilter}
              onChange={(e) => {
                this.setState({ readingStatusFilter: e.target.value });
              }}
              style={{ marginRight: "10px", width: "70px", borderWidth: "0px" }}
            >
              <option value="" className="lang-setting-option">
                {this.props.t("All")}
              </option>
              <option value="unread" className="lang-setting-option">
                {this.props.t("Unread")}
              </option>
              <option value="reading" className="lang-setting-option">
                {this.props.t("CurrentlyReading")}
              </option>
              <option value="finished" className="lang-setting-option">
                {this.props.t("Finished")}
              </option>
            </select>
            <ViewMode />
          </div>
        </div>
        <div
          className="book-list-container-parent"
          style={
            this.props.isCollapsed
              ? { width: "calc(100vw - 70px)", left: "70px" }
              : {}
          }
        >
          <div className="book-list-container">
            <ul
              className="book-list-item-box"
              ref={this.scrollContainer}
              style={
                { "--card-scale": this.state.cardScale } as React.CSSProperties
              }
            >
              {this.renderBookList(books, bookMode)}
            </ul>
          </div>
        </div>
      </>
    );
  }
}

export default withRouter(BookList as any);
