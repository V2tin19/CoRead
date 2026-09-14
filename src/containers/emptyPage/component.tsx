import React from "react";
import "./emptyPage.css";
import { emptyList } from "../../constants/emptyList";
import { Trans } from "react-i18next";
import { EmptyPageProps, EmptyPageState } from "./interface";
import emptyDark from "../../assets/images/empty-dark.svg";
import emptyLight from "../../assets/images/empty-light.svg";

import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";

class EmptyPage extends React.Component<EmptyPageProps, EmptyPageState> {
  constructor(props: EmptyPageProps) {
    super(props);
    this.state = {
      isOpenDelete: false,
    };
  }
  render() {
    const renderEmptyList = () => {
      return emptyList.map((item) => {
        const isHome = item.mode === "home";
        return (
          <div
            className="empty-page-info-container"
            key={item.mode}
            style={
              this.props.mode === item.mode ? {} : { visibility: "hidden" }
            }
          >
            <div className="empty-page-info-main">
              {isHome ? "开启团队阅读之旅" : <Trans>{item.main}</Trans>}
            </div>
            <div className="empty-page-info-sub">
              {isHome ? "书库暂无图书，点击右上角「导入」或将电子书直接拖拽至此处" : <Trans>{item.sub}</Trans>}
            </div>
            {isHome && (
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
            )}
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
