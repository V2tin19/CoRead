import { RouteComponentProps } from "react-router-dom";

export interface SettingInfoProps extends RouteComponentProps<any> {
  t: (title: string) => string;
  viewMode?: string;
  handleFetchViewMode?: () => void;
}
export interface SettingInfoState {
  viewMode: string;
  cardScale: number;
  appSkin: string;
  currentThemeIndex: number;
  isShowCustomColorPicker: boolean;
  customColor: string;
  pendingCustomColor: string;
  fontListVersion: number;
  fontOptions: { label: string; value: string }[];
  isDisablePDFCover: boolean;
  isDisableCrop: boolean;
  isShowShelfBookCount: boolean;
  isCustomSystemCSS: boolean;
  customSystemCSS: string;
  ttsHighlightStyleType: string;
  ttsHighlightColor: string;
  searchHighlightStyleType: string;
  searchHighlightColor: string;
}
