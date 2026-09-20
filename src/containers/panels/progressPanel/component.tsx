import React from "react";
import "./progressPanel.css";
import { Trans } from "react-i18next";
import { ProgressPanelProps, ProgressPanelState } from "./interface";
import _ from "underscore";
import { configStore, readingProgressStore } from "../../../core/ports/stores";
import { scrollContents } from "../../../utils/common";
import {
  toggleReadingPanel,
  toggleNavTab,
} from "../../../utils/reader/mouseEvent";
import { isMobileRuntime } from "../../../utils/mobileRuntime";
import StyleUtil from "../../../utils/reader/styleUtil";

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
      showProgressCard: false,
      showQuickTheme: false,
    };
  }

  handleApplyThemeColor = (bg: string, text: string) => {
    configStore.setReaderConfig("backgroundColor", bg);
    configStore.setReaderConfig("textColor", text);
    configStore.setReaderConfig("isOverwriteBackground", "yes");
    configStore.setReaderConfig("isOverwriteText", "yes");
    if (bg === "rgba(44,47,49,1)") {
      configStore.setReaderConfig("appSkin", "night");
    } else {
      configStore.setReaderConfig("appSkin", "light");
    }
    if (this.props.handleBackgroundColor) {
      this.props.handleBackgroundColor(bg);
    }
    StyleUtil.addDefaultCss(this.props.currentBook?.key || "");
    if (this.props.renderBookFunc) {
      this.props.renderBookFunc(this.props.currentBook?.key || "");
    }
    this.forceUpdate();
  };
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
      let bookLocation = await readingProgressStore.getProgress(
        this.props.currentBook.key
      );
      if (bookLocation && bookLocation.percentage) {
        let percentage = (parseFloat(bookLocation.percentage as any) * 100).toFixed(2);
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
    readingProgressStore.saveProgress(
      this.props.currentBook.key,
      position
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
        !configStore.getAllListConfig("convertPDFBooks").includes(
          this.props.currentBook.key
        )) ||
      this.props.currentBook.format.startsWith("CB")
        ? configStore.getReaderConfig("pdfReaderMode") || "scroll"
        : configStore.getReaderConfig("readerMode") || "double";
    const isMobile = isMobileRuntime() || document.body.clientWidth < 570;

    if (isMobile) {
      const PRESET_THEMES = [
        {
          name: "纯白",
          bg: "rgba(255,255,255,1)",
          text: "rgba(38,38,38,1)",
          border: "rgba(215,215,215,0.9)",
        },
        {
          name: "羊皮",
          bg: "rgba(246,241,231,1)",
          text: "rgba(48,43,36,1)",
          border: "rgba(224,214,198,0.9)",
        },
        {
          name: "护眼",
          bg: "rgba(226,237,227,1)",
          text: "rgba(34,48,38,1)",
          border: "rgba(195,216,198,0.9)",
        },
        {
          name: "夜间",
          bg: "rgba(44,47,49,1)",
          text: "rgba(175,178,180,1)",
          border: "rgba(70,75,78,0.9)",
        },
      ];

      return (
        <div
          className={`progress-panel mobile-progress-panel ${
            this.state.showProgressCard || this.state.showQuickTheme
              ? "mobile-progress-panel-expanded"
              : ""
          }`}
        >
          {/* 快速背景主题选择面板（方块微倒角卡片，宁框勿线） */}
          {this.state.showQuickTheme && (
            <div className="mobile-quick-theme-panel">
              {PRESET_THEMES.map((theme) => {
                const isCurrent =
                  configStore.getReaderConfig("backgroundColor") === theme.bg;
                return (
                  <button
                    key={theme.name}
                    type="button"
                    className={`mobile-theme-swatch ${
                      isCurrent ? "mobile-theme-swatch-active" : ""
                    }`}
                    style={{
                      backgroundColor: theme.bg,
                      borderColor: theme.border,
                    }}
                    onClick={() =>
                      this.handleApplyThemeColor(theme.bg, theme.text)
                    }
                    title={theme.name}
                  >
                    <span
                      className="mobile-theme-swatch-text"
                      style={{ color: theme.text }}
                    >
                      {theme.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* 移动端极简进度卡片 */}
          {this.state.showProgressCard && (
            <div className="mobile-progress-card">
              <div className="mobile-progress-header">
                <span className="mobile-progress-chapter">
                  {this.props.currentChapter ||
                    this.props.currentBook?.name ||
                    "正文"}
                </span>
                <span className="mobile-progress-percent">
                  {this.state.currentPercentage}%
                </span>
              </div>
              <div className="mobile-progress-slider-row">
                <button
                  type="button"
                  className="mobile-progress-step-btn"
                  title="上一章"
                  onClick={() => this.jumpChapterByStep(-1)}
                >
                  <span className="icon-dropdown previous-chapter-icon" />
                </button>
                <input
                  className="input-progress"
                  value={this.state.currentPercentage}
                  type="range"
                  max="100"
                  min="0"
                  step="1"
                  onMouseUp={(event) => this.onProgressChange(event)}
                  onTouchEnd={(event) => this.onProgressChange(event)}
                  onChange={(event) => {
                    this.setState({
                      currentPercentage: parseInt(event.target.value),
                    });
                  }}
                />
                <button
                  type="button"
                  className="mobile-progress-step-btn"
                  title="下一章"
                  onClick={() => this.jumpChapterByStep(1)}
                >
                  <span className="icon-dropdown next-chapter-icon" />
                </button>
              </div>
            </div>
          )}

          {/* 移动端底部 5 大核心入口 */}
          <div className="mobile-bottom-tabs">
            <button
              type="button"
              className="mobile-bottom-tab"
              onClick={() => toggleReadingPanel("left")}
              title="目录"
            >
              <span className="icon-grid mobile-tab-icon" />
              <span className="mobile-tab-text">目录</span>
            </button>
            <button
              type="button"
              className="mobile-bottom-tab"
              onClick={() => {
                // 「笔记」在这里 = 笔记 / 高光的汇总列表（左侧面板的「笔记」页签，
                // 同页签栏里还有书签与高光）。它与顶栏右上角那个「随心笔记（涂鸦）」
                // 是两个不同的东西 —— 汇总归底栏、随手画归顶栏，别再把两件事叠一起。
                // ⚠️ 只发这一个事件就够了：NavigationPanel 的 handleNavTabToggle
                // 自己就带「面板没开就开、开着同一页签就关」的逻辑，
                // 再补一个 toggleReadingPanel("left") 会变成双重切换（状态批处理下
                // 表现为偶发的「点了没反应」或「关不掉」）。
                toggleNavTab("notes");
              }}
              title="笔记与高光"
            >
              <span className="icon-note mobile-tab-icon" />
              <span className="mobile-tab-text">笔记</span>
            </button>
            <button
              type="button"
              className={`mobile-bottom-tab ${
                this.state.showProgressCard ? "mobile-bottom-tab-active" : ""
              }`}
              onClick={() =>
                this.setState((prev) => ({
                  showProgressCard: !prev.showProgressCard,
                  showQuickTheme: false,
                }))
              }
              title="进度调节"
            >
              <span className="mobile-tab-icon icon-slider-round">⊙</span>
              <span className="mobile-tab-text">进度</span>
            </button>
            <button
              type="button"
              className={`mobile-bottom-tab ${
                this.state.showQuickTheme ? "mobile-bottom-tab-active" : ""
              }`}
              onClick={() =>
                this.setState((prev) => ({
                  showQuickTheme: !prev.showQuickTheme,
                  showProgressCard: false,
                }))
              }
              title="亮度与背景"
            >
              <span className="mobile-tab-icon icon-sun">☼</span>
              <span className="mobile-tab-text">背景</span>
            </button>
            <button
              type="button"
              className="mobile-bottom-tab"
              onClick={() => toggleReadingPanel("right")}
              title="排版与字体"
            >
              <span className="mobile-tab-icon icon-font">Aa</span>
              <span className="mobile-tab-text">排版</span>
            </button>
          </div>
        </div>
      );
    }

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
          {/* 目录:手机上没有键盘快捷键,从屏幕左缘划出又容易误触,
              给一个明确入口。桌面端这个按钮同样可用(等价于左侧面板开关)。 */}
          <button
            className="progress-action-btn"
            title="打开目录"
            onClick={() => toggleReadingPanel("left")}
          >
            <Trans>Content</Trans>
          </button>
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
