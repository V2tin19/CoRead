# CoRead 安全 / 缺陷体检报告

> 范围：网页端 + `collab-server/`（多人房间共读是核心功能，重点审这一条链）
> 方法：**实测优先** —— 每一条结论都起真实服务、打真实请求验过，不靠读代码推断。
> 复现脚本与断言已固化进 `collab-server/verify-server.js` 第 `[12]` 段。

---

## 0. 威胁模型 —— 谁会攻击，攻击的是什么

> 这一段是为了回答一个非常自然的疑问：
> **「服务器是我自己的，知道地址的都是自己人，哪来的攻击？」**

### 0.1 程序不认识「信任的人」，只认识两个标识

| 标识 | 是什么 | 服务端如何处理 |
| --- | --- | --- |
| `roomId` | 房间号，进房间的凭据 | 与房间相关的**读**接口免鉴权，认的就是它 |
| `clientId` | 存在浏览器 `localStorage` 的设备号 | **由客户端自己上报**，服务端从未验证过 |

「服务器是我私有的」是**部署事实**；「进房间的人是我信任的」是**社交事实**。
代码只执行前者，看不到后者 —— 中间的落差就是攻击面。

### 0.2 三层实际边界

| 层次 | 直觉上以为 | 代码实际 |
| --- | --- | --- |
| 服务器 | 一堵墙，里面全是自己人 | 只是个进程；可以同时住许多互不相识的房间，**服务器不是任何房间的信任边界** |
| 房间号 | 门钥匙，外人猜不到 | `Math.random()` 生成（伪随机、可预测）；且 `GET /rooms` 公开返回全部房间号 |
| 写入 | 服务端知道你是谁 | 修复前**完全不校验** `clientId` 是否属于该房间，**甚至不需要先 `join`** |

### 0.3 攻击面具体是谁

1. **同一个服务器上的其他组** —— 服务器是共用的，A 组对 B 组而言就是外人。
2. **已经不在你们中间的人** —— 退群、闹掰、换设备。房间号不会因为他离开而失效，
   而且**没有任何办法吊销**。
3. **看到过房间号的人** —— 转发出去的链接、聊天记录截图、浏览历史、借用的电脑、
   浏览器插件（`localStorage` 里就躺着 `clientId`）。
4. **把端口暴露到公网但忘了配 `COLLAB_TOKEN`** —— 默认无 token 一律放行
   （「零配置可用」的代价）。风险等级取决于 `COLLAB_HOST` 绑在哪、有没有反代。

对以上四类人都能做这四件事（**修复前实测成功，非推演**）：
往别人房间发消息 / 把全房间的阅读位置拖到任意页 / 注入笔记、删掉别人的笔记 /
往别人页面涂鸦。外加一条更隐蔽的：拿列表里明文下发的别人的 `clientId` 去订阅
`/events` SSE 流，**明文窃听**别人的聊天与翻页 —— 不写不改，不留痕迹。

### 0.4 如果你是「单组 + localhost + 配了 token」

那实际风险确实很低。修这些不是因为已经被打，而是因为两点：

- 代码在**依赖社交约定**而不强制执行规则：任何人把 URL 里的房间号换成别的，
  就什么都能干，没有任何东西拦他；
- **信任不是永久的，但权限是永久的** —— 房间号一旦给出去就收不回来。

### 0.5 修复后还剩什么

`clientId` 依然由客户端自称。本次把越权面从「全互联网」收窄到「房间内成员」，
但 `POST /rooms/:id { action: "join" }` **只校验 `clientId` 非空**（`server.js:1318`），
即：**只要拿到房间号，仍然能 `join` 进房间，然后「合法地」发言、改位置。**
要真正堵死需要登录态或房间口令 —— 属产品决策，见 §2.3。

---

## 0.6 一句话结论

共读服务端把 `clientId`（设备身份）当成了凭据，但从来没有验证过它，
而所有 GET 又是免鉴权的 —— 组合起来是：

**任何人只要知道 roomId（房间列表本来就公开），就能往别人的房间里发消息、
把全房间的人拖到任意页、注入笔记、删掉别人的笔记；再借列表里明文下发的
clientId 连上事件流，明文窃听别人的聊天与翻页。**

以上全部实测复现，现已修复。

---

## 1. 已修（本次）

### 1.1 越权写入 —— 严重

