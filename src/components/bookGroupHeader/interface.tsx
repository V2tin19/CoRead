import { BookSection } from "../../utils/group/bookGroup";

export interface BookGroupHeaderProps {
  /** 段的类型：置顶 / 真实分组 / 未分组，只影响样式与默认标题 */
  kind: BookSection<any>["kind"];
  /** 已经翻译好的标题文本（调用方负责 i18n） */
  label: string;
  /** 这一段当前显示多少本 */
  count: number;
  /** 是否收起（收起时列表里这一段的书不渲染） */
  collapsed: boolean;
  /** 是否显示数量（个人书架跟「显示每个书架中的图书数量」设置走） */
  showCount: boolean;
  /** 分组名，用于 scrollToGroupHeader 定位；置顶/未分组段没有名字 */
  groupName?: string;
  /** 房间书架在 <ul> 里用 <li>，个人书架沿用 <div> */
  tag?: "div" | "li";
  onToggle: () => void;
}
