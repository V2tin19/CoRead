import BookModel from "../../../models/Book";

export interface AddDialogProps {
  handleAddDialog: (isShow: boolean) => void;
  handleActionDialog: (isShow: boolean) => void;
  handleSelectBook: (isSelectBook: boolean) => void;
  currentBook: BookModel;
  selectedBooks: string[];
  isSelectBook: boolean;
  mode: string;
  /** 保留：旧代码从这里读当前书架名，改成「分组」后已不再使用 */
  shelfTitle: string;
  t: (title: string) => string;
  /** 保留：分组不再切到独立的书架页，所以这两个动作不再触发 */
  handleMode: (mode: string) => void;
  handleShelf: (shelfTitle: string) => void;
  handleSelectedBooks: (selectedBooks: string[]) => void;
}
