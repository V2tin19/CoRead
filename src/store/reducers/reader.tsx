import { HighlightUtil } from '../../services';
import { configStore } from '../../core/ports/stores';

const highlightUtil = new HighlightUtil(configStore);
const initState = {
  bookmarks: [],
  notes: [],
  highlights: [],
  chapters: null,
  currentChapter: "",
  currentChapterIndex: 0,
  highlight: highlightUtil.getNoteHighlightValue(),
  backgroundColor:
    configStore.getReaderConfig("isMergeWord") === "yes"
      ? "rgba(0,0,0,0)"
      : configStore.getReaderConfig("backgroundColor")
        ? configStore.getReaderConfig("backgroundColor")
        : configStore.getReaderConfig("appSkin") === "night" ||
            (configStore.getReaderConfig("appSkin") === "system" &&
              configStore.getReaderConfig("isOSNight") === "yes")
          ? "rgba(44,47,49,1)"
          : "rgba(255,255,255,1)",
  noteKey: "",
  originalText: "",
  originalSentence: "",
  quoteText: "",
  htmlBook: null,
  scale: configStore.getReaderConfig("scale") || "1",
  margin: configStore.getReaderConfig("margin") || "0",
  section: null,
  readerMode: "double",
  isConvertOpen: false,
  isPdfCropOpen: false,
  isSpeechOpen: false,
  speechStartText: "",
  isSpeechAutoStart: false,
  isNavLocked: configStore.getReaderConfig("isNavLocked") === "yes",
  isSettingLocked: configStore.getReaderConfig("isSettingLocked") === "yes",
  isHideFooter: configStore.getReaderConfig("isHideFooter") === "yes",
  isHideBackground: configStore.getReaderConfig("isHideBackground") === "yes",
  isHidePageButton: configStore.getReaderConfig("isHidePageButton") === "yes",
  isHideMenuButton: configStore.getReaderConfig("isHideMenuButton") === "yes",
  isHideAudiobookButton:
    configStore.getReaderConfig("isHideAudiobookButton") === "yes",
  isHideAIButton: configStore.getReaderConfig("isHideAIButton") === "yes",
  isHideScaleButton:
    configStore.getReaderConfig("isHideScaleButton") === "yes",
  isHidePDFConvertButton:
    configStore.getReaderConfig("isHidePDFConvertButton") === "yes",
  isShowPageBorder: configStore.getReaderConfig("isShowPageBorder") === "yes",
  textOrientation: configStore.getReaderConfig("textOrientation") || "",
  jumpPosition: null as object | null,
  readerBackgroundImage:
    configStore.getReaderConfig("readerBackgroundImage") || "",
};
export function reader(
  state = initState,
  action: { type: string; payload: any }
) {
  switch (action.type) {
    case "HANDLE_BOOKMARKS":
      return {
        ...state,
        bookmarks: action.payload,
      };
    case "HANDLE_NOTES":
      return {
        ...state,
        notes: action.payload,
      };
    case "HANDLE_HIGHLIGHTS":
      return {
        ...state,
        highlights: action.payload,
      };

    case "HANDLE_CURRENT_CHAPTER":
      return {
        ...state,
        currentChapter: action.payload,
      };
    case "HANDLE_CONVERT_DIALOG":
      return {
        ...state,
        isConvertOpen: action.payload,
      };
    case "HANDLE_PDF_CROP_DIALOG":
      return {
        ...state,
        isPdfCropOpen: action.payload,
      };
    case "HANDLE_SPEECH_DIALOG":
      return {
        ...state,
        isSpeechOpen: action.payload,
      };
    case "HANDLE_SPEECH_START_TEXT":
      return {
        ...state,
        speechStartText: action.payload,
      };
    case "HANDLE_SPEECH_AUTO_START":
      return {
        ...state,
        isSpeechAutoStart: action.payload,
      };
    case "HANDLE_CURRENT_CHAPTER_INDEX":
      return {
        ...state,
        currentChapterIndex: action.payload,
      };
    case "HANDLE_ORIGINAL_TEXT":
      return {
        ...state,
        originalText: action.payload,
      };
    case "HANDLE_QUOTE_TEXT":
      return {
        ...state,
        quoteText: action.payload,
      };
    case "HANDLE_ORIGINAL_SENTENCE":
      return {
        ...state,
        originalSentence: action.payload,
      };
    case "HANDLE_NAV_LOCK":
      return {
        ...state,
        isNavLocked: action.payload,
      };
    case "HANDLE_SETTING_LOCK":
      return {
        ...state,
        isSettingLocked: action.payload,
      };
    case "HANDLE_HIDE_FOOTER":
      return {
        ...state,
        isHideFooter: action.payload,
      };
    case "HANDLE_HIDE_BACKGROUND":
      return {
        ...state,
        isHideBackground: action.payload,
      };
    case "HANDLE_HIDE_PAGE_BUTTON":
      return {
        ...state,
        isHidePageButton: action.payload,
      };
    case "HANDLE_HIDE_MENU_BUTTON":
      return {
        ...state,
        isHideMenuButton: action.payload,
      };
    case "HANDLE_HIDE_AUDIOBOOK_BUTTON":
      return {
        ...state,
        isHideAudiobookButton: action.payload,
      };
    case "HANDLE_HIDE_AI_BUTTON":
      return {
        ...state,
        isHideAIButton: action.payload,
      };
    case "HANDLE_HIDE_SCALE_BUTTON":
      return {
        ...state,
        isHideScaleButton: action.payload,
      };
    case "HANDLE_HIDE_PDF_CONVERT_BUTTON":
      return {
        ...state,
        isHidePDFConvertButton: action.payload,
      };
    case "HANDLE_SHOW_BORDER":
      return {
        ...state,
        isShowPageBorder: action.payload,
      };
    case "HANDLE_TEXT_ORIENTATION":
      return {
        ...state,
        textOrientation: action.payload,
      };
    case "HANDLE_HTML_BOOK":
      return {
        ...state,
        htmlBook: action.payload,
      };
    case "HANDLE_HIGHLIGHT":
      return {
        ...state,
        highlight: action.payload,
      };
    case "HANDLE_BACKGROUND_COLOR":
      return {
        ...state,
        backgroundColor: action.payload,
      };
    case "HANDLE_READER_BACKGROUND_IMAGE":
      return {
        ...state,
        readerBackgroundImage: action.payload,
      };
    case "HANDLE_NOTE_KEY":
      return {
        ...state,
        noteKey: action.payload,
      };
    case "HANDLE_SECTION":
      return {
        ...state,
        section: action.payload,
      };
    case "HANDLE_CHAPTERS":
      return {
        ...state,
        chapters: action.payload,
      };
    case "HANDLE_JUMP_POSITION":
      return {
        ...state,
        jumpPosition: action.payload,
      };
    case "HANDLE_READER_MODE":
      return {
        ...state,
        readerMode: action.payload,
      };
    case "HANDLE_SCALE":
      return {
        ...state,
        scale: action.payload,
      };
    case "HANDLE_MARGIN":
      return {
        ...state,
        margin: action.payload,
      };
    default:
      return state;
  }
}
