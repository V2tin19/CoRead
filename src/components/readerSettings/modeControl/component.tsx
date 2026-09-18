import React from "react";
import "./modeControl.css";
import { ModeControlProps, ModeControlState } from "./interface";
import { ConfigService } from '../../../services';
import { Trans } from "react-i18next";
import collabClient, { getCollabBookKey } from "../../../utils/collab/collabClient";
import toast from "react-hot-toast";

class ModeControl extends React.Component<ModeControlProps, ModeControlState> {
  private unsubs: Array<() => void> = [];

  private isCurrentBookInRoom = (): boolean => {
    const bookKey = getCollabBookKey(this.props.currentBook);
    return Boolean(bookKey) && collabClient.isInRoom(bookKey);
  };

  constructor(props: ModeControlProps) {
    super(props);
    // 共读时不提供滑动阅读:页在滚动模式下不稳定,笔迹无法跟随,
    // 跨设备位置同步也会丢页。只有当前正在阅读的书处于活跃共读房间时才锁定，
    // 个人书架本地书籍绝不误锁。
    this.state = { inRoom: this.isCurrentBookInRoom() };
  }

  componentDidMount() {
    this.unsubs = [
      collabClient.on("room-joined", () =>
        this.setState({ inRoom: this.isCurrentBookInRoom() })
      ),
      collabClient.on("room-left", () => this.setState({ inRoom: false })),
      collabClient.on("room-lost", () => this.setState({ inRoom: false })),
      collabClient.on("room-deleted", () => this.setState({ inRoom: false })),
    ];
  }

  componentDidUpdate(prevProps: ModeControlProps) {
    if (
      getCollabBookKey(prevProps.currentBook) !==
      getCollabBookKey(this.props.currentBook)
    ) {
      this.setState({ inRoom: this.isCurrentBookInRoom() });
    }
  }

  componentWillUnmount() {
    this.unsubs.forEach((unsubscribe) => unsubscribe());
  }

  handleChangeMode = (mode: string) => {
    if (mode === "scroll" && this.isCurrentBookInRoom()) {
      toast("共读模式下不支持滑动阅读，请退出房间后再切换", { icon: "🚫" });
      return;
    }
    if (
      (this.props.currentBook.format === "PDF" &&
        !ConfigService.getAllListConfig("convertPDFBooks").includes(
          this.props.currentBook.key
        )) ||
      this.props.currentBook.format.startsWith("CB")
    ) {
      ConfigService.setReaderConfig("pdfReaderMode", mode);
    } else {
      ConfigService.setReaderConfig("readerMode", mode);
    }

    this.props.handleReaderMode(mode);
    this.props.renderBookFunc();
  };
  render() {
    const scrollLocked = this.isCurrentBookInRoom();
    return (
      <div className="background-color-setting">
        <div
          className="background-color-text"
          style={{ position: "relative", bottom: "15px" }}
        >
          <Trans>View mode</Trans>
        </div>
        <div className="single-control-container">
          <div
            className="single-mode-container"
            onClick={() => {
              this.handleChangeMode("single");
            }}
            style={this.props.readerMode === "single" ? {} : { opacity: 0.4 }}
          >
            <span className="icon-single-page single-page-icon"></span>
          </div>

          <div
            className="double-mode-container"
            onClick={() => {
              this.handleChangeMode("double");
            }}
            style={this.props.readerMode === "double" ? {} : { opacity: 0.4 }}
          >
            <span className="icon-two-page two-page-icon"></span>
          </div>

          <div
            className="double-mode-container"
            title={
              scrollLocked
                ? "共读模式下不支持滑动阅读"
                : "滑动阅读（共读时不支持）"
            }
            onClick={() => {
              this.handleChangeMode("scroll");
            }}
            style={
              this.props.readerMode === "scroll"
                ? {}
                : { opacity: scrollLocked ? 0.2 : 0.4 }
            }
          >
            <span className="icon-scroll two-page-icon"></span>
          </div>
        </div>
      </div>
    );
  }
}
export default ModeControl;
