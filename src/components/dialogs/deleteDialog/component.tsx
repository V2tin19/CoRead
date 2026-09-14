import React from "react";
import "./deleteDialog.css";
import { Trans } from "react-i18next";
import { DeleteDialogProps, DeleteDialogState } from "./interface";
import { withRouter } from "react-router-dom";
import BookUtil from "../../../utils/file/bookUtil";
import toast from "react-hot-toast";
import CoverUtil from "../../../utils/file/coverUtil";
import DatabaseService from "../../../utils/storage/databaseService";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import { isElectron } from "react-device-detect";

class DeleteDialog extends React.Component<
  DeleteDialogProps,
  DeleteDialogState
> {
  constructor(props: DeleteDialogProps) {
    super(props);
    this.state = {
      isDeleteShelfBook:
        ConfigService.getReaderConfig("isDeleteShelfBook") === "yes",
    };
  }
  handleCancel = () => {
    this.props.handleDeleteDialog(false);
  };
  // 回收站功能已彻底废弃:删除图书一律走物理删除(deleteBook),
  // 不再有「移入回收站」这条分支。
  handleComfirm = async () => {
    if (this.props.mode === "shelf" && !this.state.isDeleteShelfBook) {
      this.deleteBookFromShelf();
    } else {
      this.deleteBooks();
    }
    if (this.props.isSearch) {
      this.props.handleSearch(false);
    }
    this.props.handleDeleteDialog(false);
    toast.success(this.props.t("Deletion successful"), {
      id: "delete-books",
    });
  };
  deleteBookFromShelf = () => {
    if (this.props.isSelectBook) {
      this.props.selectedBooks.forEach((item) => {
        ConfigService.deleteFromMapConfig(
          this.props.shelfTitle,
          item,
          "shelfList"
        );
      });
      this.props.handleSelectedBooks([]);
      this.props.handleFetchBooks();
      this.props.handleSelectBook(!this.props.isSelectBook);
      this.props.handleDeleteDialog(false);
      toast.success(this.props.t("Deletion successful"), {
        id: "delete-books",
      });
      return;
    }
    ConfigService.deleteFromMapConfig(
      this.props.shelfTitle,
      this.props.currentBook.key,
      "shelfList"
    );
  };
  deleteBooks = () => {
    if (this.props.isSelectBook) {
      this.deleteSelectedBook();
    } else {
      this.deleteCurrentBook();
    }
  };
  deleteSelectedBook = () => {
    const keys = [...this.props.selectedBooks];
    this.props.selectedBooks.forEach((item) => {
      const book = this.props.books.find((b) => b.key === item);
      this.deleteBook(item, (book?.format || "epub").toLowerCase());
    });
    this.props.handleSelectedBooks([]);
    this.props.handleFetchBooks();
    this.props.handleSelectBook(!this.props.isSelectBook);
    this.cleanupAfterDelete(keys);
  };
  deleteCurrentBook = () => {
    const key = this.props.currentBook.key;
    this.deleteBook(key, (this.props.currentBook.format || "epub").toLowerCase());
    this.props.handleFetchBooks();
    this.cleanupAfterDelete([key]);
  };
  // 物理删除之后,统一清理该书在书架/最近/收藏等索引里的残留
  cleanupAfterDelete = (keys: string[]) => {
    keys.forEach((key) => {
      ConfigService.deleteListConfig(key, "favoriteBooks");
      ConfigService.deleteListConfig(key, "deletedBooks");
      ConfigService.deleteFromAllMapConfig(key, "shelfList");
      ConfigService.deleteListConfig(key, "recentBooks");
      ConfigService.deleteObjectConfig(key, "recordLocation");
      ConfigService.deleteObjectConfig(key, "pdfCrop");
      ConfigService.deleteObjectConfig(key, "readingTime");
    });
    this.props.handleFetchBookmarks();
    this.props.handleFetchNotes();
  };
  deleteBook = (key: string, format: string) => {
    return new Promise<void>(async (resolve, reject) => {
      if (
        ConfigService.getReaderConfig("isDeleteOriginal") === "yes" &&
        isElectron
      ) {
        let fullBook = await DatabaseService.getRecord(key, "books");
        if (fullBook) {
          const fs = window.require("fs");
          let bookPath = fullBook.path;
          if (fs.existsSync(bookPath)) {
            fs.unlinkSync(bookPath);
          }
        }
      }
      DatabaseService.deleteRecord(key, "books")
        .then(async () => {
          await BookUtil.deleteBook(key, format);
          await CoverUtil.deleteCover(key);
          await BookUtil.deleteBook("cache-" + key, "zip");
          ConfigService.deleteListConfig(key, "favoriteBooks");
          ConfigService.deleteListConfig(key, "deletedBooks");
          ConfigService.deleteFromAllMapConfig(key, "shelfList");
          ConfigService.deleteListConfig(key, "recentBooks");
          ConfigService.deleteObjectConfig(key, "recordLocation");
          ConfigService.deleteObjectConfig(key, "pdfCrop");
          ConfigService.deleteObjectConfig(key, "readingTime");
          await DatabaseService.deleteRecordsByBookKey(key, "bookmarks");
          await DatabaseService.deleteRecordsByBookKey(key, "notes");
          resolve();
        })
        .catch((err) => {
          toast.error("Delete book error: " + err.message, {
            id: "delete-books",
          });
          console.error(err);
          reject(err);
        });
    });
  };
  render() {
    return (
      <div className="delete-dialog-container">
        {this.props.mode === "shelf" && !this.state.isDeleteShelfBook ? (
          <div className="delete-dialog-title">
            <Trans>Delete from shelf</Trans>
          </div>
        ) : (
          <div className="delete-dialog-title">
            <Trans>Delete this book</Trans>
          </div>
        )}
        <div className="delete-dialog-book">
          <div className="delete-dialog-book-title">
            {this.props.isSelectBook ? (
              <Trans
                i18nKey="Total books"
                count={this.props.selectedBooks.length}
              >
                {"Total " + this.props.selectedBooks.length + " books"}
              </Trans>
            ) : (
              this.props.currentBook.name
            )}
          </div>
        </div>

        {this.props.mode === "shelf" && !this.state.isDeleteShelfBook ? (
          <div className="delete-dialog-other-option" style={{ top: "100px" }}>
            <Trans>This action won't delete the original book</Trans>
          </div>
        ) : (
          <div className="delete-dialog-other-option" style={{ top: "100px" }}>
            <Trans>
              This action will permanently delete the selected books, together
              with their notes, bookmarks and digests
            </Trans>
          </div>
        )}
        <div className="add-dialog-button-container">
          <div
            className="add-dialog-cancel"
            onClick={() => {
              this.handleCancel();
            }}
          >
            <Trans>Cancel</Trans>
          </div>
          <div
            className="add-dialog-confirm"
            onClick={() => {
              this.handleComfirm();
            }}
          >
            <Trans>Delete</Trans>
          </div>
        </div>
      </div>
    );
  }
}

export default withRouter(DeleteDialog as any);
