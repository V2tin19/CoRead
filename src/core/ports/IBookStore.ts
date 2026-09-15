/**
 * 书籍与书架数据存储端口定义
 */
export interface IBookStore {
  getAllBooks(): Promise<any[]>;
  getBook(key: string): Promise<any | null>;
  saveBook(book: any): Promise<void>;
  deleteBook(key: string): Promise<void>;
  getAllShelves(): Promise<any[]>;
  saveShelf(shelf: any): Promise<void>;
  deleteShelf(key: string): Promise<void>;
}
