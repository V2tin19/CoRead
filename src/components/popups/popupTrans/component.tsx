import React from "react";
import "./popupTrans.css";
import { PopupTransProps, PopupTransState } from "./interface";
import { ConfigService } from "../../../services";
import { DefaultPrompts } from "../../../constants/aiConfig";
import { officialTranList } from "../../../constants/settingList";
import axios from "axios";
import { Trans } from "react-i18next";
import toast from "react-hot-toast";
import { getDefaultTransTarget, openExternalUrl } from "../../../utils/common";
import { chatStream } from "../../../utils/request/common";
import { getIframeDoc } from "../../../utils/reader/docUtil";

declare var window: any;

/** 语言名称到国际化 ISO 简码映射（用于公共即时翻译 API） */
const getLangCode = (lang: string): string => {
  switch (lang) {
    case "English":
      return "en";
    case "Simplified Chinese":
    case "简体中文":
      return "zh-CN";
    case "Traditional Chinese":
    case "繁体中文":
      return "zh-TW";
    case "Japanese":
    case "日语":
      return "ja";
    case "Korean":
    case "韩语":
      return "ko";
    case "French":
    case "法语":
      return "fr";
    case "German":
    case "德语":
      return "de";
    case "Spanish":
    case "西班牙语":
      return "es";
    case "Russian":
    case "俄语":
      return "ru";
    case "Portuguese":
    case "葡萄牙语":
      return "pt";
    case "Italian":
    case "意大利语":
      return "it";
    case "Arabic":
    case "阿拉伯语":
      return "ar";
    default:
      return "zh-CN";
  }
};

/** 检查用户是否在系统中已保存过任何可用的 AI 模型配置 */
const getAvailableAiConfig = () => {
  const allConfigs = ConfigService.getAllObjectConfig("aiModelConfig") || {};
  const preferredKey = ConfigService.getReaderConfig("aiTranslateModel");
  if (preferredKey && allConfigs[preferredKey]?.config) {
    return allConfigs[preferredKey].config;
  }
  const keys = Object.keys(allConfigs);
  if (keys.length > 0 && allConfigs[keys[0]]?.config) {
    return allConfigs[keys[0]].config;
  }
  return null;
};

class PopupTrans extends React.Component<PopupTransProps, PopupTransState> {
  private textAccumulator: string = "";
  private updateInterval: ReturnType<typeof setInterval> | null = null;

  constructor(props: PopupTransProps) {
    super(props);
    const savedService = ConfigService.getReaderConfig("transService") || "";
    this.state = {
      translatedText: "",
      originalText: "",
      transService: savedService,
      transTarget: ConfigService.getReaderConfig("transTarget") || "Simplified Chinese",
      transSource: ConfigService.getReaderConfig("transSource") || "Automatic",
      isAddNew: false,
      isFinishOutput: false,
    };
  }

