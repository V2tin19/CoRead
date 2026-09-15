import { IBookStore } from "../../ports/IBookStore";
import { INoteStore } from "../../ports/INoteStore";
import { IReadingProgressStore } from "../../ports/IReadingProgressStore";
import { RenderPosition, NoteRange } from "../../domain/render";
import DatabaseService from "../../../utils/storage/databaseService";
import { ConfigService } from "../../../services/configService";

/**
 * 基于 DatabaseService (localforage/IndexedDB) 的书籍存储适配器
 */
export class IndexedDBBookStore implements IBookStore {
  async getAllBooks(): Promise<any[]> {
    return DatabaseService.getAllRecords("books");
  }

  async getBook(key: string): Promise<any | null> {
    const books = await this.getAllBooks();
    return books.find((b: any) => b.key === key) || null;
  }

  async saveBook(book: any): Promise<void> {
    await DatabaseService.updateRecord(book, "books");
  }

  async deleteBook(key: string): Promise<void> {
    await DatabaseService.deleteRecord(key, "books");
  }

  async getAllShelves(): Promise<any[]> {
    return DatabaseService.getAllRecords("shelves");
  }

  async saveShelf(shelf: any): Promise<void> {
    await DatabaseService.updateRecord(shelf, "shelves");
  }

  async deleteShelf(key: string): Promise<void> {
    await DatabaseService.deleteRecord(key, "shelves");
  }
}

/**
 * 基于 DatabaseService 的笔记与书签存储适配器
 */
export class IndexedDBNoteStore implements INoteStore {
  async getAllNotes(bookKey?: string): Promise<NoteRange[]> {
    const records = (await DatabaseService.getAllRecords("notes")) || [];
    if (bookKey) {
      return records.filter((r: any) => r.bookKey === bookKey);
    }
    return records;
  }

  async getNote(key: string): Promise<NoteRange | null> {
    return DatabaseService.getRecord(key, "notes");
  }

  async saveNote(note: NoteRange): Promise<void> {
    if (note.key) {
      await DatabaseService.updateRecord(note, "notes");
    } else {
      await DatabaseService.saveRecord(note, "notes");
    }
  }

  async deleteNote(key: string): Promise<void> {
    await DatabaseService.deleteRecord(key, "notes");
  }

  async getAllBookmarks(bookKey?: string): Promise<any[]> {
    const records = (await DatabaseService.getAllRecords("bookmarks")) || [];
    if (bookKey) {
      return records.filter((r: any) => r.bookKey === bookKey);
    }
    return records;
  }

  async saveBookmark(bookmark: any): Promise<void> {
    if (bookmark.key) {
      await DatabaseService.updateRecord(bookmark, "bookmarks");
    } else {
      await DatabaseService.saveRecord(bookmark, "bookmarks");
    }
  }

  async deleteBookmark(key: string): Promise<void> {
    await DatabaseService.deleteRecord(key, "bookmarks");
  }
}

/**
 * 基于 ConfigService 与 DatabaseService 的阅读进度与时长适配器
 */
export class ReadingProgressStore implements IReadingProgressStore {
  async getProgress(bookKey: string): Promise<RenderPosition | null> {
    const raw = ConfigService.getObjectConfig(bookKey, "recordLocation", null);
    if (!raw) return null;

    const chapterIndex = parseInt(
      raw.chapterDocIndex ?? raw.chapterIndex ?? 0,
      10
    );
    const progress = parseFloat(raw.percentage ?? raw.progress ?? 0);

    return {
      chapterIndex: isNaN(chapterIndex) ? 0 : chapterIndex,
      progress: isNaN(progress) ? 0 : progress,
      text: raw.visibleText || "",
      location: raw,
    };
  }

  async saveProgress(bookKey: string, pos: RenderPosition): Promise<void> {
    const locationData = pos.location || {
      chapterDocIndex: pos.chapterIndex,
      percentage: pos.progress,
      visibleText: pos.text,
    };
    ConfigService.setObjectConfig(bookKey, locationData, "recordLocation");
    await this.addRecentBook(bookKey);
  }

  async getRecentBooks(): Promise<string[]> {
    return ConfigService.getAllListConfig("recentBooks") || [];
  }

  async addRecentBook(bookKey: string): Promise<void> {
    const recent = await this.getRecentBooks();
    const updated = [bookKey, ...recent.filter((k) => k !== bookKey)].slice(
      0,
      50
    );
    ConfigService.setAllListConfig(updated, "recentBooks");
  }

  async getReadingTime(bookKey?: string): Promise<number> {
    const records = (await DatabaseService.getAllRecords("readtimes")) || [];
    if (bookKey) {
      const match = records.find((r: any) => r.bookKey === bookKey);
      return match ? Number(match.readTime || 0) : 0;
    }
    return records.reduce(
      (acc: number, r: any) => acc + Number(r.readTime || 0),
      0
    );
  }

  async recordReadingTime(bookKey: string, seconds: number): Promise<void> {
    const records = (await DatabaseService.getAllRecords("readtimes")) || [];
    const existing = records.find((r: any) => r.bookKey === bookKey);
    if (existing) {
      existing.readTime = Number(existing.readTime || 0) + seconds;
      await DatabaseService.updateRecord(existing, "readtimes");
    } else {
      await DatabaseService.saveRecord(
        {
          bookKey,
          readTime: seconds,
          date: new Date().toISOString(),
        },
        "readtimes"
      );
    }
  }
}
