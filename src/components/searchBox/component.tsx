import React from "react";
import "./searchBox.css";
import { SearchBoxProps, SearchBoxState } from "./interface";
import { ConfigService } from '../../services';
import ConfigUtil from "../../utils/file/configUtil";
import BookUtil from "../../utils/file/bookUtil";
import { isMobileRuntime } from "../../utils/mobileRuntime";

class SearchBox extends React.Component<SearchBoxProps, SearchBoxState> {
  private searchBoxRef: React.RefObject<HTMLInputElement>;
  constructor(props: SearchBoxProps) {
    super(props);
    this.state = {
      isFocused: false,
    };
    this.searchBoxRef = React.createRef<HTMLInputElement>();
  }
  componentDidMount() {
    if (this.props.isNavSearch) {
      let searchBox: any = document.querySelector(".header-search-box");
      searchBox && searchBox.focus();
    }
  }
  handleMouse = async () => {
    let value = this.searchBoxRef.current?.value || "";
    if (this.props.isNavSearch) {
      value && this.search(value);
    }
    this.setState({ isFocused: false });
    if (this.props.mode === "nav") {
      this.props.handleNavSearchState("searching");
    }
    let keyword = (
      document.querySelector(".header-search-box") as HTMLInputElement
    ).value.toLowerCase();
    let results = await this.handleGetSearchResults(keyword);
    if (results) {
      this.props.handleSearchResults(results);
      this.props.handleSearch(true);
      if (this.props.mode === "nav") {
        this.props.handleNavSearchState("done");
      }
    }
  };
  handleGetSearchResults = async (keyword: string) => {
    let results =
      this.props.tabMode === "note"
        ? await ConfigUtil.searchNotesByKeyword(keyword, "", "note")
        : this.props.tabMode === "highlight"
          ? await ConfigUtil.searchNotesByKeyword(keyword, "", "highlight")
          : await BookUtil.searchBooksByKeyword(keyword);
    let deletedBookKeys = ConfigService.getAllListConfig("deletedBooks");
    results = results.filter((result: any) => {
      return !deletedBookKeys.includes(
        result[
          this.props.tabMode === "note" || this.props.tabMode === "highlight"
            ? "bookKey"
            : "key"
        ]
      );
    });
    return results;
  };

  handleKey = async (event: any) => {
    if (event.keyCode !== 13) {
      return;
    }
    let value = this.searchBoxRef.current?.value || "";
    if (this.props.isNavSearch || this.props.isReading) {
      value && this.search(value);
    }
    this.setState({ isFocused: false });
    if (event && event.keyCode === 13) {
      let keyword = event.target.value.toLowerCase();
      let results = await this.handleGetSearchResults(keyword);
      if (results) {
        this.props.handleSearchResults(results);
        this.props.handleSearch(true);
        if (this.props.mode === "nav") {
          this.props.handleNavSearchState("done");
        }
      }
    }
  };
  search = async (q: string) => {
    this.props.handleNavSearchState("searching");
    let searchList = await this.props.htmlBook.rendition.doSearch(q);
    this.props.handleNavSearchState("pending");
    this.props.handleSearchList(
      searchList.map((item: any) => {
        const regex = new RegExp(
          q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "gi"
        );
        item.excerpt = item.excerpt.replace(
          regex,
          `<span class="content-search-text">$&</span>`
        );
        return item;
      })
    );
    this.props.handleNavSearchState("done");
  };

  handleCancel = () => {
    if (this.props.isNavSearch) {
      this.props.handleSearchList(null);
      this.props.handleNavSearchState("done");
    }
    this.props.handleSearch(false);
    (document.querySelector(".header-search-box") as HTMLInputElement).value =
      "";
  };

  render() {
    return (
      <div style={{ position: "relative" }}>
        <input
          type="text"
          ref={this.searchBoxRef}
          className="header-search-box"
          onKeyDown={(event) => {
            this.handleKey(event);
          }}
          onFocus={() => {
            this.setState({ isFocused: true });

            if (this.props.mode === "nav") {
              this.props.handleNavSearchState("focused");
            }
          }}
          placeholder={
            this.props.isNavSearch || this.props.mode === "nav"
              ? this.props.t("Search in the Book")
              : this.props.tabMode === "note"
                ? this.props.t("Search my notes")
                : this.props.tabMode === "highlight"
                  ? this.props.t("Search my highlights")
                  : // 书架顶栏那条搜索框：手机上它被挤在图标群左边，宽度放不下
                    // 「搜索我的书库」，占位文字会被截成「搜索我的…」。
                    // 与其显示半个词，不如不写字 —— 右侧的放大镜已经说明用途。
                    // 桌面端宽度够，保持原文案。
                    isMobileRuntime()
                    ? ""
                    : this.props.t("Search my library")
          }
          style={
            this.props.mode === "nav"
              ? {
                  width: this.props.width,
                  height: this.props.height,
                  paddingRight: "38px",
                }
              : {}
          }
          onCompositionStart={() => {
            if (this.props.mode === "nav") {
              this.props.handleNavSearchState("focused");
            }
            if (this.props.isNavLocked) {
              return;
            } else {
              ConfigService.setReaderConfig("isTempLocked", "yes");
              ConfigService.setReaderConfig("isNavLocked", "yes");
            }
          }}
          onCompositionEnd={() => {
            if (ConfigService.getReaderConfig("isTempLocked") === "yes") {
              ConfigService.setReaderConfig("isNavLocked", "");
              ConfigService.setReaderConfig("isTempLocked", "");
            }
          }}
        />
        {this.props.isSearch && !this.state.isFocused ? (
          <span
            className="header-search-text"
            onClick={() => {
              this.handleCancel();
            }}
          >
            <span className="icon-close theme-color-delete"></span>
          </span>
        ) : (
          <span
            className="header-search-text"
            onClick={() => {
              this.handleMouse();
            }}
          >
            <span className="icon-search header-search-icon"></span>
          </span>
        )}
      </div>
    );
  }
}

export default SearchBox;