| # | 问题 | 实测结果（修复前） | 修复后 |
| --- | --- | --- | --- |
| 1 | 非成员可 `message` 别人的房间 | `201` 注入成功 | `403` |
| 2 | 非成员可 `location` 改全房间阅读位置 | `200`（可把所有人拖到任意页） | `403` |
| 3 | 非成员可 `notes` 注入笔记 | `201` | `403` |
| 4 | 非成员可 `doodle` 往别人页面画画 | `200` | `403` |
| 5 | 非成员可 `leader` 改别人房间的领读 | `200` | `403` |

**修法**：`POST /rooms/:id` 除 `join` / `leave` 外的所有动作，要求
`room.members.has(clientId)`。`clientId` 由客户端自称、无法真正认证，但这条把
攻击面从「全互联网」收窄到「房间内成员」，且不需要引入账号体系。

### 1.2 笔记归属 —— 严重

- 非成员（乃至任何知道 roomId 的人）可 `note-delete` **删掉别人发的笔记** —— 实测笔记真的被删。
- `note-update` 同样不校验作者。
- 更隐蔽的一条：服务端把客户端自报的 `note.authorId` 原样存下来，而归属判断
  正是靠 `authorId` —— 等于伪造成别人就能拿到改删权限。

**修法**：`authorId` / `authorName` 由**服务端盖章**（覆写，不信客户端自报）；
`note-update` / `note-delete` 只允许 `authorId` 匹配者操作；
`note.key` 加形状白名单（与前端 `remoteNote.ts` 一致），畸形 key 直接 `400`。
删不存在的笔记仍保持幂等 `200`。

### 1.3 身份泄露 → 实时窃听 —— 严重

链条：

```
GET /rooms                       → 明文下发 ownerId / memberIds / leaderId（全是 clientId）
   ↓ 拿到别人的 clientId
GET /events?clientId=<受害者>     → 无任何鉴权即可建 SSE 长连接
   ↓
明文收到该用户的全部事件：聊天内容、翻页位置、笔记
```

实测：攻击方**不带任何 token** 建连成功，并截获到明文聊天
（`senderName` / `text` 全在其中）。

**修法**（两道，缺一不可）：

1. `GET /rooms` 不再下发任何 clientId，改为按请求带的 `?clientId=` 算出
   `canManage` 布尔（前端只需要「这个房间我能不能解散」这一个信息）；
2. `/events` 在服务端配了 `COLLAB_TOKEN` 时必须带 token —— 走 `?token=` 查询参数
   （`EventSource` 不能带自定义请求头）。`/health` 永远放行，不挡部署探针。

> ⚠️ **部署注意**：配了 `COLLAB_TOKEN` 的服务器，客户端必须在
> 「个人中心 → 个人信息 → 共读服务器」里填上同一个 token，否则连不上事件流。

### 1.4 房间 ID 用 `Math.random()` 生成 —— 中

`roomId` 是「进房间」的唯一凭据（房间相关读接口免鉴权，认的就是它），
而 `Math.random()` **不是密码学安全的**（V8 的 xorshift128+，观测到若干输出即可推后续值）。

**修法**：改用 `crypto.randomBytes(6)` 生成固定 6 位；并给房间 ID 加形状校验
（只接受 `A-Z0-9`，长度 1~12 以兼容历史数据），路径段不再依赖 URL 库的点段解析
来顺带挡住目录穿越 —— 那是别人的实现细节在替我们兜底。

### 1.5 健壮性 / 小缺陷

| # | 问题 | 后果 | 修复 |
| --- | --- | --- | --- |
| 1 | 建房 / 入房不校验 `clientId` | 成员表里出现 `clientId` 为 `undefined` 的幽灵成员 | `400` |
| 2 | 畸形百分号编码（`%zz`）没兜住 `URIError` | 请求变成 `500` | 统一按空值处理 |
| 3 | 请求体超限时 `req.destroy()` 后仍写响应 | `ERR_STREAM_WRITE_AFTER_END` → 未捕获异常 → 拖崩进程 | `sendJson` 前置检查连接状态 |
| 4 | 单笔涂鸦点数无上限 | 一个 2MB 请求塞进「一笔几十万个点」，服务端如实推给同伴 → 对方浏览器逐点重建路径直接卡死 | 截到 20000 点/笔 |
| 5 | 涂鸦点数组不做归一化 | 脏点（字符串/非数字/短数组）原样入库，渲染端拿到垃圾 | 只留合法 `[x, y]` 数字对 |
| 6 | `removedIds` 不校验类型 | 传字符串会被当字符逐个遍历 | 非数组按空处理 |
| 7 | `location` 原样透传任意类型 | 接收端读到一堆 `undefined` | 只收对象 |
| 8 | `flushAllPendingWrites` 里 `length >= 0` 恒真 | 判断无意义（无害，但会误导后来者） | 去掉 |

