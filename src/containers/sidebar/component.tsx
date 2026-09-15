import React from "react";
import "./sidebar.css";
import { sideMenu } from "../../constants/sideMenu";
import { SidebarProps, SidebarState } from "./interface";
import { withRouter } from "react-router-dom";
import { ConfigService } from '../../services';
import { getWebsiteUrl, openInBrowser } from "../../utils/common";
import toast from "react-hot-toast";
import {
  addBooksToFavorite,
  isBookDragEvent,
  parseBookDragData,
} from "../../utils/reader/bookDrag";
import BrandLogo from "../../components/brandLogo";
class Sidebar extends React.Component<SidebarProps, SidebarState> {
  constructor(props: SidebarProps) {
    super(props);
    this.state = {
      mode: "home",
      hoverMode: "",
      isCollapsed:
        ConfigService.getReaderConfig("isCollapsed") === "yes" || false,
      dropTargetShelf: "",
    };
  }
  componentDidMount() {
    this.props.handleMode(
      document.URL.split("/").reverse()[0] === "empty"
        ? "home"
        : document.URL.split("/").reverse()[0]
    );
    document.addEventListener("dragend", this.handleDocumentDragEnd);
  }
  componentWillUnmount() {
    document.removeEventListener("dragend", this.handleDocumentDragEnd);
  }
  handleDocumentDragEnd = () => {
    this.setState({ dropTargetShelf: "" });
  };
  handleSidebar = (mode: string) => {
    this.setState({ mode: mode });
    this.props.handleSelectBook(false);
    this.props.history.push(`/manager/${mode}`);
    this.props.handleMode(mode);
    this.props.handleShelf("");
    this.props.handleSearch(false);
    this.props.handleSortDisplay(false);
  };
  handleHover = (mode: string) => {
    this.setState({ hoverMode: mode });
  };
  handleCollapse = (isCollapsed: boolean) => {
    this.setState({ isCollapsed });
    this.props.handleCollapse(isCollapsed);
    ConfigService.setReaderConfig("isCollapsed", isCollapsed ? "yes" : "no");
  };
  handleJump = (url: string) => {
    openInBrowser(url);
  };
  handleFavoriteDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    this.setState({ dropTargetShelf: "" });
    if (!isBookDragEvent(event)) return;

    const bookKeys = parseBookDragData(event);
    if (bookKeys.length === 0) return;

    const added = addBooksToFavorite(bookKeys);
    if (added === 0) {
      toast(this.props.t("Duplicate book"));
      return;
    }
    toast.success(this.props.t("Addition successful"));
    this.props.handleFetchBooks();
    this.props.handleShelf("");
    this.props.handleMode("favorite");
    this.setState({ mode: "favorite" });
    this.props.history.push("/manager/favorite");
  };
  getBookDragHandlers = (
    targetId: string,
    onDrop: (event: React.DragEvent) => void
  ) => ({
    onDragEnter: (event: React.DragEvent) => {
      if (isBookDragEvent(event)) {
        event.preventDefault();
        this.setState({ dropTargetShelf: targetId });
      }
    },
    onDragLeave: (event: React.DragEvent) => {
      if (
        !event.currentTarget.contains(event.relatedTarget as Node | null)
      ) {
        this.setState({ dropTargetShelf: "" });
      }
    },
    onDragOver: (event: React.DragEvent) => {
      if (isBookDragEvent(event)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
    },
    onDrop,
  });
  isBookDropTarget = (mode: string) => mode === "favorite";
  render() {
    const renderSideMenu = () => {
      return sideMenu.map((item) => {
        const isDropTarget = this.isBookDropTarget(item.mode);
        return (
          <li
            key={item.name}
            className={
              (this.props.mode === item.mode
                ? "active side-menu-item"
                : "side-menu-item") +
              (this.state.dropTargetShelf === item.mode
                ? " shelf-drop-target"
                : "")
            }
            id={`sidebar-${item.icon}`}
            onClick={() => {
              this.handleSidebar(item.mode);
            }}
            onMouseEnter={() => {
              this.handleHover(item.mode);
            }}
            onMouseLeave={() => {
              this.handleHover("");
            }}
            style={this.props.isCollapsed ? { width: 40, marginLeft: 15 } : {}}
            {...(isDropTarget
              ? this.getBookDragHandlers(item.mode, this.handleFavoriteDrop)
              : {})}
          >
            {this.props.mode === item.mode ? (
              <div className="side-menu-selector-container"></div>
            ) : null}
            {this.state.hoverMode === item.mode ? (
              <div className="side-menu-hover-container"></div>
            ) : null}
            <div
              className={
                this.props.mode === item.mode
                  ? "side-menu-selector active-selector"
                  : "side-menu-selector "
              }
            >
              <div
                className="side-menu-icon"
                style={this.props.isCollapsed ? {} : { marginLeft: "38px" }}
              >
                <span
                  className={
                    this.props.mode === item.mode
                      ? `icon-${item.icon}  active-icon`
                      : `icon-${item.icon}`
                  }
                  style={
                    this.props.isCollapsed
                      ? { position: "relative", marginLeft: "-9px" }
                      : {}
                  }
                ></span>
              </div>

              <span
                style={
                  this.props.isCollapsed
                    ? { display: "none", width: "70%" }
                    : { width: "60%" }
                }
              >
                {this.props.t(item.name)}
              </span>
            </div>
          </li>
        );
      });
    };
    return (
      <>
        <div className="sidebar">
          <div
            className="sidebar-list-icon"
            onClick={() => {
              this.handleCollapse(!this.state.isCollapsed);
            }}
          >
            <span className="icon-menu sidebar-list"></span>
          </div>

          {!this.state.isCollapsed && (
            <BrandLogo
              onClick={() => {
                this.props.history.push("/manager/home");
              }}
            />
          )}
          <div
            className="side-menu-container-parent"
            style={this.state.isCollapsed ? { width: "70px" } : {}}
          >
            <ul className="side-menu-container">{renderSideMenu()}</ul>
          </div>
          {/* Stats button at the bottom */}
          <div
            className="side-menu-about"
            style={this.props.isCollapsed ? { width: "70px" } : { width: "190px" }}
          >
            <div
              className="side-menu-item"
              id="sidebar-stats"
              style={
                this.props.isCollapsed
                  ? { width: 40, marginLeft: 15 }
                  : { width: "calc(100% - 30px)", marginLeft: 15 }
              }
              onClick={() => {
                this.props.history.push("/stats");
              }}
            >
              <div className="side-menu-selector">
                <div
                  className="side-menu-icon"
                  style={this.props.isCollapsed ? {} : { marginLeft: "38px" }}
                >
                  <span
                    className="icon-chart"
                    style={
                      this.props.isCollapsed
                        ? { position: "relative", marginLeft: "-9px" }
                        : {}
                    }
                  ></span>
                </div>
                <span
                  style={
                    this.props.isCollapsed
                      ? { display: "none", width: "70%" }
                      : { width: "60%" }
                  }
                >
                  {this.props.t("Reading Stats")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }
}

export default withRouter(Sidebar as any);
