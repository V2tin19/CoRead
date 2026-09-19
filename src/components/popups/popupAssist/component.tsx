import React from "react";
import "./popupAssist.css";
import { PopupAssistProps, PopupAssistState, AiChatMessage } from "./interface";
import { ConfigService } from '../../../services';
import { DefaultPrompts, AiProviderList } from "../../../constants/aiConfig";
import Parser from "html-react-parser";
import DOMPurify from "dompurify";
import { Trans } from "react-i18next";
import { handleContextMenu } from "../../../utils/common";
import toast from "react-hot-toast";
import { saveAs } from "file-saver";
import { chatStream } from "../../../utils/request/common";
import { marked } from "marked";
import { sampleQuestion } from "../../../constants/settingList";
class PopupAssist extends React.Component<PopupAssistProps, PopupAssistState> {
  chatBoxRef: React.RefObject<HTMLDivElement>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  answerTextAccumulator: string = "";
  updateInterval: ReturnType<typeof setInterval> | null = null;
  isHydrating = false;

  constructor(props: PopupAssistProps) {
    super(props);
    this.state = {
      answer: "",
      aiService: ConfigService.getReaderConfig("aiService") || "",
      isAddNew: false,
      isWaiting: false,
      question: "",
      chatHistory: [],
      askHistory: [],
      mode: "ask",
      inputQuestion: "",
      isConfiguring: false,
      configProvider: "deepseek",
      configEndpoint: "https://api.deepseek.com/v1",
      configApiKey: "",
      configModelId: "deepseek-chat",
      isTesting: false,
    };
    this.chatBoxRef = React.createRef();
    this.textareaRef = React.createRef();
  }

  MAX_HISTORY_LENGTH = 50;

  AI_ASK_HISTORY_KEY = "aiAskHistory";
  AI_CHAT_HISTORY_KEY = "aiChatHistory";

  HISTORY_KEY_BY_MODE: Record<string, string> = {
    ask: this.AI_ASK_HISTORY_KEY,
    chat: this.AI_CHAT_HISTORY_KEY,
  };

  loadHistory = (bookKey: string, mode: "ask" | "chat"): AiChatMessage[] => {
    if (!bookKey) {
      return [];
    }
    const key = this.HISTORY_KEY_BY_MODE[mode];
    return ConfigService.getObjectConfig(bookKey, key, []);
  };

  saveHistory = (
    bookKey: string,
    mode: "ask" | "chat",
    messages: AiChatMessage[]
  ): void => {
    if (!bookKey) {
      return;
    }
    const key = this.HISTORY_KEY_BY_MODE[mode];
    const trimmed =
      messages.length <= this.MAX_HISTORY_LENGTH
        ? messages
        : messages.slice(messages.length - this.MAX_HISTORY_LENGTH);
    ConfigService.setObjectConfig(bookKey, trimmed, key);
  };

