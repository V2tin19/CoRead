import BookModel from "../../models/Book";

/** 云端书库里的一个文件(房间书架的元素) */
export interface CloudBook {
  name: string;
  size: number;
  uploadedAt: number;
  url: string;
  /** 服务端已存的封面图(首次打开/上传时由浏览器提取),空串表示还没有 */
  coverUrl?: string;
}

/** 服务器上的一个共读房间 */
export interface CollabRoomBrief {
  roomId: string;
  name: string;
  bookKey: string;
  bookCount: number;
  ownerId: string;
  members: string[];
  /** 成员设备 id：用来判断「这个房间我能不能解散」 */
  memberIds?: string[];
  /** 房间领读设备 id */
  leaderId?: string;
  createdAt: number;
}

export interface CloudLibraryProps {
  importBookFunc: (file: File) => Promise<void>;
  handleReadingBook: (book: BookModel) => void;
  isCollapsed: boolean;
  /** 书架视图模式（card / cover / list）——与「我的图书」共用同一份 redux 状态
      与 reader config 里的 viewMode，两处切换互相同步 */
  viewMode: string;
}

export interface CloudLibraryState {
  /** 处于「房间列表」还是「某个房间的书架」 */
  view: "rooms" | "room";
  rooms: CollabRoomBrief[];
  activeRoom: CollabRoomBrief | null;
  roomBooks: CloudBook[];
  createName: string;
  joinCode: string;
  isLoading: boolean;
  isBusy: boolean;
  importingBook: string;
  menuBook: string;
  dragBook: string;
  dragOverBook: string;
  error: string;
  /** 书架卡片缩放，与「我的图书」共用 cardScale 设置，保证两边书卡一样大 */
  cardScale: number;
}
