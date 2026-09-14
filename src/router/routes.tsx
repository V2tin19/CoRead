import BookList from "../containers/lists/bookList";
import EmptyPage from "../containers/emptyPage";
import CloudLibrary from "../containers/cloudLibrary";
import PersonalCenter from "../containers/personalCenter";

export const routes = [
  { path: "/manager/empty", component: EmptyPage },
  { path: "/manager/home", component: BookList },
  { path: "/manager/favorite", component: BookList },
  { path: "/manager/cloud", component: CloudLibrary },
  { path: "/manager/profile", component: PersonalCenter },
];
