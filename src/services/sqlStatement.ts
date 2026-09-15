function withTempKeys<T extends Record<string, any>>(obj: T): T {
  const result: any = { ...obj };
  for (const k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      result[`temp-${k}`] = obj[k];
    }
  }
  return result;
}

export const SqlStatement = {
  sqlStatement: {
    createTableStatement: withTempKeys({
      notes: `
        CREATE TABLE IF NOT EXISTS "notes" (
          "key" text PRIMARY KEY,
          "bookKey" text,
          "date" object,
          "chapter" text,
          "chapterIndex" integer,
          "text" text,
          "cfi" text,
          "range" text,
          "notes" text,
          "percentage" text,
          "color" integer,
          "tag" array
        )
      `,
      bookmarks: `
        CREATE TABLE IF NOT EXISTS "bookmarks" (
          "key" text PRIMARY KEY,
          "bookKey" text,
          "cfi" text,
          "label" text,
          "percentage" text,
          "chapter" text
        );
      `,
      books: `
        CREATE TABLE IF NOT EXISTS "books" (
          "key" text PRIMARY KEY,
          "name" text,
          "author" text,
          "description" text,
          "md5" text,
          "cover" text,
          "format" text,
          "publisher" text,
          "size" integer,
          "page" integer,
          "path" text,
          "charset" text
        );
      `,
      plugins: `
        CREATE TABLE IF NOT EXISTS "plugins" (
          "key" text PRIMARY KEY,
          "type" text,
          "displayName" text,
          "icon" text,
          "version" text,
          "config" object,
          "autoValue" string,
          "langList" text,
          "voiceList" text,
          "scriptSHA256" text,
          "script" text
        );
      `,
      words: `
        CREATE TABLE IF NOT EXISTS "words" (
          "key" text PRIMARY KEY,
          "bookKey" text,
          "date" object,
          "word" text,
          "sentence" text,
          "chapter" text
        );
      `,
    }),
    getAllStatement: withTempKeys({
      notes: "SELECT * FROM notes",
      bookmarks: "SELECT * FROM bookmarks",
      books: "SELECT * FROM books",
      plugins: "SELECT * FROM plugins",
      words: "SELECT * FROM words",
    }),
    saveStatement: withTempKeys({
      notes:
        "INSERT OR REPLACE INTO notes (key, bookKey, chapter, chapterIndex, text, cfi, range, notes, date, percentage, color, tag) VALUES (@key, @bookKey, @chapter, @chapterIndex, @text, @cfi, @range, @notes, @date, @percentage, @color, @tag)",
      bookmarks:
        "INSERT OR REPLACE INTO bookmarks (key, bookKey, cfi, label, percentage, chapter) VALUES (@key, @bookKey, @cfi, @label, @percentage, @chapter)",
      books:
        "INSERT OR REPLACE INTO books (key, name, author, description, md5, cover, format, publisher, size, page, path, charset) VALUES (@key, @name, @author, @description, @md5, @cover, @format, @publisher, @size, @page, @path, @charset)",
      plugins:
        "INSERT OR REPLACE INTO plugins (key, type, displayName, icon, version, config, autoValue, langList, voiceList, scriptSHA256, script) VALUES (@key, @type, @displayName, @icon, @version, @config, @autoValue, @langList, @voiceList, @scriptSHA256, @script)",
      words:
        "INSERT OR REPLACE INTO words (key, bookKey, date, word, sentence, chapter) VALUES (@key, @bookKey, @date, @word, @sentence, @chapter)",
    }),
  },
  sqliteToJson: withTempKeys({
    notes: (row: any) => {
      const res = { ...row };
      if (typeof row.date === "string") {
        try {
          res.date = JSON.parse(row.date);
        } catch {}
      }
      if (typeof row.tag === "string") {
        try {
          res.tag = JSON.parse(row.tag);
        } catch {}
      }
      return res;
    },
    bookmarks: (row: any) => row,
    books: (row: any) => row,
    plugins: (row: any) => {
      const res = { ...row };
      if (!row.autoValue) delete res.autoValue;
      if (row.langList) {
        try {
          res.langList = JSON.parse(row.langList);
        } catch {
          delete res.langList;
        }
      } else {
        delete res.langList;
      }
      if (row.voiceList) {
        try {
          res.voiceList = JSON.parse(row.voiceList);
        } catch {
          delete res.voiceList;
        }
      } else {
        delete res.voiceList;
      }
      if (row.config) {
        try {
          res.config = JSON.parse(row.config);
        } catch {}
      }
      return res;
    },
    words: (row: any) => {
      const res = { ...row };
      if (typeof row.date === "string") {
        try {
          res.date = JSON.parse(row.date);
        } catch {}
      }
      if (res.sentence === undefined) res.sentence = "";
      return res;
    },
  }),
  jsonToSqlite: withTempKeys({
    notes: (item: any) => {
      const res = { ...item };
      res.date = JSON.stringify(item.date);
      res.tag = JSON.stringify(item.tag);
      return res;
    },
    bookmarks: (item: any) => item,
    books: (item: any) => {
      const res = { ...item };
      res.page = item.page || 0;
      return res;
    },
    plugins: (item: any) => {
      const res = { ...item };
      if (!item.autoValue) res.autoValue = null;
      res.langList = item.langList ? JSON.stringify(item.langList) : null;
      res.voiceList = item.voiceList ? JSON.stringify(item.voiceList) : null;
      res.config = item.config ? JSON.stringify(item.config) : null;
      return res;
    },
    words: (item: any) => {
      const res = { ...item };
      res.date = JSON.stringify(item.date);
      if (res.sentence === undefined) res.sentence = "";
      return res;
    },
  }),
};

export default SqlStatement;
