; ============================================================
; CoRead Windows 安装包自定义钩子（electron-builder NSIS）
; ============================================================
; 这里只做两件与「装得干净」有关的事，安装向导本身保持标准 NSIS 流程：
; 可自选目录、一路下一步装完，中间**不弹任何自定义提示、不中止**。
;   1) customInstall   装之前把正在运行的 CoRead 关掉，避免文件被占用导致替换失败
;   2) customUnInstall 问一句要不要连用户数据（%APPDATA%\CoRead）一起删，默认不删
;
; ⚠️ 2026-09-16：原来那套「安装路径防呆」已按要求整体删除。
;    删掉的是：customInit 发现 $INSTDIR 是源码仓库就改回默认目录、
;    customInstall / customUnInstall 发现 package.json + .gitignore 就 Abort。
;    它保护的场景是：应用被装进源码仓库 → NSIS 卸载执行 RMDir /r "$INSTDIR"
;    → 整个仓库（含 .git、几万个 node_modules 文件）被一起删掉（曾经真发生过）。
;    删掉之后这条风险重新存在 ⇒ 安装时自己看准目录，别装进任何源码目录。
; ============================================================

!macro customInit
!macroend

!macro customInstall
  ; 装前先关掉正在运行的 CoRead，避免文件占用导致替换失败
  nsExec::ExecToLog 'taskkill /f /im "CoRead.exe"'
  ; 等系统把文件句柄释放掉
  Sleep 2000
!macroend

!macro customUnInstall
  ; 询问是否连「书 / 笔记 / 高亮 / 配置」一起删掉。
  ; 只删 userData（%APPDATA%\CoRead），不碰安装目录之外的任何地方。
  MessageBox MB_YESNO "要一并删除你的全部数据吗？（书、笔记、高亮、书签、配置）" /SD IDNO IDNO SkipRemoval
    SetShellVarContext current
    RMDir /r "$APPDATA\CoRead"
  SkipRemoval:
!macroend
