import { connect } from "react-redux";
import AppearanceSetting from "./component";
import { withTranslation } from "react-i18next";
import { withRouter } from "react-router-dom";

import { handleFetchViewMode } from "../../../store/actions";
import { stateType } from "../../../store";

const mapStateToProps = (state: stateType) => {
  return {
    viewMode: state.manager.viewMode,
  };
};
const actionCreator = {
  handleFetchViewMode,
};
export default connect(
  mapStateToProps,
  actionCreator
)(withTranslation()(withRouter(AppearanceSetting as any) as any) as any);
