export class ReadingTimeUtil {
  private bookKey = "";
  private sessionStart = 0;
  private unregisterUnload: (() => void) | null = null;
  private configService: any;
  private platform: any;

  constructor(configService: any, platform: any) {
    this.configService = configService;
    this.platform = platform;
  }

  getDailySeconds(bookKey: string, date: string): number {
    const list: string[] = (this.configService.getAllMapConfig("readingStats") || {})[date] || [];
    const item = list.find((it) => it.startsWith(`${bookKey}-`));
    if (!item) return 0;
    const parts = item.split("-");
    return parseInt(parts[parts.length - 1], 10) || 0;
  }

  setDailySeconds(bookKey: string, date: string, seconds: number): void {
    const list: string[] = (this.configService.getAllMapConfig("readingStats") || {})[date] || [];
    const record = `${bookKey}-${seconds}`;
    const rest = list.filter((it) => !it.startsWith(`${bookKey}-`));
    this.configService.setOneMapConfig(date, [...rest, record], "readingStats");
  }

  start(bookKey: string): void {
    this.bookKey = bookKey;
    this.sessionStart = Date.now();
    if (this.platform && typeof this.platform.registerUnloadHandler === "function") {
      this.unregisterUnload = this.platform.registerUnloadHandler(() => {
        this.commit();
        if (this.platform && typeof this.platform.onBeforeClose === "function") {
          this.platform.onBeforeClose();
        }
      });
    }
  }

  stop(): void {
    this.commit();
    if (this.unregisterUnload) {
      this.unregisterUnload();
      this.unregisterUnload = null;
    }
    this.bookKey = "";
    this.sessionStart = 0;
  }

  commit(): void {
    if (!this.bookKey || !this.sessionStart) return;
    const elapsed = Date.now() - this.sessionStart;
    if (elapsed < 1000) {
      this.sessionStart = 0;
      return;
    }
    const seconds = Math.round(elapsed / 1000);
    this.sessionStart = 0;
    const total = this.configService.getObjectConfig(this.bookKey, "readingTime", 0);
    this.configService.setObjectConfig(this.bookKey, total + seconds, "readingTime");

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const dailySecs = this.getDailySeconds(this.bookKey, dateStr);
    this.setDailySeconds(this.bookKey, dateStr, dailySecs + seconds);
  }

  getTotalSeconds(bookKey: string): number {
    return this.configService.getObjectConfig(bookKey, "readingTime", 0);
  }

  getDailySecondsForBook(bookKey: string, date: string): number {
    return this.getDailySeconds(bookKey, date);
  }

  getDayStats(date: string): { bookKey: string; seconds: number }[] {
    const list: string[] = (this.configService.getAllMapConfig("readingStats") || {})[date] || [];
    return list.map((item) => {
      const idx = item.lastIndexOf("-");
      return {
        bookKey: item.substring(0, idx),
        seconds: parseInt(item.substring(idx + 1), 10) || 0,
      };
    });
  }

  getAllDates(): string[] {
    const stats = this.configService.getAllMapConfig("readingStats");
    return Object.keys(stats || {});
  }
}

export default ReadingTimeUtil;
