import axios from "axios";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { SSE } from "sse.js";
import {
  CommonTool,
  ConfigService,
  TokenService,
} from "../../assets/lib/kookit-extra-browser.min";
import { getServerRegion, reloadManager } from "../common";
import { resetReaderRequest } from "./reader";
import { resetUserRequest } from "./user";
import { resetThirdpartyRequest } from "./thirdparty";
import { isElectron } from "react-device-detect";
export const getPublicUrl = () => {
  return "";
};
export const checkDeveloperUpdate = async () => {
  return { version: "" };
};
export const getPluginList = async () => {
  return [];
};
export const uploadFile = async (url: string, file: any) => {
  return new Promise<boolean>((resolve) => {
    axios
      .put(url, file, {})
      .then(() => {
        resolve(true);
      })
      .catch((err) => {
        console.error(err);
        resolve(false);
      });
  });
};
export const checkStableUpdate = async () => {
  return { version: "" };
};
export const handleExitApp = async () => {
  toast.error(i18n.t("Authorization failed, please login again"));
  await handleClearToken();
  //路由到login页面
  reloadManager();
};
export const handleClearToken = async () => {
  await TokenService.deleteToken("is_authed");
  await TokenService.deleteToken("access_token");
  await TokenService.deleteToken("refresh_token");
  let dataSourceList = ConfigService.getAllListConfig("dataSourceList") || [];
  for (let i = 0; i < dataSourceList.length; i++) {
    let targetDrive = dataSourceList[i];
    await TokenService.setToken(targetDrive + "_token", "");
  }
  ConfigService.removeItem("defaultSyncOption");
  ConfigService.removeItem("dataSourceList");
  resetReaderRequest();
  resetUserRequest();
  resetThirdpartyRequest();
};

export const chatStream = async (
  url: string,
  providerId: string,
  apiKey: string,
  model: string,
  prompt: string,
  chat: any[],
  onMessage: (result) => void
) => {
  return new Promise<{ done: boolean }>((resolve, reject) => {
    const messages = [...chat, { role: "user", content: prompt }];
    const source = new SSE(url + "/chat/completions", {
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      payload: JSON.stringify({
        model,
        messages,
        stream: true,
        ...CommonTool.getDisableThinkingParams(providerId || ""),
      }),
      method: "POST",
    });

    source.addEventListener("open", () => {
      console.info("ChatStream connection established.");
    });

    source.addEventListener("message", (e: any) => {
      if (!e.data) return;
      if (e.data === "[DONE]") {
        source.close();
        resolve({ done: true });
        return;
      }
      try {
        const json = JSON.parse(e.data);
        const text = json?.choices?.[0]?.delta?.content;
        if (text) {
          onMessage({ text });
        }
      } catch (err) {
        console.error("ChatStream parse error:", err);
      }
    });

    source.addEventListener("error", (e: any) => {
      console.error("ChatStream error:", e);
      toast.error(e.data ? JSON.stringify(e.data) : "Unknown error", {
        id: "chat-stream-error",
        duration: 5000,
      });
      source.close();
      reject(e);
    });
  });
};
export const getNotification = async () => {
  return {
    data: {
      result: "ok",
      unread: 0,
    },
  };
};

export const parseWithMineruAgent = async (file: any) => {
  throw new Error("MinerU parse service has been removed");
};
export const parseWithSystemOCR = async (imageBase64: string) => {
  if (!isElectron) {
    return;
  }
  const { ipcRenderer } = window.require("electron");
  let result = await ipcRenderer.invoke("system-ocr", {
    base64: imageBase64,
    lang: "auto",
  });
  console.log("System OCR result:", result);
  return result.text || "";
};
