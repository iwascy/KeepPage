import type { ViewRoute } from "./routes";

export function updateScopedSearch(
  page: ViewRoute["page"],
  search: string,
  actions: {
    setPrivateSearch: (value: string) => void;
    navigatePublicSearch: (value: string) => void;
    openPrivateList: () => void;
  },
) {
  if (page === "private-mode" || page === "private-detail") {
    actions.setPrivateSearch(search);
    if (page === "private-detail") actions.openPrivateList();
    return;
  }
  actions.navigatePublicSearch(search);
}
