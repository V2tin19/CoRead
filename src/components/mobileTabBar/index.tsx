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
    const currentPath = this.props.location?.pathname || "";
    const pathMode = currentPath.replace("/manager/", "");
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
