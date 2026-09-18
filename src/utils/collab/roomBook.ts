import collabClient from "./collabClient";
import toast from "react-hot-toast";
import { toSafeHeaderValue } from "./collabServerConfig";

// ── 当前所在的共读房间(「共同阅读」页面进入房间后记录) ──────────────────
// 供右上角「导入图书到房间」按钮、整页拖拽导入等跨组件场景使用
const ACTIVE_ROOM_KEY = "koodo-collab-active-room";
export const ACTIVE_ROOM_CHANGED_EVENT = "koodo-collab-active-room-changed";
export const ROOM_BOOKS_CHANGED_EVENT = "koodo-collab-room-books-changed";

export interface ActiveCollabRoom {
  roomId: string;
  roomName?: string;
  [key: string]: any;
}

export function getActiveCollabRoom(): ActiveCollabRoom | null {
  try {
    const raw = localStorage.getItem(ACTIVE_ROOM_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.roomId) return parsed;
  } catch (e) {
    // 数据损坏按没有房间处理
  }
  return null;
}

export function setActiveCollabRoom(room: ActiveCollabRoom): void {
  localStorage.setItem(ACTIVE_ROOM_KEY, JSON.stringify(room));
  window.dispatchEvent(new CustomEvent(ACTIVE_ROOM_CHANGED_EVENT));
}

export function clearActiveCollabRoom(): void {
  localStorage.removeItem(ACTIVE_ROOM_KEY);
  window.dispatchEvent(new CustomEvent(ACTIVE_ROOM_CHANGED_EVENT));
}

// ── 从房间打开过的书的标记(与个人书架隔离) ──────────────────────────────
// 这些书只属于房间书架:不进个人书架列表,笔记/高亮也不出现在个人笔记页
const COLLAB_KEYS_KEY = "koodo-collab-book-keys";

