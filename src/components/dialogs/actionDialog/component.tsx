import React from "react";
import "./actionDialog.css";
import { Trans } from "react-i18next";
import { ActionDialogProps, ActionDialogState } from "./interface";
import toast from "react-hot-toast";
import MoreAction from "../moreAction";
import MarkAction from "../markAction";
import { ConfigService } from '../../../services';
declare var window: any;
class ActionDialog extends React.Component<
  ActionDialogProps,
  ActionDialogState
> {
  constructor(props: ActionDialogProps) {
    super(props);
    this.state = {
      isShowExport: false,
      isShowMark: false,
      isShowDetail: false,
      isExceed: false,
    };
  }

  componentDidMount() {
    window.addEventListener("keydown", this.handleKeyDown);
  }

  componentWillUnmount() {
    window.removeEventListener("keydown", this.handleKeyDown);
  }

  handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      this.props.handleActionDialog(false);
    }
  };
  handleDeleteBook = () => {
    this.props.handleReadingBook(this.props.currentBook);
    this.props.handleDeleteDialog(true);
    this.props.handleActionDialog(false);
  };
  handleEditBook = () => {
    this.props.handleEditDialog(true);
    this.props.handleReadingBook(this.props.currentBook);
    this.props.handleActionDialog(false);
  };
  handleDetailBook = () => {
    this.props.handleDetailDialog(true);
    this.props.handleReadingBook(this.props.currentBook);
    this.props.handleActionDialog(false);
  };
  handleAddShelf = () => {
    this.props.handleAddDialog(true);
    this.props.handleReadingBook(this.props.currentBook);
    this.props.handleActionDialog(false);
  };
  handleLoveBook = () => {
    ConfigService.setListConfig(this.props.currentBook.key, "favoriteBooks");
    toast.success(this.props.t("Addition successful"));
    this.props.handleActionDialog(false);
  };
  handleMultiSelect = () => {
    this.props.handleSelectBook(true);
    this.props.handleSelectedBooks([this.props.currentBook.key]);
    this.props.handleActionDialog(false);
  };
  handleTopBook = () => {
    ConfigService.setListConfig(this.props.currentBook.key, "topBooks");
    toast.success(this.props.t("Addition successful"));
    this.props.handleActionDialog(false);
    this.props.handleFetchBooks();
  };
  handleCancelTopBook = () => {
    ConfigService.deleteListConfig(this.props.currentBook.key, "topBooks");
    toast.success(this.props.t("Cancellation successful"));
    this.props.handleActionDialog(false);
    this.props.handleFetchBooks();
  };
  handleCancelLoveBook = () => {
    ConfigService.deleteListConfig(this.props.currentBook.key, "favoriteBooks");
    if (
      Object.keys(ConfigService.getAllListConfig("favoriteBooks")).length ===
        0 &&
      this.props.mode === "favorite"
    ) {
      this.props.history.push("/manager/empty");
    }
    toast.success(this.props.t("Cancellation successful"));
    this.props.handleActionDialog(false);
    this.props.handleFetchBooks();
  };
  handleMoreAction = (isShow: boolean) => {
    this.setState({ isShowExport: isShow });
  };
  handleMarkAction = (isShow: boolean) => {
    this.setState({ isShowMark: isShow });
  };
  render() {
    const moreActionProps = {
      left: this.props.left,
      top: this.props.top,
      isShowExport: this.state.isShowExport,
      isExceed: this.state.isExceed,
      handleMoreAction: this.handleMoreAction,
    };
    const markActionProps = {
      left: this.props.left,
      top: this.props.top,
      isShowMark: this.state.isShowMark,
      isExceed: this.state.isExceed,
      handleMarkAction: this.handleMarkAction,
    };
    return (
      <>
        <div
          className="action-dialog-backdrop"
          onClick={(e) => {
            e.stopPropagation();
            this.props.handleActionDialog(false);
          }}
          onTouchEnd={(e) => {
            e.stopPropagation();
            this.props.handleActionDialog(false);
          }}
        />
        <div
          className="action-dialog-container"
          onClick={(e) => {
            e.stopPropagation();
          }}
          onMouseLeave={() => {
            if (
              (typeof window !== "undefined"
                ? window.innerWidth || document.documentElement.clientWidth
                : 1024) > 570
            ) {
              this.props.handleActionDialog(false);
            }
          }}
          onMouseEnter={() => {
            this.props.handleActionDialog(true);
          }}
          style={{ left: this.props.left, top: this.props.top }}
        >
          <div className="action-dialog-actions-container">
            <div
              className="action-dialog-add"
              onClick={() => {
                if (
                  ConfigService.getAllListConfig("favoriteBooks").indexOf(
                    this.props.currentBook.key
                  ) > -1
                ) {
                  this.handleCancelLoveBook();
                } else {
                  this.handleLoveBook();
                }
              }}
            >
              <span className="icon-heart view-icon"></span>
              <p className="action-name">
                {ConfigService.getAllListConfig("favoriteBooks").indexOf(
                  this.props.currentBook.key
                ) > -1 ? (
                  <Trans>Remove from favorite</Trans>
                ) : (
                  <Trans>Add to favorite</Trans>
                )}
              </p>
            </div>
            <div
              className="action-dialog-add"
              onClick={() => {
                this.handleAddShelf();
              }}
            >
              <span className="icon-bookshelf-line view-icon"></span>
              <p className="action-name">
                <Trans i18nKey="Add to group">添加到分组</Trans>
              </p>
            </div>
            <div
              className="action-dialog-add"
              onClick={() => {
                this.handleMultiSelect();
              }}
            >
              <span className="icon-select view-icon"></span>
              <p className="action-name">
                <Trans>Multiple selection</Trans>
              </p>
            </div>
            <div
              className="action-dialog-add"
              onClick={() => {
                if (
                  ConfigService.getAllListConfig("topBooks").indexOf(
                    this.props.currentBook.key
                  ) > -1
                ) {
                  this.handleCancelTopBook();
                } else {
                  this.handleTopBook();
                }
              }}
            >
              <span
                className="icon-sort-desc view-icon"
                style={{ display: "inline-block", transform: "rotate(180deg)" }}
              ></span>
              <p className="action-name">
                {ConfigService.getAllListConfig("topBooks").indexOf(
                  this.props.currentBook.key
                ) > -1 ? (
                  <Trans>Unpin from top</Trans>
                ) : (
                  <Trans>Pin to top</Trans>
                )}
              </p>
            </div>
            <div
              className="action-dialog-delete"
              onClick={() => {
                this.handleDeleteBook();
              }}
            >
              <span className="icon-trash-line view-icon"></span>
              <p className="action-name">
                <Trans>Delete</Trans>
              </p>
            </div>
            <div
              className="action-dialog-edit"
              onClick={() => {
                this.handleEditBook();
              }}
            >
              <span className="icon-edit-line view-icon"></span>
              <p className="action-name">
                <Trans>Edit</Trans>
              </p>
            </div>
            <div
              className="action-dialog-edit"
              onClick={(event) => {
                event.stopPropagation();
                this.setState((prev) => ({
                  isShowMark: !prev.isShowMark,
                  isShowExport: false,
                }));
              }}
              onMouseEnter={(event) => {
                this.setState({ isShowMark: true, isShowExport: false });
                const e = event || window.event;
                let x = e.clientX;
                if (x > document.body.clientWidth - 300) {
                  this.setState({ isExceed: true });
                } else {
                  this.setState({ isExceed: false });
                }
              }}
              onMouseLeave={(event) => {
                if (
                  (typeof window !== "undefined"
                    ? window.innerWidth || document.documentElement.clientWidth
                    : 1024) > 570
                ) {
                  this.setState({ isShowMark: false });
                }
                event.stopPropagation();
              }}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <p className="action-name" style={{ marginLeft: "0px", display: "flex", alignItems: "center" }}>
                <span
                  className="icon-check view-icon"
                  style={{
                    display: "inline-block",
                    marginRight: "8px",
                    marginLeft: "0px",
                    fontSize: "14px",
                  }}
                ></span>
                <Trans>Mark as</Trans>
              </p>
              <span className="icon-dropdown icon-export-all"></span>
            </div>
            <div
              className="action-dialog-edit"
              onClick={() => {
                this.handleDetailBook();
              }}
            >
              <span
                className="icon-idea-line view-icon"
                style={{ fontSize: "16px" }}
              ></span>
              <p className="action-name" style={{ marginLeft: "8px" }}>
                <Trans>Details</Trans>
              </p>
            </div>
            <div
              className="action-dialog-edit"
              onClick={(event) => {
                event.stopPropagation();
                this.setState((prev) => ({
                  isShowExport: !prev.isShowExport,
                  isShowMark: false,
                }));
              }}
              onMouseEnter={(event) => {
                this.setState({ isShowExport: true, isShowMark: false });
                const e = event || window.event;
                let x = e.clientX;
                if (x > document.body.clientWidth - 300) {
                  this.setState({ isExceed: true });
                } else {
                  this.setState({ isExceed: false });
                }
              }}
              onMouseLeave={(event) => {
                if (
                  (typeof window !== "undefined"
                    ? window.innerWidth || document.documentElement.clientWidth
                    : 1024) > 570
                ) {
                  this.setState({ isShowExport: false });
                }
                event.stopPropagation();
              }}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <p className="action-name" style={{ marginLeft: "0px", display: "flex", alignItems: "center" }}>
                <span
                  className="icon-more view-icon"
                  style={{
                    display: "inline-block",
                    marginRight: "8px",
                    marginLeft: "0px",
                    transform: "rotate(90deg)",
                    fontSize: "14px",
                  }}
                ></span>
                <Trans>More actions</Trans>
              </p>

              <span className="icon-dropdown icon-export-all"></span>
            </div>
          </div>
        </div>
        <MarkAction {...(markActionProps as any)} />
        <MoreAction {...(moreActionProps as any)} />
      </>
    );
  }
}

export default ActionDialog;
