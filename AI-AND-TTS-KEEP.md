# AI 问书 / 听书：哪些**必须保留**，哪些可以删

> 配套文档：[`REFACTOR-BRIEF.md`](./REFACTOR-BRIEF.md)（重构总纲）。
> 本文档回答一个问题：**砍掉「会员登录体系」时，AI 与语音里那些"免费 / 用户自配置"的能力怎么留下来。**
>
> 结论先说：**这些能力不是"需要我们析取出来的"，它们本来就已经在代码里，而且很多还是主路径。**
> 真正的风险不是"留不下来"，而是**删多了**。第 3 节列出的三条尤其容易误删。

---

## 1. 先说三个改变判断的事实（实测）

### 事实 1：翻译 / 词典 / 问书 三个弹窗都是**双分支**结构

每个弹窗都是 `if (用户配置了自己的模型) → 直连；else → 走上游`：

| 弹窗 | 用户模型分支（**保留**） | 上游分支（**删除**） |
| --- | --- | --- |
| AI 问书 `components/popups/popupAssist/` | `chatStream(...)`（`component.tsx:273`） | `getAnswerStream(...)`（`:332`） |
| 翻译 `components/popups/popupTrans/` | `chatStream(...)`（`:152`） | `getTransStream(...)`（`:193`） |
| 词典 `components/popups/popupDict/` | `chatStream(...)`（`:148`） | `getDictionaryStream(...)`（`:274`） |

⇒ **删掉上游分支不会让这三个功能消失**，只是失去"没配模型时也能用"的默认额度。

### 事实 2：`settings/aiSetting/` 已经是一个完整的"自带模型"设置页

`src/containers/settings/aiSetting/`（`component.tsx` 约 750 行）已经具备：

- **模型接入**：`endpoint` + `modelId` + `apiKey` + `modelName` + `providerId`（`interface.tsx` 的 `AIModelConfig`）
- **连通性测试**与**拉取模型列表**（`modelsEndpoint`）
- **分场景指定模型**：`aiTranslateModel` / `aiDictModel` / `aiAssistanceModel`
- **自定义提示词**：`aiTranslatePrompt` / `aiDictPrompt` / `aiAssistancePrompt`

其中 `getSplitSentence` 之外的一切都**不需要上游**——它直连用户自己填的 endpoint。

### 事实 3：上游内置的供应商表里，**本地模型和国产开源模型都已在列**

`AiProviderList`（数据表，**目前来自黑盒 `KookitConfig`**）实测包含：

| 类别 | 供应商 |
| --- | --- |
| 本地 | **Ollama**（`localhost:11434/v1`）、**LM Studio**（`localhost:1234/v1`）、**vLLM**（`localhost:8000/v1`） |
| 国际 | OpenAI、Anthropic、Google Gemini、Mistral、Azure OpenAI、AWS Bedrock |
| 国内 | DeepSeek、StepFun（阶跃星辰）、Lingyiwanwu（零一万物）、SiliconFlow（硅基流动）、Infini（无问芯穹） |
| 兜底 | `custom`（自定义 endpoint） |

⇒ 用户**不需要联网到我们或上游**，填自己的 Key 或指向本机 Ollama 就能用。
这张表只是一条数组常量，**照着重建即可，重写成本几乎为零**。

---

## 2. 听书（TTS）：**内置语音是免费的，而且已经是默认引擎**

`src/components/textToSpeech/component.tsx` 的语音来源是两段拼接：

```ts
this.nativeVoices = await setSpeech();          // window.speechSynthesis.getVoices()
                                                // 每一项 plugin = "system"
if (isElectron) {
  this.customVoices = TTSUtil.getVoiceList(this.props.plugins);
} else {
  this.customVoices = getAllVoices(
    this.props.plugins.filter((i) => i.key === "official-ai-voice-plugin")
  );
}
this.voices = [...this.nativeVoices, ...this.customVoices];
```

| 语音来源 | 是什么 | 处置 |
| --- | --- | --- |
| **`nativeVoices`（系统语音）** | Web Speech API ⇒ Windows 走 SAPI、安卓走系统 TTS 引擎。**完全离线、免费、无配额** | ✅ **保留**，且应作为默认引擎（`voiceEngine = "system"` 已经是默认） |
| `customVoices`：`official-ai-voice-plugin` | 上游插件市场分发的 AI 语音 | 🔴 删（同时要删插件市场 `getPluginList`） |
| `customVoices`：`TTSUtil.getVoiceList`（Electron） | 黑盒 `TTSUtil` + 插件，桌面端本地 TTS 引擎 | 🟡 黑盒那部分要自写（见 brief 6.4）；能自写就不要它 |
| 多角色朗读（旁白/男/女/童） | **角色识别**依赖上游 `getSplitSentence`（`component.tsx:604`，仅在 multi-role 分支调用） | 🟡 **有替代方案，见下** |

**多角色朗读的替代方案**：角色识别本质就是"把一段文本按句标注角色"。
既然项目已经有"用户自带模型"的 `chatStream`，**直接改成"用用户配置的模型来标注角色"**即可
（提示词可以放在设置页里让用户自己改，复用 `aiSetting` 的模式）。
这样多角色朗读变成"配了模型就能用的高级功能"，而不是"必须依赖上游"。