  startUpdateInterval() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    this.updateInterval = setInterval(() => {
      if (this.answerTextAccumulator) {
        this.setState({ answer: this.answerTextAccumulator });
        if (ConfigService.getReaderConfig("isManualScroll") !== "yes") {
          this.scrollToBottom();
        }
      }
    }, 150);
  }

  stopUpdateInterval(finalAnswer?: string) {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    if (finalAnswer !== undefined) {
      this.setState({ answer: finalAnswer });
    }
  }
  loadChatHistory() {
    const bookKey = this.props.currentBook?.key;
    if (!bookKey) {
      return;
    }
    this.isHydrating = true;
    this.setState(
      {
        askHistory: this.loadHistory(bookKey, "ask"),
        chatHistory: this.loadHistory(bookKey, "chat"),
      },
      () => {
        this.isHydrating = false;
        if (ConfigService.getReaderConfig("isManualScroll") !== "yes") {
          this.scrollToBottom();
        }
      }
    );
  }
  saveChatHistory() {
    const bookKey = this.props.currentBook?.key;
    if (!bookKey || this.isHydrating) {
      return;
    }
    this.saveHistory(bookKey, "ask", this.state.askHistory);
    this.saveHistory(bookKey, "chat", this.state.chatHistory);
  }
  componentDidMount(): void {
    this.loadChatHistory();
    if (this.props.quoteText) {
      this.setState({ inputQuestion: this.props.quoteText + "\n" }, () => {
        this.autoResizeTextarea();
        const el = this.textareaRef.current;
        if (el) {
          el.focus();
          const len = el.value.length;
          el.setSelectionRange(len, len);
        }
      });
      this.props.handleQuoteText("");
    }
    const activeAi = this.getActiveAiConfig();
    if (activeAi && activeAi.config) {
      this.setState({
        configProvider: activeAi.config.providerId || "deepseek",
        configEndpoint: activeAi.config.endpoint || "https://api.deepseek.com/v1",
        configApiKey: activeAi.config.apiKey || "",
        configModelId: activeAi.config.modelId || "deepseek-chat",
      });
    }
  }
  componentDidUpdate(
    prevProps: PopupAssistProps,
    prevState: PopupAssistState
  ): void {
    if (prevProps.currentBook?.key !== this.props.currentBook?.key) {
      this.loadChatHistory();
      return;
    }
    if (this.isHydrating) {
      return;
    }
    const bookKey = this.props.currentBook?.key;
    if (!bookKey) {
      return;
    }
    if (prevState.askHistory !== this.state.askHistory) {
      this.saveHistory(bookKey, "ask", this.state.askHistory);
    }
    if (prevState.chatHistory !== this.state.chatHistory) {
      this.saveHistory(bookKey, "chat", this.state.chatHistory);
    }
  }
  componentWillUnmount(): void {
    this.saveChatHistory();
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
  autoResizeTextarea = () => {
    const el = this.textareaRef.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight) || 20;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;
    const maxLines = 5;
    const maxHeight = lineHeight * maxLines + paddingTop + paddingBottom;
    // 先重置为最小高度，让 scrollHeight 反映真实内容高度
    el.style.height = "0px";
    const contentHeight = el.scrollHeight;
    if (contentHeight >= maxHeight) {
      el.style.height = maxHeight + "px";
      el.style.overflowY = "auto";
    } else {
      el.style.height = contentHeight + "px";
      el.style.overflowY = "hidden";
    }
  };
  scrollToBottom = () => {
    if (this.chatBoxRef.current) {
      const scrollHeight = this.chatBoxRef.current.scrollHeight;
      const height = this.chatBoxRef.current.clientHeight;
      const maxScrollTop = scrollHeight - height;
      this.chatBoxRef.current.scrollTop = maxScrollTop > 0 ? maxScrollTop : 0;
    }
  };
  getActiveAiConfig = (): { config: any; modelName: string } | null => {
    const assignedKey = ConfigService.getReaderConfig("aiAssistanceModel");
    const allModels = ConfigService.getAllObjectConfig("aiModelConfig") || {};
    if (assignedKey && allModels[assignedKey]?.config) {
      return {
        config: allModels[assignedKey].config,
        modelName:
          allModels[assignedKey].displayName ||
          allModels[assignedKey].config.modelName ||
          "AI",
      };
    }
    const entries = Object.values(allModels) as any[];
    if (entries.length > 0 && entries[0]?.config) {
      return {
        config: entries[0].config,
        modelName:
          entries[0].displayName || entries[0].config.modelName || "AI",
      };
    }
    const plugin = this.props.plugins?.find(
      (item: any) =>
        item.key === "custom-ai-assistant-plugin" || item.type === "assistant"
    );
    if (plugin && (plugin.config as any)?.endpoint) {
      return {
        config: plugin.config,
        modelName: plugin.displayName || "Custom AI",
      };
    }
    return null;
  };

  handleProviderChange = (providerId: string) => {
    const provider = AiProviderList.find((p) => p.id === providerId);
    let defaultModel = "";
    if (providerId === "deepseek") defaultModel = "deepseek-chat";
    else if (providerId === "openai") defaultModel = "gpt-4o-mini";
    else if (providerId === "google") defaultModel = "gemini-1.5-flash";
    else if (providerId === "anthropic") defaultModel = "claude-3-5-sonnet-latest";
    else if (providerId === "ollama") defaultModel = "qwen2.5:latest";
    else if (providerId === "siliconflow") defaultModel = "deepseek-ai/DeepSeek-V3";
    this.setState({
      configProvider: providerId,
      configEndpoint: provider ? provider.defaultEndpoint : "",
      configModelId: defaultModel,
    });
  };

  handleTestInlineConfig = async () => {
    const { configEndpoint, configApiKey, configModelId } = this.state;
    if (!configEndpoint || !configApiKey || !configModelId) {
      toast.error("请完整填写 API 地址、Key 和模型名称");
      return;
    }
    this.setState({ isTesting: true });
    try {
      const endpoint = configEndpoint.trim();
      const chatEndpoint = endpoint.endsWith("/")
        ? endpoint + "chat/completions"
        : endpoint + "/chat/completions";
      const res = await fetch(chatEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${configApiKey.trim()}`,
        },
        body: JSON.stringify({
          model: configModelId.trim(),
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 5,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt.substring(0, 150)}`);
      }
      toast.success("连通性测试成功！服务响应正常");
    } catch (e: any) {
      toast.error("连通性测试失败：" + e.message);
    } finally {
      this.setState({ isTesting: false });
    }
  };

  handleSaveInlineConfig = () => {
    const { configEndpoint, configApiKey, configModelId, configProvider } = this.state;
    if (!configEndpoint || !configApiKey || !configModelId) {
      toast.error("请完整填写 API 地址、Key 和模型名称");
      return;
    }
    const provider = AiProviderList.find((p) => p.id === configProvider);
    const key = "ai_model_" + Date.now();
    const modelConfig = {
      endpoint: configEndpoint.trim(),
      apiKey: configApiKey.trim(),
      modelId: configModelId.trim(),
      modelName: configModelId.trim(),
      providerId: configProvider || "custom",
      providerName: provider ? provider.name : "Custom",
    };
    const modelEntry = {
      key,
      displayName: provider ? `${provider.name} (${configModelId})` : configModelId,
      config: modelConfig,
    };
    try {
      ConfigService.setObjectConfig(key, modelEntry, "aiModelConfig");
      ConfigService.setReaderConfig("aiAssistanceModel", key);
      toast.success("AI 模型配置已保存！");
      this.props.handleFetchPlugins?.();
      this.setState({ isConfiguring: false }, () => {
        let originalText =
          this.state.mode === "ask"
            ? this.props.originalText
                .replace(/(\r\n|\n|\r)/gm, "")
                .trim()
            : "";
        if (originalText || this.state.question) {
          this.handleDoAnswer(originalText);
        }
      });
    } catch (e: any) {
      toast.error("保存失败：" + e.message);
    }
  };

  async handleAnswer() {
    let originalText =
      this.state.mode === "ask"
        ? this.props.originalText
            .replace(/(\r\n|\n|\r)/gm, "")
            .replace(/-/gm, "")
            .replace(
              /[^\x20-\x7E\u00A0-\u00FF\u0100-\u017F\u4E00-\u9FFF\u3000-\u303F]/g,
              ""
            )
            .replace(/\s{2,}/g, " ")
            .trim()
        : "";
    const active = this.getActiveAiConfig();
    if (!active || !active.config?.endpoint || !active.config?.apiKey) {
      this.setState({ isConfiguring: true, isWaiting: false });
      return;
    }
    this.handleDoAnswer(originalText);
  }

  handleDoAnswer = async (text: string) => {
    try {
      const activeAi = this.getActiveAiConfig();
      if (!activeAi || !activeAi.config?.endpoint || !activeAi.config?.apiKey) {
        this.setState({ isConfiguring: true, isWaiting: false });
        toast("请先配置 AI 模型接口与 API Key");
        return;
      }
      const config = activeAi.config;
      let systemPrompt =
        ConfigService.getReaderConfig("aiAssistancePrompt") ||
        DefaultPrompts.aiAssistance;
      if (this.state.mode === "ask") {
        systemPrompt = systemPrompt.replace("{text}", text);
      } else {
        systemPrompt = systemPrompt.replace("{text}", "");
      }
      let chatHistory =
        this.state.mode === "ask"
          ? this.state.askHistory
          : this.state.chatHistory;
      const historyMessages = chatHistory.slice(0, -1);
      const currentQuestion =
        chatHistory[chatHistory.length - 1]?.content || this.state.question;
      if (!currentQuestion) {
        return;
      }
      this.answerTextAccumulator = "";
      this.startUpdateInterval();
      await chatStream(
        config.endpoint,
        config.providerId || "custom",
        config.apiKey,
        config.modelId,
        systemPrompt + "\n\nUser question: " + currentQuestion,
        historyMessages,
        (result) => {
          if (result && result.done) {
            return;
          }
          if (result && result.text) {
            if (!this.answerTextAccumulator) {
              this.setState({ isWaiting: false });
            }
            this.answerTextAccumulator += result.text;
          }
        }
      );
      this.stopUpdateInterval(this.answerTextAccumulator);
      const finalAnswer = this.answerTextAccumulator;
      this.answerTextAccumulator = "";
      if (this.state.mode === "ask") {
        this.setState({
          askHistory: [
            ...this.state.askHistory,
            { role: "assistant", content: finalAnswer },
          ],
          answer: "",
          question: "",
          isWaiting: false,
        });
      } else {
        this.setState({
          chatHistory: [
            ...this.state.chatHistory,
            { role: "assistant", content: finalAnswer },
          ],
          answer: "",
          question: "",
          isWaiting: false,
        });
      }
      if (ConfigService.getReaderConfig("isManualScroll") !== "yes") {
        this.scrollToBottom();
      }
    } catch (error) {
      toast.error(
        this.props.t("Error happened") +
          ": " +
          (error instanceof Error ? error.message : String(error))
      );
      console.error(error);
      this.setState({
        answer: this.props.t("Error happened"),
        isWaiting: false,
      });
    }
  };
  handleChangeAiService = (aiService: string) => {
    let plugin = this.props.plugins.find((item) => item.key === aiService);
    if (!plugin) {
      return;
    }
    this.setState(
      {
        aiService: aiService,
        isAddNew: false,
      },
      () => {
        ConfigService.setReaderConfig("aiService", aiService);
        if (!plugin) return;
        this.handleAnswer();
      }
    );
  };
  handleRenderHistoryMessage = (message: any[]) => {
    return message.map((item, index) => {
      return (
        <div
          key={index}
          className={
            item.role === "assistant"
              ? "popup-message-assistant"
              : "popup-message-user"
          }
        >
          {Parser(
            DOMPurify.sanitize(
              marked.parse(item.content) + "<address></address>"
            ) || " ",
            {
              replace: (_domNode) => {},
            }
          )}
        </div>
      );
    });
  };
  handleExportChatHistory = () => {
    const messages =
      this.state.mode === "ask"
        ? this.state.askHistory
        : this.state.chatHistory;
    if (messages.length === 0) {
      toast(this.props.t("Nothing to export"));
      return;
    }
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const dateStr = `${year}-${month <= 9 ? "0" + month : month}-${
      day <= 9 ? "0" + day : day
    }`;
    const modeLabel = this.state.mode === "ask" ? "Reading" : "Chat";
    const bookName = this.props.currentBook?.name || "Unknown";
    const exportData = {
      bookName,
      mode: this.state.mode,
      exportedAt: now.toISOString(),
      messages,
    };
    saveAs(
      new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json;charset=UTF-8",
      }),
      `KoodoReader-${modeLabel}-Assistant-${bookName}-${dateStr}.json`
    );
    toast.success(this.props.t("Export successful"));
  };
  handleNewQuestion = (question: string) => {
    if (this.state.mode === "ask") {
      this.setState(
        {
          askHistory: [
            ...this.state.askHistory,
            {
              role: "user",
              content: this.props.t(question),
            },
          ],
          question: this.props.t(question),
          answer: "",
          isWaiting: true,
        },
        () => {
          this.handleAnswer();
        }
      );
    } else {
      this.setState(
        {
          chatHistory: [
            ...this.state.chatHistory,
            {
              role: "user",
              content: this.props.t(question),
            },
          ],
          question: this.props.t(question),
          answer: this.props.t(""),
          isWaiting: true,
        },
        () => {
          this.handleAnswer();
        }
      );
    }
    setTimeout(() => {
      if (ConfigService.getReaderConfig("isManualScroll") !== "yes") {
        this.scrollToBottom();
      }
    }, 100);
  };
  renderConfigPanel = () => {
    const {
      configProvider,
      configEndpoint,
      configApiKey,
      configModelId,
      isTesting,
    } = this.state;
    const active = this.getActiveAiConfig();
    const hasConfig = !!(active && active.config?.endpoint && active.config?.apiKey);

    return (
      <div className="popup-assist-config-container" style={{ marginTop: "60px" }}>
        <div className="popup-assist-config-title">
          <span>{this.props.t("配置 AI 模型")}</span>
          {hasConfig && (
            <span
              style={{
                fontSize: "13px",
                color: "#f16464",
                cursor: "pointer",
                fontWeight: "normal",
              }}
              onClick={() => this.setState({ isConfiguring: false })}
            >
              返回问书
            </span>
          )}
        </div>

        <div className="popup-assist-config-row">
          <div className="popup-assist-config-label">服务商预设</div>
          <select
            className="popup-assist-config-input"
            value={configProvider}
            onChange={(e) => this.handleProviderChange(e.target.value)}
          >
            {AiProviderList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="popup-assist-config-row">
          <div className="popup-assist-config-label">API 接口地址 (URL)</div>
          <input
            className="popup-assist-config-input"
            type="text"
            placeholder="例如 https://api.deepseek.com/v1 或 http://localhost:11434/v1"
            value={configEndpoint}
            onChange={(e) => this.setState({ configEndpoint: e.target.value })}
          />
        </div>

        <div className="popup-assist-config-row">
          <div className="popup-assist-config-label">API Key</div>
          <input
            className="popup-assist-config-input"
            type="password"
            placeholder="填入 API Key（本地 Ollama 可填任意字符如 ollama）"
            value={configApiKey}
            onChange={(e) => this.setState({ configApiKey: e.target.value })}
          />
        </div>

        <div className="popup-assist-config-row">
          <div className="popup-assist-config-label">模型名称 (Model)</div>
          <input
            className="popup-assist-config-input"
            type="text"
            placeholder="例如 deepseek-chat, gpt-4o-mini, qwen2.5:latest"
            value={configModelId}
            onChange={(e) => this.setState({ configModelId: e.target.value })}
          />
        </div>

        <div className="popup-assist-config-actions">
          <button
            type="button"
            className="popup-assist-btn popup-assist-btn-secondary"
            disabled={isTesting}
            onClick={this.handleTestInlineConfig}
          >
            {isTesting ? "测试中..." : "测试连通性"}
          </button>
          <button
            type="button"
            className="popup-assist-btn popup-assist-btn-primary"
            onClick={this.handleSaveInlineConfig}
          >
            保存并使用
          </button>
        </div>
      </div>
    );
  };

  renderEmptyCard = () => {
    return (
      <div className="popup-assist-empty-card" style={{ marginTop: "60px" }}>
        <div className="popup-assist-empty-icon">🤖</div>
        <div className="popup-assist-empty-title">尚未接入 AI 大模型</div>
        <div className="popup-assist-empty-desc">
          支持接入 DeepSeek、OpenAI、SiliconFlow、本地 Ollama 等任何兼容接口的大模型。填入 API URL 与 Key 即可开始使用。
        </div>
        <button
          type="button"
          className="popup-assist-btn popup-assist-btn-primary"
          style={{ padding: "8px 20px" }}
          onClick={() => this.setState({ isConfiguring: true })}
        >
          立即配置 AI 接口
        </button>
      </div>
    );
  };

  render() {
    const activeAi = this.getActiveAiConfig();
    const hasConfig = !!(activeAi && activeAi.config?.endpoint && activeAi.config?.apiKey);
    const allModels = ConfigService.getAllObjectConfig("aiModelConfig") || {};
    const assignedKey = ConfigService.getReaderConfig("aiAssistanceModel");
    const modelKeys = Object.keys(allModels);
    const currentSelected = assignedKey || (modelKeys.length > 0 ? modelKeys[0] : "");

    return (
      <div className="dict-container">
        <div
          className="dict-service-container"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: "calc(100% - 50px)",
            top: "20px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-start",
            }}
          >
            <div
              className={
                this.state.mode === "ask"
                  ? "trans-service-selector"
                  : "trans-service-selector-inactive"
              }
              onClick={() => {
                this.setState({ mode: "ask" });
              }}
            >
              <span className={`icon-bookmark trans-icon`}></span>
              {this.props.t("Reading Assistant")}
            </div>
            <div
              className={
                this.state.mode === "chat"
                  ? "trans-service-selector"
                  : "trans-service-selector-inactive"
              }
              onClick={() => {
                this.setState({ mode: "chat" });
              }}
            >
              <span className={`icon-idea trans-icon`}></span>
              {this.props.t("Chat Assistant")}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <div
              className="popup-assist-export-button"
              title={this.props.t("Export")}
              onClick={this.handleExportChatHistory}
            >
              <span className="icon-share"></span>
            </div>

            <select
              className="dict-service-selector"
              style={{ margin: 0, color: "#f16464", maxWidth: "110px" }}
              value={currentSelected}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                if (event.target.value === "add-new") {
                  this.setState({ isConfiguring: true });
                  return;
                }
                ConfigService.setReaderConfig("aiAssistanceModel", event.target.value);
                this.setState({ isConfiguring: false });
              }}
            >
              {modelKeys.length === 0 && (
                <option value="">未配置模型</option>
              )}
              {modelKeys.map((key) => {
                const item = allModels[key];
                return (
                  <option value={key} key={key}>
                    {item.displayName || item.config?.modelName || key}
                  </option>
                );
              })}
              <option value="add-new">+ 添加新模型</option>
            </select>

            <div
              className="popup-assist-setting-btn"
              title="配置 AI 接口"
              onClick={() => {
                this.setState({ isConfiguring: !this.state.isConfiguring });
              }}
            >
              <span className="icon-setting" style={{ fontSize: "16px" }}></span>
            </div>
          </div>
        </div>

        {this.state.isConfiguring && this.renderConfigPanel()}

        {!this.state.isConfiguring && !hasConfig && this.renderEmptyCard()}

        {!this.state.isConfiguring && hasConfig && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              height: "calc(100% - 10px)",
              marginTop: "60px",
              paddingBottom: "20px",
            }}
          >
            <div
              className="dict-text-box"
              style={{
                flex: 1,
                marginTop: "0px",
                width: "calc(100% + 20px)",
                height: undefined,
                paddingBottom: "0px",
                paddingLeft: "0px",
                paddingRight: "20px",
              }}
              ref={this.chatBoxRef}
            >
              {this.handleRenderHistoryMessage(
                this.state.mode === "ask"
                  ? this.state.askHistory
                  : this.state.chatHistory
              )}
              {this.state.isWaiting ? (
                <div
                  className="popup-message-assistant"
                  style={{ float: "left" }}
                >
                  <span
                    className="icon-loading popup-assistant-loading"
                    style={{
                      marginRight: "10px",
                      marginTop: "5px",
                    }}
                  ></span>
                  <span>{this.props.t("Thinking, please wait...")}</span>
                </div>
              ) : (this.state.mode === "ask"
                  ? this.state.askHistory
                  : this.state.chatHistory
                ).length > 0 ? (
                <div className="popup-message-assistant">
                  {Parser(
                    DOMPurify.sanitize(
                      marked.parse(
                        this.state.answer ? this.state.answer : ""
                      ) + "<address></address>"
                    ) || " ",
                    {
                      replace: (_domNode) => {},
                    }
                  )}
                </div>
              ) : (
                <div className="popup-message-assistant">
                  {this.state.mode === "ask"
                    ? this.props.t(
                        "Hi there! What questions do you have about this chapter?"
                      )
                    : this.props.t(
                        "Hi there! I'm happy to help with any questions about reading or learning"
                      )}
                </div>
              )}
            </div>
            <div
              style={{
                marginLeft: "-25px",
                marginRight: "-25px",
                marginBottom: "0px",
                padding: "0px 25px",
              }}
            >
              <div className="popup-assist-shortcut-container">
                {sampleQuestion
                  .filter((item) => item.mode === this.state.mode)
                  .map((item) => {
                    return (
                      <div
                        className="popup-assist-shortcut"
                        onClick={() => {
                          this.handleNewQuestion(item.question);
                        }}
                      >
                        {item.emoji + " " + this.props.t(item.question)}
                      </div>
                    );
                  })}
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "space-between",
                }}
              >
                <textarea
                  ref={this.textareaRef}
                  name="url"
                  placeholder={this.props.t(
                    this.state.mode === "ask"
                      ? "Ask anything about this chapter"
                      : "Ask anything about reading or learning"
                  )}
                  id="trans-add-content-box"
                  className="trans-add-content-box"
                  style={{
                    height: "40px",
                    resize: "none",
                    overflowY: "hidden",
                    marginRight: "10px",
                    marginBottom: "0px",
                  }}
                  onContextMenu={() => {
                    handleContextMenu("trans-add-content-box");
                  }}
                  value={this.state.inputQuestion}
                  onChange={(
                    event: React.ChangeEvent<HTMLTextAreaElement>
                  ) => {
                    this.setState(
                      { inputQuestion: event.target.value },
                      () => {
                        this.autoResizeTextarea();
                      }
                    );
                  }}
                />
                <div
                  className="popup-assistant-send-button"
                  onClick={() => {
                    if (this.state.answer || this.state.isWaiting) {
                      return;
                    }
                    this.handleNewQuestion(this.state.inputQuestion);
                    this.setState({ inputQuestion: "" }, () => {
                      const el = this.textareaRef.current;
                      if (el) {
                        el.style.height = "40px";
                        el.style.overflowY = "hidden";
                      }
                    });
                  }}
                >
                  {this.props.t("Send")}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
}
export default PopupAssist;
