import React from "react";
import "./progressPanel.css";
import { Trans } from "react-i18next";
import { ProgressPanelProps, ProgressPanelState } from "./interface";
import _ from "underscore";
import { ConfigService } from '../../../services';
import { scrollContents } from "../../../utils/common";
import { toggleReadingPanel } from "../../../utils/reader/mouseEvent";
class ProgressPanel extends React.Component<
  ProgressPanelProps,
  ProgressPanelState
> {
  constructor(props: ProgressPanelProps) {
    super(props);
    this.state = {
      currentPage: 0,
      totalPage: 0,
      targetChapterIndex: 0,
      targetPage: 0,
      currentPercentage: 0,
      isEntered: false,
    };
  }
  async UNSAFE_componentWillReceiveProps(nextProps: ProgressPanelProps) {
    if (nextProps.htmlBook !== this.props.htmlBook && nextProps.htmlBook) {
      await this.handlePageNum(nextProps.htmlBook.rendition);
      nextProps.htmlBook.rendition.on("page-changed", async () => {
        this.handleLocation();
        await this.handlePageNum(nextProps.htmlBook.rendition);
        this.handleCurrentChapterIndex(nextProps.htmlBook.rendition);
        this.props.handleFetchPercentage(this.props.currentBook);
      });
      nextProps.htmlBook.rendition.on("rendered", async () => {
        await this.handlePageNum(nextProps.htmlBook.rendition);
        this.handleCurrentChapterIndex(nextProps.htmlBook.rendition);
      });
      this.handleCurrentChapterIndex(nextProps.htmlBook.rendition);
      let bookLocation: {
        text: string;
        chapterTitle: string;
        chapterDocIndex: string;
        chapterHref: string;
        percentage: string;
      } = ConfigService.getObjectConfig(
        this.props.currentBook.key,
        "recordLocation",
        {}
      );
      if (bookLocation.percentage) {
        let percentage = (parseFloat(bookLocation.percentage) * 100).toFixed(2);
        this.setState({ currentPercentage: parseFloat(percentage) });
      }
    }
    if (nextProps.percentage !== this.props.percentage && nextProps.htmlBook) {
      let percentage = (nextProps.percentage * 100).toFixed(2);
      this.setState({ currentPercentage: parseFloat(percentage) });
    }
  }
  handleLocation = () => {
    let position = this.props.htmlBook.rendition.getPosition();
    ConfigService.setObjectConfig(
      this.props.currentBook.key,
      position,
      "recordLocation"
    );
    this.props.handleCurrentChapter(position.chapterTitle);
    setTimeout(() => {
      scrollContents(position.chapterTitle, position.chapterHref);
    }, 1000);
  };
  handleCurrentChapterIndex = (rendition) => {
    let position = rendition.getPosition();

    let href = position.chapterHref;
    if (!href) {
      return;
    }
    let chapterIndex = _.findIndex(this.props.htmlBook.flattenChapters, {
      href,
    });
    this.setState({ targetChapterIndex: chapterIndex + 1 });
  };
  async handlePageNum(rendition) {
    let pageInfo = await rendition.getProgress();
    if (!pageInfo) {
      return;
    }
    this.setState({
      currentPage: pageInfo.currentPage,
      totalPage: pageInfo.totalPage,
    });
  }
  onProgressChange = async (event: any) => {
    const percentage = event.target.value / 100;
    this.setState({ currentPercentage: event.target.value });
    await this.props.htmlBook.rendition.goToPercentage(percentage);
  };
  // 上一章 / 下一章
  // 说明:原本直接调用 rendition.prevChapter() / nextChapter(),它们内部依赖
  // rendition 的 tempLocation(chapterDocIndex / chapterHref)来推算目标章节,
  // 而这个内部值跟界面上的章节序号不是同一套索引(它属于 chapterDocList,
  // 且拖动进度条后不一定同步),于是会出现「按一下跳到莫名其妙的地方、
  // 甚至直接跳到 100%」。这里改成:能可靠定位到当前章就走 goToChapterIndex,
  // 定位不到(PDF 没有目录、拿不到 chapterHref 等)就退回「翻一页」,
  // 和右下角的翻页箭头同一套接口,永远不会乱跳。
  jumpChapterByStep = async (step: number) => {
    const { htmlBook } = this.props;
    if (!htmlBook) return;
    const rendition = htmlBook.rendition;
    const chapters = htmlBook.flattenChapters || [];

    // 在章节表里定位当前章(EPUB/TXT 都能定位到)
    let currentIndex = -1;
    if (chapters.length > 0) {
      try {
        const position = rendition.getPosition();
        if (position && position.chapterHref) {
          currentIndex = _.findIndex(chapters, {
            href: position.chapterHref,
          });
        }
      } catch (error) {
        currentIndex = -1;
      }
    }
    const canJumpByChapter =
      chapters.length > 0 &&
      currentIndex >= 0 &&
      typeof rendition.goToChapterIndex === "function";
    if (!canJumpByChapter) {
      // 没有章节表(部分 PDF)/定位不到当前章 → 退化为翻一页
      if (step > 0) {
        await rendition.next();
      } else {
        await rendition.prev();
      }
      return;
    }
    const targetIndex = currentIndex + step;
    // 到头了就什么都不做(避免原生实现那种「直接甩到 100%」)
    if (targetIndex < 0 || targetIndex >= chapters.length) {
      return;
    }
    await rendition.goToChapterIndex(targetIndex);
  };
  handleJumpChapter = async (event: any) => {
    let targetChapterIndex = parseInt(event.target.value.trim()) - 1;
    await this.props.htmlBook.rendition.goToChapterIndex(targetChapterIndex);
  };
  // AI 问书:与原右下角 AI 按钮同款逻辑,打开侧边助手并带上本章文本
  handleAIAssistant = async () => {
    if (!this.props.htmlBook) return;
    this.props.handleMenuMode("assistant");
    this.props.handleOriginalText(
      await this.props.htmlBook.rendition.chapterText()
    );
    this.props.handleOpenMenu(true);
  };
  handleToggleSpeech = () => {
    this.props.handleSpeechDialog(!this.props.isSpeechOpen);
  };
  render() {
    if (!this.props.htmlBook) {
      return <div className="progress-panel">Loading</div>;
    }
    let readerMode =
      (this.props.currentBook.format === "PDF" &&
        !ConfigService.getAllListConfig("convertPDFBooks").includes(
          this.props.currentBook.key
        )) ||
      this.props.currentBook.format.startsWith("CB")
        ? ConfigService.getReaderConfig("pdfReaderMode") || "scroll"
        : ConfigService.getReaderConfig("readerMode") || "double";
    return (
      <div className="progress-panel">
        <div className="progress-row progress-row-info">
          <span className="progress-stat">
            <Trans>Progress</Trans> {this.state.currentPercentage}%
          </span>
          <span className="progress-stat">
            <Trans>Pages</Trans>
            <input
              type="text"
              name="jumpPage"
              id="jumpPage"
              className="progress-jump-input"
              value={
                this.state.targetPage
                  ? this.state.targetPage
                  : this.state.currentPage *
                    (readerMode === "double" &&
                    this.props.currentBook.format !== "PDF"
                      ? 2
                      : 1)
              }
              onFocus={() => {
                this.setState({ targetPage: " " });
              }}
              onChange={(event) => {
                let fieldVal = event.target.value;
                this.setState({ targetPage: fieldVal });
              }}
              onBlur={(event) => {
                if (event.target.value.trim()) {
                  this.props.htmlBook.rendition.goToPage(
                    parseInt(event.target.value.trim())
                  );
                } else {
                  this.setState({ targetPage: "" });
                }
              }}
            />
            / {this.state.totalPage}
          </span>
          <span className="progress-stat">
            <Trans>Chapters</Trans>
            <input
              type="text"
              name="jumpChapter"
              id="jumpChapter"
              className="progress-jump-input"
              value={this.state.targetChapterIndex}
              onFocus={() => {
                this.setState({ targetChapterIndex: " " });
              }}
              onChange={(event) => {
                let fieldVal = event.target.value;
                this.setState({ targetChapterIndex: fieldVal });
              }}
              onBlur={(event) => {
                if (!this.state.isEntered) {
                  if (event.target.value.trim()) {
                    this.handleJumpChapter(event);
                    this.setState({ targetChapterIndex: "" });
                  } else {
                    this.setState({ targetChapterIndex: "" });
                  }
                } else {
                  this.setState({ isEntered: false });
                }
              }}
              onKeyDown={(event: any) => {
                if (event.key === "Enter") {
                  this.setState({ isEntered: true });
                  if (event.target.value.trim()) {
                    this.handleJumpChapter(event);
                    this.setState({ targetChapterIndex: "" });
                  } else {
                    this.setState({ targetChapterIndex: "" });
                  }
                }
              }}
            />
            / {this.props.htmlBook.flattenChapters.length}
          </span>
        </div>
        <div className="progress-row progress-row-controls">
          <div
            className="previous-chapter"
            title="上一章"
            onClick={() => {
              this.jumpChapterByStep(-1);
            }}
          >
            <span className="icon-dropdown previous-chapter-icon" />
          </div>
          <input
            className="input-progress"
            value={this.state.currentPercentage}
            type="range"
            max="100"
            min="0"
            step="1"
            onMouseUp={(event) => {
              this.onProgressChange(event);
            }}
            onTouchEnd={(event) => {
              this.onProgressChange(event);
            }}
            onChange={(event) => {
              this.setState({
                currentPercentage: parseInt(event.target.value),
              });
            }}
          />
          <div
            className="next-chapter"
            title="下一章"
            onClick={() => {
              this.jumpChapterByStep(1);
            }}
          >
            <span className="icon-dropdown next-chapter-icon" />
          </div>
        </div>
        <div className="progress-row progress-row-actions">
          <button
            className="progress-option-btn"
            title="打开阅读选项"
            onClick={() => toggleReadingPanel("right")}
          >
            <span className="icon-grid progress-option-icon" />
            <Trans>Reading option</Trans>
          </button>
          <button
            className="progress-action-btn"
            title="向 AI 提问关于本章内容"
            onClick={this.handleAIAssistant}
          >
            AI 问书
          </button>
          <button
            className={
              "progress-action-btn" +
              (this.props.isSpeechOpen ? " progress-action-active" : "")
            }
            title="听书"
            onClick={this.handleToggleSpeech}
          >
            {this.props.isSpeechOpen ? "停止听书" : "听书"}
          </button>
        </div>
      </div>
    );
  }
}

export default ProgressPanel;