### 1.6 顺带修正的既有测试

`verify-server.js` 第 `[4]` 段里的「阿明 / 小美」**从来没入过房**就直接往房间
涂鸦里写 —— 那正是漏洞本身（非成员可以随便写）。已改为先入房，并新增第 `[12]` 段
「越权 / 信息泄露回归」共 28 条断言，覆盖上述每一条。

### 1.7 记笔记丢失 —— 功能缺陷（第二轮，2026-09-16）

**现象**：选中文字 → 记笔记 → 输入内容 → 点「确认」→ 提示「未找到对应笔记」，内容全丢。

**根因**（`src/core/adapters/store/indexedDBStore.ts`）：

```ts
async saveNote(note) {
  if (note.key) { await DatabaseService.updateRecord(note, "notes"); }  // ← 永远走这里
  else          { await DatabaseService.saveRecord(note, "notes"); }
}
```

`Note` 模型的构造函数**总是** `this.key = 时间戳 + ""`（`models/Note.ts:34`），
所以「新笔记」也带着 key 进来 —— 判断永远落到 `updateRecord`，而 `updateRecord`
在记录不存在时是**静默 no-op**（web 端 `records.map(...)` 键不匹配时数组原样写回；
Electron 端 `UPDATE ... WHERE key = ?` 匹配 0 行）。整条链路：

| 步骤 | 实际发生 |
| --- | --- |
| 选中文字 → 点「记笔记」 | `noteStore.saveNote(highlight)` → **静默丢弃，库里没有这条笔记** |
| 同一步 | `rendition.createOneNote(highlight)` → **高亮照样画出来**，看上去成功 |
| 点这条高亮 | `getRecord(noteKey)` 返回 null → `componentDidMount` 里 `note.text` 抛 TypeError；async 生命周期没人接这个 promise ⇒ 只在控制台留一条 unhandled rejection，编辑器照常渲染（原文区空白） |
| 输入内容 → 点「确认」 | `getRecord` 又是 null → `toast.error("未找到对应笔记")`，输入内容丢失 |

**修复（三处）**：

1. `IndexedDBNoteStore.saveNote` / `saveBookmark` —— 判据从「key 有没有值」改成
   「**库里到底有没有这条记录**」（先 `getNote(key)` 再决定 insert / update），
   与 `doodleUtil.saveLocalDoodleBook` 原有的正确写法对齐。
2. `popupNote.componentDidMount` —— 记录缺失时不再抛 TypeError，明确提示并退出，
   不留「看着能用、点确认必报错」的假编辑器。
3. `popupNote.createNote` —— 编辑期间记录消失（同伴删除 / 另一标签页）时，用挂载时
   拿到的完整快照按**同一个 key** 补写回去（走 insert 而非 update），用户刚敲的内容不丢。

**连带修掉的第二个缺陷：range 污染（会连坐整本书）**

`getHighlightCoords()` 内部是 `rangy.saveCharacterRanges(doc.body)[0]`，
**没有选区时返回 `undefined`**，而 `JSON.stringify(undefined)` 仍是 `undefined`。
老代码直接落库 ⇒ 记录带着 `range = undefined`。之后 kookit 的 `renderHighlighters`
对整本书每条笔记做 `JSON.parse(item.range)`（**那一行没有 try 保护**）⇒ 直接抛错
⇒ **这本书所有高亮和笔记都渲染不出来**。一条坏记录连坐整本书。

已在 `popupNote.createNote` 与 `noteUtil.createHighlight` 两处加同一道校验
（`range.characterRange.start/end` 必须为数字且 `end > start`，判据与 kookit 自身一致），
不合格就提示「没有取到选中的文字」并**拒绝落库**。
顺带把 `popupNote` 里 `getCoords` 缺失时「只 `console.warn` 就 `return`」的静默失效
改成用户可见提示（PDF 双页模式会走这条）。

**同类排查**（扫过全部 `DatabaseService.updateRecord / saveRecord` 调用点）：

