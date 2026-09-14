import { withRouter } from "react-router-dom";
import { withTranslation } from "react-i18next";
import PersonalCenter from "./component";

export default withRouter(withTranslation()(PersonalCenter as any) as any);
