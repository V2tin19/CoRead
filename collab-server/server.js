const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { once } = require("events");

// ── 云端书库（共享书籍）配置 ──────────────────────────────────────────────
const BOOKS_DIR = process.env.BOOKS_DIR || path.join(__dirname, "..", "books");
// 房间书架：每个房间一个子目录
const ROOMS_DIR = process.env.ROOMS_DIR || path.join(__dirname, "..", "rooms");
// 随心笔记（涂鸦）：按书 md5 存
const DOODLES_DIR =
  process.env.DOODLES_DIR || path.join(__dirname, "..", "doodles");
const MAX_BOOK_SIZE = Number(process.env.MAX_BOOK_SIZE || 512 * 1024 * 1024);
const ALLOWED_EXT = new Set([
  "epub", "pdf", "mobi", "azw3", "azw", "txt", "fb2", "cbz", "cbr",
  "cbt", "cb7", "md", "docx", "html", "xhtml", "mhtml", "htm", "xml",
]);
const BOOK_MIME = {
  epub: "application/epub+zip",
  pdf: "application/pdf",
  mobi: "application/x-mobipocket-ebook",
  azw3: "application/vnd.amazon.ebook",
  azw: "application/vnd.amazon.ebook",
  txt: "text/plain; charset=utf-8",
  fb2: "application/x-fictionbook+xml",
  cbz: "application/x-cbz",
  cbr: "application/x-cbr",
  cbt: "application/x-cbt",
  cb7: "application/x-cb7",
  md: "text/markdown; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  html: "text/html; charset=utf-8",
  xhtml: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  mhtml: "message/rfc822",
  xml: "application/xml",
};

function sanitizeBookName(raw) {
  let name = String(raw || "").split(/[\\/]/).pop().trim();
  name = name.replace(/[^\p{L}\p{N}._-]+/gu, "_");
  if (name.length > 200) name = name.slice(-200);
  return name;
}

function ensureBooksDir() {
  fs.mkdirSync(BOOKS_DIR, { recursive: true });
}

function roomBooksDir(roomId) {
  return path.join(ROOMS_DIR, String(roomId).toUpperCase());
}

function ensureRoomBooksDir(roomId) {
  fs.mkdirSync(roomBooksDir(roomId), { recursive: true });
}

function ensureDoodlesDir() {
  fs.mkdirSync(DOODLES_DIR, { recursive: true });
}

function extOf(name) {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

// 房间目录里属于「房间自身」的文件（元数据、写盘临时文件），不是书：
// 既不能通过 /file 下载，也不能被 DELETE 当书删掉。
// （老实现只做 sanitizeBookName，于是 DELETE .../books/room.json 会把房间
//   元数据直接删掉，房间名/顺序/房主在下次重启后全部消失。）
function isReservedRoomFile(name) {
  const lower = String(name || "").toLowerCase();
  return lower === "room.json" || lower.endsWith(".tmp");
}

function finishWrite(ws) {
  return new Promise((resolve) => {
    ws.on("finish", resolve);
    ws.on("error", resolve);
  });
}

// ── 房间书架落盘：写盘节流 + 原子替换 ────────────────────────────────────
// 房间元数据（名称、书单顺序）变化频繁，直接同步写会在高并发下抖动，
// 这里统一走「节流 500ms + 写临时文件再 rename」的原子写。
const ROOM_META_WRITE_DELAY = Number(process.env.ROOM_META_WRITE_DELAY || 500);
const pendingMetaWrites = new Map();

function roomMetaPath(roomId) {
  return path.join(roomBooksDir(roomId), "room.json");
}

function scheduleRoomMetaWrite(room) {
  if (pendingMetaWrites.has(room.roomId)) return;
  const timer = setTimeout(() => {
    pendingMetaWrites.delete(room.roomId);
    flushRoomMeta(room);
  }, ROOM_META_WRITE_DELAY);
  if (timer.unref) timer.unref();
  pendingMetaWrites.set(room.roomId, timer);
}

function flushRoomMeta(room) {
  try {
    ensureRoomBooksDir(room.roomId);
    const payload = JSON.stringify({
      roomId: room.roomId,
      roomName: room.roomName || "",
      ownerId: room.ownerId || "",
      bookKey: room.bookKey || "",
      createdAt: room.createdAt || Date.now(),
      order: room.bookOrder || [],
    });
    const tmp = roomMetaPath(room.roomId) + ".tmp";
    fs.writeFileSync(tmp, payload, "utf-8");
    fs.renameSync(tmp, roomMetaPath(room.roomId));
  } catch (error) {
    console.error("[collab] 房间元数据写盘失败:", error.message);
  }
}

// 启动时把磁盘上的房间恢复进内存（服务重启后房间不丢）
function loadRoomsFromDisk() {
  try {
    if (!fs.existsSync(ROOMS_DIR)) return;
    for (const entry of fs.readdirSync(ROOMS_DIR)) {
      const dir = path.join(ROOMS_DIR, entry);
      if (!fs.statSync(dir).isDirectory()) continue;
      const metaFile = path.join(dir, "room.json");
      let meta = {};
      if (fs.existsSync(metaFile)) {
        try {
          meta = JSON.parse(fs.readFileSync(metaFile, "utf-8"));
        } catch (e) {
          meta = {};
        }
      }
      const roomId = entry.toUpperCase();
      const room = {
        roomId,
        roomName: meta.roomName || "",
        bookKey: meta.bookKey || "",
        ownerId: meta.ownerId || "",
        currentLocation: null,
        members: new Map(),
        messages: [],
        notes: [],
        leaderId: "",
        // 共享笔迹从磁盘恢复（否则重启后房间里大家画过的笔记全没了）
        doodles: loadRoomDoodles(roomId),
        bookOrder: Array.isArray(meta.order) ? meta.order : [],
        createdAt: meta.createdAt || Date.now(),
        emptySince: Date.now(),
        emptyTimer: null,
      };
      rooms.set(roomId, room);
      scheduleRoomDeletion(room);
    }
    if (rooms.size > 0) {
      console.log(`[collab] 从磁盘恢复 ${rooms.size} 个房间`);
    }
  } catch (error) {
    console.error("[collab] 恢复房间失败:", error.message);
  }
}

function listRoomBooks(room) {
  const dir = roomBooksDir(room.roomId);
  if (!fs.existsSync(dir)) return [];
  const coverDir = path.join(dir, "covers");
  const coverNames = fs.existsSync(coverDir)
    ? new Set(fs.readdirSync(coverDir))
    : new Set();
  const files = fs
    .readdirSync(dir)
    .filter((f) => f !== "room.json" && !f.endsWith(".tmp"))
    .filter((f) => {
      try {
        return fs.statSync(path.join(dir, f)).isFile();
      } catch (e) {
        return false;
      }
    });
  const order = room.bookOrder || [];
  const rank = (name) => {
    const idx = order.indexOf(name);
    return idx < 0 ? Number.MAX_SAFE_INTEGER : idx;
  };
  return files
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      const hasCover = Array.from(coverNames).some((c) =>
        c.startsWith(f + ".")
      );
      return {
        name: f,
        size: st.size,
        uploadedAt: Math.round(st.mtimeMs),
        url: `/rooms/${room.roomId}/books/${encodeURIComponent(f)}/file`,
        coverUrl: hasCover
          ? `/rooms/${room.roomId}/books/${encodeURIComponent(f)}/cover`
          : "",
      };
    })
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

