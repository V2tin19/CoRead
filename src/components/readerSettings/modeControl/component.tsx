import React from "react";
import "./modeControl.css";
import { ModeControlProps, ModeControlState } from "./interface";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import { Trans } from "react-i18next";
import collabClient from "../../../utils/collab/collabClient";
import toast from "react-hot-toast";

class ModeControl extends React.Component<ModeControlProps, ModeControlState> {
  private unsubs: Array<() => void> = [];
  constructor(props: ModeControlProps) {
    super(props);
    // 共读时不提供滑动阅读:页在滚动模式下不稳定,笔迹无法跟随,
    // 跨设备位置同步也会丢页。记进 state,入房/退房时刷新按钮可用性。
    // (checkModeLock 是不落 state 的重复确认,防事件时序遗漏)
    this.state = { inRoom: collabClient.isInRoom() };
  }

  componentDidMount() {
    this.unsubs = [
      collabClient.on("room-joined", () => this.setState({ inRoom: true })),
      collabClient.on("room-left", () => this.setState({ inRoom: false })),
      collabClient.on("room-lost", () => this.setState({ inRoom: false })),
      collabClient.on("room-deleted", () => this.setState({ inRoom: false })),
    ];
  }

  componentWillUnmount() {
    this.unsubs.forEach((unsubscribe) => unsubscribe());
  }

  handleChangeMode = (mode: string) => {
    if (mode === "scroll" && collabClient.isInRoom()) {
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
    const scrollLocked = collabClient.isInRoom();
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
