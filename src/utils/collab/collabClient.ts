import { resolveCollabServerUrl } from "./collabServerConfig";

type CollabEventHandler = (payload: any) => void;

export interface CollabMessage {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: number;
}

export interface CollabMember {
  clientId: string;
  name: string;
  joinedAt: number;
}

export interface CollabRoomBrief {
  roomId: string;
  bookKey: string;
  ownerId: string;
  members: string[];
  createdAt: number;
}

export interface CollabRoomSnapshot {
  roomId: string;
  bookKey: string;
  ownerId: string;
  currentLocation: any;
  members: CollabMember[];
  messages: CollabMessage[];
  notes: any[];
  /** 房间里指定的「领读」：只有跟随开关打开且翻页者是领读时，才会被跟随 */
  leaderId?: string;
  leaderName?: string;
}

export class CollabRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** 未配置共读服务器时的错误。本地阅读器模式下共读入口应置灰,理论上走不到这里。 */
export class CollabServerUnconfiguredError extends Error {
  constructor() {
    super("尚未设置共读服务器地址");
    this.name = "CollabServerUnconfiguredError";
  }
}

// 本版本 Koodo 的 book.key 是导入时间戳,同一文件在不同设备上 key 必不相同;
// 共读用内容 MD5 作为书的关键标识(旧版本数据 key 即 md5,回退兼容)
export const getCollabBookKey = (
  book?: { key: string; md5?: string } | null
) => {
  return book?.md5 || book?.key || "";
};

class CollabClient {
  // 当前生效的共读服务器地址(唯一真源见 utils/collab/collabServerConfig.ts):
  // 用户设置 > 构建期注入 REACT_APP_COLLAB_URL > 同源 /collab(仅网页部署/开发环境)。
  // 空字符串 = 未配置 = 本地阅读器模式 —— 打包客户端不会内联任何服务器信息。
  get serverUrl(): string {
    return resolveCollabServerUrl();
  }

  /** 是否已配置共读服务器。false 时不要发起任何共读请求。 */
  get isServerConfigured(): boolean {
    return Boolean(this.serverUrl);
  }

  // 服务端设置 COLLAB_TOKEN 后，写操作需带此头；未设置则服务端放行，本值留空即可。
  token = process.env.REACT_APP_COLLAB_TOKEN || "";

  // 统一的鉴权请求头。GET/文件直链不需要，POST/PUT/DELETE 带上。
  private authHeaders(extra: Record<string, string> = {}) {
    return this.token ? { ...extra, "x-collab-token": this.token } : extra;
  }

  clientId = "";
  roomId = "";
  bookKey = "";
  name = "";
  isConnected = false;
  /** 房间里的领读（由服务端下发，翻页跟随只认这个人） */
  leaderId = "";
  leaderName = "";
  /** 本机是否跟随领读（本地偏好，不广播）。默认关：别人翻页不该把人拽走 */
  followLeader = false;
  // 显式 createRoom/joinRoom 进行中时抑制自动重入房,避免旧房间误触发
  private joining = false;
  private events: EventSource | null = null;
  private listeners: Record<string, CollabEventHandler[]> = {};
  // ── 连接自愈 ──────────────────────────────────────────────────────
  // 浏览器的 EventSource 在服务端短暂不可用（部署重启/网络切换）后会进入
  // CLOSED 态并**永远放弃**自动重连,而 UI 只会显示「正在自动重连」。
  // 这里自己兜底：最后一次收到 SSE 消息的时间 + 看门狗 + 回前台主动重连。
  private lastEventAt = 0;
  private reconnectTimer: any = null;
  private reconnectDelay = 2000;
  private watchdogTimer: any = null;
  private visibilityHooked = false;

  constructor() {
    this.clientId = this.getStoredClientId();
    try {
      // 默认开:共读就是跟着领读走的场景,不想要的人手动关一次即可(记住选择)
      this.followLeader =
        localStorage.getItem("koodo-collab-follow-leader") !== "off";
    } catch (e) {
      this.followLeader = true;
    }
  }

  setFollowLeader(enabled: boolean) {
    this.followLeader = enabled;
    try {
      localStorage.setItem(
        "koodo-collab-follow-leader",
        enabled ? "on" : "off"
      );
    } catch (e) {
      // 存不进去只影响持久化，本次会话仍然生效
    }
  }

  private getStoredClientId() {
    const key = "koodo-collab-client-id";
    let clientId = localStorage.getItem(key);
    if (!clientId) {
      clientId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(key, clientId);
    }
    return clientId;
  }