// ── 涂鸦（随心笔记）落盘：按页合并 + 原子写 ────────────────────────────
// 配额：单本书最多多少「页」有笔记、单页最多多少笔。客户端的每页上限是
// 2000 笔；服务端这层是兜底，防止有人拿接口当免费网盘无限灌。
const MAX_DOODLE_PAGES = Number(process.env.MAX_DOODLE_PAGES || 5000);
const MAX_STROKES_PER_PAGE = Number(
  process.env.MAX_STROKES_PER_PAGE || 5000
);
const doodleWriteTimers = new Map();
const DOODLE_WRITE_DELAY = Number(process.env.DOODLE_WRITE_DELAY || 800);
// 内存缓存：写盘是节流的，若每次都从磁盘重读，同一页的第二次写入会看不到
// 第一次刚合并的笔迹（还没落盘），导致「按笔合并」失效。这里以内存为准。
const doodleCache = new Map();

function doodlePath(bookKey) {
  const safe = String(bookKey || "").replace(/[^a-zA-Z0-9_-]+/g, "_");
  return path.join(DOODLES_DIR, safe + ".json");
}

function loadDoodles(bookKey) {
  if (doodleCache.has(bookKey)) return doodleCache.get(bookKey);
  let pages = {};
  const file = doodlePath(bookKey);
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (data && data.pages && typeof data.pages === "object") {
        pages = data.pages;
      }
    } catch (e) {
      pages = {};
    }
  }
  doodleCache.set(bookKey, pages);
  return pages;
}

function saveDoodles(bookKey, pages) {
  try {
    ensureDoodlesDir();
    const file = doodlePath(bookKey);
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ bookKey, pages }), "utf-8");
    fs.renameSync(tmp, file);
  } catch (error) {
    console.error("[collab] 涂鸦写盘失败:", error.message);
  }
}

function scheduleDoodleWrite(bookKey, pages) {
  doodleCache.set(bookKey, pages);
  const existing = doodleWriteTimers.get(bookKey);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    doodleWriteTimers.delete(bookKey);
    saveDoodles(bookKey, doodleCache.get(bookKey) || pages);
  }, DOODLE_WRITE_DELAY);
  if (timer.unref) timer.unref();
  doodleWriteTimers.set(bookKey, timer);
}

// ── 房间共享涂鸦落盘 ────────────────────────────────────────────────────
// 房间元数据（room.json）里只有房间自身信息，共享笔迹必须单独存一份：
// 否则 pm2 restart / 房间过期重建之后，房间里大家画过的笔迹会全丢
// （房间还有 10 分钟空置回收策略，不落盘等于「人一走笔记就没了」）。
// 策略与个人云涂鸦一致：内存为准 + 节流原子写。
const ROOM_DOODLES_DIR =
  process.env.ROOM_DOODLES_DIR || path.join(__dirname, "..", "rooms-doodles");
const roomDoodleTimers = new Map();
const roomDoodleCache = new Map();

function ensureRoomDoodlesDir() {
  if (!fs.existsSync(ROOM_DOODLES_DIR)) {
    fs.mkdirSync(ROOM_DOODLES_DIR, { recursive: true });
  }
}

function roomDoodlePath(roomId) {
  const safe = String(roomId || "")
    .toUpperCase()
    .replace(/[^a-zA-Z0-9_-]+/g, "_");
  return path.join(ROOM_DOODLES_DIR, safe + ".json");
}

function loadRoomDoodles(roomId) {
  if (roomDoodleCache.has(roomId)) return roomDoodleCache.get(roomId);
  let doodles = {};
  try {
    const file = roomDoodlePath(roomId);
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (data && data.doodles && typeof data.doodles === "object") {
        doodles = data.doodles;
      }
    }
  } catch (error) {
    console.error("[collab] 读取房间涂鸦失败:", error.message);
    doodles = {};
  }
  roomDoodleCache.set(roomId, doodles);
  return doodles;
}

function saveRoomDoodles(roomId, doodles) {
  try {
    ensureRoomDoodlesDir();
    const file = roomDoodlePath(roomId);
    const tmp = file + ".tmp";
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        roomId: String(roomId || "").toUpperCase(),
        doodles: doodles || {},
        updatedAt: Date.now(),
      }),
      "utf-8"
    );
    fs.renameSync(tmp, file);
  } catch (error) {
    console.error("[collab] 房间涂鸦写盘失败:", error.message);
  }
}

function scheduleRoomDoodleWrite(roomId, doodles) {
  roomDoodleCache.set(roomId, doodles);
  const existing = roomDoodleTimers.get(roomId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    roomDoodleTimers.delete(roomId);
    saveRoomDoodles(roomId, roomDoodleCache.get(roomId) || doodles);
  }, DOODLE_WRITE_DELAY);
  if (timer.unref) timer.unref();
  roomDoodleTimers.set(roomId, timer);
}

