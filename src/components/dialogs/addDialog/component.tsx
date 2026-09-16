import React from "react";
import { AddDialogProps } from "./interface";
import "./addDialog.css";
import toast from "react-hot-toast";
import BookGroupPicker from "../../bookGroupPicker";
import {
  applyPersonalGroupDiff,
  getPersonalGroupsOfBook,
  readPersonalGroups,
} from "../../../utils/group/bookGroup";

/**
 * 「添加到分组」入口 —— 就一个薄壳，真正的界面在共用的 BookGroupPicker 里。
 *
 * 相比上游那版「Add to shelf」，这里修掉了三个实打实的问题：
 *
 *   1. **空名污染**：老代码先 `setListConfig(shelfTitle, "sortedShelfList")`
 *      把名字写进列表、之后才判断 `if (!shelfTitle)`，于是「什么都没填直接确定」
 *      会往分组列表里塞一个空字符串条目，从此书架里多一个看不见的怪分组。
 *      现在校验发生在写盘之前（空名在 picker 里就建不出来）。
 *
 *   2. **切到不存在的书架页**：老代码收尾调 `handleMode("shelf")` +
 *      `handleShelf(name)`，而 CoRead 早就没有 `/manager/shelf` 这条路由了 ——
 *      结果 hash 还停在 home、侧边栏五个项的 active 全被摘掉、页面进入
 *      「已经不是 home 又不认识 shelf」的半死状态。这就是「点了一下就不对劲」
 *      的真正原因。现在一次导航都不做，就地重渲染。
 *
 *   3. **缺少可见出口**：老代码只能「加进去」，加完没有任何地方能看/能改。
 *      现在打开同一个弹窗就会勾上这本书当前所属的全部分组，取消勾选即移出。
 */
class AddDialog extends React.Component<AddDialogProps> {
  handleCancel = () => {
    this.props.handleAddDialog(false);
  };

  /** 这次操作涉及哪几本书的 key：多选模式用选中的，否则用当前这本 */
  private targetKeys(): string[] {
    if (this.props.isSelectBook) {
      return (this.props.selectedBooks || []).map((key) => String(key));
    }
    return this.props.currentBook ? [String(this.props.currentBook.key)] : [];
  }

  /** 打开时这本书（或这批书）已经在哪些分组里 */
  private currentGroups(): string[] {
    const keys = this.targetKeys();
    if (keys.length === 0) return [];
    const groups = readPersonalGroups();
    return groups
      .filter((group) =>
        keys.every((key) => group.books.some((book) => book === key))
      )
      .map((group) => group.name);
  }

  handleConfirm = (groupNames: string[]) => {
    const keys = this.targetKeys();
    if (keys.length === 0) {
      this.props.handleAddDialog(false);
      return;
    }
    applyPersonalGroupDiff(keys, groupNames);
    this.props.handleAddDialog(false);
    this.props.handleActionDialog(false);
    if (this.props.isSelectBook) {
      this.props.handleSelectBook(false);
      this.props.handleSelectedBooks([]);
    }
    toast.success(this.props.t("Group updated"));
  };

  render() {
    const keys = this.targetKeys();
    if (keys.length === 0) {
      return null;
    }
    return (
      <BookGroupPicker
        allGroups={readPersonalGroups().map((group) => group.name)}
        initialSelected={
          this.props.isSelectBook
            ? this.currentGroups()
            : getPersonalGroupsOfBook(keys[0])
        }
        bookCount={keys.length}
        onCancel={this.handleCancel}
        onConfirm={this.handleConfirm}
      />
    );
  }
}

export default AddDialog;
