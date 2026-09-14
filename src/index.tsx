import React from "react";
import ReactDOM from "react-dom";
import "./assets/styles/reset.css";
import "./assets/styles/global.css";
import "./assets/styles/style.css";
// 弹窗公共按钮样式(add-dialog-* 类,被删书/编辑等多个弹窗复用)
import "./components/dialogs/dialogButtons.css";
import { Provider } from "react-redux";
import "./i18n";
import store from "./store";
import Router from "./router/index";
import StyleUtil from "./utils/reader/styleUtil";
import {
  initSystemFont,
  initTheme,
  applyCustomSystemCSS,
  applyAppBackgroundImage,
} from "./utils/reader/launchUtil";
import { migrateConfig } from "./utils/common";
initTheme();
initSystemFont();
migrateConfig();
applyCustomSystemCSS();
applyAppBackgroundImage();
// 共读邀请链接形如 /?collab=ABC123,用户落地时可能还没打开书,
// 先把房间号暂存,等共读面板打开时再取出
{
  const collabRoom = new URLSearchParams(window.location.search).get("collab");
  if (collabRoom && /^[a-zA-Z0-9]{1,16}$/.test(collabRoom)) {
    localStorage.setItem("koodo-collab-pending-room", collabRoom.toUpperCase());
    window.history.replaceState({}, "", window.location.pathname);
  }
}
const container = document.getElementById("root")!;
ReactDOM.render(
  <Provider store={store}>
    <Router />
  </Provider>,
  container
);
StyleUtil.applyTheme();
