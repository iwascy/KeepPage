package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/repository"
)

type privateTestClient struct {
	t            *testing.T
	server       *Server
	token        string
	privateToken string
}

func (c privateTestClient) do(method, path, body string) *httptest.ResponseRecorder {
	c.t.Helper()
	var reader io.Reader
	if body != "" {
		reader = bytes.NewBufferString(body)
	}
	request := httptest.NewRequest(method, path, reader)
	request.Header.Set("authorization", "Bearer "+c.token)
	if c.privateToken != "" {
		request.Header.Set("x-keeppage-private-token", c.privateToken)
	}
	response := httptest.NewRecorder()
	c.server.Router().ServeHTTP(response, request)
	return response
}

func (c privateTestClient) expect(method, path, body string, status int, out any) *httptest.ResponseRecorder {
	c.t.Helper()
	response := c.do(method, path, body)
	if response.Code != status {
		c.t.Fatalf("%s %s status = %d, want %d, body = %s", method, path, response.Code, status, response.Body.String())
	}
	if out != nil {
		if err := json.Unmarshal(response.Body.Bytes(), out); err != nil {
			c.t.Fatalf("%s %s decode: %v (%s)", method, path, err, response.Body.String())
		}
	}
	return response
}

func (c privateTestClient) expectError(method, path, body string, status int, code string) {
	c.t.Helper()
	response := c.expect(method, path, body, status, nil)
	if !strings.Contains(response.Body.String(), `"error":"`+code+`"`) {
		c.t.Fatalf("%s %s expected error %s, got %s", method, path, code, response.Body.String())
	}
}

func unlockPrivateClient(t *testing.T, server *Server, email string) privateTestClient {
	t.Helper()
	client := privateTestClient{t: t, server: server, token: registerTestUser(t, server, email)}
	var unlock struct {
		PrivateToken string `json:"privateToken"`
	}
	client.expect(http.MethodPost, "/private-mode/setup", `{"password":"super-secret"}`, http.StatusCreated, &unlock)
	if unlock.PrivateToken == "" {
		t.Fatal("missing private token")
	}
	client.privateToken = unlock.PrivateToken
	return client
}

func seedPrivateBookmark(t *testing.T, repo *repository.MemoryRepository, server *Server, token string, rawURL string) string {
	t.Helper()
	claims, err := server.auth.AuthenticateBearer(context.Background(), token, auth.RequireOptions{})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	hash := strings.Repeat("a", 64)
	initResult, err := repo.InitPrivateCapture(ctx, claims.ID, domain.CaptureInitRequest{URL: rawURL, Title: "Private Page", HTMLSHA256: hash, FileSize: 10, Profile: "standard"})
	if err != nil {
		t.Fatal(err)
	}
	text := "secret archive body"
	result, err := repo.CompletePrivateCapture(ctx, claims.ID, domain.CaptureCompleteRequest{ObjectKey: initResult.ObjectKey, HTMLSHA256: hash, ExtractedText: &text, Quality: domain.QualityReport{Grade: "high"}, Source: domain.CaptureSource{URL: rawURL, Title: "Private Page", Domain: "private.example"}})
	if err != nil {
		t.Fatal(err)
	}
	return result.Bookmark.ID
}

type testFolder struct {
	ID   string `json:"id"`
	Path string `json:"path"`
}

type testTag struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type testBookmark struct {
	ID         string      `json:"id"`
	Note       string      `json:"note"`
	IsFavorite bool        `json:"isFavorite"`
	Folder     *testFolder `json:"folder"`
	Tags       []testTag   `json:"tags"`
}

type testSearch struct {
	Items []testBookmark `json:"items"`
	Total int            `json:"total"`
}