function removeRoomDoodles(roomId) {
  const timer = roomDoodleTimers.get(roomId);
  if (timer) clearTimeout(timer);
  roomDoodleTimers.delete(roomId);
  roomDoodleCache.delete(roomId);
  try {
    const file = roomDoodlePath(roomId);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (error) {
    console.error("[collab] 删除房间涂鸦失败:", error.message);
  }
}

// 房间里有没有共享笔迹（空房回收时用来保护「有笔记的房间」）
function hasRoomDoodles(room) {
  if (!room || !room.doodles) return false;
  return Object.keys(room.doodles).some(
    (pageKey) => Array.isArray(room.doodles[pageKey]) && room.doodles[pageKey].length > 0
  );
}

// 按笔合并：以 stroke.id 做并集；removedIds 里的笔迹删除。
// 这样多端同页各画各的不会互相覆盖，撤销/清空也能真正传播。
function mergeDoodlePage(existing, incoming, removedIds) {
  const byId = new Map();
  for (const stroke of existing || []) {
    if (stroke && stroke.id) byId.set(stroke.id, stroke);
  }
  for (const id of removedIds || []) byId.delete(id);
  for (const stroke of incoming || []) {
    if (stroke && stroke.id) byId.set(stroke.id, stroke);
  }
  return Array.from(byId.values());
}

const PORT = Number(process.env.COLLAB_PORT || 17390);
const HOST = process.env.COLLAB_HOST || "127.0.0.1";

// ── 轻量级鉴权 ───────────────────────────────────────────────────────────
// 公网部署时设置 COLLAB_TOKEN 环境变量,所有写操作必须带 x-collab-token 头。
// 未设置 = 本地开发模式,不校验(保证 npm run dev 零配置可用)。
// 只校验写操作(POST/PUT/DELETE);读操作(GET)放行,避免打断 SSE 长连接与文件直链。
const COLLAB_TOKEN = String(process.env.COLLAB_TOKEN || "").trim();
const TOKEN_REQUIRED = COLLAB_TOKEN.length > 0;

function isAuthorized(req) {
  if (!TOKEN_REQUIRED) return true;
  const method = (req.method || "GET").toUpperCase();
  if (method === "GET" || method === "OPTIONS") return true;
  const provided = req.headers["x-collab-token"];
  const value = Array.isArray(provided) ? provided[0] : provided;
  if (typeof value !== "string" || value.length !== COLLAB_TOKEN.length) {
    return false;
  }
  // 定长时间比较,避免通过响应耗时逐字符爆破 token
  let diff = 0;
  for (let i = 0; i < COLLAB_TOKEN.length; i++) {
    diff |= COLLAB_TOKEN.charCodeAt(i) ^ value.charCodeAt(i);
  }
  return diff === 0;
}

// 空房保留时长:移动端息屏/切后台会让 SSE 瞬断,若立刻删房,另一端将加入失败。
// 最后一名成员离开后房间保留这段时间,期间任何人(含重连的创建者)都还能加入。
const EMPTY_ROOM_TTL_MS = Number(process.env.EMPTY_ROOM_TTL_MS || 10 * 60 * 1000);
const MAX_EMPTY_ROOMS = Number(process.env.MAX_EMPTY_ROOMS || 20);

const clients = new Map(); // clientId -> { clientId, conns: Set<res> }
const rooms = new Map();

// ── CORS ───────────────────────────────────────────────────────────────
// 默认**不发**任何 CORS 头。网页版与共读服务本来同源：
//   生产 —— nginx 把 /collab/ 反代到本服务，浏览器看到的是同源；
//   开发 —— CRA 的 src/setupProxy.js 转发 /collab/*，同样同源。
// 同源请求根本不走 CORS，所以以前那个 "*" 纯属白开门：它只会让任何陌生网页
// 都能借访客的浏览器读到房间列表。
//
// 什么时候需要配：打包成桌面端 / 安卓端之后，页面不再是我们的域名 ——
//   · Electron 用 file:// 加载，发出去的 Origin 是字面量 `null`；
//   · Capacitor(安卓)的页面跑在 https://localhost。
// 这时客户端与服务端是跨域的，必须把客户端来源写进白名单（**逗号分隔，支持多值**）：
//   COLLAB_ALLOWED_ORIGIN=null,https://localhost,http://localhost
// 也可以填 "*" 放行所有来源（只在你还想保留"任意网页跨域访问"时才这么做）。
const ALLOWED_ORIGINS = String(process.env.COLLAB_ALLOWED_ORIGIN || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

function buildCorsHeaders(allowOrigin) {
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-collab-token",
    // 响应内容随 Origin 变化，告诉缓存别把 A 站的响应喂给 B 站
    vary: "Origin",
  };
}

// 按请求的 Origin 回显：命中白名单才发，否则一条 CORS 头都不发（浏览器自行拦下）。
// 不带 Origin 的请求（同源页面 / 非浏览器 / 命令行）保持老行为，回白名单第一项。
function corsHeadersFor(req) {
  if (ALLOWED_ORIGINS.length === 0) return {};
  if (ALLOWED_ORIGINS.includes("*")) return buildCorsHeaders("*");
  const origin = String((req && req.headers && req.headers.origin) || "").trim();
  if (!origin) return buildCorsHeaders(ALLOWED_ORIGINS[0]);
  if (ALLOWED_ORIGINS.includes(origin)) return buildCorsHeaders(origin);
  return {};
}

// CORS 头在请求入口按 Origin 统一 setHeader（见 createServer），这里不再重复，
// 否则 writeHead 会用那份固定的 header 盖掉按 Origin 算出来的结果。
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  res.end(body);
}

function sendEvent(clientId, event, data) {
  const client = clients.get(clientId);
  if (!client) return;
  // 半死连接（对端网络切换/息屏被掐）在 TCP 超时前 still 出现在 clients 里，
  // 往 destroyed 流上 write 会抛错甚至以 uncaughtException 拖垮整个服务，
  // 广播循环也就此中断 —— 全房间的同步一起掉。这里先过滤再兜 try/catch。
  for (const res of client.conns) {
    if (res.destroyed || res.writableEnded) {
      client.conns.delete(res);
      continue;
    }
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (e) {
      client.conns.delete(res);
    }
  }
  if (client.conns.size === 0) {
    clients.delete(clientId);
    leaveRooms(clientId);
  }
}

function broadcast(roomId, event, data, exceptClientId) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const member of room.members.values()) {
    if (member.clientId !== exceptClientId) {
      sendEvent(member.clientId, event, data);
    }
  }
}

function roomSnapshot(room) {
  return {
    roomId: room.roomId,
    name: room.roomName || "",
    bookKey: room.bookKey,
    ownerId: room.ownerId,
    currentLocation: room.currentLocation,
    // 领读：跟随开关打开时，只有这个人的翻页会被其他人跟随
    leaderId: room.leaderId || "",
    leaderName: (room.members.get(room.leaderId) || {}).name || "",
    members: Array.from(room.members.values()).map((member) => ({
      clientId: member.clientId,
      name: member.name,
      joinedAt: member.joinedAt,
    })),
    messages: room.messages.slice(-50),
    notes: room.notes.slice(-200),
  };
}

function ensureRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) {
    const error = new Error("Room not found");
    error.statusCode = 404;
    throw error;
  }
  return room;
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let aborted = false;
    req.on("data", (chunk) => {
      if (aborted) return;
      raw += chunk;
      if (raw.length > limit) {
        aborted = true;
        reject(new Error(`Request body too large (limit ${limit} bytes)`));
        req.destroy();
        return;
      }
    });
    req.on("end", () => {
      if (aborted) return;
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
  });
}

// 原始字节流读取(封面图片等二进制上传用)
function readBodyRaw(req, limit = 1024 * 1024) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on("data", (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > limit) {
        aborted = true;
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (aborted) return;
      resolve(Buffer.concat(chunks));
    });
    req.on("error", () => {
      if (!aborted) resolve(null);
    });
  });
}