  on(eventName: string, handler: CollabEventHandler) {
    if (!this.listeners[eventName]) {
      this.listeners[eventName] = [];
    }
    this.listeners[eventName].push(handler);
    return () => {
      this.listeners[eventName] = (this.listeners[eventName] || []).filter(
        (item) => item !== handler
      );
    };
  }

  off(eventName: string, handler: CollabEventHandler) {
    this.listeners[eventName] = (this.listeners[eventName] || []).filter(
      (item) => item !== handler
    );
  }

  private emit(eventName: string, payload: any) {
    (this.listeners[eventName] || []).forEach((handler) => handler(payload));
  }

  connect() {
    const serverUrl = this.serverUrl;
    if (!serverUrl) {
      // 本地阅读器模式:不建立任何连接
      this.emit("server-unconfigured", null);
      return;
    }
    if (this.events) {
      this.events.close();
      this.events = null;
    }
    this.lastEventAt = Date.now();
    const eventSource = new EventSource(
      `${serverUrl}/events?clientId=${encodeURIComponent(this.clientId)}`
    );
    this.events = eventSource;
    const touch = () => {
      this.lastEventAt = Date.now();
    };
    eventSource.addEventListener("connected", () => {
      this.isConnected = true;
      // 重连成功,退避计时器归位
      this.reconnectDelay = 2000;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.emit("connected", { clientId: this.clientId });
      void this.rejoinAfterReconnect();
    });
    eventSource.addEventListener("ping", touch);
    eventSource.addEventListener("room-updated", (event: Event) => {
      touch();
      const data = JSON.parse((event as MessageEvent).data);
      // 领读可能被别人改掉，顺手刷新，阅读器那边靠它判断「这次翻页要不要跟」
      if (data && data.roomId === this.roomId) {
        this.leaderId = data.leaderId || "";
        this.leaderName = data.leaderName || "";
      }
      this.emit("room-updated", data);
    });
    eventSource.addEventListener("chat-message", (event: Event) => {
      touch();
      this.emit("chat-message", JSON.parse((event as MessageEvent).data));
    });
    eventSource.addEventListener("page-change", (event: Event) => {
      touch();
      this.emit("page-change", JSON.parse((event as MessageEvent).data));
    });
    eventSource.addEventListener("note-created", (event: Event) => {
      touch();
      this.emit("note-created", JSON.parse((event as MessageEvent).data));
    });
    eventSource.addEventListener("note-updated", (event: Event) => {
      touch();
      this.emit("note-updated", JSON.parse((event as MessageEvent).data));
    });
    eventSource.addEventListener("note-deleted", (event: Event) => {
      touch();
      this.emit("note-deleted", JSON.parse((event as MessageEvent).data));
    });
    eventSource.addEventListener("doodle", (event: Event) => {
      touch();
      this.emit("doodle", JSON.parse((event as MessageEvent).data));
    });
    eventSource.addEventListener("room-deleted", (event: Event) => {
      touch();
      const data = JSON.parse((event as MessageEvent).data);
      if (this.roomId && data.roomId === this.roomId) {
        this.roomId = "";
      }
      this.emit("room-deleted", data);
    });
    eventSource.onerror = () => {
      this.isConnected = false;
      this.emit("connection-error", null);
      // readyState === CLOSED 表示浏览器已经放弃这条 EventSource（服务端
      // 重启/部署窗口、代理断开都会走到这里）,不主动重建就永远断下去。
      // CONNECTING 态浏览器自己会重试,不用管。
      const CLOSED =
        typeof EventSource !== "undefined" ? EventSource.CLOSED : 2;
      if (eventSource.readyState === CLOSED) {
        this.scheduleReconnect();
      }
    };
    this.startWatchdog();
    this.startVisibilityHook();
  }

