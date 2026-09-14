import React from "react";
import "./cloudLibrary.css";
import collabClient from "../../utils/collab/collabClient";
import {
  getActiveCollabRoom,
  setActiveCollabRoom,
  clearActiveCollabRoom,
  collabAuthHeaders,
  getRoomBookLocalKey,
  setRoomBookLocalKey,
  ROOM_BOOKS_CHANGED_EVENT,
} from "../../utils/collab/roomBook";
import BookUtil from "../../utils/file/bookUtil";
import CoverUtil from "../../utils/file/coverUtil";
import { uploadRoomCover } from "../../utils/collab/roomBook";
import DatabaseService from "../../utils/storage/databaseService";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import {
  calculateFileMD5,
  getFileNameWithoutExtension,
  getTextRules,
} from "../../utils/common";
import { BookHelper } from "../../assets/lib/kookit.min";
import * as Kookit from "../../assets/lib/kookit.min";
import EmptyCover from "../../components/emptyCover";
import BookModel from "../../models/Book";
import ViewMode from "../../components/viewMode";
import toast from "react-hot-toast";
import {
  CloudBook,
  CollabRoomBrief,
  CloudLibraryProps,
  CloudLibraryState,
} from "./interface";

const PENDING_JOIN_KEY = "koodo-collab-pending-join";

class CloudLibrary extends React.Component<
  CloudLibraryProps,
  CloudLibraryState
