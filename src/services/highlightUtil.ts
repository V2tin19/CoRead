import React from "react";

const LEGACY_HIGHLIGHT_KEYS = [
  "color-0",
  "color-1",
  "color-2",
  "color-3",
  "line-0",
  "line-1",
  "line-2",
  "line-3",
];

const LEGACY_BG_COLORS = ["#FEF3CD", "#FBFACC", "#CEFACD", "#CDE9FA"];
const LEGACY_LINE_COLORS = ["#FF0000", "#000080", "#0000FF", "#2EFF2E"];

const DEFAULT_TTS_HIGHLIGHT_STRING = "background-#F3C9C9";
const DEFAULT_TTS_HIGHLIGHT_VALUE = { styleType: "background", color: "#F3C9C9" };
const DEFAULT_NOTE_HIGHLIGHT_VALUE = { styleType: "background", color: "#FEF3CD" };

const TTS_CONFIG_KEY = "ttsHighlight";
const SEARCH_CONFIG_KEY = "searchHighlight";
const NOTE_CONFIG_KEY = "noteHighlight";

export class HighlightUtil {
  private configService: any;

  constructor(configService: any) {
    this.configService = configService;
  }

  getHighlightValue = (value: any): { styleType: string; color: string } => {
    if (typeof value !== "number") {
      if (typeof value === "string" && value.includes("-")) {
        const [styleType, color] = value.split("-");
        return { styleType, color };
      }
      return DEFAULT_NOTE_HIGHLIGHT_VALUE;
    }
    if (value >= 0 && value < LEGACY_HIGHLIGHT_KEYS.length) {
      const isColor = LEGACY_HIGHLIGHT_KEYS[value].includes("color");
      const idx = parseInt(LEGACY_HIGHLIGHT_KEYS[value].split("-")[1], 10);
      return {
        styleType: isColor ? "background" : "underline",
        color: isColor ? LEGACY_BG_COLORS[idx] : LEGACY_LINE_COLORS[idx],
      };
    }
    return DEFAULT_NOTE_HIGHLIGHT_VALUE;
  };

  formatHighlightValue = (val: { styleType: string; color: string }): string => {
    return `${val.styleType}-${val.color}`;
  };

  getNoteHighlightString = (): string => {
    return this.configService.getReaderConfig(NOTE_CONFIG_KEY) || "background-#FEF3CD";
  };

  getNoteHighlightValue = (): { styleType: string; color: string } => {
    const str = this.getNoteHighlightString();
    if (!str) return DEFAULT_NOTE_HIGHLIGHT_VALUE;
    const [styleType, color] = str.split("-");
    return { styleType, color };
  };

  saveNoteHighlightValue = (val: { styleType: string; color: string }): void => {
    this.configService.setReaderConfig(NOTE_CONFIG_KEY, `${val.styleType}-${val.color}`);
  };

  getTtsHighlightString = (): string => {
    return this.configService.getReaderConfig(TTS_CONFIG_KEY) || DEFAULT_TTS_HIGHLIGHT_STRING;
  };

  getTtsHighlightValue = (): { styleType: string; color: string } => {
    const str = this.getTtsHighlightString();
    if (!str) return DEFAULT_TTS_HIGHLIGHT_VALUE;
    const [styleType, color] = str.split("-");
    return { styleType, color };
  };

  saveTtsHighlightValue = (val: { styleType: string; color: string }): void => {
    this.configService.setReaderConfig(TTS_CONFIG_KEY, `${val.styleType}-${val.color}`);
  };

  getSearchHighlightString = (): string => {
    return this.configService.getReaderConfig(SEARCH_CONFIG_KEY) || DEFAULT_TTS_HIGHLIGHT_STRING;
  };

  getSearchHighlightValue = (): { styleType: string; color: string } => {
    const str = this.configService.getReaderConfig(SEARCH_CONFIG_KEY);
    if (!str) return DEFAULT_TTS_HIGHLIGHT_VALUE;
    const [styleType, color] = str.split("-");
    return { styleType, color };
  };

  saveSearchHighlightValue = (val: { styleType: string; color: string }): void => {
    this.configService.setReaderConfig(SEARCH_CONFIG_KEY, `${val.styleType}-${val.color}`);
  };

  isDarkMode = (): boolean => {
    return (
      this.configService?.getReaderConfig?.("appSkin") === "night" ||
      (this.configService?.getReaderConfig?.("appSkin") === "system" &&
        this.configService?.getReaderConfig?.("isOSNight") === "yes") ||
      this.configService?.getReaderConfig?.("backgroundColor") === "rgba(44,47,49,1)"
    );
  };