  // 断线重连:指数退避,避免服务重启窗口期疯狂打请求
  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
      this.connect();
    }, this.reconnectDelay);
  }

  // 看门狗:服务端 25s 一次心跳,超过 3 个周期没听到任何消息,说明这条
  // 连接已经是"看起来活着"的半死连接（手机息屏/切换网络后很常见）,强制重建。
  private startWatchdog() {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => {
      // 未配置服务器(或正在显式入房)时不折腾:connect() 会直接返回
      if (this.joining || !this.isServerConfigured) return;
      const es: any = this.events;
      const CLOSED = typeof EventSource !== "undefined" ? EventSource.CLOSED : 2;
      const silent = Date.now() - this.lastEventAt;
      if (!es || es.readyState === CLOSED) {
        this.scheduleReconnect();
        return;
      }
      if (silent > 75000) {
        this.connect();
      }
    }, 10000);
  }

  // 回前台:手机息屏/切后台期间 SSE 几乎必被系统掐断。回到可见时
  // ① 连接已断 → 立刻重建,不等浏览器慢悠悠的重试;
  // ② 连接看着还在 → 服务端可能已把本端移出房间,用 REST 快照核对成员表,
  //    不在就立刻重新入房（fetch 走普通请求,不依赖 SSE 是否活着）。
  private startVisibilityHook() {
    if (this.visibilityHooked || typeof document === "undefined") return;
    this.visibilityHooked = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      if (!this.isServerConfigured) return;
      const es: any = this.events;
      const CLOSED = typeof EventSource !== "undefined" ? EventSource.CLOSED : 2;
      if (!this.isConnected || !es || es.readyState !== EventSource.OPEN) {
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.reconnectDelay = 2000;
        this.connect();
        return;
      }
      void this.verifyMembership();
    });
  }

  // REST 核对房间成员表:本端被服务端摘除（息屏期间连接被掐）时立即补join
  private async verifyMembership() {
    if (this.joining || !this.roomId || !this.bookKey) return;
    try {
      const room = await this.fetchRoomSnapshot(this.roomId);
      const stillMember = (room.members || []).some(
        (member) => member.clientId === this.clientId
      );
      if (!stillMember) {
        await this.rejoinAfterReconnect();
      }
    } catch (e) {
      // 拉不到快照(网络抖动)就等看门狗/SSE 错误处理;404 由
      // rejoinAfterReconnect 的 room-lost 逻辑兜底
      const status = e instanceof CollabRequestError ? e.status : 0;
      if (status === 404) {
        const lostRoomId = this.roomId;
        this.roomId = "";
        this.emit("room-lost", { roomId: lostRoomId });
      }
    }
  }

  disconnect() {
    if (this.events) {
      this.events.close();
      this.events = null;
    }
    // 只关连接不清定时器的话,看门狗会在 10s 内发现 events 为空又把连接建回来,
    // disconnect 就形同虚设 —— 一并把自愈机制停掉。
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isConnected = false;
  }

  // SSE 断线重连(息屏/切后台/弱网)后服务端成员表已不含本端,
  // 用本地保存的房间信息静默重新入房;房间确实已不存在时通知上层重置 UI。
  private async rejoinAfterReconnect() {
    if (this.joining || !this.roomId || !this.bookKey) return;
    if (!this.isServerConfigured) return;
    try {
      const room = await this.request(`/rooms/${this.roomId}/join`, {
        clientId: this.clientId,
        bookKey: this.bookKey,
        name: this.name,
      });
      this.roomId = room.roomId;
      // 领读可能在断线期间被换过人:必须用入房快照刷新,否则跟随逻辑
      // 永远拿着断线前的旧领读 —— 症状是「换成对方领读后我怎么都不跟」,
      // 但面板上显示的领读却是对的(面板走 applyRoom,这里漏了 applyLeader)。
      this.applyLeader(room);
      this.emit("room-rejoined", room);
    } catch (error) {
      const status =
        error instanceof CollabRequestError ? error.status : 0;
      if (status === 404) {
        const lostRoomId = this.roomId;
        this.roomId = "";
        this.emit("room-lost", { roomId: lostRoomId });
      }
      // 其他错误(网络不通等)保留 roomId,等 SSE 下次重连再试
    }
  }

  private async request(path: string, body: any, method = "POST") {
    const serverUrl = this.serverUrl;
    if (!serverUrl) {
      throw new CollabServerUnconfiguredError();
    }
    // GET 不带 content-type:带它会把这请求变成「非简单请求」，跨域时凭空多出
    // 一次 OPTIONS 预检，服务端没放行预检就直接失败。
    const hasBody = body !== null && body !== undefined;
    const response = await fetch(`${serverUrl}${path}`, {
      method,
      headers: hasBody
        ? this.authHeaders({ "content-type": "application/json" })
        : this.authHeaders(),
      ...(hasBody ? { body: JSON.stringify(body) } : {}),
    });
    // 响应体不一定是 JSON：nginx 的 401 密码页、502/504 网关错误页、以及
    // 地址填错时 SPA fallback 吐回来的 index.html 都是 HTML。老实现直接
    // response.json() 会抛 SyntaxError —— 调用方那一堆 `instanceof
    // CollabRequestError` 判断全部失效（404 识别不出来、报错显示成
    // "Unexpected token '<'"）。所以这里自己解析、失败也不抛。
    const raw = await response.text().catch(() => "");
    let data: any = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (e) {
      data = null;
    }
    if (!response.ok) {
      throw new CollabRequestError(
        (data && data.error) ||
          `服务器返回了非预期内容（HTTP ${response.status}），请检查共读服务器地址`,
        response.status
      );
    }
    return data === null ? {} : data;
  }

  // 房间快照:不依赖 SSE 也能拿到成员表/领读/聊天/当前页。
  // 面板重新打开、断线自愈、回前台核对成员都走这里。
  async fetchRoomSnapshot(roomId: string): Promise<CollabRoomSnapshot> {
    return this.request(`/rooms/${roomId.toUpperCase()}`, null, "GET");
  }

  async createRoom(bookKey: string, name: string) {
    if (!this.isServerConfigured) {
      throw new CollabServerUnconfiguredError();
    }
    this.joining = true;
    this.name = name;
    this.bookKey = bookKey;
    this.roomId = "";
    this.connect();
    try {
      const room = await this.request("/rooms", {
        clientId: this.clientId,
        bookKey,
        name,
      });
      this.roomId = room.roomId;
      this.applyLeader(room);
      // 阅读器靠这个事件做「入房后按共读规则调整阅读模式」等联动
      this.emit("room-joined", room);
      return room as CollabRoomSnapshot;
    } finally {
      this.joining = false;
    }
  }

  async joinRoom(roomId: string, bookKey: string, name: string) {
    if (!this.isServerConfigured) {
      throw new CollabServerUnconfiguredError();
    }
    this.joining = true;
    this.name = name;
    this.bookKey = bookKey;
    this.roomId = "";
    this.connect();
    try {
      const room = await this.request(`/rooms/${roomId.toUpperCase()}/join`, {
        clientId: this.clientId,
        bookKey,
        name,
      });
      this.roomId = room.roomId;
      this.applyLeader(room);
      this.emit("room-joined", room);
      return room as CollabRoomSnapshot;
    } finally {
      this.joining = false;
    }
  }

  /** 用房间快照刷新领读。公开给面板:轮询/重连拿到快照时一并纠正,
   *  防止 SSE 的 room-updated 被错过导致跟随逻辑拿着旧领读 */
  applyLeader(room: any) {
    this.leaderId = room?.leaderId || "";
    this.leaderName = room?.leaderName || "";
  }

  /** 指定（或清空）房间里的领读。任何成员都能设，服务端会广播给全房间 */
  async setRoomLeader(targetId: string) {
    if (!this.roomId) return;
    await this.request(`/rooms/${this.roomId}/leader`, {
      clientId: this.clientId,
      targetId: targetId || "",
    });
  }

  async leaveRoom() {
    if (!this.roomId) return;
    const leavingRoomId = this.roomId;
    this.roomId = "";
    try {
      await this.request(`/rooms/${leavingRoomId}/leave`, {
        clientId: this.clientId,
      });
    } finally {
      // 主动退出也广播一下,ModeControl 等 UI 据此解除「共读模式限制」
      this.emit("room-left", { roomId: leavingRoomId });
    }
  }

  async listRooms() {
    const serverUrl = this.serverUrl;
    if (!serverUrl) {
      throw new CollabServerUnconfiguredError();
    }
    const response = await fetch(`${serverUrl}/rooms`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new CollabRequestError(
        (data as any).error || "Failed to list rooms",
        response.status
      );
    }
    return (data as { rooms: CollabRoomBrief[] }).rooms || [];
  }

  async deleteRoom(roomId: string) {
    const target = roomId.toUpperCase();
    await this.request(
      `/rooms/${target}`,
      { clientId: this.clientId },
      "DELETE"
    );
    if (this.roomId === target) {
      this.roomId = "";
    }
  }

  async sendMessage(text: string) {
    if (!this.roomId || !text.trim()) return null;
    return this.request(`/rooms/${this.roomId}/message`, {
      clientId: this.clientId,
      name: this.name,
      text: text.trim(),
    });
  }

  async broadcastLocation(bookKey: string, location: any) {
    if (!this.roomId || this.bookKey !== bookKey) return;
    await this.request(`/rooms/${this.roomId}/location`, {
      clientId: this.clientId,
      location,
    });
  }

  async broadcastNote(bookKey: string, note: any) {
    if (!this.roomId || this.bookKey !== bookKey) return;
    await this.request(`/rooms/${this.roomId}/notes`, {
      clientId: this.clientId,
      // 线上的笔记统一挂共读 key(内容 md5),接收方落地前改写回自己的本地 key
      note: { ...note, bookKey },
    });
  }

  async broadcastNoteUpdate(bookKey: string, note: any) {
    if (!this.roomId || this.bookKey !== bookKey) return;
    await this.request(`/rooms/${this.roomId}/note-update`, {
      clientId: this.clientId,
      note: { ...note, bookKey },
    });
  }

  async broadcastNoteDelete(
    bookKey: string,
    noteKey: string,
    chapterDocIndex?: number
  ) {
    if (!this.roomId || this.bookKey !== bookKey) return;
    await this.request(`/rooms/${this.roomId}/note-delete`, {
      clientId: this.clientId,
      noteKey,
      chapterDocIndex,
    });
  }

  // ── 随心笔记(涂鸦)─────────────────────────────────────────────────
  // 个人云:按书存笔迹,换设备打开同一本书也能看到。跟房间无关,不用在房间里。

  async fetchBookDoodles(bookKey: string): Promise<Record<string, any[]>> {
    const serverUrl = this.serverUrl;
    if (!serverUrl) return {};
    try {
      const response = await fetch(
        `${serverUrl}/doodles/${encodeURIComponent(bookKey)}`
      );
      if (!response.ok) return {};
      const data = await response.json();
      return data && data.pages && typeof data.pages === "object"
        ? data.pages
        : {};
    } catch (e) {
      return {};
    }
  }

  // 按笔合并写入:服务端按 stroke.id 做并集,多端同页画画不会互相擦掉。
  // removedIds 用来告知「这些笔迹我删了」(撤销/清空),服务端才会真的删。
  // 返回是否真的写成功 —— 调用方据此决定要不要提示/重试。
  // （老实现不看 response.ok、外面还 try/catch 全吞：401/413/500 一律无声无息，
  //   用户体感就是「画完看着好好的，换设备/同伴那边根本没有」。）
  async saveBookDoodlePage(
    bookKey: string,
    pageKey: string,
    strokes: any[],
    removedIds: string[] = []
  ): Promise<boolean> {
    const serverUrl = this.serverUrl;
    if (!serverUrl) return false;
    try {
      const response = await fetch(
        `${serverUrl}/doodles/${encodeURIComponent(bookKey)}`,
        {
          method: "PUT",
          headers: this.authHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({ pageKey, strokes, removedIds }),
        }
      );
      return response.ok;
    } catch (e) {
      return false;
    }
  }

  // 拉取房间里全部共享笔迹(进房晚的人也能看到之前画过的)
  async fetchRoomDoodles(): Promise<Record<string, any[]>> {
    if (!this.roomId) return {};
    const serverUrl = this.serverUrl;
    if (!serverUrl) return {};
    try {
      const response = await fetch(
        `${serverUrl}/rooms/${this.roomId}/doodle`
      );
      if (!response.ok) return {};
      const data = await response.json();
      return data && data.doodles && typeof data.doodles === "object"
        ? data.doodles
        : {};
    } catch (e) {
      return {};
    }
  }

  // 房间里共享笔迹(op: add / append / undo / clear)
  //   add    = 收笔后的完整笔迹（权威版本，服务端按 id 覆盖合并）
  //   append = 正在画的过程中推送的新增点（from = 该笔已有几点，rev = 单调递增序号）
  //           让同伴能「一笔一划」地看着字被写出来，而不是啪一下整笔出现。
  async broadcastDoodle(bookKey: string, payload: any): Promise<void> {
    if (!this.roomId || this.bookKey !== bookKey) return;
    await this.request(`/rooms/${this.roomId}/doodle`, {
      clientId: this.clientId,
      bookKey,
      authorId: payload.authorId || this.clientId,
      authorName: payload.authorName || this.name,
      pageKey: payload.pageKey,
      op: payload.op,
      stroke: payload.stroke,
      from: payload.from,
      rev: payload.rev,
    });
  }

  isInRoom(bookKey?: string) {
    if (!this.roomId) return false;
    return bookKey ? this.bookKey === bookKey : true;
  }
}

const collabClient = new CollabClient();

export default collabClient;