| 位置 | 判断方式 | 结论 |
| --- | --- | --- |
| `viewer.handleRemoteNoteCreated / Updated` | 先 `getRecord` 再选 save/update | ✅ 本来就对 |
| `collabPanel` 远端笔记落地 | 同上 | ✅ |
| `doodleUtil.saveLocalDoodleBook` | 先 `getRecord` 再选 | ✅ 本次就是照它改的 |
| `configUtil.removeTagFromNotes` | 记录先查出再 update | ✅ |
| `operationPanel` 新建书签 | 直接 `saveRecord`（insert） | ✅ |
| `editDialog` / `coverUtil` 改书 | 书已存在才 update | ✅ |
| `popupNote.createNote` 更新分支 | 有记录才 update | ✅ |
| `IndexedDBNoteStore.saveBookmark` | 与 `saveNote` 同一个 bug | ⚠️ 已一并修（当前无调用点） |

---

### 1.8 涂鸦串页 —— 「一页就是一张纸」失效（第三轮，2026-09-16）

**现象**：在某一页画完随心笔记，翻到下一页（实测是本章任何一页），刚才那一笔还在。
期望是「翻到新的一页就是空白」。

**先排除的部分**：存储层本来就是按页存的 —— `pageKey = 章节href#章内屏号`，
`switchPageIfNeeded` 换页时也确实换了 key、换了 `state.strokes`。
所以**不是「存错页」，而是「读的时候被别的页的笔迹污染了」**。

**根因：两个量单位不一致，收编窗口被放大了「全书章数」倍。**

`loadDoodlePage` 除了取「本页精确命中」的笔迹，还会做一次**跨设备模糊收编**：
拿每条笔迹自带的 `percentage` 与「本页页首的 `percentage`」比，差值落在 ±半个窗口内
就一并展示（用于同伴那台设备分页数不同时也能看见他的笔迹）。两个量的单位本该一致：

| 量 | 来源 | 单位 |
| --- | --- | --- |
| `percentage`（每条笔迹存着） | `handleRecord`：章前 size 之和 / 全书 size + 本章 size/全书 size × 章内比例 | **全书**百分比 |
| `span`（收编窗口） | `getDoodlePageSpan` 旧实现：`屏数 / getProgress().totalPage` | 分母是**本章**屏数 |

而 `getProgress().totalPage` 并不是全书页数：CoRead 从不给渲染内核传
`isShowTotalPage`，kookit 里它默认 `"no"`，该分支的 `totalPage` 来自
`progressInfo(readerMode, doc, element)`，算的是**当前这一章**的屏数
（`doc.body.scrollWidth / (doc.body.clientWidth + gap)`）。

于是 `span_old = 1 / 本章屏数` 去和「全书百分比」相比 —— 差了「全书章数」这个量级：

| 模型 | `span_old` | 收编半窗口（×0.52） | 一章实际占全书 |
| --- | --- | --- | --- |
| 30 章 × 5 屏/章（单页模式） | 0.200 | ±10.4% | 3.3% |

窗口比整章还宽 3 倍，**本章每一页都会把整章的笔迹收进来**。章数越多越离谱（误差 ≈ 全书章数倍），
所以看起来就像「涂鸦跟着我走」。

**修复**（`src/utils/file/doodleUtil.ts`）：

1. 新增 `getDoodleChapterShare(rendition)`：用 `getChapterDoc()` 加**与 `handleRecord` 完全相同**
   的 size 兜底公式（`item.text ? item.text.size || 1 : 1`）算「本章占全书比例」。
   （不能用 `getChapterSizes()` —— 它的兜底是 `item.text.length`，拿不到 `size` 时分母口径不一致。）
2. `getDoodlePageSpan` 改为 `屏数 × 本章占比 / 本章屏数`，即真正的「一屏占全书多少」。
3. 拿不到章节占比时返回 **0**（= 关闭模糊收编）。宁可少认（最多看不到同伴跨设备笔迹），
   也不能乱认（串页会直接毁掉「一页一张纸」的体感）。
4. 顺带把「本地 + 云端按页取并集」抽成 `mergeLocalAndCloud()`，给导出功能复用。

**没有动的部分**（本来就对）：`pageKey` 的算法、`switchPageIfNeeded` 的两拍换页时序、
落盘/撤销/清空里对「仅展示」笔迹（`displayOnlyIds`）的剔除。
注意：**模糊收编进来的笔迹从来不落盘**，所以这是显示层的 bug，用户已存的笔迹数据没有被污染，
修复后直接生效、不需要清理旧数据。