> {
  private isMountedFlag = false;

  constructor(props: CloudLibraryProps) {
    super(props);
    this.state = {
      view: "rooms",
      rooms: [],
      activeRoom: null,
      roomBooks: [],
      createName: "",
      joinCode: "",
      isLoading: false,
      isBusy: false,
      importingBook: "",
      menuBook: "",
      dragBook: "",
      dragOverBook: "",
      error: "",
      // 与个人书架（bookList）共用同一份缩放设置，房间书架跟着一起变大小
      cardScale: parseFloat(ConfigService.getReaderConfig("cardScale") || "1"),
    };
  }

  componentDidMount() {
    this.isMountedFlag = true;
    this.refreshRooms();
    window.addEventListener(
      ROOM_BOOKS_CHANGED_EVENT,
      this.handleRoomBooksChanged
    );
  }

  componentWillUnmount() {
    this.isMountedFlag = false;
    window.removeEventListener(
      ROOM_BOOKS_CHANGED_EVENT,
      this.handleRoomBooksChanged
    );
  }

  get baseUrl() {
    return collabClient.serverUrl.replace(/\/$/, "");
  }

  get displayName() {
    return localStorage.getItem("koodo-collab-display-name") || "Reader";
  }

  handleRoomBooksChanged = (event: Event) => {
    const detail = (event as CustomEvent).detail || {};
    // 只有当前正处于这个房间(或房间列表页)时才刷新
    if (this.state.view === "room" && this.state.activeRoom) {
      if (!detail.roomId || detail.roomId === this.state.activeRoom.roomId) {
        this.refreshRoomBooks(this.state.activeRoom.roomId);
      }
    }
  };

  refreshRooms = async () => {
    if (!collabClient.isServerConfigured) {
      // 本地阅读器模式:不发请求,也不当成错误
      this.setState({ rooms: [], isLoading: false, error: "" });
      return;
    }
    this.setState({ isLoading: true, error: "" });
    try {
      const response = await fetch(`${this.baseUrl}/rooms`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      // 地址填错时可能收到 HTML（打进别的站点 / SPA fallback 吐回 index.html），
      // 别让 json() 抛语法错、把提示搞成 "Unexpected token <"
      const data = await response.json().catch(() => null);
      if (!data) {
        throw new Error("服务器没有返回预期的数据，请检查共读服务器地址");
      }
      if (!this.isMountedFlag) return;
      this.setState({ rooms: data.rooms || [] });
    } catch (error) {
      if (!this.isMountedFlag) return;
      this.setState({
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (this.isMountedFlag) this.setState({ isLoading: false });
    }
  };

  refreshRoomBooks = async (roomId: string) => {
    this.setState({ isLoading: true, error: "" });
    try {
      const response = await fetch(
        `${this.baseUrl}/rooms/${encodeURIComponent(roomId)}/books`
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!this.isMountedFlag) return;
      this.setState({ roomBooks: data.books || [] });
    } catch (error) {
      if (!this.isMountedFlag) return;
      this.setState({
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (this.isMountedFlag) this.setState({ isLoading: false });
    }
  };

  handleCreateRoom = async () => {
    const roomName = this.state.createName.trim();
    if (!roomName) {
      toast.error("请先填写房间名称");
      return;
    }
    this.setState({ isBusy: true });
    try {
      const response = await fetch(`${this.baseUrl}/rooms`, {
        method: "POST",
        headers: collabAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          clientId: collabClient.clientId,
          name: this.displayName,
          roomName,
          join: false,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      toast.success(`房间「${roomName}」已创建，房间号 ${data.roomId}`);
      this.setState({ createName: "" });
      await this.refreshRooms();
      this.enterRoom({
        roomId: data.roomId,
        name: roomName,
        bookKey: "",
        bookCount: 0,
        ownerId: collabClient.clientId,
        members: [],
        createdAt: Date.now(),
      });
    } catch (error) {
      toast.error(
        "创建失败：" + (error instanceof Error ? error.message : String(error))
      );
    } finally {
      this.setState({ isBusy: false });
    }
  };

  handleJoinRoom = async () => {
    const code = this.state.joinCode.trim().toUpperCase();
    if (!code) {
      toast.error("请先填写房间号");
      return;
    }
    this.setState({ isBusy: true });
    try {
      // 先拉房间书架验证房间存在
      const response = await fetch(
        `${this.baseUrl}/rooms/${encodeURIComponent(code)}/books`
      );
      if (!response.ok) throw new Error("房间不存在，请确认房间号");
      const roomsResponse = await fetch(`${this.baseUrl}/rooms`);
      const roomsData = roomsResponse.ok ? await roomsResponse.json() : {};
      const info = (roomsData.rooms || []).find(
        (room: CollabRoomBrief) => room.roomId === code
      );
      this.setState({ joinCode: "" });
      this.enterRoom(
        info || {
          roomId: code,
          name: "",
          bookKey: "",
          bookCount: 0,
          ownerId: "",
          members: [],
          createdAt: 0,
        }
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      this.setState({ isBusy: false });
    }
  };

  handleDeleteRoom = async (room: CollabRoomBrief) => {
    if (
      !window.confirm(
        `确认删除房间「${room.name || room.roomId}」？房间书架与共读数据都会清空`
      )
    ) {
      return;
    }
    try {
      const response = await fetch(
        `${this.baseUrl}/rooms/${encodeURIComponent(room.roomId)}`,
        {
          method: "DELETE",
          headers: collabAuthHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({ clientId: collabClient.clientId }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      toast.success(`房间 ${room.roomId} 已删除`);
      if (getActiveCollabRoom()?.roomId === room.roomId) {
        clearActiveCollabRoom();
      }
      await this.refreshRooms();
    } catch (error) {
      toast.error(
        "删除失败：" + (error instanceof Error ? error.message : String(error))
      );
    }
  };

  enterRoom = (room: CollabRoomBrief) => {
    // 记下当前所在房间,右上角「导入图书到房间」和整页拖拽都往这个房间传
    setActiveCollabRoom({ roomId: room.roomId, name: room.name || "" });
    this.setState({ view: "room", activeRoom: room, roomBooks: [], menuBook: "" });
    this.refreshRoomBooks(room.roomId);
  };

  leaveRoomView = () => {
    clearActiveCollabRoom();
    this.setState({
      view: "rooms",
      activeRoom: null,
      roomBooks: [],
      menuBook: "",
    });
    this.refreshRooms();
  };

  handleRemoveFromRoom = async (book: CloudBook) => {
    const room = this.state.activeRoom;
    if (!room) return;
    try {
      const response = await fetch(
        `${this.baseUrl}/rooms/${encodeURIComponent(
          room.roomId
        )}/books/${encodeURIComponent(book.name)}`,
        { method: "DELETE", headers: collabAuthHeaders() }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      toast.success(`已移出房间：${book.name}`);
      await this.refreshRoomBooks(room.roomId);
    } catch (error) {
      toast.error(
        "移出失败：" + (error instanceof Error ? error.message : String(error))
      );
    }
  };

  // 开始阅读:本地没有才下载 → 打上房间书标记(与个人书架隔离) → 记下待加入房间 → 跳阅读器
  // 房间书的本地导入兜底:与个人导入同一套 kookit 管线,不依赖
  // 个人书架导入组件是否挂载。成功返回带 cover 的 Book。
  parseAndSaveRoomBook = async (file: File, md5: string): Promise<BookModel | null> => {
    try {
      const extension = (file.name.split(".").pop() || "").toLowerCase();
      if (!extension) return null;
      const bookName = file.name.slice(0, file.name.length - extension.length - 1);
      const content = await file.arrayBuffer();
      const rendition = BookHelper.getRendition(
        content,
        {
          format: extension.toUpperCase(),
          readerMode: "",
          charset: "",
          animation: "none",
          convertChinese: ConfigService.getReaderConfig("convertChinese"),
          bookLayout: ConfigService.getReaderConfig("bookLayout"),
          textRules: getTextRules(),
          codeHighlight: ConfigService.getReaderConfig("codeHighlight") || "",
          fullTranslationMode: "no",
          textOrientation: ConfigService.getReaderConfig("textOrientation"),
          parserRegex: "",
          isDarkMode: "no",
          isMobile: "no",
          password: "",
          isScannedPDF: "no",
          isKeepPDFBackground: "no",
        },
        Kookit
      );
      const book: BookModel = await BookHelper.generateBook(
        bookName,
        extension,
        md5,
        file.size,
        "",
        content,
        rendition
      );
      await BookUtil.addBook(book.key, book.format.toLowerCase(), content);
      await CoverUtil.addCover(book);
      // 与个人导入一致:书记录(含封面 base64)必须落库,书架/封面才认它
      await DatabaseService.saveRecord(book, "books", false);
      return book;
    } catch (error) {
      console.error("房间书本地导入失败:", error);
      return null;
    }
  };

  handleStartReading = async (book: CloudBook) => {
    const room = this.state.activeRoom;
    if (!room) return;
    if (!this.props.importBookFunc) {
      toast.error("导入功能尚未就绪，请稍后重试");
      return;
    }
    if (this.state.importingBook) return;
    this.setState({ importingBook: book.name });
    try {
      // 第一优先：本地已经有这本书（房间+文件名+体积 命中映射，且本地库还在），
      // 直接进阅读，一个字节都不下载。
      // 老逻辑是「无论下没下过都把整本下载一遍再交给导入流程」，于是每次点开
      // 同一本书都重新下载，导入流程还会弹一句「重复书」——用户看到的就是
      // 「明明早下过了还提示我下载」。
      let md5 = getRoomBookLocalKey(room.roomId, book.name, book.size);
      let localBook = md5 ? await BookUtil.getBookByMd5(md5) : null;

      if (!localBook) {
        toast.loading("正在下载并进入共读：" + book.name, { id: "cloud-read" });
        const response = await fetch(`${this.baseUrl}${book.url}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        const file = new File([arrayBuffer], book.name);
        const computed = await calculateFileMD5(file);
        if (!computed) throw new Error("文件校验失败");
        md5 = computed;
        // 算完 md5 再查一次本地：内容一样就复用，不重复导入，也就不会弹「重复书」
        localBook = await BookUtil.getBookByMd5(md5);
        if (!localBook) {
          // 不走 redux 的 importBookFunc:个人书架导入组件未挂载时它是空函数,
          // 挂载过又卸载时是旧实例的函数(内部 Promise 可能永不 resolve,
          // 把 importingBook 卡死,之后所有点击静默返回)。这里直接用
          // kookit 自行解析导入,自包含、可重试。
          localBook = await this.parseAndSaveRoomBook(file, md5);
        }
        if (!localBook) throw new Error("本地解析失败，请重试");
        // 记下映射，下一次点开这本书直接命中
        setRoomBookLocalKey(room.roomId, book.name, book.size, md5);
      }

      // 这本书还没有房间封面时,把本地导入生成的封面补传上去(全房间可见)
      if (!book.coverUrl && localBook.cover) {
        try {
          const coverData = await CoverUtil.convertCoverBase64(localBook.cover);
          await uploadRoomCover(
            room.roomId,
            book.name,
            coverData.arrayBuffer,
            coverData.extension === "jpeg" ? "jpg" : coverData.extension
          );
          this.refreshRoomBooks(room.roomId);
        } catch (e) {
          // 封面补传失败不影响阅读
        }
      }

      // 给这本书打上房间标记:不进个人书架,笔记/高亮也随房间隔离
      await this.markBookAsCollab(localBook.key, room.roomId);
      localStorage.setItem(
        PENDING_JOIN_KEY,
        JSON.stringify({ roomId: room.roomId, bookKey: md5 })
      );
      toast.dismiss("cloud-read");
      this.props.handleReadingBook(localBook);
      await BookUtil.redirectBook(localBook);
    } catch (error) {
      toast.dismiss("cloud-read");
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      this.setState({ importingBook: "" });
    }
  };

  // 浏览器版 saveRecord 是整表追加,这里用读-改-写避免重复记录;isRecord=false 不产生云同步记录
  markBookAsCollab = async (bookKey: string, roomId: string) => {
    try {
      const records = await DatabaseService.getAllRecords("books");
      const index = records.findIndex((item: any) => item.key === bookKey);
      if (index >= 0) {
        records[index] = { ...records[index], collabRoomId: roomId };
        await DatabaseService.saveAllRecords(records, "books", false);
      }
    } catch (error) {
      console.error("标记房间书失败:", error);
    }
  };

  toggleBookMenu = (bookName: string) => {
    this.setState((prev) => ({
      menuBook: prev.menuBook === bookName ? "" : bookName,
    }));
  };

  closeBookMenu = () => {
    this.setState({ menuBook: "" });
  };

  // 拖拽排序:把拖动的书放到目标书的位置,先本地生效再同步服务器
  handleDropReorder = async (targetName: string) => {
    const fromName = this.state.dragBook;
    this.setState({ dragBook: "", dragOverBook: "" });
    if (!fromName || fromName === targetName) return;
    const books = [...this.state.roomBooks];
    const from = books.findIndex((b) => b.name === fromName);
    const to = books.findIndex((b) => b.name === targetName);
    if (from < 0 || to < 0) return;
    const [moved] = books.splice(from, 1);
    books.splice(to, 0, moved);
    this.setState({ roomBooks: books });
    const room = this.state.activeRoom;
    if (!room) return;
    try {
      const response = await fetch(
        `${this.baseUrl}/rooms/${encodeURIComponent(room.roomId)}/books/reorder`,
        {
          method: "POST",
          headers: collabAuthHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({ names: books.map((b) => b.name) }),
        }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      toast.error(
        "排序保存失败：" + (error instanceof Error ? error.message : String(error))
      );
      this.refreshRoomBooks(room.roomId);
    }
  };

  formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024) {
      return (bytes / 1024 / 1024).toFixed(1) + " MB";
    }
    if (bytes >= 1024) {
      return (bytes / 1024).toFixed(1) + " KB";
    }
    return bytes + " B";
  };

  formatDate = (timestamp: number) => {
    if (!timestamp) return "";
    const d = new Date(timestamp);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  handleCardScaleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const scale = parseFloat(e.target.value);
    this.setState({ cardScale: scale });
    ConfigService.setReaderConfig("cardScale", String(scale));
  };

  // 空封面块：三种视图共用。外层给尺寸/圆角/阴影，内层与 EmptyCover 同尺寸，
  // 借 EmptyCover 自带的 transform-origin: 0 0 + scale 正好铺满（个人书架同一套算法）。
  renderCover = (
    book: CloudBook,
    wrapClass: string,
    innerClass: string,
    scale: number
  ) => {
    const nameWithoutExt = getFileNameWithoutExtension(book.name, book.name);
    const ext = (book.name.split(".").pop() || "BOOK").toUpperCase();
    return (
      <div className={wrapClass}>
        <div className={innerClass}>
          {this.state.importingBook === book.name && (
            <div className="cloud-book-loading">准备中</div>
          )}
          {book.coverUrl ? (
            <img
              className="cloud-cover-img"
              style={{ transform: `scale(${scale})` }}
              src={this.baseUrl + book.coverUrl}
              alt={nameWithoutExt}
              draggable={false}
            />
          ) : (
            <EmptyCover format={ext} title={nameWithoutExt} scale={scale} />
          )}
        </div>
      </div>
    );
  };

  // 「⋯」+ 下拉菜单。菜单挂在按钮自己的定位容器里（top:100%），
  // 三种视图下都紧贴按钮弹出，不用再为每种视图单独调菜单位置。
  renderMoreButton = (book: CloudBook) => {
    const isMenuOpen = this.state.menuBook === book.name;
    const isImporting = this.state.importingBook === book.name;
    return (
      <div className="cloud-book-more-wrap">
        <span
          className="icon-more cloud-book-more"
          title="更多选项"
          onClick={(event) => {
            event.stopPropagation();
            this.toggleBookMenu(book.name);
          }}
        />
        {isMenuOpen && (
          <div className="cloud-book-menu" onMouseLeave={this.closeBookMenu}>
            <div
              className="cloud-book-menu-item"
              onClick={(event) => {
                event.stopPropagation();
                this.closeBookMenu();
                this.handleStartReading(book);
              }}
            >
              {isImporting ? "准备中…" : "开始阅读"}
            </div>
            <div
              className="cloud-book-menu-item cloud-book-menu-danger"
              onClick={(event) => {
                event.stopPropagation();
                this.closeBookMenu();
                this.handleRemoveFromRoom(book);
              }}
            >
              移出房间
            </div>
          </div>
        )}
      </div>
    );
  };

  // ① 卡片视图：小封面 + 书名 + 「格式 · 体积 / ⋯」一行（对齐个人书架 bookCardItem）
  renderCardBody = (book: CloudBook) => {
    const nameWithoutExt = getFileNameWithoutExtension(book.name, book.name);
    const ext = (book.name.split(".").pop() || "BOOK").toUpperCase();
    return (
      <>
        {this.renderCover(
          book,
          "cloud-book-cover",
          "cloud-book-cover-inner",
          this.state.cardScale
        )}
        <p className="cloud-book-title" title={book.name}>
          {nameWithoutExt}
        </p>
        {/* 书名下面一行：左「格式 · 体积」，右「更多」——
            对齐个人书架的「阅读进度 + ⋯」那一行，更多图标常显不再靠 hover */}
        <div className="cloud-book-footer">
          <p className="cloud-book-meta">
            {ext} · {this.formatSize(book.size)}
          </p>
          {this.renderMoreButton(book)}
        </div>
      </>
    );
  };

  // ② 封面视图：大封面在左，右侧书名 + 三行信息。
  //    房间书只有文件名（没有作者/出版社/简介），所以三行换成「格式/体积/加入时间」，
  //    位置与个人书架的「作者/出版社/简介」一一对应。
  renderCoverBody = (book: CloudBook) => {
    const nameWithoutExt = getFileNameWithoutExtension(book.name, book.name);
    const ext = (book.name.split(".").pop() || "BOOK").toUpperCase();
    return (
      <>
        {this.renderCover(
          book,
          "cloud-book-cover-lg",
          "cloud-book-cover-lg-inner",
          1.14
        )}
        <div className="cloud-book-cover-info">
          <p className="cloud-book-cover-name" title={book.name}>
            {nameWithoutExt}
          </p>
          <p className="cloud-book-cover-line">格式：{ext}</p>
          <p className="cloud-book-cover-line">
            体积：{this.formatSize(book.size)}
          </p>
          <p className="cloud-book-cover-line">
            加入：{this.formatDate(book.uploadedAt)}
          </p>
          <div className="cloud-book-cover-foot">
            {this.renderMoreButton(book)}
          </div>
        </div>
      </>
    );
  };

  // ③ 列表视图：小封面 + 书名 + 右侧「格式 / 体积」两列
  renderRowBody = (book: CloudBook) => {
    const nameWithoutExt = getFileNameWithoutExtension(book.name, book.name);
    const ext = (book.name.split(".").pop() || "BOOK").toUpperCase();
    return (
      <>
        {this.renderCover(
          book,
          "cloud-book-cover-sm",
          "cloud-book-cover-sm-inner",
          0.43
        )}
        <p className="cloud-book-row-title" title={book.name}>
          {nameWithoutExt}
        </p>
        <span className="cloud-book-row-col">{ext}</span>
        <span className="cloud-book-row-col">{this.formatSize(book.size)}</span>
        {this.renderMoreButton(book)}
      </>
    );
  };

  // 三种视图共用一个 <li> 外壳：拖动排序、点击阅读、「更多」菜单只写一遍，
  // 内部按 viewMode 选择渲染哪一套内容
  renderRoomBookItem = (book: CloudBook) => {
    const mode = this.props.viewMode;
    const isDragOver =
      this.state.dragBook !== "" && this.state.dragOverBook === book.name;
    const baseClass =
      mode === "list"
        ? "cloud-book-row"
        : mode === "cover"
          ? "cloud-book-cover-card"
          : "cloud-book-card";
    return (
      <li
        key={book.name}
        className={baseClass + (isDragOver ? " cloud-book-drag-over" : "")}
        title="点击开始阅读，拖动可调整顺序"
        draggable
        onDragStart={() => this.setState({ dragBook: book.name })}
        onDragEnd={() => this.setState({ dragBook: "", dragOverBook: "" })}
        onDragOver={(event) => {
          event.preventDefault();
          if (this.state.dragOverBook !== book.name) {
            this.setState({ dragOverBook: book.name });
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            this.setState((prev) =>
              prev.dragOverBook === book.name ? { dragOverBook: "" } : null
            );
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          this.handleDropReorder(book.name);
        }}
        onClick={() => this.handleStartReading(book)}
      >
        {mode === "list"
          ? this.renderRowBody(book)
          : mode === "cover"
            ? this.renderCoverBody(book)
            : this.renderCardBody(book)}
      </li>
    );
  };

  renderRooms() {
    const { rooms, isLoading, isBusy, createName, joinCode } = this.state;
    const isServerConfigured = collabClient.isServerConfigured;
    return (
      <>
        <div className="cloud-page-header">
          <span className="cloud-page-title">共同阅读</span>
          <div className="cloud-page-actions">
            <button
              className="cloud-page-refresh-btn"
              disabled={isLoading || !isServerConfigured}
              onClick={this.refreshRooms}
            >
              刷新
            </button>
          </div>
        </div>
        <div className="cloud-page-hint">
          一个房间就是一个共同书架：创建房间、往里放书，大家打开同一本书就能实时共读
        </div>

        {!isServerConfigured && (
          <div className="cloud-page-unconfigured">
            <div className="cloud-page-unconfigured-title">
              当前是本地阅读器模式
            </div>
            <div>
              共读需要连接一台共读服务器。请到左侧「个人中心 → 个人信息 →
              共读服务器」里填写你的服务器地址，再回来创建或加入房间。
            </div>
          </div>
        )}

        <div className="collab-start-panel">
          <div className="collab-start-card">
            <div className="collab-start-card-icon icon-add"></div>
            <div className="collab-start-card-title">创建房间</div>
            <div className="collab-start-card-desc">
              起个名字开一间，把书放进去邀请朋友共读
            </div>
            <div className="collab-start-row">
              <input
                className="collab-room-input"
                placeholder="房间名称，如：周三读书会"
                value={createName}
                maxLength={60}
                onChange={(e) => this.setState({ createName: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") this.handleCreateRoom();
                }}
              />
              <button
                className="collab-room-submit collab-room-submit-primary"
                disabled={isBusy || !isServerConfigured || !createName.trim()}
                onClick={this.handleCreateRoom}
              >
                创建
              </button>
            </div>
          </div>

          <div className="collab-start-card">
            <div className="collab-start-card-icon icon-cloud"></div>
            <div className="collab-start-card-title">加入房间</div>
            <div className="collab-start-card-desc">
              输入朋友给你的 6 位房间号，直接进入他的书架
            </div>
            <div className="collab-start-row">
              <input
                className="collab-room-input collab-room-input-code"
                placeholder="房间号，如：AB12CD"
                value={joinCode}
                maxLength={6}
                onChange={(e) => this.setState({ joinCode: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") this.handleJoinRoom();
                }}
              />
              <button
                className="collab-room-submit"
                disabled={isBusy || !isServerConfigured || !joinCode.trim()}
                onClick={this.handleJoinRoom}
              >
                加入
              </button>
            </div>
          </div>
        </div>

        {this.state.error && (
          <div className="cloud-page-error">连接失败：{this.state.error}</div>
        )}

        <div className="collab-room-section-title">
          我的房间
          {rooms.length > 0 && (
            <span className="collab-room-section-count">{rooms.length}</span>
          )}
        </div>

        {isLoading ? (
          <div className="cloud-page-empty">加载中...</div>
        ) : !isServerConfigured ? (
          <div className="cloud-page-empty">
            设置共读服务器地址后，这里会列出你的房间
          </div>
        ) : rooms.length === 0 ? (
          <div className="cloud-page-empty">
            还没有共读房间，点上面「创建房间」开一个吧
          </div>
        ) : (
          <ul className="cloud-page-list collab-room-list">
            {rooms.map((room) => {
              // 只有房主或仍在房内的成员才显示「删除」：服务端只允许这两种身份解散，
              // 给非成员显示等于摆一个点了必然 403 的按钮。
              const canManage =
                room.ownerId === collabClient.clientId ||
                (room.memberIds || []).includes(collabClient.clientId);
              return (
                <li
                  key={room.roomId}
                  className="cloud-page-item collab-room-row"
                  onClick={() => this.enterRoom(room)}
                >
                  <div className="collab-room-row-badge">
                    <span className="icon-cloud"></span>
                  </div>
                  <div className="cloud-page-item-info">
                    <span className="cloud-page-item-name" title={room.name}>
                      {room.name || "未命名房间"}
                    </span>
                    <span className="cloud-page-item-meta">
                      {room.bookCount} 本书
                      {room.members.length > 0 ? (
                        <span className="collab-room-online-tag">
                          <span className="collab-live-dot"></span>
                          在线 {room.members.length} 人（
                          {room.members.slice(0, 3).join("、")}）
                        </span>
                      ) : (
                        " · 当前无人在线"
                      )}
                      {room.createdAt
                        ? ` · 建于 ${this.formatDate(room.createdAt)}`
                        : ""}
                    </span>
                  </div>
                  <span className="collab-room-code-pill" title="房间号">
                    {room.roomId}
                  </span>
                  <div className="cloud-page-item-actions">
                    <button
                      className="cloud-page-import-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        this.enterRoom(room);
                      }}
                    >
                      进入
                    </button>
                    {canManage && (
                      <button
                        className="cloud-page-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          this.handleDeleteRoom(room);
                        }}
                      >
                        删除
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </>
    );
  }

  renderRoom() {
    const { activeRoom, roomBooks, isLoading, importingBook } = this.state;
    const mode = this.props.viewMode;
    // 列表视图是竖排单列，卡片/封面视图是 flex 换行铺排
    const listClass =
      mode === "list"
        ? "cloud-book-list"
        : mode === "cover"
          ? "cloud-book-cover-grid"
          : "cloud-book-grid";
    if (!activeRoom) return null;
    return (
      <>
        <div className="cloud-page-header">
          <span className="cloud-page-title">
            <span className="collab-back-btn" onClick={this.leaveRoomView}>
              ←
            </span>
            {activeRoom.name || "未命名房间"}
            <span className="collab-room-code">{activeRoom.roomId}</span>
          </span>
          <div className="cloud-page-actions">
            {/* 卡片视图才给缩放条，与「我的图书」一致；改的是同一份 cardScale 设置 */}
            {mode === "card" && (
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
            <ViewMode />
            <button
              className="cloud-page-refresh-btn"
              disabled={isLoading}
              onClick={() => this.refreshRoomBooks(activeRoom.roomId)}
            >
              刷新
            </button>
          </div>
        </div>
        <div className="cloud-page-hint">
          房间就是大家的共同书架：右上角「导入图书到房间」放书进来，点封面开始共读。
          房间里的书不会进入你的个人书架，笔记高亮也是相互独立的。
        </div>
        {this.state.error && (
          <div className="cloud-page-error">连接失败：{this.state.error}</div>
        )}
        {isLoading ? (
          <div className="cloud-page-empty">加载中...</div>
        ) : roomBooks.length === 0 ? (
          <div className="cloud-page-empty">
            房间书架还是空的，点右上角「导入图书到房间」放第一本书进去
          </div>
        ) : (
          <ul
            className={listClass}
            style={
              { "--card-scale": this.state.cardScale } as React.CSSProperties
            }
          >
            {roomBooks.map((book) => this.renderRoomBookItem(book))}
          </ul>
        )}
        {importingBook && (
          <div className="cloud-page-progress">
            <div
              className="cloud-page-progress-bar"
              style={{ width: "100%" }}
            />
          </div>
        )}
      </>
    );
  }

  render() {
    return (
      <div
        className="cloud-page-container-parent"
        style={
          this.props.isCollapsed
            ? { left: "70px", width: "calc(100% - 70px)" }
            : {}
        }
      >
        {this.state.view === "rooms" ? this.renderRooms() : this.renderRoom()}
      </div>
    );
  }
}

export default CloudLibrary;
