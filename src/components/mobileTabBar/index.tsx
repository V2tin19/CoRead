import React from "react";
import "./mobileTabBar.css";
import { connect } from "react-redux";
import { withRouter, RouteComponentProps } from "react-router-dom";
import { withTranslation, WithTranslation } from "react-i18next";
import { stateType } from "../../store";
import {
  handleMode,
  handleSearch,
  handleSortDisplay,
  handleSelectBook,
  handleShelf,
} from "../../store/actions";
import { sideMenu } from "../../constants/sideMenu";

interface MobileTabBarProps extends RouteComponentProps<any>, WithTranslation {
  mode: string;
  handleMode: (mode: string) => void;
  handleSearch: (isSearch: boolean) => void;
  handleSortDisplay: (isSortDisplay: boolean) => void;
  handleSelectBook: (isSelectBook: boolean) => void;
  handleShelf: (shelfTitle: string) => void;
}

class MobileTabBar extends React.Component<MobileTabBarProps> {
  handleTabClick = (targetMode: string) => {
    this.props.handleSelectBook(false);
    this.props.history.push(`/manager/${targetMode}`);
    this.props.handleMode(targetMode);
    this.props.handleShelf("");
    this.props.handleSearch(false);
    this.props.handleSortDisplay(false);
  };

  render() {
    // 当前选中的 tab 必须只看「一级路径段」。
    // 之前整段 pathname 去掉 /manager/ 前缀后直接比对：进入书架的二级页或书单
    // 详情后，pathMode 会变成 "home/shelf" 这样的两段值，四项全都匹配不上 →
    // 底栏没有任何一项高亮，看起来像「选中了但没变亮」（用户反馈的那条）。
    const currentPath = this.props.location?.pathname || "";
    const pathMode = currentPath.split("/")[2] || "";
    const currentMode = pathMode || this.props.mode || "home";

    return (
      <nav className="mobile-tab-bar" aria-label="Mobile Navigation">
        {sideMenu.map((item) => {
          const isActive = currentMode === item.mode;
          return (
            <button
              key={item.mode}
              type="button"
              className={`mobile-tab-item ${isActive ? "active" : ""}`}
              aria-current={isActive ? "page" : undefined}
              onClick={() => this.handleTabClick(item.mode)}
            >
              <span className={`mobile-tab-icon icon-${item.icon}`} />
              <span className="mobile-tab-label">{this.props.t(item.name)}</span>
            </button>
          );
        })}
      </nav>
    );
  }
}

const mapStateToProps = (state: stateType) => ({
  mode: state.sidebar.mode,
});

const actionCreator = {
  handleMode,
  handleSearch,
  handleSortDisplay,
  handleSelectBook,
  handleShelf,
};

export default connect(
  mapStateToProps,
  actionCreator
)(withTranslation()(withRouter(MobileTabBar as any) as any) as any);