**验证**（用 TypeScript 编译器把**仓库里真实的** `doodleUtil.ts` 转成 JS、给 4 个依赖打桩后在 node 里跑，
不是拿复刻函数对拍）：

| 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| `getDoodleChapterShare` | — | `0.03333`（= 1/30，模型期望值） |
| `getDoodlePageSpan` | `0.200` | `0.006667` |
| 同设备：第 7 章第 1 屏画一笔，逐屏检查「本来不属于本屏却显示了」的笔迹数 | **8 次**（第 1 屏显示第 5 屏的、第 2~4 屏显示两笔、第 5 屏显示第 1 屏的） | **0 次** |
| 跨设备：同伴（每章 8 屏）落在第 1 屏中部的一笔，会被收到本机哪几屏 | 第 `[1,2,3,4,5]` 屏（等于整章） | 第 `[1]` 屏 ✅ 功能没被砍掉 |

---

### 1.9 附带新增：随心笔记导出窗口（2026-09-16）

三个出口，都在涂鸦工具条的「导出」按钮里，**纯只读**（不改任何存储、不上传）：

| 出口 | 说明 |
| --- | --- |
| 当前页 · PNG（透明底） | 只导出笔迹，直接叠在截图 / PDF 上就是「带笔记的那一页」 |
| 当前页 · PNG（带底色） | 按当前阅读背景（浅色纸 / 深色纸）铺底，出来就是一张能直接发出去的图 |
| 当前页 · SVG（矢量） | 笔迹是 `<polyline>` 路径，放大不糊、可再编辑 |
| 全书 · JSON | 按页分组的原始数据（本地 + 云端合并去重），用于备份 / 排查 |

实现要点：
- 导出用的离屏画布尺寸 = 屏幕上那块书页的像素尺寸 × dpr，且与屏幕共用同一段
  绘制函数（`paintStrokes`）与 `getFitBox` 换算 ⇒ **导出所见即所得**，不是另写一套。
- 「书页正文 + 涂鸦」的合成图**没做**：涂鸦在独立 canvas 上，canvas 读不到 iframe 里的正文，
  项目里也没有 html2canvas 这类库。所以给的是「笔迹 + 可选底色」，透明底那张可以自己叠。
- 弹窗独立成层（挂组件根节点，不在 `.doodle-toolbar-layer` 里）：
  父元素一旦有自己的 z-index 就生成层叠上下文，子元素的 z-index 出不去，会被阅读器其它浮层盖住。

---

## 2. 未修 · 需要你决策

### 2.1 个人云涂鸦没有用户维度 —— 优先级最高

`GET|PUT /doodles/<bookKey>`，其中 `bookKey` 是**书的内容 md5**，请求里
**没有任何用户标识**。后果（已实测）：

- 同一本书的所有人的笔迹混在同一份数据里；
- 无身份的第三方读同一本书 → 能读到别人的私人笔迹；
- 第三方删同一 key → 能把别人的笔迹真的清空。

这是设计层面缺了「这是谁的笔记」，不是某行代码写错。修法需要引入用户/设备身份，
例如：

```text
/doodles/<spaceKey>/<bookKey>      spaceKey = 用户自填的「笔记空间码」（服务端共享口令），
                                   或 clientId + 服务端口令
```

牵动服务端存储布局、前端 `doodleUtil.ts` 的读写、以及历史数据迁移，
属产品决策，需要你拍板方案后再动。

### 2.2 GET 读取面仍然免鉴权

以下端点不需要 token 即可读取：

| 端点 | 暴露内容 |
| --- | --- |
| `GET /rooms/:id` | 房间快照：**聊天记录**、成员 clientId、领读、当前页 |
| `GET /rooms/:id/doodle` | 房间共享笔迹（含每笔的作者 id） |
| `GET /doodles/:key` | 个人云笔迹（见 2.1） |
| `GET /books`、`GET /books/:name` | 共享书库的文件枚举与下载 |

**现状缓解**：窃听链已断（`/events` 要 token，且 clientId 不再从列表泄露）。

**要彻底关掉**需要给 GET 也加鉴权。代价是牵动 5 处前端 URL 拼装（书籍下载、
封面 `<img src>`、房间列表、涂鸦拉取、房间书架），且跨域场景下带自定义头会多一次
`OPTIONS` 预检 —— 必须同时保证 `COLLAB_ALLOWED_ORIGIN` 配全。建议单独立项，
和 2.1 一起做。

