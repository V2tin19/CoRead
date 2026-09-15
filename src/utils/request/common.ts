import axios from "axios";
import toast from "react-hot-toast";
import { SSE } from "sse.js";
import { isElectron } from "react-device-detect";
import { getDisableThinkingParams } from "../../constants/aiConfig";

export const getPublicUrl = () => {
  return "";
};

export const checkDeveloperUpdate = async () => {
  return { version: "" };
};

export const checkStableUpdate = async () => {
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

export const handleExitApp = async () => {
  // No-op in offline / decoupled mode
};

export const handleClearToken = async () => {
  // No-op in offline / decoupled mode
};

export const chatStream = async (
  url: string,
  providerId: string,
  apiKey: string,
  model: string,
  prompt: string,
  chat: any[],
  onMessage: (result: { text?: string; done?: boolean }) => void
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
        ...getDisableThinkingParams(providerId || ""),
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

export const parseWithMineruAgent = async (_file: any) => {
  throw new Error("MinerU parse service has been removed");
};

export const parseWithSystemOCR = async (imageBase64: string) => {
  if (!isElectron) {
    return "";
  }
  const { ipcRenderer } = window.require("electron");
  let result = await ipcRenderer.invoke("system-ocr", {
    base64: imageBase64,
    lang: "auto",
  });
  console.log("System OCR result:", result);
  return result.text || "";
};
