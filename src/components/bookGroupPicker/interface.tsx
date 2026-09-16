export interface BookGroupPickerProps {
  /** 所有可选分组名（个人书架 = 已有分组；房间书架 = 服务端返回的分组） */
  allGroups: string[];
  /** 打开时已经勾选的分组名 */
  initialSelected: string[];
  /** 这批书有几本，只用于文案 */
  bookCount: number;
  /** 关掉弹窗（点遮罩、点取消、按 Esc） */
  onCancel: () => void;
  /** 确认：groupNames = 这组书确认后应该属于的全部分组（空数组 = 移出所有分组） */
  onConfirm: (groupNames: string[]) => void;
}

export interface BookGroupPickerState {
  /** 列表里显示的全部分组名（已有 + 这次临时新建的） */
  names: string[];
  /** 当前勾选的 */
  selected: string[];
  /** 新建输入框里的内容 */
  newName: string;
}
