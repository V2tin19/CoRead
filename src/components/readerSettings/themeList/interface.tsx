import Book from "../../../models/Book";

export interface ThemeListProps {
  t: (title: string) => string;
  currentBook: Book;
  renderBookFunc: () => void;
  handleBackgroundColor: (color: string) => void;
}

export interface ThemeListState {
  // 桌面端沿用「点击时记录的下标」；手机端预设被裁剪过、下标会漂移，
  // 改为按当前配置现算（见 component.tsx 的 renderColorRow）。
  currentBackgroundIndex: number;
  currentTextIndex: number;
  currentPresetIndex: number;
  isShowTextPicker: boolean;
  isShowBgPicker: boolean;
  // 手机端「主题」预设行是否展开（默认只看第一行）
  isShowAllThemes: boolean;
  bgColorInput: string;
  textColorInput: string;
}