  buildHighlightStyleForType = (typeVal: any, multiply = false): string => {
    let styleType = "background";
    let color = "#FEF3CD";
    if (typeof typeVal === "number") {
      if (typeVal >= 0 && typeVal < LEGACY_HIGHLIGHT_KEYS.length) {
        const isColor = LEGACY_HIGHLIGHT_KEYS[typeVal].includes("color");
        const idx = parseInt(LEGACY_HIGHLIGHT_KEYS[typeVal].split("-")[1], 10);
        styleType = isColor ? "background" : "underline";
        color = isColor ? LEGACY_BG_COLORS[idx] : LEGACY_LINE_COLORS[idx];
      }
    } else if (typeof typeVal === "string") {
      const parts = typeVal.split("-");
      styleType = parts[0] || "background";
      color = parts[1] || "#FEF3CD";
    }

    const isNight = this.isDarkMode();

    const rgbaColor =
      styleType === "background"
        ? (() => {
            const raw = color.replace("#", "");
            const fullHex = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
            if (fullHex.length !== 6) return color;
            const r = parseInt(fullHex.slice(0, 2), 16);
            const g = parseInt(fullHex.slice(2, 4), 16);
            const b = parseInt(fullHex.slice(4, 6), 16);
            // 契约 15: 深色模式下高亮颜色自动调整对比度与透明度，确保白字/浅字清晰可读
            const alpha = isNight ? 0.45 : 0.8;
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
          })()
        : color;

    switch (styleType) {
      case "background":
        if (multiply) {
          return isNight
            ? `background: ${rgbaColor}; mix-blend-mode: screen;`
            : `background: ${rgbaColor}; mix-blend-mode: multiply;`;
        }
        return `background: ${rgbaColor};`;
      case "underline":
        return `border-bottom: 2px solid ${rgbaColor};`;
      case "strikethrough":
        return multiply
          ? `background: linear-gradient(transparent calc(50% - 1px), ${rgbaColor} calc(50% - 1px), ${rgbaColor} calc(50% + 1px), transparent calc(50% + 1px));`
          : `text-decoration: line-through; text-decoration-color: ${rgbaColor};`;
      case "wavy":
      case "wave":
        if (multiply) {
          const svgUrl = `url("data:image/svg+xml,%3Csvg xmlns='http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg' width='6' height='3'%3E%3Cpath d='M0 2 Q1.5 0 3 2 Q4.5 4 6 2' fill='none' stroke='${color.replace("#", "%23")}' stroke-width='1.5'%2F%3E%3C%2Fsvg%3E")`;
          return `background-image: ${svgUrl}; background-repeat: repeat-x; background-position: bottom; background-size: 6px 3px;`;
        }
        return `text-decoration: underline wavy ${rgbaColor} 2px; -webkit-text-decoration: underline wavy ${rgbaColor} 2px; text-decoration-line: underline; text-decoration-style: wavy; text-decoration-color: ${rgbaColor}; text-decoration-thickness: 2px; -webkit-text-decoration-style: wavy; -webkit-text-decoration-color: ${rgbaColor}; text-decoration-skip-ink: none;`;
      default:
        return `background: ${rgbaColor};`;
    }
  };

  buildHighlightPreviewStyle = (styleType: string, color: string): React.CSSProperties => {
    switch (styleType) {
      case "background":
      default:
        return { background: color };
      case "underline":
        return { borderBottom: `2px solid ${color}` };
      case "strikethrough":
        return { textDecoration: "line-through", textDecorationColor: color };
      case "wavy":
      case "wave":
        return {
          textDecoration: `underline wavy ${color} 2px`,
          textDecorationLine: "underline",
          textDecorationStyle: "wavy",
          textDecorationColor: color,
          textDecorationThickness: "2px",
          textDecorationSkipInk: "none",
        };
    }
  };

  convertNumberToHighlightValue = (num: number): { styleType: string; color: string } => {
    return this.getHighlightValue(num);
  };

  buildTtsHighlightStyle = (multiply = false): string => {
    return this.buildHighlightStyleForType(this.getTtsHighlightString(), multiply);
  };

  buildTtsHighlightPreviewStyle = (styleType: string, color: string): React.CSSProperties => {
    return this.buildHighlightPreviewStyle(styleType, color);
  };

  buildSearchHighlightStyle = (multiply = false): string => {
    return this.buildHighlightStyleForType(this.getSearchHighlightString(), multiply);
  };

  buildSearchHighlightPreviewStyle = (styleType: string, color: string): React.CSSProperties => {
    return this.buildHighlightPreviewStyle(styleType, color);
  };
}

export default HighlightUtil;
