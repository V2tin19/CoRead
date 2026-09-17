import React from "react";
import "./emptyPage.css";
import { emptyList } from "../../constants/emptyList";
import { Trans } from "react-i18next";
import { EmptyPageProps, EmptyPageState } from "./interface";
import emptyDark from "../../assets/images/empty-dark.svg";
import emptyLight from "../../assets/images/empty-light.svg";

import { ConfigService } from '../../services';
import { isMobileRuntime } from "../../utils/mobileRuntime";

/**
 * 移动端欢迎卡文案（精简版）。
 * 桌面端那三张卡是「标题 + 两行长描述」的竖排网格，手机上会撑出屏幕；
 * 这里压成一行短句，配合 emptyPage.css 里的横排布局实现一屏看完。
 */
const mobileWelcomeList = [
  {
    icon: "icon-bookshelf-line",
    title: "全格式阅读",
    desc: "EPUB / PDF / TXT / MOBI / AZW3 等十余种格式",
  },
  {
    icon: "icon-cloud",
    title: "多人实时共读",
    desc: "创建或加入房间，同屏翻页、同步划线",
  },
  {
    icon: "icon-idea",
    title: "随心手绘笔记",
    desc: "书页自由涂鸦作注，云端自动同步",
  },
];

class EmptyPage extends React.Component<EmptyPageProps, EmptyPageState> {
  constructor(props: EmptyPageProps) {
    super(props);
    this.state = {
      isOpenDelete: false,
    };
  }
  render() {
    const isMobile = isMobileRuntime();
    const renderWelcomeCards = () => {
      if (isMobile) {
        return (
          <div className="empty-welcome-grid">
            {mobileWelcomeList.map((item) => (
              <div className="empty-welcome-card" key={item.title}>
                <div className="empty-welcome-icon-box">
                  <span className={item.icon}></span>
                </div>
                <div className="empty-welcome-card-body">
                  <div className="empty-welcome-card-title">{item.title}</div>
                  <div className="empty-welcome-card-desc">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        );
      }
      return (
        <div className="empty-welcome-grid">
          <div className="empty-welcome-card">
            <div className="empty-welcome-icon-box">
              <span className="icon-bookshelf-line"></span>
            </div>
            <div className="empty-welcome-card-title">全格式阅读支持</div>
            <div className="empty-welcome-card-desc">
              支持 EPUB, PDF, TXT, MOBI, AZW3 等十余种主流电子书，极速解析排版
            </div>
          </div>
          <div className="empty-welcome-card">
            <div className="empty-welcome-icon-box">
              <span className="icon-cloud"></span>
            </div>
            <div className="empty-welcome-card-title">多人实时共读</div>
            <div className="empty-welcome-card-desc">
              前往侧栏「共同阅读」创建或加入房间，与书友同屏翻页、同步划线与讨论
            </div>
          </div>
          <div className="empty-welcome-card">
            <div className="empty-welcome-icon-box">
              <span className="icon-idea"></span>
            </div>
            <div className="empty-welcome-card-title">随心手绘笔记</div>
            <div className="empty-welcome-card-desc">
              书页自由涂鸦作注，自动云端防丢同步，为团队阅读注入生动笔触
            </div>
          </div>
        </div>
      );
    };
    const renderEmptyList = () => {
      return emptyList.map((item) => {
        const isHome = item.mode === "home";
        return (
          <div
            className={
              "empty-page-info-container" +
              (this.props.mode === item.mode ? "" : " empty-page-info-hidden")
            }
            key={item.mode}
          >
            <div className="empty-page-info-main">
              {isHome ? "开启团队阅读之旅" : <Trans>{item.main}</Trans>}
            </div>
            <div className="empty-page-info-sub">
              {isHome ? (
                isMobile ? (
                  "点击右上角「导入」添加你的第一本书"
                ) : (
                  "书库暂无图书，点击右上角「导入」或将电子书直接拖拽至此处"
                )
              ) : (
                <Trans>{item.sub}</Trans>
              )}
            </div>
            {isHome && renderWelcomeCards()}
          </div>
        );
      });
    };
    return (
      <>
        <div
          className="empty-page-container"
          style={
            this.props.isCollapsed
              ? { width: "calc(100vw - 100px)", left: "100px" }
              : {}
          }
        >
          <div
            className="empty-illustration-container"
            style={{ width: "calc(100% - 50px)" }}
          >
            <img
              src={
                ConfigService.getReaderConfig("appSkin") === "night" ||
                (ConfigService.getReaderConfig("appSkin") === "system" &&
                  ConfigService.getReaderConfig("isOSNight") === "yes")
                  ? emptyDark
                  : emptyLight
              }
              alt=""
              className="empty-page-illustration"
            />
          </div>

          {renderEmptyList()}
        </div>
      </>
    );
  }
}

export default EmptyPage;