function joinRoom(room, clientId, name) {
  if (room.emptyTimer) {
    clearTimeout(room.emptyTimer);
    room.emptyTimer = null;
  }
  room.emptySince = 0;
  const member = {
    clientId,
    name: String(name || "Reader").slice(0, 40),
    joinedAt: Date.now(),
  };
  room.members.set(clientId, member);
  // 领读没指定、或指定的那个人已经不在房里 → 默认让房主当；房主也不在就第一个进的人当
  if (!room.leaderId || !room.members.has(room.leaderId)) {
    room.leaderId =
      room.ownerId && room.members.has(room.ownerId) ? room.ownerId : clientId;
  }
  broadcast(room.roomId, "room-updated", roomSnapshot(room));
  return member;
}

function deleteRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.emptyTimer) {
    clearTimeout(room.emptyTimer);
    room.emptyTimer = null;
  }
  const pending = pendingMetaWrites.get(roomId);
  if (pending) {
    clearTimeout(pending);
    pendingMetaWrites.delete(roomId);
  }
  rooms.delete(roomId);
  // 房间数据（书架文件 + 元数据 + 共享笔迹）一并清掉
  fs.rm(roomBooksDir(roomId), { recursive: true, force: true }, () => {});
  removeRoomDoodles(roomId);
}

function evictExcessEmptyRooms() {
  const emptyRooms = [];
  for (const room of rooms.values()) {
    if (room.members.size === 0) emptyRooms.push(room);
  }
  if (emptyRooms.length <= MAX_EMPTY_ROOMS) return;
  emptyRooms.sort((a, b) => (a.emptySince || 0) - (b.emptySince || 0));
  for (const room of emptyRooms.slice(0, emptyRooms.length - MAX_EMPTY_ROOMS)) {
    // 磁盘上有书、或有共享笔迹的房间不驱逐（下次启动还能恢复）
    if (listRoomBooks(room).length > 0 || hasRoomDoodles(room)) continue;
    deleteRoom(room.roomId);
  }
}

function scheduleRoomDeletion(room) {
  room.emptySince = Date.now();
  if (room.emptyTimer) clearTimeout(room.emptyTimer);
  room.emptyTimer = setTimeout(() => {
    // 有书、或者房间里已经有大家画过的共享笔迹 → 保留（重启/再进都还在）。
    // 只有「又没书又没笔记」的空壳房才回收，否则共享笔记会因为
    // 「大家离开超过 TTL」被静默清掉，这正是多人涂鸦最不能接受的。
    if (listRoomBooks(room).length === 0 && !hasRoomDoodles(room)) {
      deleteRoom(room.roomId);
    }
  }, EMPTY_ROOM_TTL_MS);
  if (room.emptyTimer.unref) room.emptyTimer.unref();
  evictExcessEmptyRooms();
}

function removeMember(roomId, clientId) {
  const room = rooms.get(roomId);
  if (!room || !room.members.has(clientId)) return;
  room.members.delete(clientId);
  if (room.members.size === 0) {
    scheduleRoomDeletion(room);
  } else {
    if (room.ownerId === clientId) {
      room.ownerId = room.members.values().next().value.clientId;
    }
    // 领读走了：交给房主，房主也不在就交给还在房里的第一个人
    if (room.leaderId === clientId || !room.members.has(room.leaderId)) {
      room.leaderId =
        room.ownerId && room.members.has(room.ownerId)
          ? room.ownerId
          : room.members.values().next().value.clientId;
    }
    broadcast(roomId, "room-updated", roomSnapshot(room));
  }
}

function leaveRooms(clientId) {
  for (const room of rooms.values()) {
    if (room.members.has(clientId)) {
      removeMember(room.roomId, clientId);
    }
  }
}

// 房间书架：把上传流写进 <ROOMS_DIR>/<roomId>/<filename>
function receiveRoomBook(req, room, rawName) {
  return new Promise((resolve) => {
    const name = sanitizeBookName(rawName);
    const ext = extOf(name);
    if (!name || !ALLOWED_EXT.has(ext)) {
      resolve({ status: 400, error: "Unsupported book format: " + (ext || "unknown") });
      return;
    }
    ensureRoomBooksDir(room.roomId);
    const dest = path.join(roomBooksDir(room.roomId), name);
    const ws = fs.createWriteStream(dest, { flags: "w" });
    let bytes = 0;
    let tooLarge = false;
    let failed = false;
    (async () => {
      try {
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > MAX_BOOK_SIZE) {
            tooLarge = true;
            break;
          }
          if (!ws.write(chunk)) await once(ws, "drain");
        }
        ws.end();
        await finishWrite(ws);
      } catch (error) {
        failed = true;
        ws.destroy();
      }
      if (tooLarge) {
        ws.destroy();
        fs.unlink(dest, () => {});
        resolve({ status: 413, error: "Book too large" });
        return;
      }
      if (failed || !fs.existsSync(dest)) {
        resolve({ status: 500, error: "Upload failed" });
        return;
      }
      // 新书加进顺序表末尾
      if (!room.bookOrder.includes(name)) {
        room.bookOrder.push(name);
        scheduleRoomMetaWrite(room);
      }
      const st = fs.statSync(dest);
      resolve({
        status: 201,
        book: {
          name,
          size: st.size,
          uploadedAt: Math.round(st.mtimeMs),
          url: `/rooms/${room.roomId}/books/${encodeURIComponent(name)}/file`,
        },
      });
    })();
  });
}

