# 安卓端（Capacitor）

> 配套：[`DESKTOP.md`](./DESKTOP.md)（Electron 桌面端）、[`MOBILE-UX-PLAN.md`](./MOBILE-UX-PLAN.md)（移动端交互方向）。
> 本文件只讲**打包**；**Web 层的移动端适配不在本文范围**。

## 0. 一句话说清形态

桌面端和安卓端是**并列的两层壳**，共用**同一份 `build/` 产物**：

```
npm run build  →  build/   ┬→ Electron 打包收 build/**/*（Windows 客户端）
                           └→ Capacitor 的 webDir 收 build/（安卓 APK）
```

⚠️ **不要改构建流程与输出目录**。两条打包链同时依赖 `react-scripts build` 落在 `build/`，
改了会两处一起返工。同理，前端**不许用 Node API、不许新增原生模块依赖**（安卓没有 Node）。

## 1. 壳的来历（重要，别被"遗留代码"吓到）

`android/` 不是从上游抄来的，也**没有**任何重构前遗留物。实测结论：

- **上游 `koodo-reader/koodo-reader` 从来没有公开过安卓工程**，而且它的官方安卓端
  **不是 Capacitor，是 React Native + Expo**（拆官方 `Koodo-Reader-2.4.4-arm64.apk` 得出：
  `assets/index.android.bundle` + `libhermes.so` + `libexpo-*.so`，包名 `com.koodoreader.expo`，
  带原生 pdfium/ffmpeg 与 Google Play 内购）。⇒ **上游那条路抄不到**，它是另一套技术栈的独立工程。
- 本仓库的 `android/` 源自 Turead 时代用 **Capacitor 8.4.1 官方模板** 生成的工程，
  与官方模板（`node_modules/@capacitor/cli/assets/android-template.tar.gz`）逐文件比对后：
  **20 个文本文件完全一致，真正人改的只有 3 处**——
  1. `app/build.gradle` 的 `applicationId` / `namespace`
  2. `AndroidManifest.xml` 加 `android:usesCleartextTraffic="true"`
  3. `ic_launcher_background.xml` 的 `#FFFFFF` → `#09090B`
- **零原生插件**：`app/capacitor.build.gradle` 的 `dependencies {}` 是空的；
  `MainActivity.java` 全文只有 `class MainActivity extends BridgeActivity {}`；
  `AndroidManifest.xml` 只申请 `INTERNET` 一个权限。
- 模板自带的两个测试文件（包名 `com.getcapacitor.myapp`、硬编码断言 `com.getcapacitor.app`）
  已删除。

## 2. 为什么 `allowMixedContent` + `usesCleartextTraffic` 是必要的

这两处"放宽"**不是技术债**，是私网共读的前提：

| 角色 | 地址 |
| --- | --- |
| 安卓端页面 origin | `https://localhost`（Capacitor 8 的 `androidScheme` 默认 `https`） |
| 共读服务器 | `http://<私网IP>:17390` |

https 页面请求 http 资源 = **mixed content**，WebView 默认拦截。所以要同时开：

- `capacitor.config.ts` → `android.allowMixedContent: true`
- `AndroidManifest.xml` → `android:usesCleartextTraffic="true"`

⚠️ 日后共读若改走 HTTPS，**这两处要一起收窄**。另外服务端 CORS 白名单
（环境变量 `COLLAB_ALLOWED_ORIGIN`，名字单数但支持多值）应包含：
`null,https://localhost,http://localhost,capacitor://localhost`。

## 3. 环境要求

| 项 | 要求 |
| --- | --- |
| Node.js | 20+ |
| JDK | **21**（`app/capacitor.build.gradle` 明确要 `JavaVersion.VERSION_21`） |
| Android SDK | 通过 Android Studio 安装 |
| 编译版本 | `compileSdk` / `targetSdk` = 36，`minSdk` = 24（见 `android/variables.gradle`） |

**本机已配齐**（2026-09-17）：

| 项 | 落点 |
| --- | --- |
| JDK 21 | Temurin 21 LTS，已设为**用户级** `JAVA_HOME`（系统自带的是 25，Gradle 8.14.3 不认） |
| Android SDK | `cmdline-tools/latest` + `platform-tools` + `platforms;android-36` + `build-tools;36.0.0`，已设为**用户级** `ANDROID_HOME` |
| SDK 定位 | `android/local.properties` 的 `sdk.dir`（该文件在 `.gitignore` 里，不入库） |

⚠️ `java -version` 与 Gradle 实际用的 JDK **不是一回事**：Gradle 读的是 `JAVA_HOME`。
命令行里手工指定时形如 `JAVA_HOME=<jdk21 路径> ./gradlew.bat assembleDebug`。

首次全量构建实测约 **5 分钟**（含下载 Gradle 发行包与 Maven 依赖），增量约 1.5 分钟。

## 4. 命令

```bash
npm install --legacy-peer-deps     # react-scripts 5 要 typescript ^4，必须加这个参数

npm run android:sync               # = npm run build && npx cap sync android
npm run android:open               # 用 Android Studio 打开 android/
npm run android:build:debug        # = android:sync && cd android && gradlew.bat assembleDebug
```

产物：`android/app/build/outputs/apk/debug/app-debug.apk`

⚠️ **首次 Gradle 要下载 `gradle-8.14.3-all.zip`，网络超时是已知坑**。
兜底：挂代理重试，或用 Android Studio 打开 `android/` 让它完成 Gradle sync。

## 5. 生成物与 git

**会被提交**：`android/` 下的源码与资源（约 51 个文件）—— Gradle 脚本、`MainActivity.java`、
manifest、图标 mipmap、splash。

**不会**（`android/.gitignore` 已忽略）：`app/src/main/assets/public`（cap sync 拷进来的 web 产物）、
`app/src/main/assets/capacitor.config.json`、`build/`、`.gradle/`、`capacitor-cordova-android-plugins/`、
`local.properties`。签名文件由根目录 `.gitignore` 的 `*.keystore` / `*.jks` 兜住。

## 6. 当前状态与已知限制

**已就绪**：壳已换牌为 `com.coread.app` / `CoRead`，`npx cap sync android` rc=0，
web 产物（271 文件 / 32.25 MB）能正确拷入。

**未做**：

- **Web 层的移动端适配还没开始** —— 现在套上壳能**跑**，但手机尺寸下**不好用**。
  前置是 `isMobile` 开关（6 处仍写死 `"no"`）与内核 `console` 劫持的处理，
  见 `MOBILE-UX-PLAN.md` 第 1 节。**建议先做这步，再折腾出包。**
- 真机验收未做（触摸惯性、返回键与菜单抢事件、刘海遮挡、IndexedDB 是否被系统回收）。

**限制（套壳路线固有）**：

- 大书 / 扫描版 PDF 渲染比原生慢（我们用 pdf.js + wasm，不是原生 pdfium）
- 后台音频与锁屏控制需要额外插件
- 文件导入与存储受 WebView 限制（`showDirectoryPicker` 在安卓 WebView 不存在，
  "本地文件夹"功能会静默降级）
- 桌面端 Electron 专有功能在安卓上不可用
- 共读需要一台**公网可达**的服务器

## 7. 版本号约定

`android/app/build.gradle` 里 `versionName` 跟 `package.json` 的 `version` 对齐（当前 `2.3.9`），
`versionCode` 是整数且**必须单调递增**。首次分发前确认两者，**`applicationId` 一旦分发就不可更改**。
