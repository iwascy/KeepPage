import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error Native Node TypeScript tests require explicit .ts extensions.
import { updateScopedSearch } from "./search-scope.ts";

test("private searches never update the public query or URL", () => {
  for (const page of ["private-mode", "private-detail"] as const) {
    let privateQuery = "";
    let publicQuery = "existing-public-search";
    let hash = page === "private-detail" ? "#/private/bookmarks/id" : "#/settings/private-mode";
    updateScopedSearch(page, "private-keyword", {
      setPrivateSearch: (value) => { privateQuery = value; },
      navigatePublicSearch: (value) => { publicQuery = value; hash = `#/?q=${value}`; },
      openPrivateList: () => { hash = "#/settings/private-mode"; },
    });
    assert.equal(privateQuery, "private-keyword");
    assert.equal(publicQuery, "existing-public-search");
    assert.equal(hash, "#/settings/private-mode");
    assert.equal(hash.includes("private-keyword"), false);
  }
});

test("ordinary-page searches still open the public list", () => {
  let publicQuery = "";
  updateScopedSearch("settings-api-tokens", "gorm", {
    setPrivateSearch: () => { assert.fail("private state changed"); },
    openPrivateList: () => { assert.fail("private navigation"); },
    navigatePublicSearch: (value) => { publicQuery = value; },
  });
  assert.equal(publicQuery, "gorm");
});
