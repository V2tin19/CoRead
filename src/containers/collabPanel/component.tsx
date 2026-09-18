import React from "react";
import "./collabPanel.css";
import collabClient, {
  CollabMessage,
  CollabRoomSnapshot,
  CollabRequestError,
  CollabServerUnconfiguredError,
  getCollabBookKey,
} from "../../utils/collab/collabClient";
import { CollabPanelProps, CollabPanelState } from "./interface";
import DatabaseService from "../../utils/storage/databaseService";
import { getOrCreateDisplayName } from "../../utils/collab/roomBook";
import {
  getCollabServerUrlSetting,
  saveCollabServerUrlSetting,
  getCollabServerTokenSetting,
  saveCollabServerTokenSetting,
  testCollabServerConnection,
} from "../../utils/collab/collabServerConfig";
import { sanitizeRemoteNote } from "../../utils/collab/remoteNote";
import {
  isDoodleLiveEnabled,
  isDoodleSyncEnabled,
  setDoodleLiveEnabled,
  setDoodleSyncEnabled,
} from "../../utils/file/doodleUtil";
import toast from "react-hot-toast";
import { isMobileRuntime } from "../../utils/mobileRuntime";

const PENDING_ROOM_KEY = "koodo-collab-pending-room";
const PENDING_JOIN_KEY = "koodo-collab-pending-join";
// 共读面板可自由拖动,位置记忆在这里(刷新/重开面板仍在原处)
const PANEL_POS_KEY = "koodo-collab-panel-pos";

/** 读取上次拖动位置(带容错,存坏了就回默认) */
const loadPanelPos = (): { x: number; y: number } | null => {
  try {
    const raw = localStorage.getItem(PANEL_POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.x === "number" &&
      typeof parsed.y === "number" &&
      Number.isFinite(parsed.x) &&
      Number.isFinite(parsed.y)
    ) {
      return { x: parsed.x, y: parsed.y };
    }
    return null;
  } catch {
    return null;
  }
};

class CollabPanel extends React.Component<CollabPanelProps, CollabPanelState> {
  private unsubs: Array<() => void> = [];
  // 房间快照轮询:成员表以前只靠 SSE 的 room-updated 推送,面板关闭期间
  // 断线/重连事件全都收不到,重新打开就永远是「在线 0 人」的旧账。
  // 挂载时先拉一次快照,面板开着时每 10s 刷新一遍兜底。
  private snapshotTimer: any = null;
  /** 拖拽起点快照:按下时的鼠标坐标 + 面板起始偏移 */
  private dragStart: {
    pointerX: number;
    pointerY: number;
    originX: number;
    originY: number;
  } | null = null;

  constructor(props: CollabPanelProps) {
    super(props);
    this.state = {
      // 与「个人中心 → 共读服务器」是同一份设置(唯一真源),这里只是回显
      serverUrl: getCollabServerUrlSetting() || collabClient.serverUrl,
      serverToken: getCollabServerTokenSetting() || collabClient.token,
      roomIdInput: "",
      activeRoomId: collabClient.roomId,
      ownerId: "",
      members: [],
      messages: [],
      messageText: "",
      status: collabClient.roomId ? "已在房间中" : "",
      isBusy: false,
      rooms: [],
      isLoadingRooms: false,
      isAdvancedVisible: false,
      // 从「共同阅读」页面点「开始阅读」进来时,先显示入房中,不展示创建/加入界面
      isPendingJoin: Boolean(localStorage.getItem(PENDING_JOIN_KEY)),
      isDoodleSync: isDoodleSyncEnabled(),
      isDoodleLive: isDoodleLiveEnabled(),
      leaderId: collabClient.leaderId || "",
      leaderName: collabClient.leaderName || "",
      followLeader: collabClient.followLeader,
      dragOffset: loadPanelPos(),
      isDragging: false,
      showServerToken: false,
    };
  }

