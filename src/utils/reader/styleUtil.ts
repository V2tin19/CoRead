import { getIframeDoc } from "./docUtil";
import { ConfigService } from '../../services';
import { applyThemeColor, removeThemeColor } from "./themeUtil";
import { StyleHelper } from "../../assets/lib/kookit.min";
import FontUtil from "../file/fontUtil";

class styleUtil {
  // add default css for iframe
  static addDefaultCss(bookKey: string) {
    let doc = getIframeDoc("ANY")[0];
    if (!doc) return;
    if (!doc.head) {
      return;
    }
    //get style with id of default-style
    let styleElement = doc.getElementById("default-style");
    if (styleElement) {
      styleElement.textContent = this.getDefaultCss(bookKey);
    } else {
      let css = this.getDefaultCss(bookKey);
      let style = doc.createElement("style");
      style.id = "default-style";
      style.textContent = css;
      doc.head.appendChild(style);
    }
    // 窄屏(手机)排版收边:出版书的排版 CSS(外链 .css,kookit 会保留)常给
    // body/正文块留 2em 上下的左右留白,小屏上正文被挤成窄窄一条。
    // 这里在手机宽度下把这些水平留白收掉,只动 body 及其直接子元素,
    // 不碰更深层的缩进(引用/列表/诗行照旧)。桌面上不生效。
    let narrowStyleElement = doc.getElementById("kookit-narrow-style");
    const narrowCss = `@media screen and (max-width: 570px) {
      html body {
        margin-left: 0 !important; margin-right: 0 !important;
        padding-left: 0 !important; padding-right: 0 !important;
        max-width: 100% !important;
      }
      html body > div, html body > p, html body > section,
      html body > article, html body > main, html body > header,
      html body > footer, html body > span,
      html body p, html body div {
        margin-left: 0 !important; margin-right: 0 !important;
        padding-left: 0 !important; padding-right: 0 !important;
        max-width: 100% !important;
      }
    }`;
    if (narrowStyleElement) {
      narrowStyleElement.textContent = narrowCss;
    } else {
      let narrowStyle = doc.createElement("style");
      narrowStyle.id = "kookit-narrow-style";
      narrowStyle.textContent = narrowCss;
      doc.head.appendChild(narrowStyle);
    }
    // inject custom book CSS if enabled
    let customCssElement = doc.getElementById("custom-book-style");
    const isCustomBookCSS =
      ConfigService.getReaderConfig("isCustomBookCSS") === "yes";
    const customBookCSS = ConfigService.getReaderConfig("customBookCSS") || "";
    if (isCustomBookCSS && customBookCSS) {
      if (customCssElement) {
        customCssElement.textContent = customBookCSS;
      } else {
        let customStyle = doc.createElement("style");
        customStyle.id = "custom-book-style";
        customStyle.textContent = customBookCSS;
        doc.head.appendChild(customStyle);
      }
    } else if (customCssElement) {
      customCssElement.textContent = "";
    }
  }
  // get default css for iframe
  static getDefaultCss(bookKey: string) {
    return StyleHelper.getDefaultCss(ConfigService, bookKey);
  }

  static async applyReaderFonts(rendition: any): Promise<void> {
    if (!rendition?.displayFontUrl) return;

    const fontName = ConfigService.getReaderConfig("fontFamily");
    const subFontName = ConfigService.getReaderConfig("subFontFamily");

    if (fontName && FontUtil.isCustomFont(fontName)) {
      const url = await FontUtil.getFontUrl(fontName);
      if (url) await rendition.displayFontUrl(fontName, url);
    }

    if (subFontName && FontUtil.isCustomFont(subFontName)) {
      const url = await FontUtil.getFontUrl(subFontName);
      if (url) await rendition.displayFontUrl(subFontName, url);
    }
  }

  static applyTheme() {
    const themeColor = ConfigService.getReaderConfig("themeColor");
    if (themeColor && themeColor !== "default") {
      applyThemeColor(themeColor);
    } else {
      removeThemeColor();
    }
  }
}

export default styleUtil;