export function getCollabBookKeyList(): string[] {
  try {
    const raw = localStorage.getItem(COLLAB_KEYS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

export function addCollabBookKey(key: string): void {
  if (!key) return;
  const list = getCollabBookKeyList();
  if (!list.includes(key)) {
    list.push(key);
    localStorage.setItem(COLLAB_KEYS_KEY, JSON.stringify(list));
  }
}

export function removeCollabBookKey(key: string): void {
  const list = getCollabBookKeyList();
  const next = list.filter((item) => item !== key);
  if (next.length !== list.length) {
    localStorage.setItem(COLLAB_KEYS_KEY, JSON.stringify(next));
  }
}

// ── 共读昵称(与「个人设置」页共用) ─────────────────────────────────────
const DISPLAY_NAME_KEY = "koodo-collab-display-name";

// 生成 7 位随机 ID:数字 + 大小写字母
function generateRandomId(): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  for (let i = 0; i < 7; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// 读取昵称;没设置过就生成一个默认 ID 并持久化,以后一直用它
export function getOrCreateDisplayName(): string {
  const existing = localStorage.getItem(DISPLAY_NAME_KEY);
  if (existing) return existing;
  const generated = generateRandomId();
  localStorage.setItem(DISPLAY_NAME_KEY, generated);
  return generated;
}

export function saveDisplayName(name: string): void {
  localStorage.setItem(DISPLAY_NAME_KEY, name.trim() || generateRandomId());
}

// ── 房间书 → 本地书 key 的映射 ──────────────────────────────────────────
// 房间书架里的书只用「文件名」标识；本地书库用的是内容 md5。于是每次从房间
// 点开一本书，都得先把整本下载下来算 md5，才能知道「这本下过没有」——
// 症状就是每次点开同一本书都重新下载一遍，还会撞上导入流程的「重复书」提示。
// 这里把「房间 + 文件名 + 体积 → 本地 key」记下来：第二次点开直接命中，
// 不下载、不导入、不弹重复提示。带体积一起存是为了防「同名文件被换过」。
const ROOM_BOOK_LOCAL_KEY = "koodo-collab-room-book-local-keys";

interface RoomBookLocalRef {
  key: string;
  size: number;
}

function readRoomBookMap(): Record<string, RoomBookLocalRef> {
  try {
    const raw = localStorage.getItem(ROOM_BOOK_LOCAL_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}

function roomBookMapKey(roomId: string, bookName: string): string {
  return `${String(roomId).toUpperCase()}::${bookName}`;
}

/** 查「这个房间的这本书」在本地对应哪个 key；没记录 / 体积对不上都返回空 */
export function getRoomBookLocalKey(
  roomId: string,
  bookName: string,
  size?: number
): string {
  if (!roomId || !bookName) return "";
  const ref = readRoomBookMap()[roomBookMapKey(roomId, bookName)];
  if (!ref || !ref.key) return "";
  if (typeof size === "number" && ref.size && ref.size !== size) return "";
  return ref.key;
}

export function setRoomBookLocalKey(
  roomId: string,
  bookName: string,
  size: number,
  bookKey: string
): void {
  if (!roomId || !bookName || !bookKey) return;
  try {
    const map = readRoomBookMap();
    map[roomBookMapKey(roomId, bookName)] = { key: bookKey, size: size || 0 };
    localStorage.setItem(ROOM_BOOK_LOCAL_KEY, JSON.stringify(map));
  } catch (e) {
    // 存不进去也不影响使用，下次最多多下一次
  }
}

// ── 房间书架的上传/列表辅助 ─────────────────────────────────────────────
export function getRoomBaseUrl(): string {
  return collabClient.serverUrl.replace(/\/$/, "");
}

// 服务端设置 COLLAB_TOKEN 后，写操作(POST/PUT/DELETE)需带上此头。
// 没有设置时返回空对象，等价于原行为。本函数是前端拼共读请求头的唯一真源。
export function collabAuthHeaders(
  extra: Record<string, string> = {}
): Record<string, string> {
  const token = toSafeHeaderValue(collabClient.token);
  return token ? { ...extra, "x-collab-token": token } : extra;
}

// 上传一个文件到房间书架(带进度 toast),成功返回 true
// 上传房间书封面(浏览器在上传/首次打开时提取好的图片字节)。
// 失败静默返回 false:封面只是锦上添花,不弹错误打扰用户。
export function uploadRoomCover(
  roomId: string,
  bookName: string,
  data: ArrayBuffer,
  ext: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `${getRoomBaseUrl()}/rooms/${encodeURIComponent(roomId)}/books/cover?filename=${encodeURIComponent(bookName)}&ext=${encodeURIComponent(ext)}`
    );
    const token = collabClient.token;
    if (token) xhr.setRequestHeader("x-collab-token", token);
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.send(data);
  });
}

export function uploadFileToRoom(roomId: string, file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const toastId = "room-upload";
    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `${getRoomBaseUrl()}/rooms/${encodeURIComponent(roomId)}/books/upload?filename=${encodeURIComponent(file.name)}`
    );
    // XHR 不带 content-type 由浏览器按 File 自动生成，这里只需补鉴权头
    const token = collabClient.token;
    if (token) xhr.setRequestHeader("x-collab-token", token);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        toast.loading(`上传中 ${percent}%: ${file.name}`, { id: toastId });
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        toast.success("已导入房间书架: " + file.name, { id: toastId });
        resolve(true);
        return;
      }
      let message = `HTTP ${xhr.status}`;
      try {
        message = JSON.parse(xhr.responseText).error || message;
      } catch (e) {
        // 保留默认信息
      }
      toast.error("上传失败: " + message, { id: toastId });
      resolve(false);
    };
    xhr.onerror = () => {
      toast.error("网络错误,上传失败", { id: toastId });
      resolve(false);
    };
    xhr.send(file);
  });
}

export async function listRoomBookNames(roomId: string): Promise<string[]> {
  try {
    const response = await fetch(
      `${getRoomBaseUrl()}/rooms/${encodeURIComponent(roomId)}/books`
    );
    if (!response.ok) return [];
    const data = await response.json();
    return (data.books || []).map((book: any) => book.name);
  } catch (e) {
    return [];
  }
}

// 通知「共同阅读」页面刷新房间书架
export function notifyRoomBooksChanged(roomId: string): void {
  window.dispatchEvent(
    new CustomEvent(ROOM_BOOKS_CHANGED_EVENT, { detail: { roomId } })
  );
}
