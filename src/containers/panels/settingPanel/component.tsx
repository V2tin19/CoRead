import React from "react";
import "./settingPanel.css";
import ThemeList from "../../../components/readerSettings/themeList";
import SliderList from "../../../components/readerSettings/sliderList";
import DropdownList from "../../../components/readerSettings/dropdownList";
import ModeControl from "../../../components/readerSettings/modeControl";
import SettingSwitch from "../../../components/readerSettings/settingSwitch";
import { SettingPanelProps, SettingPanelState } from "./interface";
import { Trans } from "react-i18next";
import {
  KookitConfig,
} from '../../../services';
import { configStore } from '../../../core/ports/stores';
import { sliderConfigs } from "../../../constants/dropdownList";
import { isMobileRuntime } from "../../../utils/mobileRuntime";
import toast from "react-hot-toast";

class SettingPanel extends React.Component<
  SettingPanelProps,
  SettingPanelState
> {
  constructor(props: SettingPanelProps) {
    super(props);
    this.state = {
      isSettingLocked:
        configStore.getReaderConfig("isSettingLocked") === "yes"
          ? true
          : false,
      isShowMenu: false,
    };
  }

  componentDidMount() {
    // 手机端把遗留的「锁定」清掉。
    // 锁定键在手机上已隐藏（见 pages/reader/index.css）：它原本的作用是
    // 「鼠标移开也不收起面板」，手机没有 hover 也就没有可感知效果；
    // 但它会让阅读器一进书就自动展开右侧抽屉（isOpenRightPanel 初值取自它），
    // 上一个版本点过锁的用户会一直中招，所以这里主动归零一次。
    // 只改本机 readerConfig，桌面端另有自己的一份配置。
    if (isMobileRuntime() && this.props.isSettingLocked) {
      this.props.handleSettingLock(false);
      configStore.setReaderConfig("isSettingLocked", "no");
    }
  }

  handleLock = () => {
    this.props.handleSettingLock(!this.props.isSettingLocked);
    configStore.setReaderConfig(
      "isSettingLocked",
      !this.props.isSettingLocked ? "yes" : "no"
    );
    setTimeout(() => {
      this.props.renderBookFunc();
    }, 300);
  };

  handleClearAllStyle = () => {
    if (
      configStore.getAllListConfig("seperateStyleBooks").includes(
        this.props.currentBook.key
      )
    ) {
      configStore.deleteObjectConfig(
        this.props.currentBook.key,
        "seperateStyleConfig"
      );
    } else {
      const readerConfig = JSON.parse(
        configStore.getItem("readerConfig") || "{}"
      );
      KookitConfig.StyleKeys.forEach((key) => delete readerConfig[key]);
      configStore.setItem("readerConfig", JSON.stringify(readerConfig));
    }

    toast.success(this.props.t("Clear successful"));
    this.props.renderBookFunc();
  };

  render() {
    return (
      <div
        className="setting-panel-parent"
        style={{
          backgroundColor: this.props.isSettingLocked
            ? this.props.backgroundColor
            : "",
          color: this.props.isSettingLocked
            ? configStore.getReaderConfig("textColor")
            : "",
        }}
      >
        <span
          className={
            this.props.isSettingLocked
              ? "icon-lock lock-icon"
              : "icon-unlock lock-icon"
          }
          onClick={() => {
            this.handleLock();
          }}
        ></span>

        <div className="setting-panel-title">
          <Trans>Reading option</Trans>
        </div>
        <div className="setting-panel">
          <ModeControl />
          <ThemeList />
          {sliderConfigs
            .filter((item) => {
              if (
                this.props.currentBook.format === "PDF" &&
                !configStore.getAllListConfig("convertPDFBooks").includes(
                  this.props.currentBook.key
                )
              ) {
                return item.isPDF;
              }
              return true;
            })
            .map((item) => (
              <SliderList key={item.mode} {...{ item }} />
            ))}

          <DropdownList />

          <SettingSwitch />
          <div className="setting-panel-menu" style={{ marginTop: "5px" }}>
            <span
              className="icon-more menu-icon"
              onClick={() => {
                this.setState({ isShowMenu: !this.state.isShowMenu });
              }}
              style={{ fontSize: "15px" }}
            ></span>
          </div>
          <div
            className="action-dialog-container"
            style={{
              right: 5,
              top: 5,
              width: 150,
              display: this.state.isShowMenu ? "block" : "none",
            }}
            onMouseLeave={() => {
              this.setState({ isShowMenu: false });
            }}
          >
            <div className="action-dialog-actions-container" style={{}}>
              <div
                className="action-dialog-add"
                onClick={() => {
                  this.handleClearAllStyle();
                }}
              >
                <p className="action-name">
                  <Trans>Clear all style</Trans>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default SettingPanel;