  private startUpdateInterval() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    this.updateInterval = setInterval(() => {
      if (this.textAccumulator) {
        this.setState({ translatedText: this.textAccumulator });
      }
    }, 150);
  }

  private stopUpdateInterval() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    if (this.textAccumulator) {
      this.setState({ translatedText: this.textAccumulator });
    }
  }

  async componentDidMount() {
    let originalText = this.props.originalText.replace(/(\r\n|\n|\r)/gm, "");
    this.setState({ originalText });

    let currentService = this.state.transService;
    const hasAiConfig = Boolean(getAvailableAiConfig());
    const customPlugins = this.props.plugins.filter(
      (item) => item.type === "translation" && item.key !== "custom-ai-trans-plugin"
    );

    // 智能选择首选翻译服务：有配置 AI 优先走 AI，无 AI 走免配置即时翻译
    if (!currentService || currentService === "custom-ai-trans-plugin") {
      if (hasAiConfig) {
        currentService = "custom-ai-trans-plugin";
      } else if (customPlugins.length > 0) {
        currentService = customPlugins[0].key;
      } else {
        currentService = "free-online-trans";
      }
    }

    this.setState({
      transService: currentService,
      isAddNew: false,
    });
    ConfigService.setReaderConfig("transService", currentService);

    this.handleTrans(originalText, currentService);
  }

  handleTrans = async (text: string, overrideService?: string) => {
    const service = overrideService || this.state.transService;
    if (!text || !text.trim()) return;

    // 1. 自定义 AI 模型流式翻译
    if (service === "custom-ai-trans-plugin") {
      const plugin = this.props.plugins.find((item) => item.key === "custom-ai-trans-plugin");
      const config = plugin?.config || getAvailableAiConfig();

      if (!config || !config.endpoint || !config.modelId) {
        // 未配置 AI 模型时平滑回退到公共即时翻译，避免报错阻断
        toast("未检测到 AI 模型，已为您使用公共即时翻译");
        this.setState({ transService: "free-online-trans" });
        ConfigService.setReaderConfig("transService", "free-online-trans");
        this.handlePublicTrans(text);
        return;
      }

      let targetLang =
        ConfigService.getReaderConfig("transTarget") ||
        this.state.transTarget ||
        "Simplified Chinese";
      if (targetLang === "Traditional Chinese") {
        targetLang = "繁体中文";
      }

      let systemPrompt =
        ConfigService.getReaderConfig("aiTranslatePrompt") ||
        DefaultPrompts.aiTranslate;
      systemPrompt = systemPrompt.replace(
        "{from}",
        ConfigService.getReaderConfig("transSource") || "Automatic"
      );
      systemPrompt = systemPrompt.replace("{to}", targetLang);
      systemPrompt = systemPrompt.replace("{text}", text);

      this.textAccumulator = "";
      this.setState({ translatedText: "", isFinishOutput: false });
      this.startUpdateInterval();

      try {
        await chatStream(
          config.endpoint,
          config.providerId,
          config.apiKey,
          config.modelId,
          systemPrompt,
          [],
          (result) => {
            if (result && result.done) return;
            if (result && result.text) {
              this.textAccumulator += result.text;
            }
          }
        );
      } catch (err: any) {
        console.error("AI 翻译失败:", err);
        toast.error("AI 翻译异常，已为您切换为公共即时翻译");
        this.handlePublicTrans(text);
        return;
      }

      this.stopUpdateInterval();
      this.textAccumulator = "";
      this.setState({ isFinishOutput: true });
      return;
    }

    // 2. 免配置的公共即时翻译（开箱即用！）
    if (service === "free-online-trans") {
      await this.handlePublicTrans(text);
      return;
    }

    // 3. 第三方翻译插件（如用户通过插件库自定义安装的脚本插件）
    const plugin = this.props.plugins.find((item) => item.key === service);
    if (!plugin) {
      await this.handlePublicTrans(text);
      return;
    }

    try {
      const translateFunc = plugin.script;
      // eslint-disable-next-line no-eval
      eval(translateFunc);
      window
        .translate(
          text,
          ConfigService.getReaderConfig("transSource") || "",
          ConfigService.getReaderConfig("transTarget") ||
            getDefaultTransTarget(plugin.langList),
          axios,
          plugin.config
        )
        .then((res: string) => {
          if (res.startsWith("https://")) {
            openExternalUrl(res, true, "trans");
            let docs = getIframeDoc(this.props.currentBook.format);
            for (let i = 0; i < docs.length; i++) {
              let doc = docs[i];
              if (!doc) continue;
              doc.getSelection()?.empty();
            }
          } else {
            this.setState({
              translatedText: res,
              isFinishOutput: true,
            });
          }
        })
        .catch((err: any) => {
          console.error(err);
          this.handlePublicTrans(text);
        });
    } catch (e) {
      console.error(e);
      this.handlePublicTrans(text);
    }
  };

  /** 免配置公共即时翻译引擎（MyMemory 开放接口） */
  private handlePublicTrans = async (text: string) => {
    this.setState({
      translatedText: "正在即时翻译...",
      isFinishOutput: false,
    });

    const targetLang =
      ConfigService.getReaderConfig("transTarget") ||
      this.state.transTarget ||
      "Simplified Chinese";
    const sourceLang =
      ConfigService.getReaderConfig("transSource") ||
      this.state.transSource ||
      "Automatic";

    const fromCode = sourceLang === "Automatic" ? "autodetect" : getLangCode(sourceLang);
    const toCode = getLangCode(targetLang);

    try {
      const apiUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
        text
      )}&langpair=${fromCode}|${toCode}`;
      const res = await axios.get(apiUrl, { timeout: 8000 });
      if (res.data?.responseData?.translatedText) {
        this.setState({
          translatedText: res.data.responseData.translatedText,
          isFinishOutput: true,
        });
        return;
      }
    } catch (e) {
      console.warn("公共翻译请求失败:", e);
    }

    this.setState({
      translatedText:
        "当前网络环境下公共翻译未返回结果。您可点击下方【在浏览器中查看】直接查看权威翻译，或前往【AI 设置】配置高精度模型。",
      isFinishOutput: true,
    });
  };

  handleChangeService(target: string) {
    this.setState({ transService: target }, () => {
      ConfigService.setReaderConfig("transService", target);
      this.handleTrans(this.props.originalText.replace(/(\r\n|\n|\r)/gm, ""), target);
    });
  }

  /** 在系统浏览器中一键打开在线翻译 */
  handleOpenBrowserTrans = () => {
    const text = this.state.originalText || this.props.originalText;
    if (!text) return;
    const isZh = navigator.language === "zh-CN" || navigator.language?.startsWith("zh");
    const targetLang = ConfigService.getReaderConfig("transTarget") || "Simplified Chinese";
    const tl = getLangCode(targetLang);
    const url = isZh
      ? `https://fanyi.baidu.com/#auto/zh/${encodeURIComponent(text)}`
      : `https://translate.google.com/?sl=auto&tl=${tl}&text=${encodeURIComponent(text)}`;
    openExternalUrl(url);
  };

  /** 直接跳转至“AI 服务”设置 */
  handleGoToAiSetting = () => {
    this.props.handleOpenMenu(false);
    this.props.handleSetting(true);
    this.props.handleSettingMode("ai");
  };

  render() {
    const { transService, originalText, translatedText, isFinishOutput } = this.state;
    const isAiTrans = transService === "custom-ai-trans-plugin";
    const hasAiConfig = Boolean(getAvailableAiConfig());

    // 可用服务列表：AI 翻译 + 公共即时翻译 + 其它自定义插件
    const customPlugins = this.props.plugins.filter(
      (item) => item.type === "translation" && item.key !== "custom-ai-trans-plugin"
    );

    return (
      <div className="trans-container">
        {/* 顶部服务切换栏 */}
        <div className="trans-service-selector-container">
          {/* 1. AI 智能翻译 */}
          <div
            className={
              isAiTrans ? "trans-service-selector" : "trans-service-selector-inactive"
            }
            onClick={() => this.handleChangeService("custom-ai-trans-plugin")}
            title="基于大语言模型深度翻译"
          >
            <span className="trans-icon">✨</span>
            <span>AI 翻译</span>
          </div>

          {/* 2. 免配置即时翻译 */}
          <div
            className={
              transService === "free-online-trans"
                ? "trans-service-selector"
                : "trans-service-selector-inactive"
            }
            onClick={() => this.handleChangeService("free-online-trans")}
            title="免配置公共即时翻译"
          >
            <span className="trans-icon">🌐</span>
            <span>即时翻译</span>
          </div>

          {/* 3. 其它插件 */}
          {customPlugins.map((item) => (
            <div
              key={item.key}
              className={
                transService === item.key
                  ? "trans-service-selector"
                  : "trans-service-selector-inactive"
              }
              onClick={() => this.handleChangeService(item.key)}
            >
              <span className={`icon-${item.icon} trans-icon`}></span>
              <span>{this.props.t(item.displayName)}</span>
            </div>
          ))}

          {/* 直达 AI 模型设置按钮 */}
          <div
            className="trans-service-selector-inactive trans-ai-config-btn"
            onClick={this.handleGoToAiSetting}
            title="配置 AI 服务（API Key、模型）"
          >
            <span className="icon-setting trans-icon"></span>
            <span>AI 设置</span>
          </div>
        </div>

        {/* 语言选择栏 */}
        <div className="trans-lang-selector-container">
          <div className="original-lang-box">
            <select
              className="original-lang-selector"
              style={{ maxWidth: "120px", margin: 0 }}
              value={ConfigService.getReaderConfig("transSource") || "Automatic"}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                let targetLang = event.target.value;
                ConfigService.setReaderConfig("transSource", targetLang);
                this.setState({ transSource: targetLang });
                this.handleTrans(this.state.originalText);
              }}
            >
              {Object.keys(officialTranList).map((item, index) => (
                <option value={item} key={index}>
                  {this.props.t(item)}
                </option>
              ))}
            </select>
          </div>
          <div className="trans-lang-box">
            <select
              className="trans-lang-selector"
              style={{ maxWidth: "120px", margin: 0 }}
              value={ConfigService.getReaderConfig("transTarget") || "Simplified Chinese"}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                let targetLang = event.target.value;
                ConfigService.setReaderConfig("transTarget", targetLang);
                this.setState({ transTarget: targetLang });
                this.handleTrans(this.state.originalText);
              }}
            >
              {Object.keys(officialTranList)
                .filter((k) => k !== "Automatic")
                .map((item, index) => (
                  <option value={item} key={index}>
                    {this.props.t(item)}
                  </option>
                ))}
            </select>
          </div>
        </div>

        {/* 原文与译文对比卡片 */}
        <div className="trans-box">
          <div className="original-text-box">
            <div className="original-text">{originalText}</div>
          </div>
          <div className="trans-text-box">
            <div className="trans-text">
              {translatedText}
              {isAiTrans && isFinishOutput && (
                <p className="dict-learn-more" style={{ color: "#4b89ff", marginTop: 8 }}>
                  ✨ 由 AI 大模型深度翻译
                </p>
              )}
              {!isAiTrans && isFinishOutput && (
                <p className="dict-learn-more" style={{ color: "rgba(128,128,128,0.8)", marginTop: 8 }}>
                  🌐 公共即时翻译
                </p>
              )}
            </div>
          </div>
        </div>

        {/* 底部全链路辅助操作栏 */}
        <div className="trans-bottom-bar">
          <button
            type="button"
            className="trans-quick-action-btn"
            onClick={this.handleOpenBrowserTrans}
            title="在浏览器中查看完整释义"
          >
            <span className="icon-search" style={{ marginRight: 4 }} />
            在浏览器中打开翻译
          </button>

          {!hasAiConfig && isAiTrans && (
            <button
              type="button"
              className="trans-quick-action-btn trans-highlight-btn"
              onClick={this.handleGoToAiSetting}
            >
              <span style={{ marginRight: 4 }}>⚙</span>
              配置 AI 模型
            </button>
          )}
        </div>
      </div>
    );
  }
}

export default PopupTrans;
