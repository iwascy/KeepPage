package repository

import (
	"context"
	"os"
	"testing"

	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/migrations"
)

// This opt-in test uses a dedicated disposable database, never the application DATABASE_URL.
func TestPostgresPrivateTaxonomy(t *testing.T) {
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
	userID, otherID := auth.NewUUID(), auth.NewUUID()
	for _, id := range []string{userID, otherID} {
		if _, err = r.pool.Exec(ctx, "insert into users (id,email,password_hash) values ($1,$2,'test-not-a-password')", id, id+"@test.local"); err != nil {
			t.Fatal(err)
		}
		defer r.pool.Exec(ctx, "delete from users where id=$1", id)
	}
	publicFolder, err := r.CreateFolder(ctx, userID, domain.FolderCreateRequest{Name: "Public"})
	if err != nil {
		t.Fatal(err)
	}
	publicTag, err := r.CreateTag(ctx, userID, domain.TagCreateRequest{Name: "public-tag"})
	if err != nil {
		t.Fatal(err)
	}
	secret, err := r.CreatePrivateFolder(ctx, userID, domain.FolderCreateRequest{Name: "Secret"})
	if err != nil {
		t.Fatal(err)
	}
	deep, err := r.CreatePrivateFolder(ctx, userID, domain.FolderCreateRequest{Name: "Deep", ParentID: &secret.ID})
	if err != nil {
		t.Fatal(err)
	}
	hidden, err := r.CreatePrivateTag(ctx, userID, domain.TagCreateRequest{Name: "hidden"})
	if err != nil {
		t.Fatal(err)
	}
	bookmarkID := auth.NewUUID()
	if _, err = r.pool.Exec(ctx, "insert into private_bookmarks (id,user_id,source_url,normalized_url_hash,title,domain) values ($1,$2,'https://private.test/x','private-hash','Private X','private.test')", bookmarkID, userID); err != nil {
		t.Fatal(err)
	}
	if b, err := r.UpdatePrivateBookmarkMetadata(ctx, userID, bookmarkID, domain.BookmarkMetadataUpdateRequest{FolderID: domain.OptionalString{Present: true, Value: &publicFolder.ID}}); err == nil || b != nil {
		t.Fatalf("public folder id attached to private bookmark: %+v %v", b, err)
	}
	if b, err := r.UpdatePrivateBookmarkMetadata(ctx, otherID, bookmarkID, domain.BookmarkMetadataUpdateRequest{IsFavorite: new(bool)}); err != nil || b != nil {
		t.Fatalf("other user updated private bookmark: %+v %v", b, err)
	}
	tagIDs := []string{hidden.ID, publicTag.ID}
	b, err := r.UpdatePrivateBookmarkMetadata(ctx, userID, bookmarkID, domain.BookmarkMetadataUpdateRequest{FolderID: domain.OptionalString{Present: true, Value: &deep.ID}, TagIDs: &tagIDs})
	if err != nil {
		t.Fatal(err)
	}
	if b.Folder == nil || b.Folder.Path != "Secret/Deep" || len(b.Tags) != 1 || b.Tags[0].ID != hidden.ID {
		t.Fatalf("unexpected private metadata: %+v", b)
	}
	for query, want := range map[domain.BookmarkSearchQuery]int{
		{FolderID: secret.ID, Limit: 10}: 1, {FolderID: publicFolder.ID, Limit: 10}: 0, {TagID: hidden.ID, Limit: 10}: 1,
		{TagID: publicTag.ID, Limit: 10}: 0, {Q: "hidden", Limit: 10}: 1, {Q: "Secret/De", Limit: 10}: 1,
	} {
		result, err := r.SearchPrivateBookmarks(ctx, userID, query)
		if err != nil {
			t.Fatal(err)
		}
		if result.Total != want || (want == 1 && (result.Items[0].Folder == nil || len(result.Items[0].Tags) != 1)) {
			t.Fatalf("query %+v: want %d got %+v", query, want, result)
		}
	}
	stats, err := r.GetPrivateBookmarkSidebarStats(ctx, userID)
	if err != nil || len(stats.FolderCounts) != 1 || stats.FolderCounts[0].FolderID != deep.ID {
		t.Fatalf("unexpected private stats: %+v %v", stats, err)
	}
	if folders, _ := r.ListFolders(ctx, userID); len(folders) != 1 {
		t.Fatalf("private folders leaked to public list: %+v", folders)
	}
	names := []string{"fresh"}
	path := "New/Path"
	if b, err = r.UpdatePrivateBookmarkMetadata(ctx, userID, bookmarkID, domain.BookmarkMetadataUpdateRequest{FolderPath: domain.OptionalString{Present: true, Value: &path}, Tags: &names}); err != nil || b.Folder == nil || b.Folder.Path != "New/Path" || len(b.Tags) != 1 {
		t.Fatalf("unexpected path metadata: %+v %v", b, err)
	}
	if tags, _ := r.ListTags(ctx, userID); len(tags) != 1 {
		t.Fatalf("private tags leaked to public list: %+v", tags)
	}
	if ok, err := r.DeletePrivateFolder(ctx, userID, publicFolder.ID); err != nil || ok {
		t.Fatalf("deleted public folder through private api: %v %v", ok, err)
	}
	if ok, err := r.DeletePrivateTag(ctx, userID, publicTag.ID); err != nil || ok {
		t.Fatalf("deleted public tag through private api: %v %v", ok, err)
	}
	if ok, err := r.DeletePrivateFolder(ctx, userID, secret.ID); err != nil || !ok {
		t.Fatalf("delete private folder: %v %v", ok, err)
	}
	if folders, _ := r.ListPrivateFolders(ctx, userID); len(folders) != 3 {
		t.Fatalf("unexpected private folders after delete: %+v", folders)
	}
	if ok, err := r.DeletePrivateBookmark(ctx, otherID, bookmarkID); err != nil || ok {
		t.Fatalf("other user deleted private bookmark: %v %v", ok, err)
	}
	if ok, err := r.DeletePrivateBookmark(ctx, userID, bookmarkID); err != nil || !ok {
		t.Fatalf("delete private bookmark: %v %v", ok, err)
	}
	if detail, err := r.GetPrivateBookmarkDetail(ctx, userID, bookmarkID); err != nil || detail != nil {
		t.Fatalf("private bookmark still readable: %+v %v", detail, err)
	}
}
