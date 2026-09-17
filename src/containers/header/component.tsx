import React from "react";
import "./header.css";
import SearchBox from "../../components/searchBox";
import ImportLocal from "../../components/importLocal";
import RoomImportButton from "../../components/roomImportButton";
import ThemeToggle from "../../components/themeToggle";
import { HeaderProps, HeaderState } from "./interface";
import { ConfigService } from '../../services';
import { generateSnapshot } from "../../utils/file/backup";
import { isElectron } from "react-device-detect";
import { upgradeConfig, upgradeStorage } from "../../utils/file/common";
import DatabaseService from "../../utils/storage/databaseService";
import BookUtil from "../../utils/file/bookUtil";
import { throttle } from "../../utils/common";
import { LocalFileManager } from "../../utils/file/localFile";
import { isMobileRuntime } from "../../utils/mobileRuntime";
declare var window: any;

class Header extends React.Component<HeaderProps, HeaderState> {
  private resizeHandler: (() => void) | null = null;
  constructor(props: HeaderProps) {
    super(props);

    this.state = {
      isOnlyLocal: false,
      language: ConfigService.getReaderConfig("lang"),
      isNewVersion: false,
      width: document.body.clientWidth,
      isDataChange: false,
      isHidePro: false,
      isSync: false,
      notificationCount: 0,
    };
  }
  async componentDidMount() {
    if (isElectron) {
      try {
        await generateSnapshot();
      } catch (error) {
        console.error("Failed to generate snapshot:", error);
      }
      const fs = window.require("fs");
      const path = window.require("path");
      const { ipcRenderer } = window.require("electron");
      const dirPath = ipcRenderer.sendSync("user-data", "ping");
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(path.join(dirPath, "data", "book"), { recursive: true });
      }

      if (
        ConfigService.getReaderConfig("storageLocation") &&
        !ConfigService.getItem("storageLocation")
      ) {
        ConfigService.setItem(
          "storageLocation",
          ConfigService.getReaderConfig("storageLocation")
        );
      }
      if (ConfigService.getReaderConfig("isHidePro") === "yes") {
        this.setState({ isHidePro: true });
      }

      //Check for data update
      //upgrade data from old version
      let res1 = await upgradeStorage(this.handleFinishUpgrade);
      let res2 = upgradeConfig();
      if (!res1 || !res2) {
        console.error("upgrade failed");
      }

      ipcRenderer.on(
        "open-book-from-link",
        async (_event: any, config: any) => {
          const book = await DatabaseService.getRecord(config.bookKey, "books");
          if (book) {
            BookUtil.redirectBook(book);
          }
        }
      );
      ipcRenderer.on(
        "open-note-from-link",
        async (_event: any, config: any) => {
          const note = await DatabaseService.getRecord(config.noteKey, "notes");
          if (!note) return;
          const book = await DatabaseService.getRecord(note.bookKey, "books");
          if (!book) return;
          let bookLocation: any = {};
          try {
            bookLocation = JSON.parse(note.cfi) || {};
          } catch (error) {
            bookLocation.cfi = note.cfi;
            bookLocation.chapterTitle = note.chapter;
          }
          if (bookLocation.fingerprint) {
            bookLocation.chapterDocIndex = bookLocation.page - 1 + "";
            bookLocation.chapterHref = "title" + (bookLocation.page - 1);
          }
          ConfigService.setObjectConfig(
            note.bookKey,
            bookLocation,
            "recordLocation"
          );
          BookUtil.redirectBook(book);
        }
      );
    } else {
      upgradeConfig();
      // ── 移动端（安卓壳）：跳过程序化的「授权本地文件夹」引导弹窗 ──
      // 那个弹窗依赖 File System Access API 的 showDirectoryPicker 选目录，
      // 安卓 WebView 里没有可用的目录授权能力（点击只会弹「系统限制」提示），
      // 首次进入却会先挡住书架，用户看到的就是「是否继续使用网页端浏览」。
      // 手机端数据本来就落在 IndexedDB，不需要它，所以整段跳过；
      // isUseLocal 也就保持未设置状态，不会走后面的「重新授权」分支。
      if (!isMobileRuntime()) {
        const status = await LocalFileManager.getPermissionStatus();
        if (
          !ConfigService.getItem("isUseLocal") &&
          LocalFileManager.isSupported()
        ) {
          this.props.handleLocalFileDialog(true);
        } else if (
          ConfigService.getItem("isUseLocal") === "yes" &&
          !status.directoryName
        ) {
          this.props.handleLocalFileDialog(true);
        } else if (
          ConfigService.getItem("isUseLocal") === "yes" &&
          (status.needsReauthorization || !status.hasAccess)
        ) {
          this.props.handleLocalFileDialog(true);
        }
      }
    }
    this.resizeHandler = throttle(() => {
      this.setState({ width: document.body.clientWidth });
    });
    window.addEventListener("resize", this.resizeHandler);
    this.handleOpenLastReadBook();
  }
  componentWillUnmount() {
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }
  }
  handleOpenLastReadBook = async () => {
    let filePath = "";
    //open book when app start
    if (isElectron) {
      const { ipcRenderer } = window.require("electron");
      filePath = ipcRenderer.sendSync("check-file-data");
    }
    if (
      ConfigService.getReaderConfig("isOpenBook") === "yes" &&
      !this.props.currentBook.key &&
      !filePath
    ) {
      let lastReadBookKey = ConfigService.getAllListConfig("recentBooks")[0];
      if (lastReadBookKey) {
        let fullBook = await DatabaseService.getRecord(
          lastReadBookKey,
          "books"
        );
        if (fullBook) {
          this.props.handleReadingBook(fullBook);
          BookUtil.redirectBook(fullBook);
        }
      }
    }
  };
  handleFinishUpgrade = () => {
    setTimeout(() => {
      if (this.props.mode === "home") {
        this.props.history.push("/manager/home");
      }
    }, 2000);
  };

  render() {
    return (
      <div
        className="header"
        style={this.props.isCollapsed ? { marginLeft: "40px" } : {}}
      >
        <div
          className="header-search-container"
          style={this.props.isCollapsed ? { width: "369px" } : {}}
        >
          <SearchBox />
        </div>
        <div
          className="setting-icon-parrent"
          style={this.props.isCollapsed ? { marginLeft: "430px" } : {}}
        >
          {/* 白天 / 黑夜开关：常驻右上角，不用进设置里翻 */}
          <div className="setting-icon-container" style={{ marginRight: "2px" }}>
            <ThemeToggle />
          </div>
          <div
            className="setting-icon-container"
            onClick={() => {
              this.props.handleSortDisplay(!this.props.isSortDisplay);
            }}
            onMouseLeave={() => {
              this.props.handleSortDisplay(false);
            }}
            style={{ top: "18px" }}
          >
            <span
              data-tooltip-id="my-tooltip"
              data-tooltip-content={this.props.t("Sort by")}
              data-tooltip-place="left"
            >
              <span className="icon-sort-desc header-sort-icon"></span>
            </span>
          </div>
          <div
            className="setting-icon-container"
            onClick={() => {
              this.props.handleSetting(true);
              this.props.handleAbout(false);
            }}
            onMouseLeave={() => {
              this.props.handleAbout(false);
            }}
            style={{ marginTop: "2px" }}
          >
            <span
              data-tooltip-id="my-tooltip"
              data-tooltip-content={this.props.t("Setting")}
              data-tooltip-place="left"
            >
              <span
                className="icon-setting setting-icon"
                style={{ fontSize: "25px" }}
              ></span>
            </span>
          </div>
        </div>

        {this.props.location &&
        this.props.location.pathname === "/manager/cloud" ? (
          <RoomImportButton {...({ t: this.props.t } as any)} />
        ) : (
          <ImportLocal
            {...({
              handleDrag: this.props.handleDrag,
            } as any)}
          />
        )}
      </div>
    );
  }
}

export default Header;
