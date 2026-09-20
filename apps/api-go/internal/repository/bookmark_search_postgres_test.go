package repository

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/migrations"
)

// This opt-in test uses a dedicated disposable database, never the application DATABASE_URL.
func TestPostgresBookmarkSearch(t *testing.T) {
	databaseURL := os.Getenv("KEEPPAGE_SEARCH_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set KEEPPAGE_SEARCH_TEST_DATABASE_URL to a disposable Postgres database")
	}
	ctx := context.Background()
	if err := migrations.EnsureDatabase(ctx, databaseURL); err != nil {
		t.Fatal(err)
	}
	if err := migrations.Apply(ctx, databaseURL); err != nil {
		t.Fatal(err)
	}
	r, err := NewPostgresRepository(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	userID := auth.NewUUID()
	if _, err = r.pool.Exec(ctx, "insert into users (id,email,password_hash) values ($1,$2,'test-not-a-password')", userID, userID+"@test.local"); err != nil {
		t.Fatal(err)
	}
	defer r.pool.Exec(ctx, "delete from users where id=$1", userID)
	if _, err = r.IngestBookmark(ctx, userID, domain.IngestBookmarkRequest{URL: "https://example.test/gorm", Title: "GORM 中文资料"}); err != nil {
		t.Fatal(err)
	}
	if _, err = r.pool.Exec(ctx, "insert into private_bookmarks (id,user_id,source_url,normalized_url_hash,title,domain) values ($1,$2,'https://private.test/gorm','private-hash','GORM 私密资料','private.test')", auth.NewUUID(), userID); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"bookmarks", "private_bookmarks"} {
		versionTable := "bookmark_versions"
		if table == "private_bookmarks" {
			versionTable = "private_bookmark_versions"
		}
		versionID := auth.NewUUID()
		_, err = r.pool.Exec(ctx, fmt.Sprintf("insert into %s (id,bookmark_id,version_no,html_object_key,html_sha256,capture_profile,quality_score,quality_grade,extracted_text) select $1,id,1,'test-object','test-hash','standard',90,'high','存档正文独有的全文命中词' from %s where user_id=$2", versionTable, table), versionID, userID)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = r.pool.Exec(ctx, fmt.Sprintf("update %s set latest_version_id=$1 where user_id=$2", table), versionID, userID); err != nil {
			t.Fatal(err)
		}
	}
	for _, private := range []bool{false, true} {
		for _, ordering := range []string{"", "created", "updated", "title", "relevance"} {
			for _, search := range []string{"", "gorm", "中文", "全文命中词", "%", "不存在"} {
				query := domain.BookmarkSearchQuery{Sort: ordering, Q: search, Limit: 10}
				var result domain.BookmarkSearchResponse
				if private {
					result, err = r.SearchPrivateBookmarks(ctx, userID, query)
				} else {
					result, err = r.SearchBookmarks(ctx, userID, query)
				}
				if err != nil {
					t.Fatalf("private=%v sort=%s q=%s: %v", private, ordering, search, err)
				}
				expected := 0
				if search == "" || search == "gorm" || search == "全文命中词" || (!private && search == "中文") {
					expected = 1
				}
				if result.Total != expected {
					t.Fatalf("private=%v q=%s expected %d got %#v", private, search, expected, result)
				}
				if search != "" && expected == 1 && result.Items[0].SearchSnippet == "" {
					t.Fatal("missing snippet")
				}
			}
		}
	}
}