### 2.3 `clientId` 没有认证 —— 固有边界

同一房间内的成员之间可以互相冒名（伪造 `senderId` / 昵称发消息）。
这是「没有账号体系」的固有代价。本次把攻击面从「全互联网」收窄到「房间内成员」，
再往上就需要真正的登录态。

### 2.4 房间聊天与房间笔记只存在内存

房间元数据与共享涂鸦都落盘，但 `messages` / `notes` 只在内存 →
服务重启后聊天记录与房间笔记丢失。是否符合预期请你判断（涂鸦刻意做了持久化，
这两者没做，行为不一致）。

### 2.5 已知项（沿用）

- `MAX_EMPTY_ROOMS` 驱逐时，**有书 或 有笔迹**的空房永不驱逐 → `rooms` 内存只涨不落。
  房间数很多时才需要在意；「卸内存留磁盘、有人进房再加载」的休眠态是独立改动。
- Electron / 安卓打包端是跨域，必须把客户端来源写进 `COLLAB_ALLOWED_ORIGIN`
  （`null,https://localhost,http://localhost`）。

---

## 3. 验证记录

### 3.1 第一轮 · 共读服务端加固

| 项 | 结果 |
| --- | --- |
| `node collab-server/verify-server.js` | **117 通过 / 0 失败**（原 89 + 新增 28 条安全回归） |
| `tsc --noEmit` | 0 错误 |
| 生产构建（`BUILD_PATH` 到独立目录） | `Compiled successfully`，267 个产物文件 |
| 产物泄露扫描 | `17390` 命中 0；无测试 token 残留 |
| 攻击探针复测 | 越权写全部 `403`，列表不再含 clientId，SSE 未授权 `401` |
| 路径穿越复测 | `%2e%2e` / `..%2F` / 畸形房间 ID 全部 `404`（修复前也是 404，但那是 URL 库兜的，现已自己拦） |

### 3.2 第二轮 · 笔记功能修复

| 项 | 结果 |
| --- | --- |
| 缺陷机制复现（node 逐行复刻 `databaseService` web 分支语义 + 新旧 `saveNote`） | 修复前：写入后记录数 **0**、按 key 取回 **null**、点确认 → 「未找到对应笔记」；修复后：记录数 **1**、**命中** |
| `tsc --noEmit` | 0 错误 |
| 生产构建（`BUILD_PATH` 到独立目录） | `Compiled successfully`，EXIT=0 |
| `npm run scan` | 仓库内 0 命中 |

> ⚠️ 第二轮是**语义级复现**（把 `databaseService` 的 web 分支逻辑逐行照搬进 node 脚本，
> 证明「带 key 的新记录会被 `updateRecord` 静默丢弃」），**不是**在浏览器里完整点一遍。
> 真机走一次「选中文字 → 记笔记 → 输入 → 确认」仍建议人工确认（本机截不了图）。

### 3.3 第三轮 · 涂鸦按页隔离 + 导出窗口

| 项 | 结果 |
| --- | --- |
| 根因验证（用 `typescript` 把**真实** `doodleUtil.ts` 转成 JS、4 个依赖打桩后在 node 里直接调） | `getDoodleChapterShare` = `0.03333`（模型期望 1/30）；`getDoodlePageSpan` = `0.006667`（旧实现 `0.200`） |
| 同设备串页复现（第 7 章第 1 屏画一笔，逐屏统计「不属于本屏却显示了」） | 修复前 **8 次** → 修复后 **0 次** |
| 跨设备收编回归（同伴每章 8 屏、笔迹落在第 1 屏中部） | 修复前收到 `[1,2,3,4,5]` 屏 → 修复后只收到 `[1]` 屏（功能保留） |
| `tsc --noEmit` | 0 错误 |
| 生产构建（`BUILD_PATH` 到独立目录） | EXIT=0，产物 `main.75144bb4.js` + `main.026b03e1.css`（warning 只有既有的 `chardet` source-map 噪音，不涉及本次改动文件） |
| `npm run scan` | 仓库内 0 命中（EXIT=0） |

> ⚠️ 同样是**语义级 + 真源码级**验证，不是在浏览器里点一遍。导出窗口的下载行为
> （`file-saver` 落盘）与 PNG/SVG 的实际观感建议人工走一次：
> 打开一本书 → 随心笔记 → 「导出」→ 依次点四个出口，看文件是否落到下载目录、图片对不对。