> ⚠️ 注意 `multiRoleVoiceType` 本身就支持 `"system"` ⇒ **角色识别与语音引擎是两件独立的事**，
> 别把"用系统语音"和"需要上游"绑在一起。

---

## 3. ⚠️ 三条最容易删错的地方（**必须逐函数判定，不许整目录删**）

原计划里写的是「整个 `src/utils/request/` 目录删除」——**这个指令是错的**，
`common.ts` 是一个**混装文件**：它既装着上游域名，也装着"用户自带模型"的直连能力。逐函数判定如下。

### 3.1 `src/utils/request/common.ts`（234 行）—— 拆分，不能整体删

| 函数 | 判定 | 理由 |
| --- | --- | --- |
| `chatStream` | ✅ **必留** | **AI 问书 / 翻译 / 词典的唯一可用主路径**（直连用户 endpoint + apiKey，SSE 流式）。删了这三个功能全废 |
| `uploadFile` | ✅ 留 | 通用 `PUT` 上传，与上游无关（房间书架/网盘用） |
| `parseWithSystemOCR` | ✅ 留（Electron） | **本地免费 OCR**：`ipcRenderer.invoke("system-ocr")`，走操作系统 OCR。⚠️ 对应的主进程 handler 在 `main.js`（不在本副本） |
| `getPublicUrl` / `checkDeveloperUpdate` / `checkStableUpdate` | 🔴 删 | 上游更新通道（`api.koodoreader.com`） |
| `getPluginList` | 🔴 删 | **上游插件市场**（顺带干掉上面那两个 `customVoices` 的来源） |
| `getNotification` | 🔴 删 | 上报**设备指纹** `TokenService.getFingerprint()` |
| `parseWithMineruAgent` | 🔴 删 | 第三方服务 `mineru.net` |
| `handleExitApp` / `handleClearToken` | 🔴 删 | 账号 token 体系（`TokenService`） |

迁移建议：把留下的三个函数搬到 `src/core/adapters/ai/`（或 `utils/ai/`），
`getDisableThinkingParams` 换成我们自己的实现（见 3.3）。

### 3.2 `src/utils/request/reader.ts`（约 350 行）—— 整体删，但要**先接掉三个调用点**

它是 `ReaderRequest`（上游 Cloudflare Worker 客户端）的包装：
`getTransStream` / `getAnswerStream` / `getDictionaryStream` / `getDictionary` / `getDictText` /
`getOcrResult(V2)` / `getTTSAudio` / `getBatchTrans` / `getWordDefinitions` / `getBookMetadata` /
`getSplitSentence` / `detectLanguage` —— **全部删除**。

但删之前要处理这三个调用点（否则连锁编译失败）：

| 调用点 | 现状 | 处置 |
| --- | --- | --- |
| `components/popups/*/component.tsx` | 上游分支（`else` 那一半） | 直接删掉 `else` 分支；**用户在设置页没配模型时，给出明确提示**（"请先在设置里配置 AI 模型"），不要静默失败 |
| `utils/reader/ttsUtil.ts:241`（`getTTSAudio`） | 上游 AI 语音 | 删除该分支，只保留 `speechSynthesis` 路径 |
| `components/textToSpeech/component.tsx:604`（`getSplitSentence`） | 多角色角色识别 | 换成"用户自带模型"实现（见第 2 节），或先下线多角色并保留入口提示 |

### 3.3 必须一起自写的小东西

| 符号 | 来源 | 自写成本 |
| --- | --- | --- |
| `KookitConfig.AiProviderList` | 黑盒 | 极低：第 1 节那张表照抄成数组 |
| `KookitConfig.DefaultPrompts` | 黑盒 | 低：三个默认提示词（翻译/词典/问书） |
| `CommonTool.getDisableThinkingParams(providerId)` | 黑盒 | 低：按供应商返回"关闭思考"的参数（如某些模型要 `enable_thinking: false`），认不出来的返回 `{}` |

---

## 4. 给重构的动作清单（可直接排进 Phase 1 / Phase 5）

**Phase 1（切断期，允许暂时少功能）**

1. `src/utils/request/` 按 3.1 / 3.2 **逐函数**处理（**不要 `rm -rf` 整个目录**）。
2. 删上游分支后，把"没配模型"的兜底从"静默失败"改成**明确提示 + 一键去设置页**。
3. 删插件市场后，TTS 的 `customVoices` 相关代码一并清理（`official-ai-voice-plugin`）。
4. 把 `AiProviderList` / `DefaultPrompts` / `getDisableThinkingParams` 自写成我们自己的常量与工具。

**Phase 5（功能补齐期）**

5. 把 `aiSetting` 的入口**放到显眼位置**（现在藏在「设置 → AI」里，
   而这套东西是**产品差异点**：用户自己带模型，不花钱、不上传数据到我们或上游）。
6. 给"多角色朗读"接上用户模型（角色标注），并在设置页暴露提示词。
7. 可选：`parseWithSystemOCR` 在 Windows 端接出来当"免费本地 OCR"入口；安卓端无此能力，入口按形态隐藏。

> **一句话原则**：AI 与语音的"免费/可自配"能力，本来就建立在
> **"用户自己的模型 / 操作系统自带的能力"** 之上，与会员体系无关。
> 我们要做的是**把上游那半删干净，把这半留好并露出入口**，而不是重新实现。
