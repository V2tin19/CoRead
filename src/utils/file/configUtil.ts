import {
  ConfigService,
  CommonTool,
  SqlStatement,
} from "../../assets/lib/kookit-extra-browser.min";
import DatabaseService from "../storage/databaseService";
import { isElectron } from "react-device-detect";
import { getStorageLocation } from "../common";
import Note from "../../models/Note";

class ConfigUtil {
  static async getNotesByBookKeyAndTypeWithSort(
    bookKey: string,
    type: string,
    sort: string = "key",
    order: string = "DESC"
  ) {
    if (isElectron) {
      let queryString = "";
      let data: any[] = [];
      if (type === "note" && bookKey) {
        queryString = `SELECT key, bookKey, chapterIndex FROM notes WHERE bookKey = ? AND notes != '' ORDER BY ${sort} ${order}`;
        data = [bookKey];
      } else if (type === "highlight" && bookKey) {
        queryString = `SELECT key, bookKey, chapterIndex FROM notes WHERE bookKey = ? AND notes = '' ORDER BY ${sort} ${order}`;
        data = [bookKey];
      } else if (type === "note" && !bookKey) {
        queryString = `SELECT key, bookKey, chapterIndex FROM notes WHERE notes != '' ORDER BY ${sort} ${order}`;
      } else if (type === "highlight" && !bookKey) {
        queryString = `SELECT key, bookKey, chapterIndex FROM notes WHERE notes = '' ORDER BY ${sort} ${order}`;
      } else if (!type && bookKey) {
        queryString = `SELECT key, bookKey, chapterIndex FROM notes WHERE bookKey = ? ORDER BY ${sort} ${order}`;
        data = [bookKey];
      } else {
        queryString = `SELECT key, bookKey, chapterIndex FROM notes ORDER BY ${sort} ${order}`;
      }
      const { ipcRenderer } = window.require("electron");
      return await ipcRenderer.invoke("custom-database-command", {
        dbName: "notes",
        storagePath: getStorageLocation(),
        query: queryString,
        data: data,
        executeType: "all",
      });
    } else {
      let notes: Note[] = await DatabaseService.getAllRecords("notes");
      let filteredNotes = notes.filter((note) => {
        let typeMatch =
          (type === "note" && note.notes !== "") ||
          (type === "highlight" && note.notes === "") ||
          !type;
        let bookKeyMatch = bookKey ? note.bookKey === bookKey : true;
        return typeMatch && bookKeyMatch;
      });
      if (sort === "key") {
        filteredNotes.sort((a, b) => {
          if (order === "ASC") {
            return Number(a.key) - Number(b.key);
          } else {
            return Number(b.key) - Number(a.key);
          }
        });
      } else if (sort === "percentage") {
        filteredNotes.sort((a, b) => {
          if (order === "ASC") {
            return Number(a.percentage) - Number(b.percentage);
          } else {
            return Number(b.percentage) - Number(a.percentage);
          }
        });
      }
      return filteredNotes;
    }
  }
  static async searchNotesByKeyword(
    keyword: string,
    bookKey: string,
    type: string
  ) {
    if (isElectron) {
      const { ipcRenderer } = window.require("electron");
      let queryString = "";
      let data: any[] = [];
      if (type === "note" && bookKey) {
        queryString = `SELECT * FROM notes WHERE bookKey = ? AND (notes LIKE ? OR text LIKE ?) ORDER BY key DESC`;
        data = [
          bookKey,
          `%${keyword.toLowerCase()}%`,
          `%${keyword.toLowerCase()}%`,
        ];
      } else if (type === "highlight" && bookKey) {
        queryString = `SELECT * FROM notes WHERE bookKey = ? AND (notes = '' AND (notes LIKE ? OR text LIKE ?)) ORDER BY key DESC`;
        data = [
          bookKey,
          `%${keyword.toLowerCase()}%`,
          `%${keyword.toLowerCase()}%`,
        ];
      } else if (type === "note" && !bookKey) {
        queryString = `SELECT * FROM notes WHERE (notes != '' AND (notes LIKE ? OR text LIKE ?)) ORDER BY key DESC`;
        data = [`%${keyword.toLowerCase()}%`, `%${keyword.toLowerCase()}%`];
      } else if (type === "highlight" && !bookKey) {
        queryString = `SELECT * FROM notes WHERE (notes = '' AND (notes LIKE ? OR text LIKE ?)) ORDER BY key DESC`;
        data = [`%${keyword.toLowerCase()}%`, `%${keyword.toLowerCase()}%`];
      } else if (!type && bookKey) {
        queryString = `SELECT * FROM notes WHERE bookKey = ? AND (notes LIKE ? OR text LIKE ?) ORDER BY key DESC`;
        data = [
          bookKey,
          `%${keyword.toLowerCase()}%`,
          `%${keyword.toLowerCase()}%`,
        ];
      } else {
        queryString = `SELECT * FROM notes WHERE (notes LIKE ? OR text LIKE ?) ORDER BY key DESC`;
        data = [`%${keyword.toLowerCase()}%`, `%${keyword.toLowerCase()}%`];
      }
      return await ipcRenderer.invoke("custom-database-command", {
        dbName: "notes",
        storagePath: getStorageLocation(),
        query: queryString,
        data: data,
        executeType: "all",
      });
    } else {
      let notes = await DatabaseService.getAllRecords("notes");
      let filteredNotes = notes.filter(
        (note) =>
          ((type === "note" && note.notes !== "") ||
            (type === "highlight" && note.notes === "") ||
            !type) &&
          (note.bookKey === bookKey || !bookKey) &&
          (note.notes.toLowerCase().includes(keyword.toLowerCase()) ||
            note.text.toLowerCase().includes(keyword.toLowerCase()))
      );
      filteredNotes.sort((a, b) => b.key - a.key);
      return filteredNotes;
    }
  }
  static async searchBookmarksByKeyword(keyword: string, bookKey: string) {
    if (isElectron) {
      const { ipcRenderer } = window.require("electron");
      let queryString = "";
      let data: any[] = [];
      if (bookKey) {
        queryString = `SELECT * FROM bookmarks WHERE bookKey = ? AND (label LIKE ? OR chapter LIKE ?) ORDER BY key DESC`;
        data = [
          bookKey,
          `%${keyword.toLowerCase()}%`,
          `%${keyword.toLowerCase()}%`,
        ];
      } else {
        queryString = `SELECT * FROM bookmarks WHERE (label LIKE ? OR chapter LIKE ?) ORDER BY key DESC`;
        data = [`%${keyword.toLowerCase()}%`, `%${keyword.toLowerCase()}%`];
      }
      return await ipcRenderer.invoke("custom-database-command", {
        dbName: "bookmarks",
        storagePath: getStorageLocation(),
        query: queryString,
        data: data,
        executeType: "all",
      });
    } else {
      let bookmarks = await DatabaseService.getAllRecords("bookmarks");
      let filteredBookmarks = bookmarks.filter(
        (bookmark) =>
          (bookmark.bookKey === bookKey || !bookKey) &&
          (bookmark.label.toLowerCase().includes(keyword.toLowerCase()) ||
            bookmark.chapter.toLowerCase().includes(keyword.toLowerCase()))
      );
      filteredBookmarks.sort((a, b) => b.key - a.key);
      return filteredBookmarks;
    }
  }
  static async getNoteWithTags(tags: string[]) {
    if (isElectron) {
      const { ipcRenderer } = window.require("electron");
      let queryString = "";
      let data: any[] = [];
      if (tags.length > 0) {
        let instrArr = tags.map(() => "instr(tag, ?) > 0").join(" AND ");
        queryString = `SELECT * FROM notes WHERE ${instrArr} ORDER BY key DESC`;
        data = tags;
      } else {
        queryString = `SELECT * FROM notes ORDER BY key DESC`;
      }
      return await ipcRenderer.invoke("custom-database-command", {
        dbName: "notes",
        storagePath: getStorageLocation(),
        query: queryString,
        data: data,
        executeType: "all",
      });
    } else {
      let notes = await DatabaseService.getAllRecords("notes");
      let filteredNotes = notes.filter((note) => {
        for (let i = 0; i < tags.length; i++) {
          if (!note.tag.includes(tags[i])) {
            return false;
          }
        }
        return true;
      });
      filteredNotes.sort((a, b) => b.key - a.key);
      return filteredNotes;
    }
  }
  static async deleteTagFromNotes(tagName: string) {
    if (isElectron) {
      const { ipcRenderer } = window.require("electron");
      let rawNotes: any[] = await ipcRenderer.invoke(
        "custom-database-command",
        {
          dbName: "notes",
          storagePath: getStorageLocation(),
          query: `SELECT * FROM notes WHERE instr(tag, ?) > 0`,
          data: [tagName],
          executeType: "all",
        }
      );
      let notes = rawNotes.map((item) =>
        SqlStatement.sqliteToJson["notes"](item)
      );
      let updatedNotes = notes.map((item) => {
        return {
          ...item,
          tag: item.tag.filter((subitem: string) => subitem !== tagName),
        };
      });
      for (let i = 0; i < updatedNotes.length; i++) {
        await ipcRenderer.invoke("custom-database-command", {
          dbName: "notes",
          storagePath: getStorageLocation(),
          query: `UPDATE notes SET tag = ? WHERE key = ?`,
          data: [JSON.stringify(updatedNotes[i].tag), updatedNotes[i].key],
          executeType: "run",
        });
      }
    } else {
      let notes: any[] = await DatabaseService.getAllRecords("notes");
      let filteredNotes = notes.filter((note) => note.tag.includes(tagName));
      let updatedNotes = filteredNotes.map((item) => {
        return {
          ...item,
          tag: item.tag.filter((subitem) => subitem !== tagName),
        };
      });
      for (let i = 0; i < updatedNotes.length; i++) {
        await DatabaseService.updateRecord(updatedNotes[i], "notes");
      }
    }
  }
  static async getNoteList() {
    if (isElectron) {
      const { ipcRenderer } = window.require("electron");
      let queryString = `SELECT key, bookKey, chapterIndex FROM notes ORDER BY key DESC`;
      return await ipcRenderer.invoke("custom-database-command", {
        dbName: "notes",
        storagePath: getStorageLocation(),
        query: queryString,
        executeType: "all",
      });
    } else {
      let notes = await DatabaseService.getAllRecords("notes");
      notes.sort((a, b) => b.key - a.key);
      return notes;
    }
  }
  static async dumpConfig(type: string) {
    let config = {};
    if (type === "sync") {
      config = ConfigService.getAllSyncRecord();
    } else {
      let configList = CommonTool.configList;
      configList = [
        ...configList,
        "dictList",
        "backgroundList",
        "fontList",
        "readerConfig",
        "customBackgrounds",
        "customFonts",
        "customDicts",
      ];
      for (let i = 0; i < configList.length; i++) {
        let item = configList[i];
        if (ConfigService.getItem(item)) {
          config[item] = ConfigService.getItem(item);
        }
      }
    }
    return config;
  }
  static clearConfig(type: string) {
    if (type === "sync") {
      ConfigService.removeItem("syncRecord");
    } else {
      let configList = CommonTool.configList;
      for (let i = 0; i < configList.length; i++) {
        let item = configList[i];
        ConfigService.removeItem(item);
      }
    }
  }
  static async loadConfig(type: string, configStr: string) {
    let tempConfig = JSON.parse(configStr);
    if (type === "sync") {
      ConfigService.setAllSyncRecord(tempConfig);
    } else {
      for (let key in tempConfig) {
        ConfigService.setItem(key, tempConfig[key]);
      }
    }
  }
}
export default ConfigUtil;
