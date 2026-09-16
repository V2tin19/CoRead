// 7za 转发器（Windows 打包用）
//
// ------------------------------------------------------------------
// 为什么要这个东西
// ------------------------------------------------------------------
// electron-builder 解压 winCodeSign 时会执行：
//
//     7za.exe x -snld -bd <archive>.7z -o<dir>
//
// 该压缩包里含 macOS 用的 darwin/10.12/lib/libcrypto.dylib 与 libssl.dylib
// 两个**符号链接**。在既不是管理员、又没开「开发者模式」的 Windows 账号上，
// 创建符号链接会报：
//
//     ERROR: Cannot create symbolic link : 客户端没有所需的特权
//
// 7-Zip 随后以 rc=2 退出，electron-builder 认为解压失败 → 重新下载 → 再失败，
// 无限重试直到放弃。
//
// 已验证无效的做法（别再试）：
//   - 换 7-Zip 24.09：-snld 在 21.07 和 24.09 的帮助里都查不到，两版都 rc=2。
//   - 手工预置缓存目录：缓存目录名是 URL 的哈希，每次运行都不一样
//     （880167211 / 559986591 / 562867271 …），预置了也用不上。
//   - 关掉 rcedit（signAndEditExecutable: false）：能绕过，但 exe 会丢掉
//     应用图标和版本信息，快捷方式显示成 Electron 默认图标。
//
// Windows 打包根本用不到 darwin 目录，所以这里在解压参数里补一个
// -xr!darwin 把它排除掉，其余原样转发给真正的 7za.real.exe。
//
// ------------------------------------------------------------------
// 怎么部署（node_modules 不进 git，npm ci 之后要重做）
// ------------------------------------------------------------------
//   cd tools/7za-shim
//   go build -o 7za-shim.exe .
//   copy 7za.exe -> node_modules\7zip-bin\win\x64\7za.real.exe   （原版备份，只做一次）
//   copy 7za-shim.exe -> node_modules\7zip-bin\win\x64\7za.exe
//
// 校验：
//   7za.exe x -snld -bd <winCodeSign>.7z -o<临时目录>   → rc 应为 0
package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

func main() {
	args := os.Args[1:]
	if len(args) > 0 && (args[0] == "x" || args[0] == "e") {
		args = append(args, "-xr!darwin")
	}

	self, err := os.Executable()
	if err != nil {
		self = os.Args[0]
	}
	real := filepath.Join(filepath.Dir(self), "7za.real.exe")

	cmd := exec.Command(real, args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			if ws, ok := ee.Sys().(syscall.WaitStatus); ok {
				os.Exit(ws.ExitStatus())
			}
		}
		os.Exit(1)
	}
}
