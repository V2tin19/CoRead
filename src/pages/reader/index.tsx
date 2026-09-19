import {
  handleFetchNotes,
  handleFetchBookmarks,
  handleFetchBooks,
  handleReadingBook,
  handleFetchPercentage,
  handleReaderMode,
  handleMenuMode,
  handleOriginalText,
  handleOpenMenu,
  handleConvertDialog,
  handlePdfCropDialog,
  handleSpeechDialog,
  handleScale,
  handleFetchAuthed,
  handleFetchUserInfo,
  handleSetting,
} from "../../store/actions";
import { connect } from "react-redux";
import { stateType } from "../../store";
import Reader from "./component";
import { withTranslation } from "react-i18next";

const mapStateToProps = (state: stateType) => {
  return {
    currentBook: state.book.currentBook,
    percentage: state.progressPanel.percentage,
    htmlBook: state.reader.htmlBook,
    // 手机端顶栏那个「当前页有书签」的小旗要按这个列表比对当前页指纹
    bookmarks: state.reader.bookmarks,
    readerMode: state.reader.readerMode,
    isNavLocked: state.reader.isNavLocked,
    isConvertOpen: state.reader.isConvertOpen,
    isPdfCropOpen: state.reader.isPdfCropOpen,
    isSpeechOpen: state.reader.isSpeechOpen,
    isOpenPopupOptionDialog: state.backupPage.isOpenPopupOptionDialog,
    isSettingLocked: state.reader.isSettingLocked,
    isAuthed: state.manager.isAuthed,
    isSearch: state.manager.isSearch,
    isSettingOpen: state.manager.isSettingOpen,
    scale: state.reader.scale,
    renderBookFunc: state.book.renderBookFunc,
    isHidePageButton: state.reader.isHidePageButton,
    isHideMenuButton: state.reader.isHideMenuButton,
    isHideAudiobookButton: state.reader.isHideAudiobookButton,
    isHideAIButton: state.reader.isHideAIButton,
    isHidePDFConvertButton: state.reader.isHidePDFConvertButton,
    isHideScaleButton: state.reader.isHideScaleButton,
  };
};
const actionCreator = {
  handleFetchNotes,
  handleFetchBookmarks,
  handleFetchBooks,
  handleReadingBook,
  handleFetchPercentage,
  handleReaderMode,
  handleMenuMode,
  handleOriginalText,
  handleOpenMenu,
  handleConvertDialog,
  handlePdfCropDialog,
  handleScale,
  handleFetchAuthed,
  handleSpeechDialog,
  handleFetchUserInfo,
  handleSetting,
};
export default connect(
  mapStateToProps,
  actionCreator
)(withTranslation()(Reader as any) as any);
