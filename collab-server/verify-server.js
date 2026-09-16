/**
 * collab-server 端到端验证：起一个临时服务，逐个打接口，断言返回。
 * 用独立端口 + 独立数据目录，不碰真实数据。
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

const PORT = 17999;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = path.join(os.tmpdir(), "collab-verify-" + Date.now());
const NODE = process.execPath;

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log("  ✅ " + name);
  } else {
    failed++;
    console.log("  ❌ " + name + (extra ? "  → " + JSON.stringify(extra) : ""));
  }
}

async function json(pathname, options) {
  const res = await fetch(BASE + pathname, options);
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    body = null;
  }
  return { status: res.status, body };
}

// 只取响应头（CORS 断言需要看原始 header，json() 会把它丢掉）。
// 带重试：刚 kill 掉实例时，undici 连接池里可能还压着一条已死的连接，
// 复用它会直接 ECONNRESET —— 这不是 CORS 的问题，重试一次即可。
async function headers(pathname, options) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(BASE + pathname, options);
      return { status: res.status, headers: res.headers };
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }
  throw lastError;
}

// 等到端口真的空出来（kill 完必须等，否则新实例 EADDRINUSE，
// 结果断言打在旧实例上，结论是假的）
async function waitForPortFree(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let alive = true;
    try {
      await fetch(BASE + "/health");
    } catch (e) {
      alive = false;
    }
    if (!alive) return true;
    await sleep(150);
  }
  return false;
}

function post(pathname, data, method = "POST") {
  return json(pathname, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE + "/health");
      if (res.ok) return true;
    } catch (e) {
      // 还没起来
    }
    await sleep(120);
  }
  return false;
}

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const child = spawn(NODE, [path.join(__dirname, "server.js")], {
    env: {
      ...process.env,
      COLLAB_PORT: String(PORT),
      COLLAB_HOST: "127.0.0.1",
      BOOKS_DIR: path.join(TMP, "books"),
      ROOMS_DIR: path.join(TMP, "rooms"),
      DOODLES_DIR: path.join(TMP, "doodles"),
      ROOM_DOODLES_DIR: path.join(TMP, "rooms-doodles"),
      ROOM_META_WRITE_DELAY: "50",
      DOODLE_WRITE_DELAY: "50",
      EMPTY_ROOM_TTL_MS: "600000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (d) => process.stderr.write("[server] " + d));

  try {
    const up = await waitForServer();
    check("服务启动 /health", up);
    if (!up) return;

    // ── 1. 房间 CRUD ────────────────────────────────────────────────────
    console.log("\n[1] 房间与房间书架");
    const created = await post("/rooms", {
      clientId: "c-owner",
      roomName: "周三读书会",
      join: false,
    });
    check("POST /rooms 建房返回 roomId", created.status === 201 && !!created.body.roomId, created);
    const roomId = created.body.roomId;

    const listed = await json("/rooms");
    const mine = (listed.body.rooms || []).find((r) => r.roomId === roomId);
    check("GET /rooms 含新房间", !!mine, listed.body);
    check("房间带 name", mine && mine.name === "周三读书会", mine);
    check("房间带 bookCount=0", mine && mine.bookCount === 0, mine);

    // 上传房间书
    console.log("\n[2] 房间书架上传/下载/排序/移出");
    const up1 = await fetch(
      `${BASE}/rooms/${roomId}/books/upload?filename=${encodeURIComponent("书一.epub")}`,
      { method: "POST", body: Buffer.from("EPUB-FAKE-1") }
    );
    check("上传房间书 1 → 201", up1.status === 201, up1.status);
    const up2 = await fetch(
      `${BASE}/rooms/${roomId}/books/upload?filename=${encodeURIComponent("book2.txt")}`,
      { method: "POST", body: Buffer.from("TXT-FAKE-2") }
    );
    check("上传房间书 2 → 201", up2.status === 201, up2.status);

    const badExt = await fetch(
      `${BASE}/rooms/${roomId}/books/upload?filename=danger.exe`,
      { method: "POST", body: Buffer.from("EXE") }
    );
    check("拒绝非法扩展名 .exe", badExt.status === 400, badExt.status);

    const books1 = await json(`/rooms/${roomId}/books`);
    check("列出房间书 2 本", (books1.body.books || []).length === 2, books1.body);
    check(
      "房间书带下载 url",
      (books1.body.books || []).every((b) => /\/file$/.test(b.url)),
      books1.body
    );

    const dl = await fetch(`${BASE}/rooms/${roomId}/books/${encodeURIComponent("书一.epub")}/file`);
    const dlText = await dl.text();
    check("下载房间书内容一致", dl.status === 200 && dlText === "EPUB-FAKE-1", dlText);

    const reorder = await post(`/rooms/${roomId}/books/reorder`, {
      names: ["book2.txt", "书一.epub"],
    });
    check("重排序 → 200", reorder.status === 200, reorder.body);
    const books2 = await json(`/rooms/${roomId}/books`);
    check(
      "重排序生效",
      books2.body.books[0] && books2.body.books[0].name === "book2.txt",
      books2.body.books.map((b) => b.name)
    );

    // ── 2.5 房间分组 ────────────────────────────────────────────────────
    // 这一步刻意放在删书之前：分组要拿两本书才验得出「多对多」和
    // 「删书后摘掉幽灵成员」两件事。
    console.log("\n[2.5] 房间分组");
    const groupsEmpty = await json(`/rooms/${roomId}/books`);
    check(
      "新房间 groups 为空数组",
      Array.isArray(groupsEmpty.body.groups) && groupsEmpty.body.groups.length === 0,
      groupsEmpty.body.groups
    );

    // 多对多：book2.txt 同时在两个组里
    const setGroups = await post(`/rooms/${roomId}/books/groups`, {
      groups: [
        { name: "科幻", books: ["书一.epub", "book2.txt"] },
        { name: "在读", books: ["book2.txt"] },
      ],
    });
    check("POST books/groups → 200", setGroups.status === 200, setGroups.body);
    const groups1 = await json(`/rooms/${roomId}/books`);
    check(
      "分组落盘并随 books 一起下发",
      (groups1.body.groups || []).length === 2 &&
        groups1.body.groups[0].name === "科幻" &&
        groups1.body.groups[0].books.length === 2,
      groups1.body.groups
    );
    check(
      "同一本书可属于多个分组（多对多）",
      (groups1.body.groups || []).filter((g) =>
        g.books.includes("book2.txt")
      ).length === 2,
      groups1.body.groups
    );

    // 清洗：不存在的文件名要被丢掉，空组不落盘，重名只留第一个
    const dirty = await post(`/rooms/${roomId}/books/groups`, {
      groups: [
        { name: "科幻", books: ["不存在.epub"] },
        { name: "有效", books: ["书一.epub", "也不存在.txt"] },
        { name: "有效", books: ["book2.txt"] },
        { name: "   ", books: ["书一.epub"] },
        { name: "带/斜杠的", books: ["book2.txt"] },
        123,
      ],
    });
    check("脏数据提交仍 → 200", dirty.status === 200, dirty.body);
    const groups2 = (dirty.body.groups || []).map((g) => g.name);
    check(
      "空成员组被丢弃 / 重名只留第一个",
      groups2.length === 2 && groups2[0] === "有效" && groups2[1] === "带斜杠的",
      groups2
    );
    check(
      "组名里的路径符号被清掉",
      (dirty.body.groups || [])[1].name === "带斜杠的",
      (dirty.body.groups || []).map((g) => g.name)
    );
    check(
      "组内不存在的文件被过滤，剩下的成员正确",
      (dirty.body.groups || [])[0].books.join(",") === "书一.epub" &&
        (dirty.body.groups || [])[1].books.join(",") === "book2.txt",
      dirty.body.groups
    );

    const del = await post(
      `/rooms/${roomId}/books/${encodeURIComponent("book2.txt")}`,
      {},
      "DELETE"
    );
    check("移出房间书 → 200", del.status === 200, del.body);
    const books3 = await json(`/rooms/${roomId}/books`);
    check("移出后只剩 1 本", (books3.body.books || []).length === 1, books3.body);
    check(
      "删书后分组里不再有幽灵成员",
      (books3.body.groups || []).every(
        (g) => !g.books.includes("book2.txt")
      ) &&
        (books3.body.groups || []).every((g) => g.books.length > 0),
      books3.body.groups
    );

    const clearGroups = await post(`/rooms/${roomId}/books/groups`, {
      groups: [],
    });
    check("清空分组 → 200 且 groups 为空", clearGroups.status === 200 && (clearGroups.body.groups || []).length === 0, clearGroups.body);

    // ── 3. 入房 / 聊天 / 位置 / 笔记 ────────────────────────────────────
    console.log("\n[3] 入房 / 聊天 / 位置 / 笔记");
    const join = await post(`/rooms/${roomId}/join`, {
      clientId: "c-guest",
      bookKey: "md5-abc",
      name: "小明",
    });
    check("入房 → 200 且成员含小明", join.status === 200, join.body);
    check(
      "roomSnapshot 含 name 字段",
      join.status === 200 && join.body.name === "周三读书会",
      join.body && join.body.name
    );

    const conflict = await post(`/rooms/${roomId}/join`, {
      clientId: "c-guest2",
      bookKey: "md5-DIFFERENT",
      name: "别人",
    });
    check("不同书入房 → 409", conflict.status === 409, conflict.body);

    const msg = await post(`/rooms/${roomId}/message`, {
      clientId: "c-guest",
      name: "小明",
      text: "大家好",
    });
    check("发消息 → 201", msg.status === 201 && msg.body.text === "大家好", msg.body);

    const loc = await post(`/rooms/${roomId}/location`, {
      clientId: "c-guest",
      location: { chapterHref: "chap1.xhtml" },
    });
    check("广播位置 → 200", loc.status === 200, loc.body);

    const note = await post(`/rooms/${roomId}/notes`, {
      clientId: "c-guest",
      note: { key: "n1", bookKey: "md5-abc", notes: "重点", authorName: "小明" },
    });
    check("广播笔记 → 201", note.status === 201, note.body);
    const snap = await json(`/rooms/${roomId}/books`); // 顺带确认房间仍在
    check("房间仍在（笔记未破坏房间）", snap.status === 200, snap.status);

    const noteDel = await post(`/rooms/${roomId}/note-delete`, {
      clientId: "c-guest",
      noteKey: "n1",
    });
    check("删除笔记 → 200", noteDel.status === 200, noteDel.body);

    // ── 4. 涂鸦：个人云 + 房间共享 ──────────────────────────────────────
    console.log("\n[4] 涂鸦（个人云 / 房间共享）");
    const put1 = await post(
      "/doodles/md5-abc",
      {
        pageKey: "chap1.xhtml#p0",
        strokes: [{ id: "s1", points: [1, 2], color: "#000" }],
        removedIds: [],
      },
      "PUT"
    );
    check("PUT /doodles 个人云 → 200", put1.status === 200, put1.body);
    check("个人云返回 1 笔", (put1.body.strokes || []).length === 1, put1.body);

    const put2 = await post(
      "/doodles/md5-abc",
      {
        pageKey: "chap1.xhtml#p0",
        strokes: [{ id: "s2", points: [3, 4], color: "#f00" }],
        removedIds: [],
      },
      "PUT"
    );
    check("按笔合并后共 2 笔", (put2.body.strokes || []).length === 2, put2.body);

    const put3 = await post(
      "/doodles/md5-abc",
      { pageKey: "chap1.xhtml#p0", strokes: [], removedIds: ["s1"] },
      "PUT"
    );
    check("removedIds 能删笔（剩 1）", (put3.body.strokes || []).length === 1, put3.body);

    const got = await json("/doodles/md5-abc");
    check("GET /doodles 读回 1 笔", (got.body.pages["chap1.xhtml#p0"] || []).length === 1, got.body);

    const roomDoodle = await post(`/rooms/${roomId}/doodle`, {
      clientId: "c-guest",
      bookKey: "md5-abc",
      authorId: "c-guest",
      authorName: "小明",
      pageKey: "chap1.xhtml#p0",
      op: "add",
      stroke: { id: "r1", points: [9, 9] },
    });
    check("房间涂鸦 add → 200", roomDoodle.status === 200, roomDoodle.body);

    const roomDoodleGet = await json(`/rooms/${roomId}/doodle`);
    const rd = roomDoodleGet.body.doodles["chap1.xhtml#p0"] || [];
    check("房间涂鸦读回 1 笔", rd.length === 1, roomDoodleGet.body);
    check("房间涂鸦带作者", rd[0] && rd[0].authorName === "小明", rd[0]);
    check("房间涂鸦保留原 stroke 字段", rd[0] && Array.isArray(rd[0].points), rd[0]);

    const roomUndo = await post(`/rooms/${roomId}/doodle`, {
      clientId: "c-guest",
      pageKey: "chap1.xhtml#p0",
      op: "undo",
      stroke: { id: "r1" },
    });
    check("房间涂鸦 undo → 200", roomUndo.status === 200, roomUndo.body);

    // 多人同页：撤销 / 清空必须只作用在自己画的笔迹上
    const PAGE_P1 = "chap1.xhtml#p1";
    // ⚠️ 房间内的写操作现在要求发起者是房间成员（服务端校验 clientId，
    //    见 [12] 段）。以前这段测试里的「阿明 / 小美」从来没入过房 ——
    //    那正是漏洞本身：非成员可以随便往别人的房间里画。
    await post(`/rooms/${roomId}/join`, {
      clientId: "c-a",
      name: "阿明",
      bookKey: "md5-abc",
    });
    await post(`/rooms/${roomId}/join`, {
      clientId: "c-b",
      name: "小美",
      bookKey: "md5-abc",
    });
    const drawAs = (clientId, name, id, pageKey) =>
      post(`/rooms/${roomId}/doodle`, {
        clientId,
        bookKey: "md5-abc",
        authorId: clientId,
        authorName: name,
        pageKey,
        op: "add",
        stroke: { id, points: [1, 1] },
      });
    await drawAs("c-a", "阿明", "a1", PAGE_P1);
    await drawAs("c-a", "阿明", "a2", PAGE_P1);
    await drawAs("c-b", "小美", "b1", PAGE_P1);

    const peerClear = await post(`/rooms/${roomId}/doodle`, {
      clientId: "c-b",
      authorId: "c-b",
      pageKey: PAGE_P1,
      op: "clear",
    });
    const afterClear = (peerClear.body.strokes || []).map((s) => s.id).sort();
    check(
      "小美清空只清自己（阿明两笔还在）",
      afterClear.length === 2 && afterClear.join(",") === "a1,a2",
      afterClear
    );

    const crossUndo = await post(`/rooms/${roomId}/doodle`, {
      clientId: "c-b",
      authorId: "c-b",
      pageKey: PAGE_P1,
      op: "undo",
      stroke: { id: "a1" },
    });
    check(
      "小美撤销不了阿明的笔迹",
      (crossUndo.body.strokes || []).length === 2,
      crossUndo.body
    );

    const ownUndo = await post(`/rooms/${roomId}/doodle`, {
      clientId: "c-a",
      authorId: "c-a",
      pageKey: PAGE_P1,
      op: "undo",
      stroke: { id: "a2" },
    });
    const afterOwnUndo = (ownUndo.body.strokes || []).map((s) => s.id);
    check(
      "阿明撤销自己那一笔生效（且服务端真的删了，翻回该页不会复活）",
      afterOwnUndo.length === 1 && afterOwnUndo[0] === "a1",
      afterOwnUndo
    );

    // ── 5. 落盘与恢复 ──────────────────────────────────────────────────
    console.log("\n[5] 落盘 / 重启恢复");
    await sleep(400);
    const metaFile = path.join(TMP, "rooms", roomId, "room.json");
    check("room.json 已落盘", fs.existsSync(metaFile), metaFile);
    const doodleFile = path.join(TMP, "doodles", "md5-abc.json");
    check("涂鸦 json 已落盘", fs.existsSync(doodleFile), doodleFile);
    const roomDoodleFile = path.join(TMP, "rooms-doodles", roomId + ".json");
    check("房间共享涂鸦 json 已落盘", fs.existsSync(roomDoodleFile), roomDoodleFile);

    child.kill();
    await sleep(600);
    const child2 = spawn(NODE, [path.join(__dirname, "server.js")], {
      env: {
        ...process.env,
        COLLAB_PORT: String(PORT),
        COLLAB_HOST: "127.0.0.1",
        BOOKS_DIR: path.join(TMP, "books"),
        ROOMS_DIR: path.join(TMP, "rooms"),
        DOODLES_DIR: path.join(TMP, "doodles"),
        ROOM_DOODLES_DIR: path.join(TMP, "rooms-doodles"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const upAgain = await waitForServer();
    check("重启后服务可用", upAgain);
    if (upAgain) {
      const after = await json("/rooms");
      const restored = (after.body.rooms || []).find((r) => r.roomId === roomId);
      check("重启后房间恢复", !!restored, after.body);
      check("重启后房间名保留", restored && restored.name === "周三读书会", restored);
      check("重启后书架书数保留", restored && restored.bookCount === 1, restored);
      const dlPages = await json("/doodles/md5-abc");
      check(
        "重启后涂鸦保留",
        (dlPages.body.pages["chap1.xhtml#p0"] || []).length === 1,
        dlPages.body
      );
      const roomDoodlesAfter = await json(`/rooms/${roomId}/doodle`);
      const restoredPage =
        (roomDoodlesAfter.body.doodles || {})["chap1.xhtml#p1"] || [];
      check(
        "重启后房间共享笔迹保留（多人能继续看到同一页的笔记）",
        restoredPage.length === 1 && restoredPage[0].id === "a1",
        roomDoodlesAfter.body
      );
    }
    child2.kill();

    // ── 6. 解散房间清理 ────────────────────────────────────────────────
    console.log("\n[6] 解散房间清理磁盘");
    const child3 = spawn(NODE, [path.join(__dirname, "server.js")], {
      env: {
        ...process.env,
        COLLAB_PORT: String(PORT),
        BOOKS_DIR: path.join(TMP, "books"),
        ROOMS_DIR: path.join(TMP, "rooms"),
        DOODLES_DIR: path.join(TMP, "doodles"),
        ROOM_DOODLES_DIR: path.join(TMP, "rooms-doodles"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForServer();
    const before = path.join(TMP, "rooms", roomId);
    const rm = await post(`/rooms/${roomId}`, { clientId: "c-owner" }, "DELETE");
    check("解散房间 → 200", rm.status === 200, rm.body);
    await sleep(400);
    check("解散后房间目录被清", !fs.existsSync(before), before);
    check(
      "解散后房间共享涂鸦也被清",
      !fs.existsSync(path.join(TMP, "rooms-doodles", roomId + ".json")),
      path.join(TMP, "rooms-doodles", roomId + ".json")
    );
    child3.kill();

    // ── 7. 轻量级鉴权 ──────────────────────────────────────────────────
    console.log("\n[7] 轻量级鉴权 (COLLAB_TOKEN)");
    const TOKEN = "s3cret-token-for-verify";
    const child4 = spawn(NODE, [path.join(__dirname, "server.js")], {
      env: {
        ...process.env,
        COLLAB_PORT: String(PORT),
        COLLAB_HOST: "127.0.0.1",
        BOOKS_DIR: path.join(TMP, "books"),
        ROOMS_DIR: path.join(TMP, "rooms"),
        DOODLES_DIR: path.join(TMP, "doodles"),
        ROOM_DOODLES_DIR: path.join(TMP, "rooms-doodles"),
        COLLAB_TOKEN: TOKEN,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForServer();

    const authHeaders = { "content-type": "application/json", "x-collab-token": TOKEN };
    const postAuth = (p, data, method = "POST") =>
      json(p, { method, headers: authHeaders, body: JSON.stringify(data) });

    // 读操作放行(SSE / 列表 / 文件直链不应被 token 打断)
    const readNoToken = await json("/rooms");
    check("GET /rooms 无 token 放行", readNoToken.status === 200, readNoToken.body);
    const healthNoToken = await json("/health");
    check("GET /health 无 token 放行", healthNoToken.status === 200);

    // SSE：实时数据流，配了 token 就必须带（走 ?token= —— EventSource
    // 不能带自定义请求头）。不带 token 也能连上，就等于任何人只要拿到
    // 别人的 clientId，就能明文听走他的聊天与翻页（实测可复现）。
    const sseNoToken = await fetch(`${BASE}/events?clientId=someone`);
    check("GET /events 无 token → 401", sseNoToken.status === 401, sseNoToken.status);
    await sseNoToken.body?.cancel?.();
    const sseBadToken = await fetch(`${BASE}/events?clientId=someone&token=wrong`);
    check("GET /events 错误 token → 401", sseBadToken.status === 401, sseBadToken.status);
    await sseBadToken.body?.cancel?.();
    const sseOk = await fetch(
      `${BASE}/events?clientId=someone&token=${encodeURIComponent(TOKEN)}`
    );
    check("GET /events 正确 token → 200", sseOk.status === 200, sseOk.status);
    await sseOk.body?.cancel?.();

    // 写操作必须有 token
    const createNoToken = await post("/rooms", { clientId: "x", name: "n", roomName: "r" });
    check("POST /rooms 无 token → 401", createNoToken.status === 401, createNoToken.body);
    const doodleNoToken = await json("/doodles/md5-x", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pageKey: "p", strokes: [] }),
    });
    check("PUT /doodles 无 token → 401", doodleNoToken.status === 401, doodleNoToken.body);

    // 错误 token 拒绝
    const badToken = await json("/rooms", {
      method: "POST",
      headers: { "content-type": "application/json", "x-collab-token": "wrong-token-value1" },
      body: JSON.stringify({ clientId: "x", name: "n", roomName: "r" }),
    });
    check("POST /rooms 错误 token → 401", badToken.status === 401, badToken.body);

    // 正确 token 通过
    const okCreate = await postAuth("/rooms", {
      clientId: "owner-1",
      name: "房主",
      roomName: "鉴权房",
      join: false,
    });
    check(
      "POST /rooms 正确 token → 201",
      okCreate.status === 201,
      okCreate.body
    );
    const authRoomId = okCreate.body.roomId;
    const okDoodle = await json("/doodles/md5-x", {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ pageKey: "p", strokes: [{ id: "s1" }] }),
    });
    check("PUT /doodles 正确 token → 200", okDoodle.status === 200, okDoodle.body);

    // 房间删除权限:非房主非成员不能删
    const delByStranger = await postAuth(
      `/rooms/${authRoomId}`,
      { clientId: "stranger" },
      "DELETE"
    );
    check("他人删除房间 → 403", delByStranger.status === 403, delByStranger.body);
    const delByOwner = await postAuth(
      `/rooms/${authRoomId}`,
      { clientId: "owner-1" },
      "DELETE"
    );
    check("房主删除房间 → 200", delByOwner.status === 200, delByOwner.body);

    // 删不存在的房间:幂等返回,不凭空造房
    const delGhost = await postAuth(
      "/rooms/ZZZZZZ",
      { clientId: "owner-1" },
      "DELETE"
    );
    check("删除不存在房间 → 幂等 200", delGhost.status === 200, delGhost.body);
    const ghostCheck = await json("/rooms");
    const ghostExists = (ghostCheck.body.rooms || []).some((r) => r.roomId === "ZZZZZZ");
    check("删除不存在房间不会凭空造房", !ghostExists);

    // 路径穿越:上传文件名带 ../ 也不应逃出房间目录
    const traverse = await fetch(
      `${BASE}/rooms/${authRoomId}/books/upload?filename=${encodeURIComponent("../../evil.epub")}`,
      { method: "POST", headers: { "x-collab-token": TOKEN }, body: Buffer.from("x") }
    );
    await sleep(300);
    const escaped = [
      path.join(TMP, "evil.epub"),
      path.join(TMP, "rooms", "evil.epub"),
      path.join(TMP, "books", "evil.epub"),
    ].some((p) => fs.existsSync(p));
    check("上传文件名 ../ 不逃出目录", !escaped, { status: traverse.status });

    // ── 8. 增量涂鸦协议 / room.json 保护 / 领读 ───────────────────────
    console.log("\n[8] 增量涂鸦 append / room.json 保护 / 领读");
    const room8 = await postAuth("/rooms", {
      clientId: "c-lead",
      name: "领读人",
      roomName: "增量房",
      join: true,
    });
    check("建房并进房 → 201", room8.status === 201, room8.body);
    const r8 = room8.body.roomId;
    check("默认领读 = 房主", room8.body.leaderId === "c-lead", room8.body);

    // append 首片：服务端建一条「正在画」的笔迹
    const app1 = await postAuth(`/rooms/${r8}/doodle`, {
      clientId: "c-lead",
      authorId: "c-lead",
      pageKey: "p1",
      op: "append",
      from: 0,
      rev: 1,
      stroke: {
        id: "live1",
        color: "#111",
        size: 3,
        points: [[0.1, 0.1], [0.2, 0.2]],
      },
    });
    const app1s = (app1.body.strokes || []).find((s) => s.id === "live1");
    check("append 首片 → 2 点", app1s && app1s.points.length === 2, app1.body);

    // append 第二片：接在后面
    const app2 = await postAuth(`/rooms/${r8}/doodle`, {
      clientId: "c-lead",
      authorId: "c-lead",
      pageKey: "p1",
      op: "append",
      from: 2,
      rev: 2,
      stroke: { id: "live1", points: [[0.3, 0.3]] },
    });
    const app2s = (app2.body.strokes || []).find((s) => s.id === "live1");
    check("append 第二片 → 3 点", app2s && app2s.points.length === 3, app2.body);

    // append 乱序旧包：应被丢弃，不能把点写回去
    const appOld = await postAuth(`/rooms/${r8}/doodle`, {
      clientId: "c-lead",
      authorId: "c-lead",
      pageKey: "p1",
      op: "append",
      from: 1,
      rev: 1,
      stroke: { id: "live1", points: [[9, 9]] },
    });
    const appOlds = (appOld.body.strokes || []).find((s) => s.id === "live1");
    check(
      "append 乱序旧包被丢弃（仍是 3 点）",
      appOlds && appOlds.points.length === 3,
      appOld.body
    );

    // 收笔的完整笔迹（add）覆盖增量版本，且不会变成第二条
    const finalAdd = await postAuth(`/rooms/${r8}/doodle`, {
      clientId: "c-lead",
      authorId: "c-lead",
      pageKey: "p1",
      op: "add",
      stroke: {
        id: "live1",
        color: "#111",
        size: 3,
        points: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3], [0.4, 0.4]],
      },
    });
    const finalList = finalAdd.body.strokes || [];
    const finalS = finalList.find((s) => s.id === "live1");
    check("收笔 add 覆盖为 4 点", finalS && finalS.points.length === 4, finalAdd.body);
    check(
      "同一笔只存在一条（增量没被当成两笔）",
      finalList.filter((s) => s.id === "live1").length === 1,
      finalAdd.body
    );

    // 领读：设置 / 拒绝非成员 / 快照下发
    const lead = await postAuth(`/rooms/${r8}/leader`, {
      clientId: "c-lead",
      targetId: "c-lead",
    });
    check("设置领读 → 200", lead.status === 200 && lead.body.leaderId === "c-lead", lead.body);
    const leadBad = await postAuth(`/rooms/${r8}/leader`, {
      clientId: "c-lead",
      targetId: "nobody",
    });
    check("把非成员设为领读 → 400", leadBad.status === 400, leadBad.body);
    const snapR8 = await postAuth(`/rooms/${r8}/join`, {
      clientId: "c-other",
      name: "路人",
      bookKey: "",
    });
    check(
      "房间快照带 leaderId/leaderName",
      snapR8.status === 200 && snapR8.body.leaderId === "c-lead",
      snapR8.body
    );
    check("后来者进房不会抢走领读", snapR8.body.leaderId === "c-lead", snapR8.body);

    // room.json 保护：既不能下载，也不能删
    const metaGet = await json(`/rooms/${r8}/books/room.json/file`);
    check("GET room.json/file → 404（不再泄露房间元数据）", metaGet.status === 404, metaGet.body);
    const metaDel = await postAuth(
      `/rooms/${r8}/books/room.json`,
      { clientId: "c-lead" },
      "DELETE"
    );
    check("DELETE room.json → 404（删不掉房间元数据）", metaDel.status === 404, metaDel.body);

    child4.kill();

    // ── 9. join:false 建房也要进空房回收 ──────────────────────────────
    console.log("\n[9] join:false 空房回收");
    const child5 = spawn(NODE, [path.join(__dirname, "server.js")], {
      env: {
        ...process.env,
        COLLAB_PORT: String(PORT),
        COLLAB_HOST: "127.0.0.1",
        BOOKS_DIR: path.join(TMP, "books"),
        ROOMS_DIR: path.join(TMP, "rooms"),
        DOODLES_DIR: path.join(TMP, "doodles"),
        ROOM_DOODLES_DIR: path.join(TMP, "rooms-doodles"),
        EMPTY_ROOM_TTL_MS: "1500",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForServer();
    const orphan = await post("/rooms", {
      clientId: "c-orphan",
      roomName: "只建不进",
      join: false,
    });
    const orphanId = orphan.body.roomId;
    const before9 = await json("/rooms");
    check(
      "join:false 房间已建",
      (before9.body.rooms || []).some((r) => r.roomId === orphanId),
      before9.body
    );
    await sleep(2600);
    const after9 = await json("/rooms");
    check(
      "join:false 空房到期被回收",
      !(after9.body.rooms || []).some((r) => r.roomId === orphanId),
      after9.body
    );
    child5.kill();

    // ── 10. CORS：默认一条都不发，配了 COLLAB_ALLOWED_ORIGIN 才发指定 origin ──
    // 前端与共读服务本来同源（生产 nginx 反代 /collab/，开发 setupProxy 转发），
    // 同源请求不走 CORS —— 所以默认必须关掉，不能留通配符。
    //
    // 这一段自己管实例：先把主实例也杀掉、等端口空出来，再分别起「不配 / 配」
    // 两个实例对比。否则新实例会 EADDRINUSE 静默退出，断言其实打在旧实例上。
    // ── 11. 房间快照端点 + 同 clientId 多连接（多标签页）───────────────
    console.log("\n[11] 房间快照 + 同 clientId 多连接");
    // 上一段刚重启过实例,undici 连接池里可能压着死连接(见 headers() 注释),
    // 这一段的所有请求都走重试版
    const jsonR = async (pathname, options) => {
      let lastError = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await json(pathname, options);
        } catch (error) {
          lastError = error;
          await sleep(250);
        }
      }
      throw lastError;
    };
    const postR = (pathname, data, method = "POST") =>
      jsonR(pathname, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
    // 与其它段一致:自起一个隔离实例(前一段已把自己的实例杀掉)
    const child11 = spawn(NODE, [path.join(__dirname, "server.js")], {
      env: {
        ...process.env,
        COLLAB_PORT: String(PORT),
        COLLAB_HOST: "127.0.0.1",
        BOOKS_DIR: path.join(TMP, "books"),
        ROOMS_DIR: path.join(TMP, "rooms"),
        DOODLES_DIR: path.join(TMP, "doodles"),
        ROOM_DOODLES_DIR: path.join(TMP, "rooms-doodles"),
        EMPTY_ROOM_TTL_MS: "600000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child11.stderr.on("data", (d) => process.stderr.write("[11] " + d));
    await waitForServer();
    {
      // 11.1 GET /rooms/:id 返回快照
      const createRes = await postR("/rooms", {
        clientId: "snap-owner",
        roomName: "snap-room",
        bookKey: "book-snap",
      });
      const roomId = createRes.body.roomId;
      const snap = await jsonR(`/rooms/${roomId}`);
      check("GET /rooms/:id 返回快照", snap.status === 200, snap);
      check(
        "快照含成员/领读/书key",
        Array.isArray(snap.body.members) &&
          snap.body.members.length === 1 &&
          snap.body.leaderId === "snap-owner" &&
          snap.body.bookKey === "book-snap",
        snap.body
      );
      const missing = await jsonR("/rooms/ZZZZZZ");
      check("不存在的房间快照 → 404", missing.status === 404, missing);

      // 11.2 同一 clientId 开两条 SSE(两个标签页),广播两边都收得到;
      //      关掉其中一条,成员不掉线
      const openSSE = async () => {
        const controller = new AbortController();
        const res = await fetch(`${BASE}/events?clientId=tab-user`, {
          signal: controller.signal,
        });
        return { res, controller };
      };
      await postR("/rooms/" + roomId + "/join", {
        clientId: "tab-user",
        bookKey: "book-snap",
        name: "tab-user",
      });
      const connA = await openSSE();
      const connB = await openSSE();
      await sleep(300);
      // undici 的 body 是 WHATWG ReadableStream,用 getReader 后台收集
      const collect = async (conn, chunks) => {
        const reader = conn.res.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(Buffer.from(value).toString("utf8"));
          }
        } catch (e) {
          // abort 时不抛
        }
      };
      const chunksA = [];
      const chunksB = [];
      const pumpA = collect(connA, chunksA);
      const pumpB = collect(connB, chunksB);
      await postR("/rooms/" + roomId + "/join", {
        clientId: "another-reader",
        bookKey: "book-snap",
        name: "another",
      });
      await sleep(400);
      const textA = chunksA.join("");
      const textB = chunksB.join("");
      check(
        "同 clientId 两条 SSE 都收到广播",
        textA.includes("room-updated") && textB.includes("room-updated"),
        { textA: textA.slice(-100), textB: textB.slice(-100) }
      );
      // 关掉一条连接,成员应仍在房里(快照能查到)
      connA.controller.abort();
      await pumpA;
      await sleep(300);
      const snapAfter = await jsonR(`/rooms/${roomId}`);
      check(
        "关掉一条连接后成员不掉线",
        (snapAfter.body.members || []).some((m) => m.clientId === "tab-user"),
        snapAfter.body.members
      );
      // 全部连接关闭后才算离线
      connB.controller.abort();
      await pumpB;
      await sleep(300);
      const snapGone = await jsonR(`/rooms/${roomId}`);
      check(
        "全部连接关闭后成员被移除",
        !(snapGone.body.members || []).some((m) => m.clientId === "tab-user"),
        snapGone.body.members
      );
      await postR("/rooms/" + roomId, { clientId: "snap-owner" }, "DELETE");
    }
    child11.kill();

    console.log("\n[10] CORS 默认关闭 / 可按需开启");
    const spawnWithEnv = (extraEnv, tag) => {
      const c = spawn(NODE, [path.join(__dirname, "server.js")], {
        env: {
          ...process.env,
          COLLAB_PORT: String(PORT),
          COLLAB_HOST: "127.0.0.1",
          BOOKS_DIR: path.join(TMP, "books"),
          ROOMS_DIR: path.join(TMP, "rooms"),
          DOODLES_DIR: path.join(TMP, "doodles"),
          ROOM_DOODLES_DIR: path.join(TMP, "rooms-doodles"),
          ...extraEnv,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      c.stderr.on("data", (d) => process.stderr.write(`[${tag}] ` + d));
      return c;
    };

    try {
      child.kill();
    } catch (e) {}
    await waitForPortFree();

    // 10.1 不配 → 一条 CORS 头都不发
    const corsOff = spawnWithEnv({}, "cors-off");
    await waitForServer();
    const plain = await headers("/health");
    check(
      "默认不发送 access-control-allow-origin",
      plain.headers.get("access-control-allow-origin") === null,
      { got: plain.headers.get("access-control-allow-origin") }
    );
    corsOff.kill();
    await waitForPortFree();

    // 10.2 配多个来源（网页域名 + 打包客户端）→ 按请求 Origin 回显
    //      Electron 的 file:// 页面发出去的 Origin 是字面量 "null"，
    //      Capacitor(安卓)的页面跑在 https://localhost。
    const corsOn = spawnWithEnv(
      { COLLAB_ALLOWED_ORIGIN: "https://read.example.com, null ,https://localhost" },
      "cors-on"
    );
    await waitForServer();

    const noOrigin = await headers("/health");
    check(
      "不带 Origin 时回白名单第一项（保持老行为）",
      noOrigin.headers.get("access-control-allow-origin") ===
        "https://read.example.com",
      { got: noOrigin.headers.get("access-control-allow-origin") }
    );

    const webOrigin = await headers("/health", {
      headers: { origin: "https://read.example.com" },
    });
    check(
      "白名单内的网页来源 → 回显该 origin",
      webOrigin.headers.get("access-control-allow-origin") ===
        "https://read.example.com",
      { got: webOrigin.headers.get("access-control-allow-origin") }
    );

    const fileOrigin = await headers("/health", {
      headers: { origin: "null" },
    });
    check(
      "Electron(file://) 的 Origin: null → 放行",
      fileOrigin.headers.get("access-control-allow-origin") === "null",
      { got: fileOrigin.headers.get("access-control-allow-origin") }
    );

    const capOrigin = await headers("/health", {
      headers: { origin: "https://localhost" },
    });
    check(
      "Capacitor(安卓) 的 https://localhost → 放行",
      capOrigin.headers.get("access-control-allow-origin") ===
        "https://localhost",
      { got: capOrigin.headers.get("access-control-allow-origin") }
    );

    const evilOrigin = await headers("/health", {
      headers: { origin: "https://evil.example" },
    });
    check(
      "白名单外的来源 → 一条 CORS 头都不发",
      evilOrigin.headers.get("access-control-allow-origin") === null,
      { got: evilOrigin.headers.get("access-control-allow-origin") }
    );

    check(
      "CORS 响应带 Vary: Origin",
      /origin/i.test(fileOrigin.headers.get("vary") || ""),
      { got: fileOrigin.headers.get("vary") }
    );

    // 10.3 预检(OPTIONS)必须带 CORS 头，否则浏览器直接拦下真正的请求
    const preflight = await headers("/rooms", {
      method: "OPTIONS",
      headers: {
        origin: "null",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,x-collab-token",
      },
    });
    check(
      "OPTIONS 预检 → 204 且带 CORS 头",
      preflight.status === 204 &&
        preflight.headers.get("access-control-allow-origin") === "null" &&
        /content-type/i.test(
          preflight.headers.get("access-control-allow-headers") || ""
        ),
      {
        status: preflight.status,
        acao: preflight.headers.get("access-control-allow-origin"),
        acah: preflight.headers.get("access-control-allow-headers"),
      }
    );
    corsOn.kill();

    // ── 12. 越权 / 信息泄露回归 ─────────────────────────────────────────
    // 这一段的每一条都对应一个**实测确实能打穿**的问题（2026-09-16 探针）：
    // 非会员能往别人的房间发消息 / 拖走全房间的阅读位置 / 注入笔记 /
    // 删掉别人的笔记；/rooms 会下发成员设备 id；SSE 可匿名订阅并截获明文聊天。
    // 断言留在这里，防止哪天改回去。
    console.log("\n[12] 越权 / 信息泄露回归");
    await waitForPortFree();
    const child12 = spawnWithEnv({}, "sec");
    await waitForServer();
    {
      const owner = await postR("/rooms", {
        clientId: "sec-owner",
        name: "房主",
        roomName: "私密房",
        bookKey: "book-sec",
      });
      const secRoom = owner.body.roomId;
      await postR(`/rooms/${secRoom}/join`, {
        clientId: "sec-member",
        name: "成员",
        bookKey: "book-sec",
      });

      // 12.1 非成员写：一律 403
      const outsiderWrites = [
        ["message", { text: "我是外人" }],
        ["location", { location: { chapterDocIndex: 999 } }],
        ["notes", { note: { key: "evil", range: "[1,2]" } }],
        ["doodle", { pageKey: "p1", op: "add", stroke: { id: "x1", points: [[0, 0]] } }],
        ["leader", { targetId: "sec-owner" }],
      ];
      for (const [action, extra] of outsiderWrites) {
        const r = await postR(`/rooms/${secRoom}/${action}`, {
          clientId: "sec-outsider",
          name: "外人",
          ...extra,
        });
        check(`非成员 ${action} → 403`, r.status === 403, r);
      }
      const outsiderClose = await postR(
        `/rooms/${secRoom}`,
        { clientId: "sec-outsider" },
        "DELETE"
      );
      check("非成员解散房间 → 403", outsiderClose.status === 403, outsiderClose);

      // 非成员不能靠伪造 authorId 混进来
      const spoofAuthor = await postR(`/rooms/${secRoom}/doodle`, {
        clientId: "sec-outsider",
        authorId: "sec-member",
        pageKey: "p1",
        op: "add",
        stroke: { id: "x2", points: [[0, 0]] },
      });
      check("非成员伪造 authorId 也进不来 → 403", spoofAuthor.status === 403, spoofAuthor);

      // 12.2 笔记归属：作者由服务端盖章，改删只限作者
      const mine = await postR(`/rooms/${secRoom}/notes`, {
        clientId: "sec-member",
        name: "成员",
        note: { key: "note-mine", range: "[1,2]", authorId: "sec-owner" },
      });
      check("成员写笔记 → 201", mine.status === 201, mine);
      check(
        "笔记作者由服务端盖章（客户端自报的 authorId 被覆盖）",
        mine.body.note && mine.body.note.authorId === "sec-member",
        mine.body
      );
      const stealDelete = await postR(`/rooms/${secRoom}/note-delete`, {
        clientId: "sec-owner",
        noteKey: "note-mine",
      });
      check("房主删成员的笔记 → 403", stealDelete.status === 403, stealDelete);
      const stealUpdate = await postR(`/rooms/${secRoom}/note-update`, {
        clientId: "sec-owner",
        note: { key: "note-mine", range: "[3,4]" },
      });
      check("房主改成员的笔记 → 403", stealUpdate.status === 403, stealUpdate);
      const ownDelete = await postR(`/rooms/${secRoom}/note-delete`, {
        clientId: "sec-member",
        noteKey: "note-mine",
      });
      check("作者删自己的笔记 → 200", ownDelete.status === 200, ownDelete);
      const delMissing = await postR(`/rooms/${secRoom}/note-delete`, {
        clientId: "sec-member",
        noteKey: "not-exist",
      });
      check("删不存在的笔记保持幂等 200", delMissing.status === 200, delMissing);
      const badKey = await postR(`/rooms/${secRoom}/notes`, {
        clientId: "sec-member",
        note: { key: "../../evil", range: "[1,2]" },
      });
      check("畸形笔记 key → 400", badKey.status === 400, badKey);

      // 12.3 房间列表不下发任何 clientId
      const list = await jsonR("/rooms");
      const brief = (list.body.rooms || []).find((r) => r.roomId === secRoom) || {};
      check(
        "房间列表不含 ownerId / memberIds / leaderId",
        !("ownerId" in brief) && !("memberIds" in brief) && !("leaderId" in brief),
        brief
      );
      const serialized = JSON.stringify(brief);
      check(
        "房间列表里搜不到任何 clientId",
        !serialized.includes("sec-owner") && !serialized.includes("sec-member"),
        serialized
      );
      const asOwner = (await jsonR(`/rooms?clientId=sec-owner`)).body.rooms.find(
        (r) => r.roomId === secRoom
      );
      check("房主看到 canManage=true", asOwner && asOwner.canManage === true, asOwner);
      const asOutsider = (
        await jsonR(`/rooms?clientId=sec-outsider`)
      ).body.rooms.find((r) => r.roomId === secRoom);
      check(
        "非成员看到 canManage=false",
        asOutsider && asOutsider.canManage === false,
        asOutsider
      );

      // 12.4 clientId 必填（老实现会塞进一个 id 为 undefined 的幽灵成员）
      const noClient = await postR("/rooms", { name: "x", roomName: "y" });
      check("建房不带 clientId → 400", noClient.status === 400, noClient);
      const joinNoClient = await postR(`/rooms/${secRoom}/join`, { name: "x" });
      check("入房不带 clientId → 400", joinNoClient.status === 400, joinNoClient);
      const ghost = (await jsonR(`/rooms/${secRoom}`)).body.members || [];
      check(
        "成员表里没有 clientId 为空的幽灵成员",
        ghost.every((m) => typeof m.clientId === "string" && m.clientId),
        ghost
      );

      // 12.5 路径形状：房间 ID 只接受 A-Z0-9
      const badRoomId = await jsonR("/rooms/..%2F..%2Fpackage.json");
      check("畸形 roomId → 404（不会落到别的目录）", badRoomId.status === 404, badRoomId);
      const traverseName = await jsonR(
        `/rooms/${secRoom}/books/..%2F..%2Froom.json/file`
      );
      check(
        "畸形书名穿越 → 404（拿不到 room.json）",
        traverseName.status === 404,
        traverseName
      );

      // 12.6 资源上限：单笔点数被截断（否则一个 2MB 请求就能让同伴端卡死）
      const huge = await postR(`/rooms/${secRoom}/doodle`, {
        clientId: "sec-member",
        pageKey: "p-huge",
        op: "add",
        stroke: {
          id: "h1",
          points: Array.from({ length: 30000 }, () => [0.1, 0.1]),
        },
      });
      const hugePoints = ((huge.body.strokes || [])[0] || {}).points || [];
      check(
        "单笔点数被截到上限（防同伴端被拖死）",
        hugePoints.length === 20000,
        hugePoints.length
      );

      // 12.7 个人云涂鸦：脏点被剔除、removedIds 非数组不再当成字符遍历
      const dirty = await postR(
        "/doodles/md5-dirty",
        {
          pageKey: "p1",
          strokes: [{ id: "d1", points: [["a", "b"], [1, 2], [3], null] }],
          removedIds: "not-an-array",
        },
        "PUT"
      );
      check(
        "涂鸦点数组被归一化（脏点剔除、只留合法数字对）",
        dirty.body.strokes &&
          dirty.body.strokes[0].points.length === 1 &&
          dirty.body.strokes[0].points[0][0] === 1,
        dirty.body
      );
    }
    child12.kill();
    await waitForPortFree();
  } finally {
    try {
      child.kill();
    } catch (e) {}
    await sleep(200);
    fs.rm(TMP, { recursive: true, force: true }, () => {});
  }

  console.log(`\n===== 结果: ${passed} 通过 / ${failed} 失败 =====`);
  process.exit(failed === 0 ? 0 : 1);
})();
