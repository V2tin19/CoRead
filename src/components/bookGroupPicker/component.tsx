import React from "react";
import { Trans } from "react-i18next";
import toast from "react-hot-toast";
import "./bookGroupPicker.css";
import { BookGroupPickerProps, BookGroupPickerState } from "./interface";
import {
  MAX_GROUP_NAME_LENGTH,
  sanitizeGroupName,
} from "../../utils/group/bookGroup";
import i18n from "../../i18n";

/**
 * 分组选择弹窗 —— 个人书架和共读房间书架共用。
 *
 * 和上游 Koodo 那个「Add to shelf」的区别：
 *   · **多对多**：一排复选框，一本书可以同时进多个分组。
 *   · 去掉了「复制到 / 移动到」的二选一 —— 多选模型下这个选择没有意义，
 *     勾上 = 加进去，取消 = 移出来。
 *   · 完全受控 + 无副作用：自己不碰 ConfigService、不发请求，
 *     只通过 onConfirm 把「最终应该属于哪些分组」交回给调用方。
 *     个人书架写本地配置、房间书架 POST 服务端，各自处理。
 *
 * 分组名一律当**数据**直接显示，不走 i18n：名字是用户自己敲的，
 * 拿去查词表反而会出现「名字刚好撞上某个键就被翻译掉」的怪事。
 */
class BookGroupPicker extends React.Component<
  BookGroupPickerProps,
  BookGroupPickerState
> {
  private inputRef = React.createRef<HTMLInputElement>();

  constructor(props: BookGroupPickerProps) {
    super(props);
    const names = Array.from(
      new Set(
        [...props.allGroups, ...props.initialSelected]
          .map(sanitizeGroupName)
          .filter((name) => !!name)
      )
    );
    this.state = {
      names,
      selected: Array.from(
        new Set(props.initialSelected.map(sanitizeGroupName).filter((n) => !!n))
      ),
      newName: "",
    };
  }

  componentDidMount() {
    // 还没建过任何分组时，光标直接落在输入框，省一次点击
    if (this.state.names.length === 0) {
      setTimeout(() => this.inputRef.current?.focus(), 30);
    }
  }

  toggle = (name: string) => {
    this.setState((prev) => ({
      selected: prev.selected.includes(name)
        ? prev.selected.filter((n) => n !== name)
        : [...prev.selected, name],
    }));
  };

  handleCreate = () => {
    const name = sanitizeGroupName(this.state.newName);
    if (!name) {
      toast(i18n.t("Group name is empty"));
      return;
    }
    if (name.length >= MAX_GROUP_NAME_LENGTH) {
      toast(i18n.t("Group name is too long"));
      return;
    }
    this.setState((prev) => ({
      names: prev.names.includes(name) ? prev.names : [...prev.names, name],
      selected: prev.selected.includes(name)
        ? prev.selected
        : [...prev.selected, name],
      newName: "",
    }));
  };

  handleConfirm = () => {
    this.props.onConfirm(this.state.selected);
  };

  render() {
    const { names, selected, newName } = this.state;
    return (
      <div
        className="bgp-mask"
        onMouseDown={(event) => {
          // 只有点在遮罩本身（不是弹窗内部）才算取消
          if (event.target === event.currentTarget) this.props.onCancel();
        }}
      >
        <div
          className="bgp-panel"
          onKeyDown={(event: React.KeyboardEvent) => {
            if (event.key === "Escape") this.props.onCancel();
          }}
        >
          <div className="bgp-head">
            <span className="bgp-title">
              <Trans i18nKey="Add to group">添加到分组</Trans>
            </span>
            <span
              className="bgp-close"
              title="关闭"
              onClick={this.props.onCancel}
            >
              ×
            </span>
          </div>

          <div className="bgp-hint">
            {this.props.bookCount > 1
              ? `给这 ${this.props.bookCount} 本书选分组，可以同时选多个。全部取消勾选 = 移出所有分组。`
              : "可以同时选多个分组（一本书能属于多个组）。全部取消勾选 = 移出所有分组。"}
          </div>

          <div className="bgp-list">
            {names.length === 0 ? (
              <div className="bgp-empty">
                还没有任何分组，在下面输入名字新建一个
              </div>
            ) : (
              names.map((name) => (
                <label className="bgp-item" key={name}>
                  <input
                    type="checkbox"
                    className="bgp-item-check"
                    checked={selected.includes(name)}
                    onChange={() => this.toggle(name)}
                  />
                  <span className="bgp-item-name" title={name}>
                    {name}
                  </span>
                </label>
              ))
            )}
          </div>

          <div className="bgp-new">
            <input
              ref={this.inputRef}
              className="bgp-new-input"
              placeholder="新建分组，回车确认"
              maxLength={MAX_GROUP_NAME_LENGTH}
              value={newName}
              onChange={(event) =>
                this.setState({
                  newName: sanitizeGroupName(event.target.value),
                })
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  this.handleCreate();
                }
                if (event.key === "Escape") this.props.onCancel();
              }}
            />
            <span
              className={
                "bgp-new-btn" + (sanitizeGroupName(newName) ? "" : " is-disabled")
              }
              onClick={this.handleCreate}
            >
              <Trans i18nKey="New group">新建</Trans>
            </span>
          </div>

          <div className="bgp-foot">
            <span className="bgp-foot-count">
              {selected.length > 0
                ? `已选 ${selected.length} 个分组`
                : "未选任何分组"}
            </span>
            <div className="bgp-actions">
              <span className="bgp-cancel" onClick={this.props.onCancel}>
                <Trans i18nKey="Cancel">取消</Trans>
              </span>
              <span className="bgp-confirm" onClick={this.handleConfirm}>
                <Trans i18nKey="Confirm">确定</Trans>
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default BookGroupPicker;