  /* ── 面板拖动 ── */
  /**
   * 真正生效的拖动偏移。
   * 手机端把 y 夹到 >= 0：面板的默认位置本来就已经在阅读器顶栏下沿，
   * 再往上拖只会把「可拖动的标题栏」塞进顶栏底下 ⇒ 手指命中的是顶栏、
   * 把手抓不到（这就是果冻反馈的「叠在导航栏那里拖不动」）。
   * 这里夹一道还能顺带救回老版本存进 localStorage 的负 y —— 否则重开面板
   * 又回到那个抓不到的位置。
   */
  panelOffset = (): { x: number; y: number } | null => {
    const offset = this.state.dragOffset;
    if (!offset) return null;
    const isMobile =
      isMobileRuntime() || document.body.clientWidth < 570;
    if (!isMobile) return offset;
    return { x: offset.x, y: Math.max(0, offset.y) };
  };

  handleDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    // 只响应鼠标左键 / 触摸主指针
    if (event.button !== undefined && event.button !== 0) return;
    const origin = this.panelOffset() || { x: 0, y: 0 };
    this.dragStart = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      originX: origin.x,
      originY: origin.y,
    };
    this.setState({ isDragging: true });
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  handleDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!this.dragStart) return;
    const cur = this.panelOffset();
    const next = {
      x: this.dragStart.originX + (event.clientX - this.dragStart.pointerX),
      y: this.dragStart.originY + (event.clientY - this.dragStart.pointerY),
    };
    // 夹在视口内,避免拖出屏幕再也抓不回来
    const panel = event.currentTarget.closest(".collab-panel") as HTMLElement;
    if (panel) {
      const rect = panel.getBoundingClientRect();
      const defaultLeft = rect.left - (cur?.x || 0);
      const defaultTop = rect.top - (cur?.y || 0);
      const maxX = window.innerWidth - rect.width - defaultLeft;
      const maxY = window.innerHeight - rect.height - defaultTop;
      // 手机端不让往上拖（理由见 panelOffset 的注释）：下界取 0 而不是 -defaultTop
      const isMobile =
        isMobileRuntime() || document.body.clientWidth < 570;
      const minY = isMobile ? 0 : -defaultTop;
      next.x = Math.max(-defaultLeft, Math.min(next.x, maxX));
      next.y = Math.max(minY, Math.min(next.y, maxY));
    }
    this.setState({ dragOffset: next });
  };

  handleDragEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!this.dragStart) return;
    this.dragStart = null;
    this.setState({ isDragging: false });
    (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
    // 记忆位置
    try {
      if (this.state.dragOffset) {
        localStorage.setItem(
          PANEL_POS_KEY,
          JSON.stringify(this.state.dragOffset)
        );
      }
    } catch {
      /* 存不进去也不影响使用 */
    }
  };

  /** 双击标题栏复位到默认位置 */
  handleDragReset = () => {
    this.dragStart = null;
    this.setState({ dragOffset: null, isDragging: false });
    try {
      localStorage.removeItem(PANEL_POS_KEY);
    } catch {
      /* ignore */
    }
  };

  componentDidMount() {
    this.unsubs = [
      collabClient.on("room-updated", this.applyRoom),
      collabClient.on("chat-message", this.addMessage),
      collabClient.on("room-rejoined", (room: CollabRoomSnapshot) => {
        this.applyRoom(room);
        this.setState({ status: "断线重连成功,已恢复共读" });
      }),
      collabClient.on("room-lost", (payload: any) => {
        this.setState({
          activeRoomId: "",
          ownerId: "",
          members: [],
          messages: [],
          status: "房间已失效",
        });
        toast.error(
          `共读房间 ${payload?.roomId || ""} 已失效(房间过期或服务器重启),请重新发起`
        );
        this.loadRooms();
      }),
      collabClient.on("room-deleted", (payload: any) => {
        if (payload?.roomId && payload.roomId === this.state.activeRoomId) {
          this.setState({
            activeRoomId: "",
            ownerId: "",
            members: [],
            messages: [],
            status: "房间已被解散",
          });
          toast.success(`房间 ${payload.roomId} 已解散`);
        }
        this.loadRooms();
      }),
      collabClient.on("connection-error", () => {
        this.setState({ status: "连接断开,正在自动重连..." });
      }),
      collabClient.on("connected", () => {
        if (collabClient.roomId) {
          this.setState({ status: "已重新连接服务器" });
        }
      }),
    ];
    this.takePendingRoomCode();
    this.takePendingJoin();
    this.refreshRoomSnapshot();
    this.snapshotTimer = setInterval(() => this.refreshRoomSnapshot(), 10000);
    if (!this.state.activeRoomId && !this.state.isPendingJoin) {
      this.loadRooms();
    }
  }

  // 主动从服务端拉房间快照,把成员/领读/聊天刷成当前真实状态
  refreshRoomSnapshot = async () => {
    if (!collabClient.roomId) return;
    try {
      const room = await collabClient.fetchRoomSnapshot(collabClient.roomId);
      // 拉取期间可能已退出/换房;轮询刷新不改状态行,避免覆盖「连接断开」提示
      if (collabClient.roomId && collabClient.roomId === room.roomId) {
        this.applyRoom(room, true);
      }
    } catch (error) {
      // 快照失败不弹错:SSE 断线与重连有自己的提示链路,
      // 404(房间没了)交给 room-lost 事件处理
    }
  };

  componentDidUpdate(prevProps: CollabPanelProps) {
    // 书籍异步加载完成后 currentBook 才可用,此时重试自动入房
    if (
      this.state.isPendingJoin &&
      getCollabBookKey(prevProps.currentBook) !==
        getCollabBookKey(this.props.currentBook)
    ) {
      this.takePendingJoin();
    }
  }

  componentWillUnmount() {
    this.unsubs.forEach((unsubscribe) => unsubscribe());
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  // 邀请链接(?collab=房间号)落地后暂存在 localStorage,打开面板时取出填入
  takePendingRoomCode = () => {
    if (this.state.activeRoomId) return;
    const pending = localStorage.getItem(PENDING_ROOM_KEY);
    if (pending) {
      localStorage.removeItem(PENDING_ROOM_KEY);
      this.setState({ roomIdInput: pending });
    }
  };

  // 从「共同阅读」页面点「开始阅读」时暂存的房间信息,打开面板后自动加入
  takePendingJoin = () => {
    if (this.state.activeRoomId) return;
    const raw = localStorage.getItem(PENDING_JOIN_KEY);
    if (!raw) {
      if (this.state.isPendingJoin) {
        this.setState({ isPendingJoin: false });
      }
      return;
    }
    // 书还没加载完(currentBook 为空),先不动待加入信息,等 componentDidUpdate 重试
    const collabKey = getCollabBookKey(this.props.currentBook);
    if (!collabKey) return;
    localStorage.removeItem(PENDING_JOIN_KEY);
    try {
      const pending = JSON.parse(raw);
      if (pending?.roomId && pending.bookKey === collabKey) {
        this.joinRoomWithCode(pending.roomId).finally(() => {
          this.setState({ isPendingJoin: false });
        });
        return;
      }
    } catch (_e) {
      // 数据损坏就直接丢弃
    }
    this.setState({ isPendingJoin: false });
  };

  loadRooms = async () => {
    this.setState({ isLoadingRooms: true });
    try {
      const rooms = await collabClient.listRooms();
      this.setState({ rooms });
    } catch {
      this.setState({ rooms: [] });
    } finally {
      this.setState({ isLoadingRooms: false });
    }
  };

  applyRoom = (room: CollabRoomSnapshot, keepStatus = false) => {
    // 面板拿到的每一份快照(入房/重连/轮询)都顺手纠正 collabClient 的领读,
    // 跟随翻页的判断读的是 collabClient.leaderId,不是这份 state
    collabClient.applyLeader(room);
    const update: Partial<CollabPanelState> = {
      activeRoomId: room.roomId,
      ownerId: room.ownerId,
      members: room.members || [],
      messages: room.messages || [],
      leaderId: room.leaderId || "",
      leaderName: room.leaderName || "",
    };
    if (!keepStatus) {
      update.status = `房间 ${room.roomId} 共读中`;
    }
    this.setState(update as any);
  };

  // 指定房间领读。跟随开关打开的人，会跟着领读翻页
  handleSetLeader = async (targetId: string) => {
    if (!this.state.activeRoomId) return;
    // 再点一次当前领读 = 取消指定
    const next = targetId === this.state.leaderId ? "" : targetId;
    try {
      await collabClient.setRoomLeader(next);
    } catch (error) {
      toast.error("设置领读失败：" + this.describeError(error));
    }
  };

  handleToggleFollow = (checked: boolean) => {
    collabClient.setFollowLeader(checked);
    this.setState({
      followLeader: checked,
      status: checked
        ? this.state.leaderId
          ? "已开启跟随领读：领读翻页时你的画面会跟着走"
          : "已开启跟随领读：请先指定一位领读"
        : "已关闭跟随领读",
    });
  };

  handleToggleDoodleLive = (checked: boolean) => {
    setDoodleLiveEnabled(checked);
    this.setState({
      isDoodleLive: checked,
      status: checked
        ? "已开启「一笔一划」：同伴画的时候你能看着字写出来"
        : "已关闭「一笔一划」：收笔后整笔出现（更省流量）",
    });
  };

  applyRoomNotes = async (room: CollabRoomSnapshot) => {
    if (!room.notes?.length || !this.props.htmlBook?.rendition) return;
    const collabKey = getCollabBookKey(this.props.currentBook);
    for (const note of room.notes) {
      if (!note || note.bookKey !== collabKey) continue;
      // 进房时一次性补齐历史笔记：同样来自网络，先净化再落库/注入
      const safe = sanitizeRemoteNote(note);
      if (!safe) continue;
      const existing = await DatabaseService.getRecord(safe.key, "notes");
      if (existing) continue;
      const localNote = { ...safe, bookKey: this.props.currentBook.key };
      await DatabaseService.saveRecord(localNote, "notes", false);
      await this.props.htmlBook.rendition.createOneNote(localNote, () => {});
    }
    this.props.handleFetchNotes();
  };

  addMessage = (message: CollabMessage) => {
    this.setState((prev) => ({
      messages: [...prev.messages, message].slice(-80),
    }));
  };

  getDisplayName() {
    // 昵称统一在「个人设置」页管理;这里只读取,没设置就取默认 ID
    return getOrCreateDisplayName();
  }

  // 「同步涂鸦」开关:打开后,房间里所有人都能实时看到彼此的笔迹
  handleToggleDoodleSync = (checked: boolean) => {
    setDoodleSyncEnabled(checked);
    this.setState({
      isDoodleSync: checked,
      status: checked
        ? "已开启涂鸦同步:房间里大家的笔迹会互相看到"
        : "已关闭涂鸦同步:笔迹只保存在自己这边",
    });
  };

  // 面板里的地址输入框与「个人中心 → 共读服务器」共用同一份存储,
  // 改完立即落盘,规范化结果回填输入框
  handleServerUrlBlur = () => {
    const saved = saveCollabServerUrlSetting(this.state.serverUrl);
    this.setState({ serverUrl: saved });
  };

  handleServerTokenBlur = () => {
    const saved = saveCollabServerTokenSetting(this.state.serverToken);
    this.setState({ serverToken: saved });
  };

  handleTestConnection = async () => {
    if (this.state.isTestingConnection) return;
    this.setState({ isTestingConnection: true, testResult: null });
    try {
      const result = await testCollabServerConnection(
        this.state.serverUrl,
        this.state.serverToken
      );
      this.setState({ testResult: result });
    } catch (e: any) {
      this.setState({
        testResult: {
          ok: false,
          message: "测试过程发生未知错误",
          hint: e?.message || String(e),
        },
      });
    } finally {
      this.setState({ isTestingConnection: false });
    }
  };

  describeError(error: unknown) {
    if (error instanceof CollabServerUnconfiguredError) {
      return "尚未设置共读服务器地址,请先到「个人中心 → 个人信息」里填写";
    }
    if (error instanceof CollabRequestError) {
      if (error.status === 404) return "房间不存在或已过期,请确认房间号";
      if (error.status === 409)
        return "对方在读另一本书,请先打开同一本书再加入";
      return error.message;
    }
    return "无法连接服务器,请检查网络或服务器地址";
  }

  createRoom = async () => {
    if (!this.props.currentBook?.key) return;
    if (!collabClient.isServerConfigured) {
      const message = "尚未设置共读服务器地址,请先到「个人中心 → 个人信息」里填写";
      this.setState({ status: message, isAdvancedVisible: true });
      toast.error(message);
      return;
    }
    this.setState({ isBusy: true, status: "正在创建房间..." });
    try {
      const room = await collabClient.createRoom(
        getCollabBookKey(this.props.currentBook),
        this.getDisplayName()
      );
      this.applyRoom(room);
      toast.success(`房间 ${room.roomId} 已创建,把房间号或邀请链接发给朋友`);
    } catch (error) {
      const message = this.describeError(error);
      this.setState({ status: message });
      toast.error(message);
    } finally {
      this.setState({ isBusy: false });
    }
  };

  joinRoomWithCode = async (code: string) => {
    const trimmed = code.trim();
    if (!this.props.currentBook?.key) {
      toast.error("请先打开一本书再加入共读");
      return;
    }
    if (!trimmed) return;
    if (!collabClient.isServerConfigured) {
      const message = "尚未设置共读服务器地址,请先到「个人中心 → 个人信息」里填写";
      this.setState({ status: message, isAdvancedVisible: true });
      toast.error(message);
      return;
    }
    this.setState({ isBusy: true, status: "正在加入房间..." });
    try {
      const room = await collabClient.joinRoom(
        trimmed,
        getCollabBookKey(this.props.currentBook),
        this.getDisplayName()
      );
      this.applyRoom(room);
      await this.applyRoomNotes(room);
      if (room.currentLocation && this.props.htmlBook?.rendition) {
        await this.props.htmlBook.rendition.goToPosition(
          JSON.stringify(room.currentLocation)
        );
      }
      toast.success(`已加入房间 ${room.roomId}`);
    } catch (error) {
      const message = this.describeError(error);
      this.setState({ status: message });
      toast.error(message);
      this.loadRooms();
    } finally {
      this.setState({ isBusy: false });
    }
  };

  leaveRoom = async () => {
    this.setState({ isBusy: true, status: "正在退出房间..." });
    try {
      await collabClient.leaveRoom();
      this.setState({
        activeRoomId: "",
        ownerId: "",
        members: [],
        messages: [],
        status: "已退出房间",
      });
      this.loadRooms();
    } catch (error) {
      this.setState({ status: (error as Error).message });
    } finally {
      this.setState({ isBusy: false });
    }
  };

  deleteRoomFromList = async (roomId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!window.confirm(`确认删除房间 ${roomId}?在线成员会被请出`)) return;
    try {
      await collabClient.deleteRoom(roomId);
      toast.success(`房间 ${roomId} 已删除`);
    } catch (error) {
      toast.error("删除失败:" + this.describeError(error));
    }
    this.loadRooms();
  };

  dissolveRoom = async () => {
    const roomId = this.state.activeRoomId;
    if (!roomId) return;
    if (!window.confirm(`确认解散房间 ${roomId}?所有成员将退出`)) return;
    this.setState({ isBusy: true, status: "正在解散房间..." });
    try {
      await collabClient.deleteRoom(roomId);
      this.setState({
        activeRoomId: "",
        ownerId: "",
        members: [],
        messages: [],
        status: "房间已解散",
      });
      toast.success(`房间 ${roomId} 已解散`);
    } catch (error) {
      toast.error("解散失败:" + this.describeError(error));
    } finally {
      this.setState({ isBusy: false });
      this.loadRooms();
    }
  };

  sendMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = this.state.messageText.trim();
    if (!text) return;
    this.setState({ messageText: "" });
    try {
      const message = await collabClient.sendMessage(text);
      if (message) {
        this.addMessage(message as CollabMessage);
      }
    } catch (error) {
      this.setState({ status: this.describeError(error) });
    }
  };

  copyText = async (text: string, hint: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      toast.success(hint);
    } catch {
      toast.error("复制失败,请手动复制:" + text);
    }
  };

  copyRoomCode = () => {
    this.copyText(this.state.activeRoomId, "房间号已复制");
  };

  copyInviteLink = () => {
    const link = `${window.location.origin}/?collab=${this.state.activeRoomId}`;
    this.copyText(link, "邀请链接已复制,发给朋友即可加入");
  };

  render() {
    const isInRoom = Boolean(this.state.activeRoomId);
    const { rooms, isLoadingRooms } = this.state;
    const isMobile = isMobileRuntime() || document.body.clientWidth < 570;
    // 手机端生效的拖动偏移（y 夹到 >= 0，见 panelOffset）
    const offset = this.panelOffset();
    return (
      <div
        className={
          "collab-panel" + (this.state.isDragging ? " collab-panel-dragging" : "")
        }
        style={
          offset
            ? {
                transform: `translate(${offset.x}px, ${offset.y}px)`,
              }
            : undefined
        }
      >
        <div
          className="collab-panel-header"
          onPointerDown={this.handleDragStart}
          onPointerMove={this.handleDragMove}
          onPointerUp={this.handleDragEnd}
          onPointerCancel={this.handleDragEnd}
          onDoubleClick={this.handleDragReset}
          title="按住可拖动 · 双击复位"
        >
          <span className="collab-panel-title">
            <span className="collab-panel-drag-grip" aria-hidden="true" />
            共读
          </span>
          <span className="collab-panel-close" onClick={this.props.onClose}>
            ×
          </span>
        </div>
        <div className="collab-panel-body">
          {!isInRoom && this.state.isPendingJoin ? (
            <div className="collab-hint">正在进入共读房间...</div>
          ) : !isInRoom ? (
            <>
              <div className="collab-section-title">发起共读</div>
              <div className="collab-hint">
                用当前打开的书创建房间,朋友打开同一本书后即可加入
              </div>
              <button
                className="collab-button collab-primary-button"
                disabled={this.state.isBusy}
                onClick={this.createRoom}
              >
                创建共读房间
              </button>
              <div className="collab-section-title">加入共读</div>
              {isLoadingRooms ? (
                <div className="collab-hint">正在获取房间列表...</div>
              ) : rooms.length > 0 ? (
                <ul className="collab-room-list">
                  {rooms.map((room) => (
                    <li
                      key={room.roomId}
                      className="collab-room-item"
                      onClick={() => this.joinRoomWithCode(room.roomId)}
                    >
                      <div className="collab-room-item-info">
                        <span className="collab-room-item-id">
                          {room.roomId}
                        </span>
                        <span className="collab-room-item-members">
                          {room.members.length > 0
                            ? room.members.join("、")
                            : "暂无成员在线"}
                        </span>
                      </div>
                      <div className="collab-room-item-actions">
                        <span className="collab-room-item-join">加入</span>
                        <span
                          className="collab-room-item-delete"
                          onClick={(event) =>
                            this.deleteRoomFromList(room.roomId, event)
                          }
                        >
                          删除
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="collab-hint">
                  服务器上暂无房间,可以让对方创建一个
                </div>
              )}
              <div
                className="collab-link"
                onClick={this.loadRooms}
                style={{ marginTop: 4 }}
              >
                刷新房间列表
              </div>
              <label className="collab-field" style={{ marginTop: 8 }}>
                或输入房间号
                <div className="collab-join-row">
                  <input
                    value={this.state.roomIdInput}
                    placeholder="如 A1B2C3"
                    onChange={(event) =>
                      this.setState({ roomIdInput: event.target.value })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        this.joinRoomWithCode(this.state.roomIdInput);
                      }
                    }}
                  />
                  <button
                    className="collab-button"
                    disabled={this.state.isBusy}
                    onClick={() =>
                      this.joinRoomWithCode(this.state.roomIdInput)
                    }
                  >
                    加入
                  </button>
                </div>
              </label>
            </>
          ) : (
            <>
              {/* 房间号:压成一行胶囊,不再独占一大块版面 */}
              <div className="collab-room-code">
                <span className="collab-room-code-label">房间号</span>
                <strong className="collab-room-code-value">
                  {this.state.activeRoomId}
                </strong>
                <span
                  className="collab-room-code-copy"
                  onClick={this.copyRoomCode}
                  title="复制房间号"
                >
                  复制
                </span>
                <span
                  className="collab-room-code-copy"
                  onClick={this.copyInviteLink}
                  title="复制邀请链接"
                >
                  链接
                </span>
              </div>
              {/* 在线成员：点一下就设为「领读」。跟随开关打开的人只会跟着领读翻页 */}
              <div className="collab-members">
                <div className="collab-members-head">
                  <span>在线 {this.state.members.length} 人</span>
                  <span className="collab-members-leader">
                    {this.state.leaderName
                      ? `领读：${this.state.leaderName}`
                      : "未指定领读"}
                  </span>
                </div>
                {this.state.members.length === 0 ? (
                  <div className="collab-hint">等待成员加入</div>
                ) : (
                  <ul className="collab-member-list">
                    {this.state.members.map((member) => (
                      <li className="collab-member-item" key={member.clientId}>
                        <span className="collab-member-name">
                          {member.name}
                          {member.clientId === collabClient.clientId
                            ? "（我）"
                            : ""}
                          {member.clientId === this.state.leaderId && (
                            <em className="collab-member-badge">领读</em>
                          )}
                          {/* 设备形态标注：由成员自己入房时上报（collabClient 的
                              deviceKind()），服务端在 roomSnapshot 里原样透传。
                              老客户端不带这个字段 ⇒ 服务端兜底成 desktop。 */}
                          <em
                            className={
                              "collab-member-badge collab-member-device" +
                              (member.device === "mobile"
                                ? " collab-member-device-mobile"
                                : "")
                            }
                            title={
                              member.device === "mobile"
                                ? "手机端加入"
                                : "电脑端加入"
                            }
                          >
                            {member.device === "mobile" ? "手机" : "电脑"}
                          </em>
                        </span>
                        <span
                          className={
                            member.clientId === this.state.leaderId
                              ? "collab-member-action collab-member-action-on"
                              : "collab-member-action"
                          }
                          title="指定这个人当领读；再点一次取消"
                          onClick={() => this.handleSetLeader(member.clientId)}
                        >
                          {member.clientId === this.state.leaderId
                            ? "取消领读"
                            : "设为领读"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <label className="collab-switch-field">
                <span>
                  跟随领读
                  <em>打开后，领读翻页时你的画面跟着走</em>
                </span>
                <input
                  type="checkbox"
                  checked={this.state.followLeader}
                  onChange={(event) =>
                    this.handleToggleFollow(event.target.checked)
                  }
                />
              </label>
              <div className="collab-messages">
                {this.state.messages.length === 0 ? (
                  <div className="collab-hint">暂无聊天消息</div>
                ) : (
                  this.state.messages.map((message) => (
                    <div className="collab-message" key={message.id}>
                      <span className="collab-message-name">
                        {message.senderName}
                      </span>
                      <span>{message.text}</span>
                    </div>
                  ))
                )}
              </div>
              <form className="collab-chat-form" onSubmit={this.sendMessage}>
                <input
                  value={this.state.messageText}
                  placeholder="输入消息"
                  onChange={(event) =>
                    this.setState({ messageText: event.target.value })
                  }
                />
                <button className="collab-button" type="submit">
                  发送
                </button>
              </form>
              <div className="collab-button-row">
                <button
                  className="collab-button"
                  disabled={this.state.isBusy}
                  onClick={this.leaveRoom}
                >
                  退出房间
                </button>
                <button
                  className="collab-button collab-danger-button"
                  disabled={this.state.isBusy}
                  onClick={this.dissolveRoom}
                >
                  解散房间
                </button>
              </div>
            </>
          )}
          {/* 「同步涂鸦」= 随心笔记在房间里的总开关。入口就放在共读面板，
              打开后：同一页上每个人的笔迹实时互见，翻页会各自换本页的。
              涂鸦层里能按作者单独显示/隐藏，并能看到房间里还有几页有同伴笔记。 */}
          <label className="collab-switch-field">
            <span>
              同步涂鸦
              <em>
                {isInRoom
                  ? "同一页上大家的笔迹实时互见"
                  : "进入共读房间后生效"}
              </em>
            </span>
            <input
              type="checkbox"
              checked={this.state.isDoodleSync}
              onChange={(event) =>
                this.handleToggleDoodleSync(event.target.checked)
              }
            />
          </label>
          {/* 「一笔一划」：画的过程中就把新增的点推给同伴，同伴能看着字被写出来，
              而不是收笔时整笔啪地冒出来。代价是请求变多，弱网可关。 */}
          <label className="collab-switch-field collab-switch-sub">
            <span>
              一笔一划
              <em>
                {this.state.isDoodleSync
                  ? "同伴作画时，笔迹一笔笔实时出现"
                  : "开启「同步涂鸦」后生效"}
              </em>
            </span>
            <input
              type="checkbox"
              disabled={!this.state.isDoodleSync}
              checked={this.state.isDoodleLive}
              onChange={(event) =>
                this.handleToggleDoodleLive(event.target.checked)
              }
            />
          </label>
          <div className="collab-status">{this.state.status}</div>
          {/* 「高级设置」(服务器地址 / 鉴权 Token) 在手机上去掉：
              它跟「个人中心 → 共读服务器」是同一份设置，手机上从这里进本就多余，
              还让本来就不高的面板被挤到只能滚。桌面端一字不动。 */}
          {!isMobile && (
            <>
              <div
                className="collab-link"
                onClick={() =>
                  this.setState((prev) => ({
                    isAdvancedVisible: !prev.isAdvancedVisible,
                  }))
                }
              >
                {this.state.isAdvancedVisible ? "收起高级设置" : "高级设置"}
              </div>
              {this.state.isAdvancedVisible && (
                <>
                  <label className="collab-field">
                    服务器地址
                    <input
                      value={this.state.serverUrl}
                      disabled={isInRoom}
                      placeholder="https://your-server.example.com"
                      onChange={(event) =>
                        this.setState({ serverUrl: event.target.value })
                      }
                      onBlur={this.handleServerUrlBlur}
                    />
                    <span className="collab-field-note">
                      与「个人中心 → 共读服务器」是同一份设置；留空则只用本地阅读
                    </span>
                  </label>
                  <label className="collab-field" style={{ marginTop: "8px" }}>
                    鉴权 Token（可选）
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <input
                        style={{ flex: 1 }}
                        type={this.state.showServerToken ? "text" : "password"}
                        value={this.state.serverToken}
                        disabled={isInRoom}
                        placeholder="共读服务 Token (如服务端开启)"
                        onChange={(event) =>
                          this.setState({ serverToken: event.target.value })
                        }
                        onBlur={this.handleServerTokenBlur}
                      />
                      <button
                        type="button"
                        style={{
                          height: "30px",
                          padding: "0 8px",
                          fontSize: "12px",
                          borderRadius: "6px",
                          border: "1px solid rgba(120, 120, 120, 0.35)",
                          background: "transparent",
                          color: "inherit",
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                        onClick={() =>
                          this.setState((prev) => ({
                            showServerToken: !prev.showServerToken,
                          }))
                        }
                      >
                        {this.state.showServerToken ? "隐藏" : "显示"}
                      </button>
                    </div>
                    {/[^\x00-\x7F]/.test(this.state.serverToken) && (
                      <span style={{ color: "#eb5757", fontSize: "11px", marginTop: "2px" }}>
                        ⚠️ 检测到中文字符，Token 必须为纯英文字钥。
                      </span>
                    )}
                    <span className="collab-field-note">
                      服务端配置 COLLAB_TOKEN 时必填；留空表示服务端未开启鉴权
                    </span>
                  </label>
                  <div className="collab-test-connection-row">
                    <button
                      type="button"
                      className={`collab-test-btn ${
                        this.state.isTestingConnection ? "loading" : ""
                      }`}
                      disabled={this.state.isTestingConnection}
                      onClick={this.handleTestConnection}
                    >
                      {this.state.isTestingConnection
                        ? "正在测试连通性..."
                        : "测试服务器连接"}
                    </button>
                    {this.state.testResult && (
                      <span
                        className={`collab-test-badge ${
                          this.state.testResult.ok ? "success" : "error"
                        }`}
                      >
                        {this.state.testResult.ok ? "✓ " : "✕ "}
                        {this.state.testResult.message}
                      </span>
                    )}
                  </div>
                  {this.state.testResult?.hint && (
                    <div
                      className={`collab-test-hint ${
                        this.state.testResult.ok ? "success" : "error"
                      }`}
                    >
                      {this.state.testResult.hint}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    );
  }
}

export default CollabPanel;
