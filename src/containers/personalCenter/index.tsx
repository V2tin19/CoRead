import { connect } from "react-redux";
import { withRouter } from "react-router-dom";
import { withTranslation } from "react-i18next";
import { handleFetchPlugins } from "../../store/actions";
import PersonalCenter from "./component";

export default connect(
  null,
  { handleFetchPlugins }
)(withRouter(withTranslation()(PersonalCenter as any) as any) as any);

