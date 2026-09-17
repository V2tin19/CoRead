import React from "react";
import { backgroundList, textList } from "../../../constants/themeList";
import StyleUtil from "../../../utils/reader/styleUtil";
import "./themeList.css";
import { Trans } from "react-i18next";
import { ThemeListProps, ThemeListState } from "./interface";
import {
  ConfigService,
  KookitConfig,
} from '../../../services';
import { HexColorPicker } from "react-colorful";
import toast from "react-hot-toast";
import { normalizePickerColor, parseColorInput } from "../../../utils/common";
import { isMobileRuntime } from "../../../utils/mobileRuntime";

// 手机端「主题」预设默认只露第一行（5 个），其余折叠在「展开全部」后面。
const MOBILE_THEME_ROW = 5;
// 手机端「背景色 / 文字色」各只保留两个预设：
// 背景 = 白 / 深，文字 = 黑 / 白。
// 其余彩色预设由下面「主题」那一行和取色板承担，用户自取的颜色照旧另起一行追加。
const MOBILE_BG_PRESETS = 2;
const MOBILE_TEXT_PRESETS = 2;

class ThemeList extends React.Component<ThemeListProps, ThemeListState> {
  constructor(props: ThemeListProps) {
    super(props);
    this.state = {
      currentBackgroundIndex: backgroundList
        .concat(ConfigService.getAllListConfig("themeColors"))
        .findIndex((item) => {
          return (
            item ===
            (ConfigService.getReaderConfig("backgroundColor") ||
              "rgba(255,255,255,1)")
          );
        }),
      currentTextIndex: textList
        .concat(ConfigService.getAllListConfig("themeColors"))
        .findIndex((item) => {
          return (
            item ===
            (ConfigService.getReaderConfig("textColor") || "rgba(0,0,0,1)")
          );
        }),
      currentPresetIndex: KookitConfig.PresetThemeList.findIndex((item) => {
        return (
          item.backgroundColor ===
            (ConfigService.getReaderConfig("backgroundColor") ||
              "rgba(255,255,255,1)") &&
          item.textColor ===
            (ConfigService.getReaderConfig("textColor") || "rgba(0,0,0,1)")
        );
      }),
      isShowTextPicker: false,
      isShowBgPicker: false,
      isShowAllThemes: false,
      bgColorInput: normalizePickerColor(
        ConfigService.getReaderConfig("backgroundColor"),
        "#ffffff"
      ),
      textColorInput: normalizePickerColor(
        ConfigService.getReaderConfig("textColor"),
        "#000000"
      ),
    };
  }

  // ────────────── 手机端色板瘦身（桌面端逐字不动） ──────────────
  // 判据放在取值源头：只有 isMobileRuntime() 为真时才裁预设，
  // 桌面端拿到的仍然是 backgroundList / textList 原样（各 4 个）。
  isMobilePanel = () => isMobileRuntime();
  presetBgColors = () =>
    this.isMobilePanel()
      ? backgroundList.slice(0, MOBILE_BG_PRESETS)
      : backgroundList;
  presetTextColors = () =>
    this.isMobilePanel()
      ? textList.slice(0, MOBILE_TEXT_PRESETS)
      : textList;

  currentBgColor = () =>
    ConfigService.getReaderConfig("backgroundColor") || "rgba(255,255,255,1)";
  currentTextColor = () =>
    ConfigService.getReaderConfig("textColor") || "rgba(0,0,0,1)";

  // 一份色板 = 预设 + 补位色 + 用户自取色。
  // 「补位色」只在手机上出现：当前颜色既不是预设、也不在用户自取的色里时
  //（典型：从桌面端带过来的羊皮 / 护眼），把它补在预设之后 ——
  // ① 选中的圆球永远看得见，② 它落在下一行，不挤占「黑 / 白 / 取色板」那一行。
  // 桌面端不补，顺序与裁剪前逐字一致。
  buildColorList = (presets: string[], current: string) => {
    const custom = ConfigService.getAllListConfig("themeColors");
    const extra =
      this.isMobilePanel() &&
      !presets.includes(current) &&
      !custom.includes(current)
        ? [current]
        : [];
    return {
      list: presets.concat(extra).concat(custom),
      extraCount: extra.length,
    };
  };