func TestPrivateWorkspaceTaxonomy(t *testing.T) {
	repo := repository.NewMemoryRepository()
	server := newTestServerWithRepo(repo)
	alice := unlockPrivateClient(t, server, "private-taxonomy@example.com")
	locked := alice
	locked.privateToken = ""
	for _, route := range [][2]string{{http.MethodGet, "/private/workspace/bootstrap"}, {http.MethodGet, "/private/folders"}, {http.MethodPost, "/private/tags"}, {http.MethodGet, "/private/bookmarks/sidebar-stats"}, {http.MethodDelete, "/private/bookmarks/x"}} {
		locked.expectError(route[0], route[1], `{"name":"x"}`, http.StatusUnauthorized, "PrivateModeLocked")
	}

	var publicFolder testFolder
	alice.expect(http.MethodPost, "/folders", `{"name":"Public"}`, http.StatusCreated, &publicFolder)
	var publicTag testTag
	alice.expect(http.MethodPost, "/tags", `{"name":"public-tag"}`, http.StatusCreated, &publicTag)
	var secret, deep testFolder
	alice.expect(http.MethodPost, "/private/folders", `{"name":"Secret"}`, http.StatusCreated, &secret)
	alice.expect(http.MethodPost, "/private/folders", `{"name":"Deep","parentId":"`+secret.ID+`"}`, http.StatusCreated, &deep)
	alice.expectError(http.MethodPost, "/private/folders", `{"name":"Child","parentId":"`+publicFolder.ID+`"}`, http.StatusNotFound, "FolderNotFound")
	var hidden testTag
	alice.expect(http.MethodPost, "/private/tags", `{"name":"hidden","color":"#000000"}`, http.StatusCreated, &hidden)

	bookmarkID := seedPrivateBookmark(t, repo, server, alice.token, "https://private.example/page")
	metadataPath := "/private/bookmarks/" + bookmarkID + "/metadata"
	alice.expectError(http.MethodPatch, metadataPath, `{}`, http.StatusBadRequest, "ValidationError")
	var updated testBookmark
	alice.expect(http.MethodPatch, metadataPath, `{"folderId":"`+deep.ID+`","tagIds":["`+hidden.ID+`","`+publicTag.ID+`"],"note":"n","isFavorite":true}`, http.StatusOK, &updated)
	if updated.Folder == nil || updated.Folder.Path != "Secret/Deep" || len(updated.Tags) != 1 || updated.Tags[0].ID != hidden.ID || updated.Note != "n" || !updated.IsFavorite {
		t.Fatalf("unexpected metadata update: %+v", updated)
	}
	alice.expectError(http.MethodPatch, metadataPath, `{"folderId":"`+publicFolder.ID+`"}`, http.StatusNotFound, "FolderNotFound")

	for query, want := range map[string]int{
		"folderId=" + secret.ID: 1, "folderId=" + deep.ID: 1, "folderId=" + publicFolder.ID: 0,
		"tagId=" + hidden.ID: 1, "tagId=" + publicTag.ID: 0, "q=hidden": 1, "q=Secret": 1, "q=nomatch": 0,
	} {
		var result testSearch
		alice.expect(http.MethodGet, "/private/bookmarks?"+query, "", http.StatusOK, &result)
		if result.Total != want {
			t.Fatalf("private search %s total = %d, want %d", query, result.Total, want)
		}
		if want == 1 && (result.Items[0].Folder == nil || len(result.Items[0].Tags) != 1) {
			t.Fatalf("private search %s missing folder/tags: %+v", query, result.Items[0])
		}
	}

	if body := alice.expect(http.MethodGet, "/folders", "", http.StatusOK, nil).Body.String(); strings.Contains(body, "Secret") || !strings.Contains(body, "Public") {
		t.Fatalf("public folders leaked private taxonomy: %s", body)
	}
	if body := alice.expect(http.MethodGet, "/workspace/bootstrap", "", http.StatusOK, nil).Body.String(); strings.Contains(body, "hidden") || strings.Contains(body, "Secret") {
		t.Fatalf("public bootstrap leaked private taxonomy: %s", body)
	}
	var bootstrap struct {
		Folders      []testFolder         `json:"folders"`
		Tags         []testTag            `json:"tags"`
		FolderCounts []domain.FolderCount `json:"folderCounts"`
	}
	alice.expect(http.MethodGet, "/private/workspace/bootstrap", "", http.StatusOK, &bootstrap)
	if len(bootstrap.Folders) != 2 || len(bootstrap.Tags) != 1 || len(bootstrap.FolderCounts) != 1 || bootstrap.FolderCounts[0].FolderID != deep.ID || bootstrap.FolderCounts[0].Count != 1 {
		t.Fatalf("unexpected private bootstrap: %+v", bootstrap)
	}
	var stats domain.BookmarkSidebarStatsResponse
	alice.expect(http.MethodGet, "/private/bookmarks/sidebar-stats", "", http.StatusOK, &stats)
	if len(stats.FolderCounts) != 1 {
		t.Fatalf("unexpected private stats: %+v", stats)
	}

	alice.expect(http.MethodPatch, "/private/folders/"+secret.ID, `{"name":"Vault"}`, http.StatusOK, nil)
	alice.expectError(http.MethodPatch, "/private/folders/"+publicFolder.ID, `{"name":"Nope"}`, http.StatusNotFound, "FolderNotFound")
	alice.expect(http.MethodPatch, "/private/tags/"+hidden.ID, `{"name":"concealed"}`, http.StatusOK, nil)
	alice.expectError(http.MethodPatch, "/private/tags/"+publicTag.ID, `{"name":"nope"}`, http.StatusNotFound, "TagNotFound")
	var detail struct {
		Bookmark testBookmark `json:"bookmark"`
	}
	alice.expect(http.MethodGet, "/private/bookmarks/"+bookmarkID, "", http.StatusOK, &detail)
	if detail.Bookmark.Folder == nil || detail.Bookmark.Folder.Path != "Vault/Deep" || len(detail.Bookmark.Tags) != 1 || detail.Bookmark.Tags[0].Name != "concealed" {
		t.Fatalf("private detail did not follow taxonomy rename: %+v", detail.Bookmark)
	}

	alice.expect(http.MethodPatch, metadataPath, `{"folderPath":"New/Path","tags":["fresh"]}`, http.StatusOK, &updated)
	if updated.Folder == nil || updated.Folder.Path != "New/Path" || len(updated.Tags) != 1 || updated.Tags[0].Name != "fresh" {
		t.Fatalf("unexpected path/name metadata update: %+v", updated)
	}
	if body := alice.expect(http.MethodGet, "/tags", "", http.StatusOK, nil).Body.String(); strings.Contains(body, "fresh") {
		t.Fatalf("private tag created in public taxonomy: %s", body)
	}
	if body := alice.expect(http.MethodGet, "/folders", "", http.StatusOK, nil).Body.String(); strings.Contains(body, "New") {
		t.Fatalf("private folder created in public taxonomy: %s", body)
	}
	var freshTags struct {
		Items []testTag `json:"items"`
	}
	alice.expect(http.MethodGet, "/private/tags", "", http.StatusOK, &freshTags)
	var freshID string
	for _, tag := range freshTags.Items {
		if tag.Name == "fresh" {
			freshID = tag.ID
		}
	}
	alice.expect(http.MethodDelete, "/private/tags/"+freshID, "", http.StatusNoContent, nil)
	alice.expectError(http.MethodDelete, "/private/tags/"+freshID, "", http.StatusNotFound, "TagNotFound")
	alice.expectError(http.MethodDelete, "/private/tags/"+publicTag.ID, "", http.StatusNotFound, "TagNotFound")
	alice.expect(http.MethodPatch, metadataPath, `{"folderId":"`+deep.ID+`"}`, http.StatusOK, nil)
	alice.expect(http.MethodDelete, "/private/folders/"+secret.ID, "", http.StatusNoContent, nil)
	alice.expectError(http.MethodDelete, "/private/folders/"+publicFolder.ID, "", http.StatusNotFound, "FolderNotFound")
	alice.expect(http.MethodGet, "/private/bookmarks/"+bookmarkID, "", http.StatusOK, &detail)
	if detail.Bookmark.Folder == nil || detail.Bookmark.Folder.Path != "Deep" || len(detail.Bookmark.Tags) != 0 {
		t.Fatalf("private detail did not follow taxonomy delete: %+v", detail.Bookmark)
	}

	bob := unlockPrivateClient(t, server, "private-taxonomy-bob@example.com")
	bob.expectError(http.MethodPatch, metadataPath, `{"note":"x"}`, http.StatusNotFound, "PrivateBookmarkNotFound")
	bob.expectError(http.MethodDelete, "/private/bookmarks/"+bookmarkID, "", http.StatusNotFound, "PrivateBookmarkNotFound")
	bob.expectError(http.MethodGet, "/private/bookmarks/"+bookmarkID, "", http.StatusNotFound, "PrivateBookmarkNotFound")
	bob.expectError(http.MethodPatch, "/private/folders/"+deep.ID, `{"name":"Mine"}`, http.StatusNotFound, "FolderNotFound")
	var bobSearch testSearch
	bob.expect(http.MethodGet, "/private/bookmarks", "", http.StatusOK, &bobSearch)
	if bobSearch.Total != 0 {
		t.Fatalf("bob sees alice private bookmarks: %+v", bobSearch)
	}

	alice.expect(http.MethodDelete, "/private/bookmarks/"+bookmarkID, "", http.StatusNoContent, nil)
	alice.expectError(http.MethodDelete, "/private/bookmarks/"+bookmarkID, "", http.StatusNotFound, "PrivateBookmarkNotFound")
	alice.expectError(http.MethodGet, "/private/bookmarks/"+bookmarkID, "", http.StatusNotFound, "PrivateBookmarkNotFound")
	var empty testSearch
	alice.expect(http.MethodGet, "/private/bookmarks", "", http.StatusOK, &empty)
	if empty.Total != 0 {
		t.Fatalf("deleted private bookmark still listed: %+v", empty)
	}
}