const server = http.createServer(async (req, res) => {
  // 未配 COLLAB_ALLOWED_ORIGIN、或请求来源不在白名单时，这里拿到空对象，
  // 等于一条 CORS 头都不发
  for (const [key, value] of Object.entries(corsHeadersFor(req))) {
    res.setHeader(key, value);
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: "Missing or invalid collaboration token" });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        rooms: rooms.size,
        clients: clients.size,
        uptime: Math.round(process.uptime()),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      sendJson(res, 200, {
        ok: true,
        name: "Koodo collaboration server",
        message:
          "This is the realtime API server. Open Koodo Reader and use the 共读 panel to create or join a room.",
        health: "/health",
        events: "/events?clientId=YOUR_CLIENT_ID",
        rooms: rooms.size,
        clients: clients.size,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/events") {
      const clientId = url.searchParams.get("clientId") || randomUUID();
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });
      res.write("\n");
      // 网页版每打开一次阅读器都是一个新标签页,同一个 clientId（同一台设备）
      // 完全可能同时存在多条 SSE 连接。老实现 Map 直接覆盖,旧标签页从此
      // 收不到任何事件 —— 症状正是「翻页第一次还能同步,第二次就不行了」。
      // 这里改成同一 clientId 挂多条连接,全部关闭才算离线。
      let client = clients.get(clientId);
      if (!client) {
        client = { clientId, conns: new Set() };
        clients.set(clientId, client);
      }
      client.conns.add(res);
      // 对端强杀连接时 write 可能触发异步 error 事件,不接管会被当作
      // uncaughtException 把整个服务拖崩（pm2 重启 = 全房间断线）。
      res.on("error", () => {
        client.conns.delete(res);
      });
      sendEvent(clientId, "connected", { clientId });
      const heartbeat = setInterval(() => {
        if (res.destroyed || res.writableEnded) {
          clearInterval(heartbeat);
          return;
        }
        try {
          res.write(`event: ping\ndata: ${Date.now()}\n\n`);
        } catch (e) {
          clearInterval(heartbeat);
        }
      }, 25000);
      req.on("close", () => {
        clearInterval(heartbeat);
        const current = clients.get(clientId);
        if (!current) return;
        current.conns.delete(res);
        if (current.conns.size === 0) {
          clients.delete(clientId);
          leaveRooms(clientId);
        }
      });
      return;
    }

    // ── 房间列表 ───────────────────────────────────────────────────────────
    if (req.method === "GET" && url.pathname === "/rooms") {
      const list = Array.from(rooms.values()).map((room) => ({
        roomId: room.roomId,
        name: room.roomName || "",
        bookKey: room.bookKey,
        bookCount: listRoomBooks(room).length,
        ownerId: room.ownerId,
        members: Array.from(room.members.values()).map((member) => member.name),
        // 成员 id：前端据此判断「这个房间我能不能解散」，避免给非成员
        // 也显示一个点了必然 403 的「删除」按钮
        memberIds: Array.from(room.members.keys()),
        leaderId: room.leaderId || "",
        createdAt: room.createdAt,
      }));
      sendJson(res, 200, { rooms: list });
      return;
    }

    if (req.method === "POST" && url.pathname === "/rooms") {
      const body = await readBody(req);
      const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
      const room = {
        roomId,
        roomName: String(body.roomName || "").slice(0, 60),
        bookKey: body.bookKey || "",
        ownerId: body.clientId,
        currentLocation: null,
        members: new Map(),
        messages: [],
        notes: [],
        leaderId: "",
        doodles: {},
        bookOrder: [],
        createdAt: Date.now(),
      };
      rooms.set(roomId, room);
      ensureRoomBooksDir(roomId);
      scheduleRoomMetaWrite(room);
      if (body.join === false) {
        // 「共同阅读」页「创建房间」：只建房，不进人（进房由页面自己控制）。
        // 但它同样要纳入空房回收 —— 老实现这条分支直接 return，房间既没有
        // emptySince 也没有 emptyTimer，于是「房屋回收」/「超量驱逐」对它完全
        // 失效，只建不用的房间会在内存和磁盘里越堆越多。
        scheduleRoomDeletion(room);
        sendJson(res, 201, { roomId, name: room.roomName });
        return;
      }
      joinRoom(room, body.clientId, body.name);
      sendJson(res, 201, roomSnapshot(room));
      return;
    }

    // ── 房间书封面：上传时由浏览器提取,房间书架展示真封面 ────────────────
    const COVER_EXT_CONTENT_TYPE = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      gif: "image/gif",
    };
    const coverUpload = url.pathname.match(/^\/rooms\/([^/]+)\/books\/cover$/);
    if (coverUpload && req.method === "POST") {
      const roomId = coverUpload[1].toUpperCase();
      const room = ensureRoom(roomId);
      const name = sanitizeBookName(url.searchParams.get("filename") || "");
      const ext = String(url.searchParams.get("ext") || "jpg")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      if (!name || !COVER_EXT_CONTENT_TYPE[ext]) {
        sendJson(res, 400, { error: "filename and valid ext are required" });
        return;
      }
      const body = await readBodyRaw(req, 3 * 1024 * 1024);
      if (!body || body.length === 0) {
        sendJson(res, 400, { error: "Empty cover" });
        return;
      }
      const coverDir = path.join(roomBooksDir(room.roomId), "covers");
      fs.mkdirSync(coverDir, { recursive: true });
      // 同名书只留一份封面(不同扩展名都清掉)
      for (const old of fs.existsSync(coverDir)
        ? fs.readdirSync(coverDir)
        : []) {
        if (old.startsWith(name + ".")) {
          try {
            fs.unlinkSync(path.join(coverDir, old));
          } catch (e) {}
        }
      }
      const dest = path.join(coverDir, name + "." + ext);
      fs.writeFileSync(dest, body);
      sendJson(res, 201, { ok: true, coverUrl: `/rooms/${roomId}/books/${encodeURIComponent(name)}/cover` });
      return;
    }

    const coverGet = url.pathname.match(
      /^\/rooms\/([^/]+)\/books\/([^/]+)\/cover$/
    );
    if (coverGet && req.method === "GET") {
      const roomId = coverGet[1].toUpperCase();
      let name = "";
      try {
        name = sanitizeBookName(decodeURIComponent(coverGet[2]));
      } catch (e) {
        // 畸形编码一律按无封面处理
      }
      const coverDir = path.join(roomBooksDir(roomId), "covers");
      let found = "";
      if (name && fs.existsSync(coverDir)) {
        for (const file of fs.readdirSync(coverDir)) {
          if (file.startsWith(name + ".")) {
            found = path.join(coverDir, file);
            break;
          }
        }
      }
      if (!found) {
        sendJson(res, 404, { error: "Cover not found" });
        return;
      }
      const ext = found.split(".").pop().toLowerCase();
      res.writeHead(200, {
        "content-type": COVER_EXT_CONTENT_TYPE[ext] || "application/octet-stream",
        "cache-control": "public, max-age=604800",
      });
      fs.createReadStream(found).pipe(res);
      return;
    }

    // ── 房间书架 ───────────────────────────────────────────────────────────
    const roomBookUpload = url.pathname.match(
      /^\/rooms\/([^/]+)\/books\/upload$/
    );
    if (roomBookUpload && req.method === "POST") {
      const roomId = roomBookUpload[1].toUpperCase();
      const room = ensureRoom(roomId);
      const result = await receiveRoomBook(
        req,
        room,
        url.searchParams.get("filename") || ""
      );
      if (result.status >= 400) {
        sendJson(res, result.status, { error: result.error });
        return;
      }
      broadcast(roomId, "room-books-updated", { roomId }, null);
      sendJson(res, 201, result.book);
      return;
    }

    const roomBooksReorder = url.pathname.match(
      /^\/rooms\/([^/]+)\/books\/reorder$/
    );
    if (roomBooksReorder && req.method === "POST") {
      const roomId = roomBooksReorder[1].toUpperCase();
      const room = ensureRoom(roomId);
      const body = await readBody(req);
      const names = Array.isArray(body.names) ? body.names : [];
      const existing = new Set(listRoomBooks(room).map((b) => b.name));
      // 只保留真实存在的文件，缺失的补到末尾，避免顺序表被写脏
      const ordered = names.filter((n) => existing.has(n));
      for (const name of existing) {
        if (!ordered.includes(name)) ordered.push(name);
      }
      room.bookOrder = ordered;
      scheduleRoomMetaWrite(room);
      sendJson(res, 200, { ok: true, order: ordered });
      return;
    }

    const roomBookFile = url.pathname.match(
      /^\/rooms\/([^/]+)\/books\/([^/]+)\/file$/
    );
    if (roomBookFile && req.method === "GET") {
      const roomId = roomBookFile[1].toUpperCase();
      const name = sanitizeBookName(decodeURIComponent(roomBookFile[2]));
      const file = path.join(roomBooksDir(roomId), name);
      if (
        !name ||
        isReservedRoomFile(name) ||
        !fs.existsSync(file) ||
        !fs.statSync(file).isFile()
      ) {
        sendJson(res, 404, { error: "Book not found" });
        return;
      }
      const ext = extOf(name);
      const size = fs.statSync(file).size;
      const asciiName = name.replace(/[^\x20-\x7e]/g, "_");
      res.writeHead(200, {
        "content-type": BOOK_MIME[ext] || "application/octet-stream",
        "content-length": size,
        "content-disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "cache-control": "public, max-age=3600",
      });
      fs.createReadStream(file).pipe(res);
      return;
    }

    // 房间书架列表 / 上传 / 单本操作
    const roomBookList = url.pathname.match(/^\/rooms\/([^/]+)\/books$/);
    if (roomBookList && req.method === "GET") {
      const roomId = roomBookList[1].toUpperCase();
      const room = ensureRoom(roomId);
      sendJson(res, 200, { books: listRoomBooks(room) });
      return;
    }

    const roomBookItem = url.pathname.match(
      /^\/rooms\/([^/]+)\/books\/([^/]+)$/
    );
    if (roomBookItem && req.method === "DELETE") {
      const roomId = roomBookItem[1].toUpperCase();
      const room = ensureRoom(roomId);
      const name = sanitizeBookName(decodeURIComponent(roomBookItem[2]));
      const file = path.join(roomBooksDir(roomId), name);
      // 白名单：只删「扩展名在允许列表里」的真书；room.json / *.tmp 显式拦住
      if (
        !name ||
        isReservedRoomFile(name) ||
        !ALLOWED_EXT.has(extOf(name)) ||
        !fs.existsSync(file) ||
        !fs.statSync(file).isFile()
      ) {
        sendJson(res, 404, { error: "Book not found" });
        return;
      }
      fs.unlinkSync(file);
      // 连带清掉这本书的封面
      const coverDir = path.join(roomBooksDir(roomId), "covers");
      if (fs.existsSync(coverDir)) {
        for (const coverFile of fs.readdirSync(coverDir)) {
          if (coverFile.startsWith(name + ".")) {
            try {
              fs.unlinkSync(path.join(coverDir, coverFile));
            } catch (e) {}
          }
        }
      }
      room.bookOrder = (room.bookOrder || []).filter((n) => n !== name);
      scheduleRoomMetaWrite(room);
      broadcast(roomId, "room-books-updated", { roomId }, null);
      sendJson(res, 200, { ok: true });
      return;
    }

    // ── 随心笔记（涂鸦）：个人云，与房间无关 ─────────────────────────────
    const doodleBook = url.pathname.match(/^\/doodles\/([^/]+)$/);
    if (doodleBook && req.method === "GET") {
      const bookKey = decodeURIComponent(doodleBook[1]);
      sendJson(res, 200, { bookKey, pages: loadDoodles(bookKey) });
      return;
    }
    if (doodleBook && req.method === "PUT") {
      const bookKey = decodeURIComponent(doodleBook[1]);
      // 涂鸦单页可以很密（客户端上限 2000 笔），给到 4MB；一般请求仍是 1MB
      const body = await readBody(req, 4 * 1024 * 1024);
      const pageKey = String(body.pageKey || "");
      if (!pageKey) {
        sendJson(res, 400, { error: "pageKey is required" });
        return;
      }
      const pages = loadDoodles(bookKey);
      if (!pages[pageKey] && Object.keys(pages).length >= MAX_DOODLE_PAGES) {
        sendJson(res, 413, { error: "这本书的笔记页数已达上限" });
        return;
      }
      pages[pageKey] = mergeDoodlePage(
        pages[pageKey],
        body.strokes,
        body.removedIds
      );
      if (pages[pageKey].length > MAX_STROKES_PER_PAGE) {
        pages[pageKey] = pages[pageKey].slice(-MAX_STROKES_PER_PAGE);
      }
      if (pages[pageKey].length === 0) delete pages[pageKey];
      scheduleDoodleWrite(bookKey, pages);
      sendJson(res, 200, { ok: true, strokes: pages[pageKey] || [] });
      return;
    }

    // ── 房间共享涂鸦 ───────────────────────────────────────────────────────
    const roomDoodle = url.pathname.match(/^\/rooms\/([^/]+)\/doodle$/);
    if (roomDoodle && req.method === "GET") {
      const roomId = roomDoodle[1].toUpperCase();
      const room = ensureRoom(roomId);
      sendJson(res, 200, { doodles: room.doodles || {} });
      return;
    }

    // 房间快照：客户端重连/面板重新打开时主动拉取,不再只依赖 SSE 推送
    const roomInfo = url.pathname.match(/^\/rooms\/([^/]+)$/);
    if (roomInfo && req.method === "GET") {
      const room = ensureRoom(roomInfo[1].toUpperCase());
      sendJson(res, 200, roomSnapshot(room));
      return;
    }

    const roomMatch = url.pathname.match(
      /^\/rooms\/([^/]+)(?:\/([^/]+))?$/
    );
    if (roomMatch && req.method === "DELETE") {
      const roomId = roomMatch[1].toUpperCase();
      // 房间不存在时直接当作已删除,不要用 ensureRoom 凭空造房再删(会造成噪声写入)
      const room = rooms.get(roomId);
      if (!room) {
        sendJson(res, 200, { ok: true, alreadyGone: true });
        return;
      }
      const body = await readBody(req);
      const isOwner = !!body.clientId && room.ownerId === body.clientId;
      const isMember = room.members.has(body.clientId);
      // 只有房主或仍在房内的成员能解散;空房(房主掉线后的 TTL 残留)也须由房主本人清理,
      // 防止他人枚举 roomId 清掉别人的房间书架。
      if (!isOwner && !isMember) {
        sendJson(res, 403, {
          error: "Only the room owner or a member can close this room",
        });
        return;
      }
      broadcast(roomId, "room-deleted", { roomId, closedBy: body.clientId });
      deleteRoom(roomId);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (roomMatch && req.method === "POST") {
      const roomId = roomMatch[1].toUpperCase();
      const action = roomMatch[2] || "join";
      const room = ensureRoom(roomId);
      // 房间内的 POST 包含涂鸦收笔的完整笔迹（可能较大），给到 2MB
      const body = await readBody(req, 2 * 1024 * 1024);

      if (action === "join") {
        if (body.bookKey && room.bookKey && body.bookKey !== room.bookKey) {
          sendJson(res, 409, {
            error: "This room is reading a different local book.",
            roomBookKey: room.bookKey,
          });
          return;
        }
        // 先加入的书写进房间，后来者按同一本比对
        if (!room.bookKey && body.bookKey) room.bookKey = body.bookKey;
        joinRoom(room, body.clientId, body.name);
        sendJson(res, 200, roomSnapshot(room));
        return;
      }

      if (action === "leave") {
        removeMember(roomId, body.clientId);
        sendJson(res, 200, { ok: true });
        return;
      }

      // 指定/清空房间领读。任何成员都能设（房间内共享状态，服务端广播出去）。
      // 领读本身不影响别人；只有「跟随开关打开」的成员才会跟着领读翻页。
      if (action === "leader") {
        const targetId = String(body.targetId || "");
        if (targetId && !room.members.has(targetId)) {
          sendJson(res, 400, { error: "Target is not a member of this room" });
          return;
        }
        room.leaderId = targetId;
        broadcast(roomId, "room-updated", roomSnapshot(room));
        sendJson(res, 200, {
          ok: true,
          leaderId: room.leaderId,
          leaderName: (room.members.get(room.leaderId) || {}).name || "",
        });
        return;
      }

      if (action === "message") {
        const message = {
          id: randomUUID(),
          roomId,
          senderId: body.clientId,
          senderName: String(body.name || "Reader").slice(0, 40),
          text: String(body.text || "").slice(0, 2000),
          createdAt: Date.now(),
        };
        room.messages.push(message);
        room.messages = room.messages.slice(-200);
        broadcast(roomId, "chat-message", message, body.clientId);
        sendJson(res, 201, message);
        return;
      }

      if (action === "location") {
        room.currentLocation = body.location || null;
        broadcast(
          roomId,
          "page-change",
          {
            roomId,
            senderId: body.clientId,
            location: room.currentLocation,
          },
          body.clientId
        );
        sendJson(res, 200, { ok: true });
        return;
      }

      // 笔记：带上作者信息（authorId/authorName），接收端才能显示「谁写的」
      if (action === "notes") {
        const noteEvent = {
          roomId,
          senderId: body.clientId,
          note: body.note,
          createdAt: Date.now(),
        };
        room.notes.push(noteEvent.note);
        room.notes = room.notes.slice(-500);
        broadcast(roomId, "note-created", noteEvent, body.clientId);
        sendJson(res, 201, noteEvent);
        return;
      }

      if (action === "note-update") {
        const noteEvent = {
          roomId,
          senderId: body.clientId,
          note: body.note,
          updatedAt: Date.now(),
        };
        room.notes = room.notes.map((note) =>
          note && body.note && note.key === body.note.key ? body.note : note
        );
        broadcast(roomId, "note-updated", noteEvent, body.clientId);
        sendJson(res, 200, noteEvent);
        return;
      }

      if (action === "note-delete") {
        const noteEvent = {
          roomId,
          senderId: body.clientId,
          noteKey: body.noteKey,
          chapterDocIndex: body.chapterDocIndex,
          deletedAt: Date.now(),
        };
        room.notes = room.notes.filter((note) => note.key !== body.noteKey);
        broadcast(roomId, "note-deleted", noteEvent, body.clientId);
        sendJson(res, 200, noteEvent);
        return;
      }

      // 共享涂鸦：op = add / undo / clear，按笔 id 合并
      if (action === "doodle") {
        const bookKey = body.bookKey || "";
        const pageKey = String(body.pageKey || "");
        if (!pageKey) {
          sendJson(res, 400, { error: "pageKey is required" });
          return;
        }
        if (!room.doodles) room.doodles = {};
        if (
          !room.doodles[pageKey] &&
          Object.keys(room.doodles).length >= MAX_DOODLE_PAGES
        ) {
          sendJson(res, 413, { error: "房间笔记页数已达上限" });
          return;
        }
        // 房间笔迹按「页 -> 笔」存，并记录作者
        const pageStrokes = room.doodles[pageKey] || [];
        const operatorId = body.authorId || body.clientId || "";
        const authored = (stroke) =>
          stroke
            ? {
                ...stroke,
                authorId: operatorId,
                authorName: body.authorName || "",
              }
            : stroke;
        // 撤销 / 清空必须限定在「操作者自己画的」笔迹上。
        // 老实现 clear 直接 next=[]，会把同一页里别人画的笔迹一起抹掉；
        // undo 也不校验作者 —— 多人同页时这是破坏性 bug（症状：刷新后
        // 别人的笔记整页消失，或自己撤销过的笔迹"复活"）。
        const isMine = (stroke) =>
          !stroke.authorId || stroke.authorId === operatorId;
        let next;
        if (body.op === "clear") {
          next = pageStrokes.filter((stroke) => !isMine(stroke));
        } else if (body.op === "undo") {
          const removeId = body.stroke && body.stroke.id;
          if (removeId) {
            // 精确删这一笔，且只删自己画的
            next = pageStrokes.filter(
              (stroke) => stroke.id !== removeId || !isMine(stroke)
            );
          } else {
            // 兼容不带笔迹 id 的老客户端：只撤销自己画的最后一笔
            let target = -1;
            for (let i = pageStrokes.length - 1; i >= 0; i--) {
              if (isMine(pageStrokes[i])) {
                target = i;
                break;
              }
            }
            next =
              target < 0
                ? pageStrokes
                : pageStrokes.filter((_stroke, index) => index !== target);
          }
        } else if (body.op === "append") {
          // 「一笔一划」：同伴正在写的这一笔，分片推过来的新增点。
          // from = 这一笔此前已有几点（用来拼接），rev = 单调序号（用来丢乱序/重复包）。
          const incoming = body.stroke || {};
          const from = Math.max(0, Number(body.from) || 0);
          const rev = Number(body.rev) || 0;
          if (!incoming.id) {
            sendJson(res, 400, { error: "stroke.id is required" });
            return;
          }
          const index = pageStrokes.findIndex(
            (stroke) => stroke && stroke.id === incoming.id
          );
          if (index < 0) {
            // 第一次见到这一笔：必须从第 0 点开始，否则前半段缺失会画成断的，
            // 这种情况直接忽略，等收笔时那份完整笔迹兜底
            next =
              from > 0
                ? pageStrokes
                : pageStrokes.concat([
                    authored({ ...incoming, rev, points: incoming.points || [] }),
                  ]);
          } else {
            const existing = pageStrokes[index];
            if (typeof existing.rev === "number" && existing.rev >= rev) {
              // 乱序或重复的旧包，丢掉
              next = pageStrokes;
            } else {
              const mergedPoints = (existing.points || [])
                .slice(0, from)
                .concat(incoming.points || []);
              next = pageStrokes.slice();
              next[index] = authored({
                ...existing,
                ...incoming,
                points: mergedPoints,
                rev,
              });
            }
          }
        } else {
          next = mergeDoodlePage(pageStrokes, [authored(body.stroke)], []);
        }
        if (next.length === 0) delete room.doodles[pageKey];
        else room.doodles[pageKey] = next;
        // 房间共享笔迹单独落盘（节流 + 原子写）：服务重启 / 房间空置回收后
        // 大家画过的笔记还在
        scheduleRoomDoodleWrite(roomId, room.doodles);
        const isRemovalOp = body.op === "undo" || body.op === "clear";
        broadcast(
          roomId,
          "doodle",
          {
            roomId,
            bookKey,
            pageKey,
            op: body.op || "add",
            // 广播里 undo/clear 只带被删笔迹的 id：整笔带出去太肥，收端也只认 id
            stroke: isRemovalOp
              ? body.stroke && body.stroke.id
                ? { id: body.stroke.id }
                : undefined
              : authored(body.stroke),
            // append 用：from = 这一笔此前已有几点，rev = 单调递增序号
            from: body.from,
            rev: body.rev,
            authorId: operatorId,
            authorName: body.authorName || "",
            at: Date.now(),
          },
          body.clientId
        );
        sendJson(res, 200, { ok: true, strokes: room.doodles[pageKey] || [] });
        return;
      }
    }

    // ── 云端书库：共享书籍 ─────────────────────────────────────────────────
    if (req.method === "GET" && url.pathname === "/books") {
      ensureBooksDir();
      const books = fs
        .readdirSync(BOOKS_DIR)
        .filter((f) => fs.statSync(path.join(BOOKS_DIR, f)).isFile())
        .map((f) => {
          const st = fs.statSync(path.join(BOOKS_DIR, f));
          return {
            name: f,
            size: st.size,
            uploadedAt: Math.round(st.mtimeMs),
            url: `/books/${encodeURIComponent(f)}`,
          };
        })
        .sort((a, b) => b.uploadedAt - a.uploadedAt);
      sendJson(res, 200, { books });
      return;
    }

    if (req.method === "POST" && url.pathname === "/books") {
      const name = sanitizeBookName(url.searchParams.get("filename") || "");
      const ext = extOf(name);
      if (!name || !ALLOWED_EXT.has(ext)) {
        sendJson(res, 400, {
          error: "Unsupported book format: " + (ext || "unknown"),
        });
        return;
      }
      ensureBooksDir();
      const dest = path.join(BOOKS_DIR, name);
      const ws = fs.createWriteStream(dest, { flags: "w" });
      let bytes = 0;
      let aborted = false;
      try {
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > MAX_BOOK_SIZE) {
            aborted = true;
            break;
          }
          if (!ws.write(chunk)) await once(ws, "drain");
        }
        ws.end();
        await finishWrite(ws);
      } catch (error) {
        ws.destroy();
        if (!aborted) {
          sendJson(res, 500, { error: "Upload failed" });
          return;
        }
      }
      if (aborted) {
        ws.destroy();
        fs.unlink(dest, () => {});
        sendJson(res, 413, { error: "Book too large" });
        return;
      }
      if (!fs.existsSync(dest)) {
        sendJson(res, 500, { error: "Upload failed" });
        return;
      }
      const st = fs.statSync(dest);
      sendJson(res, 201, {
        name,
        size: st.size,
        uploadedAt: Math.round(st.mtimeMs),
        url: `/books/${encodeURIComponent(name)}`,
      });
      return;
    }

    const bookMatch = url.pathname.match(/^\/books\/([^/]+)$/);
    if (bookMatch && req.method === "GET") {
      const name = sanitizeBookName(decodeURIComponent(bookMatch[1]));
      const file = path.join(BOOKS_DIR, name);
      if (!name || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        sendJson(res, 404, { error: "Book not found" });
        return;
      }
      const ext = extOf(name);
      const size = fs.statSync(file).size;
      const asciiName = name.replace(/[^\x20-\x7e]/g, "_");
      res.writeHead(200, {
        "content-type": BOOK_MIME[ext] || "application/octet-stream",
        "content-length": size,
        "content-disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "cache-control": "public, max-age=3600",
      });
      fs.createReadStream(file).pipe(res);
      return;
    }

    if (bookMatch && req.method === "DELETE") {
      const name = sanitizeBookName(decodeURIComponent(bookMatch[1]));
      const file = path.join(BOOKS_DIR, name);
      if (!name || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        sendJson(res, 404, { error: "Book not found" });
        return;
      }
      fs.unlink(file, (err) => {
        if (err) {
          sendJson(res, 500, { error: "Delete failed" });
          return;
        }
        sendJson(res, 200, { ok: true });
      });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message });
  }
});

ensureBooksDir();
ensureDoodlesDir();
fs.mkdirSync(ROOMS_DIR, { recursive: true });
loadRoomsFromDisk();

// 退出前把节流中的涂鸦/房间元数据立刻落盘，避免「刚画完就重启」丢数据
function flushAllPendingWrites() {
  for (const timer of pendingMetaWrites.values()) clearTimeout(timer);
  pendingMetaWrites.clear();
  for (const room of rooms.values()) {
    if (room.bookOrder && room.bookOrder.length >= 0) flushRoomMeta(room);
  }
  for (const timer of doodleWriteTimers.values()) clearTimeout(timer);
  doodleWriteTimers.clear();
  for (const [bookKey, pages] of doodleCache) saveDoodles(bookKey, pages);
  for (const timer of roomDoodleTimers.values()) clearTimeout(timer);
  roomDoodleTimers.clear();
  for (const [roomId, doodles] of roomDoodleCache) saveRoomDoodles(roomId, doodles);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    flushAllPendingWrites();
    process.exit(0);
  });
}

server.listen(PORT, HOST, () => {
  console.log(`Koodo collaboration server listening on http://${HOST}:${PORT}`);
});

module.exports = server;
