package repository

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
)

func TestSearchSortingAndPlainSnippets(t *testing.T) {
	r := NewMemoryRepository()
	now := time.Now().UTC()
	old := now.Add(-24 * time.Hour)
	r.bookmarks["a"] = []domain.Bookmark{
		{ID: "1", Title: "GORM title", SourceURL: "https://one.test", Note: "<b>gorm</b> usage", CreatedAt: old, UpdatedAt: now},
		{ID: "2", Title: "Another article", SourceURL: "https://two.test", Note: "gorm note", CreatedAt: now, UpdatedAt: old},
		{ID: "3", Title: "Tag match", SourceURL: "https://three.test", Tags: []domain.Tag{{ID: "t", Name: "gorm"}}, CreatedAt: now, UpdatedAt: old},
	}
	r.bookmarks["other"] = []domain.Bookmark{{ID: "secret", Title: "gorm private user"}}
	for _, test := range []struct{ sort, first string }{{"created", "3"}, {"updated", "1"}, {"title", "2"}, {"relevance", "1"}} {
		result, err := r.SearchBookmarks(context.Background(), "a", domain.BookmarkSearchQuery{Q: "gorm", Sort: test.sort, Limit: 2})
		if err != nil || result.Total != 3 || len(result.Items) != 2 || result.Items[0].ID != test.first {
			t.Fatalf("sort %s: %#v, %v", test.sort, result, err)
		}
		for _, item := range result.Items {
			if strings.Contains(item.SearchSnippet, "<b>") || !strings.Contains(strings.ToLower(item.SearchSnippet), "gorm") {
				t.Fatalf("bad snippet: %q", item.SearchSnippet)
			}
		}
	}
	page, _ := r.SearchBookmarks(context.Background(), "a", domain.BookmarkSearchQuery{Sort: "created", Offset: 1, Limit: 1})
	if len(page.Items) != 1 || page.Items[0].ID != "2" {
		t.Fatalf("unstable pagination: %#v", page)
	}
	empty, _ := r.SearchBookmarks(context.Background(), "a", domain.BookmarkSearchQuery{Q: "unmatched", Limit: 10})
	if empty.Total != 0 {
		t.Fatal("non-matching results")
	}
}

func TestPrivateSearchKeepsOwnerAndSnippetIsolation(t *testing.T) {
	r := NewMemoryRepository()
	version := "v"
	state := r.captureState()
	state.privateBookmarks["private"] = domain.Bookmark{ID: "private", Title: "Private title", LatestVersionID: &version, CreatedAt: time.Now()}
	state.privateVersions["object"] = memoryCaptureVersion{userID: "owner", bookmarkID: "private", versionID: version, extractedText: "中文资料中的搜索命中测试"}
	result, _ := r.SearchPrivateBookmarks(context.Background(), "owner", domain.BookmarkSearchQuery{Q: "搜索命中", Limit: 10})
	if result.Total != 1 || !strings.Contains(result.Items[0].SearchSnippet, "搜索命中") {
		t.Fatalf("private search: %#v", result)
	}
	other, _ := r.SearchPrivateBookmarks(context.Background(), "other", domain.BookmarkSearchQuery{Q: "搜索命中", Limit: 10})
	normal, _ := r.SearchBookmarks(context.Background(), "owner", domain.BookmarkSearchQuery{Q: "搜索命中", Limit: 10})
	if other.Total != 0 || normal.Total != 0 {
		t.Fatal("private content leaked")
	}
}

func TestSearchSnippetUnicodeAndLiteralWildcards(t *testing.T) {
	snippet := plainSearchSnippet(strings.Repeat("前", 100)+"命中内容"+strings.Repeat("后", 200), "命中")
	if !strings.Contains(snippet, "命中") || len([]rune(snippet)) > 182 || !strings.HasPrefix(snippet, "…") {
		t.Fatalf("invalid unicode snippet: %q", snippet)
	}
	if escapeSearchLike(`50%_\`) != `50\%\_\\` {
		t.Fatal("LIKE input must be literal")
	}
	if plainSearchSnippet("secret", "") != "" {
		t.Fatal("unsolicited search snippet")
	}
}
