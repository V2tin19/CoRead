import { connect } from "react-redux";
import { stateType } from "../../store";
import CollabPanel from "./component";
import { handleFetchNotes } from "../../store/actions";

const mapStateToProps = (state: stateType) => {
  return {
    currentBook: state.book.currentBook,
    htmlBook: state.reader.htmlBook,
  };
};

const actionCreator = {
  handleFetchNotes,
};

export default connect(mapStateToProps, actionCreator)(CollabPanel as any);
