import React from "react";
import "./pageWidget.css";
import { PageWidgetProps, PageWidgetState } from "./interface";
import { ConfigService } from '../../services';
class PageWidget extends React.Component<PageWidgetProps, PageWidgetState> {
  isFirst: Boolean;
  lastBatchTranslationTriggerAt: number;
  batchTranslationLock: Promise<any>;
  private currentRendition: any = null;
  private pageChangedHandler: any = null;
  private renderedHandler: any = null;

  constructor(props: any) {
    super(props);
    this.state = {
      isSingle: this.props.readerMode !== "double",
      currentPage: 0,
      totalPage: 0,
      prevPage: 0,
      nextPage: 0,
      ignoreNextPageChange: false,
    };
    this.isFirst = true;
    this.lastBatchTranslationTriggerAt = 0;
    this.batchTranslationLock = Promise.resolve();
  }

  componentDidMount() {
    if (this.props.htmlBook?.rendition) {
      this.bindRenditionEvents(this.props.htmlBook.rendition);
    }
  }

  componentWillUnmount() {
    this.unbindRenditionEvents();
  }

  bindRenditionEvents = async (rendition: any) => {
    if (!rendition) return;
    this.unbindRenditionEvents();
    this.currentRendition = rendition;
    await this.handlePageNum(rendition);

    this.pageChangedHandler = async () => {
      await this.handlePageNum(rendition);
      await this.handleBatchTranslation(rendition);
      if (this.state.ignoreNextPageChange) {
        this.setState({ ignoreNextPageChange: false });
      } else {
        this.props.handleJumpPosition(null);
      }
    };
    this.renderedHandler = async () => {
      await this.handlePageNum(rendition);
      await this.handleBatchTranslation(rendition);
      await this.handleWordDefinition(rendition);
    };

    rendition.on("page-changed", this.pageChangedHandler);
    rendition.on("rendered", this.renderedHandler);
  };

  unbindRenditionEvents = () => {
    if (this.currentRendition) {
      if (this.pageChangedHandler) {
        this.currentRendition.off?.("page-changed", this.pageChangedHandler);
        this.pageChangedHandler = null;
      }
      if (this.renderedHandler) {
        this.currentRendition.off?.("rendered", this.renderedHandler);
        this.renderedHandler = null;
      }
      this.currentRendition = null;
    }
  };

  async UNSAFE_componentWillReceiveProps(nextProps: PageWidgetProps) {
    if (nextProps.htmlBook !== this.props.htmlBook && nextProps.htmlBook) {
      this.bindRenditionEvents(nextProps.htmlBook.rendition);
    }
    if (nextProps.readerMode !== this.props.readerMode) {
      this.setState({ isSingle: nextProps.readerMode !== "double" });
    }
    if (
      nextProps.jumpPosition !== this.props.jumpPosition &&
      nextProps.jumpPosition !== null
    ) {
      this.setState({ ignoreNextPageChange: true });
    }
  }
  async handleBatchTranslation(_rendition: any) {
    return Promise.resolve();
  }
  async handleWordDefinition(_rendition: any) {
    return Promise.resolve();
  }
  async handlePageNum(rendition: any) {
    if (!rendition) return;
    try {
      let pageInfo = await rendition.getProgress();
      if (pageInfo && typeof pageInfo.currentPage === "number") {
        let currentPage = pageInfo.currentPage || 1;
        let totalPage = pageInfo.totalPage || 1;
        if (currentPage < 1) currentPage = 1;
        if (totalPage > 0 && currentPage > totalPage) currentPage = totalPage;
        this.setState({
          currentPage,
          totalPage,
          prevPage: currentPage,
          nextPage: currentPage + 1,
        });
        return;
      }
      let position = rendition.getPosition?.();
      if (position && position.percentage) {
        const pct = Math.max(0, Math.min(1, parseFloat(position.percentage)));
        const total = rendition.getChapter?.()?.length || 100;
        const current = Math.max(1, Math.min(total, Math.round(pct * total)));
        this.setState({
          currentPage: current,
          totalPage: total,
          prevPage: current,
          nextPage: current + 1,
        });
      }
    } catch (e) {
      // 容错处理
    }
  }

