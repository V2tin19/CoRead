import BookModel from "../../models/Book";
import HtmlBookModel from "../../models/HtmlBook";
import {
  CollabMessage,
  CollabMember,
  CollabRoomBrief,
} from "../../utils/collab/collabClient";

export interface CollabPanelProps {
  currentBook: BookModel;
  htmlBook: HtmlBookModel;
  onClose: () => void;
  handleFetchNotes: () => void;
}

export interface CollabPanelState {
  serverUrl: string;
  serverToken: string;
  roomIdInput: string;
  activeRoomId: string;
  ownerId: string;
  members: CollabMember[];
  messages: CollabMessage[];
  messageText: string;
  status: string;
  isBusy: boolean;
  rooms: CollabRoomBrief[];
  isLoadingRooms: boolean;
  isAdvancedVisible: boolean;
  isPendingJoin: boolean;
  isDoodleSync: boolean;
  /** 是否开启「一笔一划」实时涂鸦同步 */
  isDoodleLive: boolean;
  /** 房间领读（跟随开关打开时，只跟随这个人的翻页） */
  leaderId: string;
  leaderName: string;
  /** 本人是否跟随领读 */
  followLeader: boolean;
  /** 面板拖动偏移量（相对默认右上角位置）。null = 使用默认位置 */
  dragOffset: { x: number; y: number } | null;
  /** 是否正在拖动（拖动中禁用过渡与文本选择） */
  isDragging: boolean;
}