  handleChangeBgColor = (color: string, index: number = -1) => {
    ConfigService.setReaderConfig("backgroundColor", color);
    this.props.handleBackgroundColor(color);
    this.setState({
      currentBackgroundIndex: index,
    });
    if (index === 1) {
      ConfigService.setReaderConfig("textColor", "rgba(255,255,255,1)");
    } else if (
      index === 0 &&
      ConfigService.getReaderConfig("backgroundColor") === "rgba(255,255,255,1)"
    ) {
      ConfigService.setReaderConfig("textColor", "rgba(0,0,0,1)");
    }
    this.props.renderBookFunc();
    this.setState({
      currentPresetIndex: this.getPresetIndex(
        color,
        ConfigService.getReaderConfig("textColor") || "rgba(0,0,0,1)"
      ),
    });
  };

  handleChooseBgColor = (color: string) => {
    this.setState({ bgColorInput: color });
    ConfigService.setReaderConfig("backgroundColor", color);
    this.props.handleBackgroundColor(color);
    this.setState({
      currentPresetIndex: this.getPresetIndex(
        color,
        ConfigService.getReaderConfig("textColor") || "rgba(0,0,0,1)"
      ),
    });
  };
  handleColorTextPicker = (isShowTextPicker: boolean) => {
    if (
      !isShowTextPicker &&
      this.presetTextColors()
        .concat(ConfigService.getAllListConfig("themeColors"))
        .findIndex((item) => {
          return (
            item ===
            (ConfigService.getReaderConfig("textColor") || "rgba(0,0,0,1)")
          );
        }) === -1
    ) {
      ConfigService.setListConfig(
        ConfigService.getReaderConfig("textColor"),
        "themeColors"
      );
    }
    this.setState({ isShowTextPicker });
  };
  handleColorBgPicker = (isShowBgPicker: boolean) => {
    if (
      !isShowBgPicker &&
      this.presetBgColors()
        .concat(ConfigService.getAllListConfig("themeColors"))
        .findIndex((item) => {
          return (
            item ===
            (ConfigService.getReaderConfig("backgroundColor") ||
              "rgba(255,255,255,1)")
          );
        }) === -1
    ) {
      ConfigService.setListConfig(
        ConfigService.getReaderConfig("backgroundColor"),
        "themeColors"
      );
    }
    this.setState({ isShowBgPicker });
  };
  handleChooseTextColor = (color: string) => {
    this.setState({
      currentTextIndex: this.presetTextColors()
        .concat(ConfigService.getAllListConfig("themeColors"))
        .indexOf(color),
      textColorInput: color,
      currentPresetIndex: this.getPresetIndex(this.currentBgColor(), color),
    });
    ConfigService.setReaderConfig("textColor", color);
    this.props.renderBookFunc();
  };
  getPresetIndex = (backgroundColor: string, textColor: string) => {
    return KookitConfig.PresetThemeList.findIndex((item) => {
      return (
        item.backgroundColor === backgroundColor && item.textColor === textColor
      );
    });
  };
  handleChoosePreset = (
    preset: { textColor: string; backgroundColor: string },
    index: number
  ) => {
    ConfigService.setReaderConfig("backgroundColor", preset.backgroundColor);
    ConfigService.setReaderConfig("textColor", preset.textColor);
    this.props.handleBackgroundColor(preset.backgroundColor);
    const bgIndex = backgroundList
      .concat(ConfigService.getAllListConfig("themeColors"))
      .indexOf(preset.backgroundColor);
    const textIndex = textList
      .concat(ConfigService.getAllListConfig("themeColors"))
      .indexOf(preset.textColor);
    this.setState({
      currentBackgroundIndex: bgIndex,
      currentTextIndex: textIndex,
      currentPresetIndex: index,
      bgColorInput: normalizePickerColor(preset.backgroundColor, "#ffffff"),
      textColorInput: normalizePickerColor(preset.textColor, "#000000"),
    });
    this.props.renderBookFunc();
  };
  // 「背景色 / 文字色」两行圆球共用一套渲染：
  // 预设 → （手机端）补位色 → 用户自取色，只有用户自取的色带右上角删除键。
  // 手机端在预设之后插一个换行块，让自取色落到下一行。
  renderColorRow = (kind: "background" | "text") => {
    const isBg = kind === "background";
    const presets = isBg ? this.presetBgColors() : this.presetTextColors();
    const current = isBg ? this.currentBgColor() : this.currentTextColor();
    const { list, extraCount } = this.buildColorList(presets, current);
    // 桌面端：沿用原来的「点击时记录的下标」，行为与改动前逐字一致。
    // 手机端：预设被裁剪过、下标会漂移，改成按当前配置现算，保证选中的圆球一定对得上。
    const activeIndex = this.isMobilePanel()
      ? list.indexOf(current)
      : isBg
        ? this.state.currentBackgroundIndex
        : this.state.currentTextIndex;
    const customStart = presets.length + extraCount;
    return list.map((item, index) => (
      <React.Fragment key={kind + item + index}>
        {index === presets.length &&
          list.length > presets.length &&
          this.isMobilePanel() && <li className="color-list-break" />}
        <li
          className={
            index === activeIndex
              ? "active-color background-color-circle"
              : "background-color-circle"
          }
          onClick={() => {
            if (isBg) {
              this.handleChangeBgColor(item, index);
            } else {
              this.handleChooseTextColor(item);
            }
          }}
          style={{ backgroundColor: item }}
        >
          {index >= customStart && (
            <span
              className="icon-close theme-color-delete theme-color-delete-hover"
              onClick={(e) => {
                e.stopPropagation();
                ConfigService.deleteListConfig(item, "themeColors");
                if (index === activeIndex) {
                  if (isBg) {
                    this.handleChangeBgColor(presets[0], 0);
                  } else {
                    this.handleChooseTextColor(presets[0]);
                  }
                } else {
                  this.forceUpdate();
                }
              }}
            ></span>
          )}
        </li>
      </React.Fragment>
    ));
  };
  render() {
    const isMobile = this.isMobilePanel();
    const themePresets = KookitConfig.PresetThemeList;
    // 手机上默认只渲染第一行，桌面端照旧全量渲染。
    const visibleThemes =
      isMobile && !this.state.isShowAllThemes
        ? themePresets.slice(0, MOBILE_THEME_ROW)
        : themePresets;
    return (
      <div className="background-color-setting">
        <div
          className="background-color-text"
          style={{
            display: "flex",
            justifyContent: "flex-start",
            alignItems: "center",
          }}
        >
          <Trans>Background color</Trans>
          <span
            className="theme-color-clear-button"
            onClick={() => {
              ConfigService.setReaderConfig("backgroundColor", "");
              this.props.handleBackgroundColor("");
              toast.success(this.props.t("Removal successful"));
              this.props.renderBookFunc();
            }}
          >
            <Trans>Clear</Trans>{" "}
            <span className="icon-trash" style={{ fontSize: "13px" }}></span>
          </span>
        </div>
        <ul className="background-color-list">
          <li
            className="background-color-circle"
            onClick={() => {
              this.handleColorBgPicker(!this.state.isShowBgPicker);
            }}
          >
            <span
              className={this.state.isShowBgPicker ? "icon-check" : "icon-more"}
            ></span>
          </li>

          {this.renderColorRow("background")}
        </ul>
        {this.state.isShowBgPicker && (
          <div style={{ margin: "10px 20px" }}>
            <HexColorPicker
              color={normalizePickerColor(
                ConfigService.getReaderConfig("backgroundColor"),
                "#ffffff"
              )}
              onChange={this.handleChooseBgColor}
              style={{
                marginBottom: 10,
                animation: "fade-in 0.2s ease-in-out 0s 1",
              }}
            />
            <input
              className="color-input-box"
              value={this.state.bgColorInput}
              placeholder="#rrggbb / rgba(r,g,b,a)"
              onChange={(e) => this.setState({ bgColorInput: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const hex = parseColorInput(this.state.bgColorInput);
                  if (hex) this.handleChooseBgColor(hex);
                }
              }}
              onBlur={() => {
                const hex = parseColorInput(this.state.bgColorInput);
                if (hex) this.handleChooseBgColor(hex);
                else
                  this.setState({
                    bgColorInput: normalizePickerColor(
                      ConfigService.getReaderConfig("backgroundColor"),
                      "#ffffff"
                    ),
                  });
              }}
            />
          </div>
        )}
        <div
          className="background-color-text"
          style={{
            display: "flex",
            justifyContent: "flex-start",
            alignItems: "center",
          }}
        >
          <Trans>Text color</Trans>
          <span
            className="theme-color-clear-button"
            onClick={() => {
              ConfigService.setReaderConfig("textColor", "");
              toast.success(this.props.t("Removal successful"));
              this.props.renderBookFunc();
            }}
          >
            <Trans>Clear</Trans>{" "}
            <span className="icon-trash" style={{ fontSize: "13px" }}></span>
          </span>
        </div>
        <ul className="background-color-list">
          <li
            className="background-color-circle"
            onClick={() => {
              this.handleColorTextPicker(!this.state.isShowTextPicker);
            }}
          >
            <span
              className={
                this.state.isShowTextPicker ? "icon-check" : "icon-more"
              }
            ></span>
          </li>

          {this.renderColorRow("text")}
        </ul>
        {this.state.isShowTextPicker && (
          <div style={{ margin: "10px 20px" }}>
            <HexColorPicker
              color={normalizePickerColor(
                ConfigService.getReaderConfig("textColor"),
                "#000000"
              )}
              onChange={this.handleChooseTextColor}
              style={{
                marginBottom: 10,
                animation: "fade-in 0.2s ease-in-out 0s 1",
              }}
            />
            <input
              className="color-input-box"
              value={this.state.textColorInput}
              placeholder="#rrggbb / rgba(r,g,b,a)"
              onChange={(e) =>
                this.setState({ textColorInput: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const hex = parseColorInput(this.state.textColorInput);
                  if (hex) this.handleChooseTextColor(hex);
                }
              }}
              onBlur={() => {
                const hex = parseColorInput(this.state.textColorInput);
                if (hex) this.handleChooseTextColor(hex);
                else
                  this.setState({
                    textColorInput: normalizePickerColor(
                      ConfigService.getReaderConfig("textColor"),
                      "#000000"
                    ),
                  });
              }}
            />
          </div>
        )}
        <div
          className="background-color-text"
          style={{
            display: "flex",
            justifyContent: "flex-start",
            alignItems: "center",
          }}
        >
          <Trans>Theme</Trans>
        </div>
        <div className="preset-theme-list">
          {visibleThemes.map((item, index) => {
            return (
              <div
                key={item.key}
                className={"preset-theme-item"}
                style={{
                  backgroundColor: item.backgroundColor,
                  color: item.textColor,
                  borderColor: item.textColor,
                }}
                onClick={() => {
                  this.handleChoosePreset(item, index);
                }}
              >
                <span className="preset-theme-text">
                  {(ConfigService.getReaderConfig("lang") || "").startsWith(
                    "zh"
                  )
                    ? this.props.t(item.title)
                    : "A"}
                </span>
              </div>
            );
          })}
        </div>
        {isMobile && themePresets.length > MOBILE_THEME_ROW && (
          <span
            className="theme-expand-toggle"
            onClick={() => {
              this.setState({ isShowAllThemes: !this.state.isShowAllThemes });
            }}
          >
            {this.state.isShowAllThemes
              ? "收起"
              : `展开全部 ${themePresets.length} 个主题`}
            <span
              className={
                "icon-dropdown theme-expand-caret" +
                (this.state.isShowAllThemes ? " is-open" : "")
              }
            ></span>
          </span>
        )}
      </div>
    );
  }
}

export default ThemeList;