  getFooterTextColor = (): string => {
    const bg =
      this.props.backgroundColor ||
      ConfigService.getReaderConfig("backgroundColor") ||
      "rgba(255,255,255,1)";
    const appSkin = ConfigService.getReaderConfig("appSkin");
    const isOSNight = ConfigService.getReaderConfig("isOSNight") === "yes";

    // 显式夜间模式判断
    if (
      bg === "rgba(44,47,49,1)" ||
      appSkin === "night" ||
      (appSkin === "system" && isOSNight)
    ) {
      return "rgba(255, 255, 255, 0.45)";
    }

    // 解析 RGB 值计算感知亮度（ITU-R BT.709）
    const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      const r = parseInt(match[1], 10);
      const g = parseInt(match[2], 10);
      const b = parseInt(match[3], 10);
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (luminance < 128) {
        return "rgba(255, 255, 255, 0.45)";
      }
    }
    return "rgba(0, 0, 0, 0.38)";
  };

  render() {
    return (
      <>
        <div
          className="background"
          style={{
            color: ConfigService.getReaderConfig("textColor")
              ? ConfigService.getReaderConfig("textColor")
              : "",
            width:
              !this.props.isNavLocked && !this.props.isSettingLocked
                ? "100%"
                : this.props.isNavLocked && this.props.isSettingLocked
                  ? "calc(100% - 600px)"
                  : "calc(100% - 300px)",
            left: !this.props.isNavLocked ? "0" : "300px",
            right: !this.props.isSettingLocked ? "0" : "300px",
            backgroundColor: this.props.backgroundColor,
            filter: `brightness(${
              ConfigService.getReaderConfig("brightness") || 1
            }) invert(${
              ConfigService.getReaderConfig("isInvert") === "yes" ? 1 : 0
            })`,
          }}
        >
          {/* 底部右下角页码水印（当前页 / 总页数），浅色字随背景自适应 */}
          <div className="footer-container">
            {!this.props.isHideFooter && (
              <div
                className="reader-footer-page-number"
                style={{
                  color: this.getFooterTextColor(),
                }}
              >
                {this.state.totalPage > 0
                  ? `${this.state.currentPage || 1} / ${this.state.totalPage}`
                  : `${this.state.currentPage || 1}`}
              </div>
            )}
          </div>
          <>
            {this.props.isShowBookmark ? (
              <div className="bookmark"></div>
            ) : null}
          </>
          {this.props.isShowPageBorder && (
            <>
              <div className="page-border"></div>
              <div className="inner-page-border"></div>
              <div className="page-border-header-line"></div>
              <div className="page-border-footer-line"></div>
              {!this.state.isSingle && (
                <div
                  className="page-border-center-line"
                  style={
                    this.props.textOrientation === "vertical"
                      ? {
                          top: "50%",
                          height: "1px",
                          width: "calc(100% - 30px)",
                          left: "15px",
                          right: "15px",
                        }
                      : {}
                  }
                ></div>
              )}
            </>
          )}
        </div>
        {this.props.jumpPosition && (
          <div className="jump-return-button-container">
            <button
              className="jump-return-button"
              onClick={async () => {
                if (this.props.jumpPosition && this.props.htmlBook) {
                  this.setState({ ignoreNextPageChange: true });
                  await this.props.htmlBook.rendition.goToPosition(
                    JSON.stringify(this.props.jumpPosition)
                  );
                  this.props.handleJumpPosition(null);
                }
              }}
            >
              {this.props.t("Return")}
            </button>
          </div>
        )}
      </>
    );
  }
}

export default PageWidget;
