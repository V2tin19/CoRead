import React from "react";
import "./pageWidget.css";
import { PageWidgetProps, PageWidgetState } from "./interface";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { Trans } from "react-i18next";
class PageWidget extends React.Component<PageWidgetProps, PageWidgetState> {
  isFirst: Boolean;
  lastBatchTranslationTriggerAt: number;
  batchTranslationLock: Promise<any>;
  constructor(props: any) {
    super(props);
    this.state = {
      isSingle: this.props.readerMode !== "double",
      prevPage: 0,
      nextPage: 0,
      ignoreNextPageChange: false,
    };
    this.isFirst = true;
    this.lastBatchTranslationTriggerAt = 0;
    this.batchTranslationLock = Promise.resolve();
  }

  async UNSAFE_componentWillReceiveProps(nextProps: PageWidgetProps) {
    if (nextProps.htmlBook !== this.props.htmlBook && nextProps.htmlBook) {
      await this.handlePageNum(nextProps.htmlBook.rendition);
      nextProps.htmlBook.rendition.on("page-changed", async () => {
        await this.handlePageNum(nextProps.htmlBook.rendition);
        await this.handleBatchTranslation(nextProps.htmlBook.rendition);
        if (this.state.ignoreNextPageChange) {
          this.setState({ ignoreNextPageChange: false });
        } else {
          this.props.handleJumpPosition(null);
        }
      });
      nextProps.htmlBook.rendition.on("rendered", async () => {
        await this.handlePageNum(nextProps.htmlBook.rendition);
        await this.handleBatchTranslation(nextProps.htmlBook.rendition);
        await this.handleWordDefinition(nextProps.htmlBook.rendition);
      });
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
  async handlePageNum(rendition) {
    let pageInfo = await rendition.getProgress();
    if (!pageInfo) {
      return;
    }
    if (
      this.props.currentBook.format === "PDF" &&
      !ConfigService.getAllListConfig("convertPDFBooks").includes(
        this.props.currentBook.key
      )
    ) {
      this.setState({
        prevPage: pageInfo.currentPage,
        nextPage: pageInfo.currentPage + 1,
      });
      return;
    }
    this.setState({
      prevPage: this.state.isSingle
        ? pageInfo.currentPage
        : pageInfo.currentPage * 2 - 1,
      nextPage: this.state.isSingle
        ? pageInfo.currentPage
        : pageInfo.currentPage * 2,
    });
  }

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
          {/* 页眉信息(章节名 / 书名 / 当前时间 / 阅读进度)按需求整体移除,
              这里不再渲染 .header-container。相关样式与状态一并清理。 */}
          <div className="footer-container">
            {!this.props.isHideFooter && this.state.prevPage > 0 && (
              <p
                className="background-page-left"
                style={
                  this.state.isSingle
                    ? {
                        left: `calc(50vw - 
                      270px)`,
                      }
                    : {}
                }
              >
                <Trans i18nKey="Book page" count={this.state.prevPage}>
                  Page
                  {{
                    count: this.state.prevPage,
                  }}
                </Trans>
              </p>
            )}
            {!this.props.isHideFooter &&
              this.state.nextPage > 0 &&
              !this.state.isSingle && (
                <p className="background-page-right">
                  <Trans i18nKey="Book page" count={this.state.nextPage}>
                    Page
                    {{
                      count: this.state.nextPage,
                    }}
                  </Trans>
                </p>
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
