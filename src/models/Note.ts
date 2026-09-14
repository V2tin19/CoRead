class Note {
  key: string;
  bookKey: string;
  date: { year: number; month: number; day: number };
  chapter: string;
  chapterIndex: number;
  text: string;
  cfi: string;
  range: string;
  notes: string;
  percentage: string;
  color: string;
  tag: string[];
  // ── 共读作者信息（个人笔记下这几个字段为空）──────────────────────────
  // authorName:做这条笔记的人昵称(来自「个人设置」,持久且用户可辨识)
  // authorId  :设备标识(clientId 持久化在 localStorage),用于判断"是不是我"
  authorName: string;
  authorId: string;
  createdAt: number;
  constructor(
    bookKey: string,
    chapter: string,
    chapterIndex: number,
    text: string,
    cfi: string,
    range: string,
    notes: string,
    percentage: string,
    color: string,
    tag: string[],
    authorName?: string,
    authorId?: string
  ) {
    this.key = new Date().getTime() + "";
    this.bookKey = bookKey;
    this.date = {
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
      day: new Date().getDate(),
    };
    this.chapter = chapter;
    this.chapterIndex = chapterIndex;
    this.text = text;
    this.cfi = cfi;
    this.range = range;
    this.notes = notes || "";
    this.percentage = percentage;
    this.color = color;
    this.tag = tag;
    this.authorName = authorName || "";
    this.authorId = authorId || "";
    this.createdAt = Date.now();
  }
}

export default Note;
