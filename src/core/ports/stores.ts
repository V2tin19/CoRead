import { IConfigStore } from "./IConfigStore";
import { IBookStore } from "./IBookStore";
import { INoteStore } from "./INoteStore";
import { IReadingProgressStore } from "./IReadingProgressStore";
import { LocalConfigStore } from "../adapters/store/localConfigStore";
import {
  IndexedDBBookStore,
  IndexedDBNoteStore,
  ReadingProgressStore,
} from "../adapters/store/indexedDBStore";

/**
 * 统一仓储实例出口（单例模式，对上层提供解耦访问）
 */
export const configStore: IConfigStore = new LocalConfigStore();
export const bookStore: IBookStore = new IndexedDBBookStore();
export const noteStore: INoteStore = new IndexedDBNoteStore();
export const readingProgressStore: IReadingProgressStore =
  new ReadingProgressStore();
