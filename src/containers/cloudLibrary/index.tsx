import { connect } from "react-redux";
import { stateType } from "../../store";
import { handleReadingBook } from "../../store/actions";
import CloudLibrary from "./component";

const mapStateToProps = (state: stateType) => {
  return {
    importBookFunc: state.book.importBookFunc,
    isCollapsed: state.sidebar.isCollapsed,
    viewMode: state.manager.viewMode,
  };
};

const actionCreator = {
  handleReadingBook,
};

export default connect(
  mapStateToProps,
  actionCreator
)(CloudLibrary as any);
