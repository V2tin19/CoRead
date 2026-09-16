import { isElectron } from "react-device-detect";

/**
 * 平台与存储策略（桌面端 / 网页端共用）
 * ============================================================
 * 背景：本 fork 已经从「Koodo Reader 桌面版」裁剪成「网页端」，
 * 删掉了 `main` / `build` / 闭源 `kookit-extra`，也没有 better-sqlite3。
 * 所以桌面版重新加上 Electron 外壳时，**不能**再指望主进程里那套
 * 原生 SQLite（`database-command` / `custom-database-command`）。
 *
 * 于是把「平台」和「数据放哪」拆成两个概念：
 *
 * - `isElectron`（来自 react-device-detect，看 UA 里有没有 Electron）
 *   决定**文件**走哪条路：桌面端用原生 fs 读写图书、封面、备份；
 *   网页端用 File System Access API / IndexedDB。
 *   这条**保持原样**，桌面端要继续走原生分支，否则书不会落到磁盘上。
 *
 * - `isElectronStorage`
 *   决定**配置 / 笔记 / 高亮 / 书架记录**放哪。桌面端一律 `false`，
 *   也就是走 IndexedDB（localforage），不碰主进程 SQLite。
 *
 * ⚠️ 改动约定：凡是「数据层」文件（databaseService / configUtil /
 * bookUtil 里的 SQL 分支）判断存储位置时，用 `isElectronStorage`，
 * 不要用 `isElectron`。文件层继续用 `isElectron`。
 */
export const isElectronStorage = false;

export { isElectron };
