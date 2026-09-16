import React from "react";
import "./bookGroupHeader.css";
import { BookGroupHeaderProps } from "./interface";

/**
 * 分组段的标题行 —— 个人书架与共读房间书架共用同一个组件，保证两边长得一样。
 *
 * 刻意不在这里读取任何配置 / 请求数据：标题文本由调用方翻译好传进来，
 * 数量、折叠状态也由调用方管。这样个人书架（redux + 本地配置）和
 * 房间书架（fetch 服务端）都能直接复用。
 *
 * 颜色一律用 inherit + 透明度：这个组件会落在别人已经设好主题色的容器里，
 * 写死黑或白在深色主题下必瞎。
 */
const BookGroupHeader: React.FC<BookGroupHeaderProps> = (props) => {
  const Tag: any = props.tag === "li" ? "li" : "div";
  const { kind, label, count, collapsed, showCount, groupName } = props;
  return (
    <Tag
      className={
        "book-group-header book-group-header-" +
        kind +
        (collapsed ? " book-group-header-collapsed" : "")
      }
      data-group-name={groupName || ""}
      title={collapsed ? "展开这一段" : "收起这一段"}
      onClick={(event: React.MouseEvent) => {
        event.stopPropagation();
        props.onToggle();
      }}
    >
      <span className="book-group-caret" />
      <span className="book-group-label">{label}</span>
      {showCount && <span className="book-group-count">{count}</span>}
    </Tag>
  );
};

export default BookGroupHeader;
