package service

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
	"github.com/keeppage/keeppage/apps/api-go/internal/repository"
	"github.com/keeppage/keeppage/apps/api-go/internal/storage"
)

const backupFormat = "keeppage-bookmarks-package"
const backupVersion = 1

type BackupService struct {
	bookmarks *BookmarkService
	extras    *BookmarkExtrasService
	objects   storage.ObjectStorage
	taxonomy  repository.TaxonomyRepository
	restore   repository.BookmarkBackupRepository
}

func NewBackupService(repo repository.Repository, bookmarks *BookmarkService, extras *BookmarkExtrasService, objects storage.ObjectStorage) *BackupService {
	return &BackupService{bookmarks: bookmarks, extras: extras, objects: objects, taxonomy: repo.(repository.TaxonomyRepository), restore: repo.(repository.BookmarkBackupRepository)}
}

type backupObject struct {
	ObjectKey     string `json:"objectKey"`
	ContentBase64 string `json:"contentBase64"`
	SizeBytes     int64  `json:"sizeBytes"`
	SHA256        string `json:"sha256"`
	ContentType   string `json:"contentType,omitempty"`
}
type backupBookmark struct {
	Bookmark domain.Bookmark          `json:"bookmark"`
	Versions []domain.BookmarkVersion `json:"versions"`
}
type backupPackage struct {
	Format     string          `json:"format"`
	Version    int             `json:"version"`
	ExportedAt time.Time       `json:"exportedAt"`
	ExportedBy domain.AuthUser `json:"exportedBy"`
	Scope      string          `json:"scope"`
	Options    struct {
		IncludeVersions string `json:"includeVersions"`
	} `json:"options"`
	Folders   []domain.Folder  `json:"folders"`
	Tags      []domain.Tag     `json:"tags"`
	Bookmarks []backupBookmark `json:"bookmarks"`
	Objects   []backupObject   `json:"objects"`
}
type BackupPreview struct {
	Format     string          `json:"format"`
	Version    int             `json:"version"`
	ExportedAt time.Time       `json:"exportedAt"`
	SourceUser domain.AuthUser `json:"sourceUser"`
	Counts     struct {
		Folders           int   `json:"folders"`
		Tags              int   `json:"tags"`
		Bookmarks         int   `json:"bookmarks"`
		ExistingBookmarks int   `json:"existingBookmarks"`
		NewBookmarks      int   `json:"newBookmarks"`
		Versions          int   `json:"versions"`
		Objects           int   `json:"objects"`
		TotalObjectBytes  int64 `json:"totalObjectBytes"`
	} `json:"counts"`
}
type BackupImportResult struct {
	BackupPreview
	Imported struct {
		FoldersEnsured               int `json:"foldersEnsured"`
		TagsEnsured                  int `json:"tagsEnsured"`
		BookmarksCreated             int `json:"bookmarksCreated"`
		BookmarksMerged              int `json:"bookmarksMerged"`
		ObjectsWritten               int `json:"objectsWritten"`
		VersionsRestored             int `json:"versionsRestored"`
		VersionsSkippedMissingObject int `json:"versionsSkippedMissingObject"`
	} `json:"imported"`
}

func (s *BackupService) Export(ctx context.Context, user domain.AuthUser, folders []domain.Folder, tags []domain.Tag) ([]byte, string, BackupPreview, error) {
	all := []domain.Bookmark{}
	for offset := 0; ; offset += 100 {
		page, err := s.bookmarks.Search(ctx, user.ID, domain.BookmarkSearchQuery{View: "all", Limit: 100, Offset: offset})
		if err != nil {
			return nil, "", BackupPreview{}, err
		}
		all = append(all, page.Items...)
		if len(all) >= page.Total || len(page.Items) == 0 {
			break
		}
	}
	pkg := backupPackage{Format: backupFormat, Version: backupVersion, ExportedAt: time.Now().UTC(), ExportedBy: user, Scope: "normal-bookmarks", Folders: folders, Tags: tags, Bookmarks: []backupBookmark{}, Objects: []backupObject{}}
	pkg.Options.IncludeVersions = "latest"
	keys := map[string]struct{}{}
	for _, bookmark := range all {
		detail, err := s.extras.Detail(ctx, user.ID, bookmark.ID)
		if err != nil {
			return nil, "", BackupPreview{}, err
		}
		versions := []domain.BookmarkVersion{}
		if len(detail.Versions) > 0 {
			versions = []domain.BookmarkVersion{detail.Versions[0]}
			keys[versions[0].HTMLObjectKey] = struct{}{}
			if versions[0].ReaderHTMLObjectKey != nil {
				keys[*versions[0].ReaderHTMLObjectKey] = struct{}{}
			}
			for _, media := range versions[0].MediaFiles {
				keys[media.ObjectKey] = struct{}{}
			}
		}
		pkg.Bookmarks = append(pkg.Bookmarks, backupBookmark{Bookmark: detail.Bookmark, Versions: versions})
	}
	objectKeys := make([]string, 0, len(keys))
	for k := range keys {
		objectKeys = append(objectKeys, k)
	}
	sort.Strings(objectKeys)
	for _, key := range objectKeys {
		body, err := s.objects.GetObject(ctx, key)
		if err != nil {
			continue
		}
		sum := sha256.Sum256(body)
		pkg.Objects = append(pkg.Objects, backupObject{ObjectKey: key, ContentBase64: base64.StdEncoding.EncodeToString(body), SizeBytes: int64(len(body)), SHA256: hex.EncodeToString(sum[:])})
	}
	body, err := encodeBackup(pkg)
	if err != nil {
		return nil, "", BackupPreview{}, err
	}
	preview, err := s.preview(ctx, user.ID, pkg)
	if err != nil {
		return nil, "", BackupPreview{}, err
	}
	return body, fmt.Sprintf("keeppage-bookmarks-%s.kpkg", pkg.ExportedAt.Format("2006-01-02T15-04-05Z")), preview, nil
}

func (s *BackupService) Preview(ctx context.Context, userID string, body []byte) (BackupPreview, error) {
	pkg, err := decodeBackup(body)
	if err != nil {
		return BackupPreview{}, err
	}
	return s.preview(ctx, userID, pkg)
}
func (s *BackupService) preview(ctx context.Context, userID string, pkg backupPackage) (BackupPreview, error) {
	p := BackupPreview{Format: pkg.Format, Version: pkg.Version, ExportedAt: pkg.ExportedAt, SourceUser: pkg.ExportedBy}
	p.Counts.Folders = len(pkg.Folders)
	p.Counts.Tags = len(pkg.Tags)
	p.Counts.Bookmarks = len(pkg.Bookmarks)
	p.Counts.Objects = len(pkg.Objects)
	for _, o := range pkg.Objects {
		p.Counts.TotalObjectBytes += o.SizeBytes
	}
	for _, b := range pkg.Bookmarks {
		p.Counts.Versions += len(b.Versions)
		existing, err := s.extras.Status(ctx, userID, b.Bookmark.SourceURL)
		if err != nil {
			return p, err
		}
		if existing.Exists {
			p.Counts.ExistingBookmarks++
		} else {
			p.Counts.NewBookmarks++
		}
	}
	return p, nil
}
func (s *BackupService) Import(ctx context.Context, userID string, body []byte) (BackupImportResult, error) {
	pkg, err := decodeBackup(body)
	if err != nil {
		return BackupImportResult{}, err
	}
	preview, err := s.preview(ctx, userID, pkg)
	if err != nil {
		return BackupImportResult{}, err
	}
	out := BackupImportResult{BackupPreview: preview}
	if out.Imported.FoldersEnsured, err = s.ensureFolders(ctx, userID, pkg.Folders); err != nil {
		return out, err
	}
	if out.Imported.TagsEnsured, err = s.ensureTags(ctx, userID, pkg.Tags); err != nil {
		return out, err
	}
	// Remap every object into the importer's namespace so package keys cannot
	// overwrite other users' shared object-storage paths.
	keyMap := map[string]string{}
	objectEntries := map[string]backupObject{}
	for _, o := range pkg.Objects {
		if err := validObjectKey(o.ObjectKey); err != nil {
			return out, httperror.BadRequest("InvalidBackupObjectKey", "Backup package contains an invalid object key: "+o.ObjectKey, nil)
		}
		raw, err := base64.StdEncoding.DecodeString(o.ContentBase64)
		if err != nil {
			return out, httperror.BadRequest("InvalidBackupPackage", "Object payload is invalid.", nil)
		}
		sum := sha256.Sum256(raw)
		if hex.EncodeToString(sum[:]) != o.SHA256 {
			return out, httperror.BadRequest("BackupObjectChecksumMismatch", "Object checksum mismatch: "+o.ObjectKey, nil)
		}
		newKey, err := remapImportedObjectKey(userID, o.ObjectKey)
		if err != nil {
			return out, err
		}
		if err = s.objects.PutObject(ctx, newKey, raw, o.ContentType); err != nil {
			return out, err
		}
		keyMap[o.ObjectKey] = newKey
		remapped := o
		remapped.ObjectKey = newKey
		objectEntries[o.ObjectKey] = remapped
		out.Imported.ObjectsWritten++
	}
	for _, p := range pkg.Bookmarks {
		note := p.Bookmark.Note
		result, err := s.bookmarks.Create(ctx, userID, domain.IngestBookmarkRequest{URL: p.Bookmark.SourceURL, Title: p.Bookmark.Title, Note: &note, FolderPath: folderPath(p.Bookmark.Folder), Tags: tagNames(p.Bookmark.Tags), DedupeStrategy: "merge"})
		if err != nil {
			return out, err
		}
		if result.Status == "created" {
			out.Imported.BookmarksCreated++
		} else {
			out.Imported.BookmarksMerged++
		}
		if _, err = s.extras.Update(ctx, userID, result.Bookmark.ID, domain.BookmarkMetadataUpdateRequest{IsFavorite: &p.Bookmark.IsFavorite}); err != nil {
			return out, err
		}
		for _, version := range p.Versions {
			if _, ok := objectEntries[version.HTMLObjectKey]; !ok {
				out.Imported.VersionsSkippedMissingObject++
				continue
			}
			if version.ReaderHTMLObjectKey != nil {
				if _, ok := objectEntries[*version.ReaderHTMLObjectKey]; !ok {
					out.Imported.VersionsSkippedMissingObject++
					continue
				}
			}
			missingMedia := false
			for _, media := range version.MediaFiles {
				if _, ok := objectEntries[media.ObjectKey]; !ok {
					missingMedia = true
					break
				}
			}
			if missingMedia {
				out.Imported.VersionsSkippedMissingObject++
				continue
			}
			restored := rewriteRestoredVersionKeys(version, keyMap)
			if _, err = s.restore.AddRestoredBookmarkVersion(ctx, userID, result.Bookmark.ID, restored); err != nil {
				return out, err
			}
			out.Imported.VersionsRestored++
		}
	}
	return out, nil
}

func remapImportedObjectKey(userID, oldKey string) (string, error) {
	if err := validObjectKey(oldKey); err != nil {
		return "", err
	}
	if strings.TrimSpace(userID) == "" {
		return "", httperror.BadRequest("InvalidBackupObjectKey", "Importer user id is required.", nil)
	}
	base := filepath.Base(filepath.ToSlash(oldKey))
	if base == "." || base == ".." || base == "" || strings.Contains(base, "/") {
		base = "object.bin"
	}
	// Always write under the importer's capture prefix, never trust package keys.
	return fmt.Sprintf("captures/%s/%s-%s", userID, auth.NewUUID(), base), nil
}

func rewriteRestoredVersionKeys(version domain.BookmarkVersion, keyMap map[string]string) domain.BookmarkVersion {
	if mapped, ok := keyMap[version.HTMLObjectKey]; ok {
		version.HTMLObjectKey = mapped
	}
	if version.ReaderHTMLObjectKey != nil {
		if mapped, ok := keyMap[*version.ReaderHTMLObjectKey]; ok {
			value := mapped
			version.ReaderHTMLObjectKey = &value
		}
	}
	if len(version.MediaFiles) > 0 {
		media := make([]domain.CaptureMediaFile, len(version.MediaFiles))
		copy(media, version.MediaFiles)
		for i := range media {
			if mapped, ok := keyMap[media[i].ObjectKey]; ok {
				media[i].ObjectKey = mapped
			}
		}
		version.MediaFiles = media
	}
	return version
}

func (s *BackupService) ensureFolders(ctx context.Context, userID string, folders []domain.Folder) (int, error) {
	existing, err := s.taxonomy.ListFolders(ctx, userID)
	if err != nil {
		return 0, err
	}
	known := map[string]string{}
	for _, folder := range existing {
		known[folder.Path] = folder.ID
	}
	copyFolders := append([]domain.Folder(nil), folders...)
	sort.Slice(copyFolders, func(i, j int) bool {
		return strings.Count(copyFolders[i].Path, "/") < strings.Count(copyFolders[j].Path, "/")
	})
	ensured := 0
	for _, folder := range copyFolders {
		if _, ok := known[folder.Path]; ok {
			continue
		}
		parentPath := ""
		if before, _, ok := strings.Cut(folder.Path, "/"); ok {
			_ = before
			parts := strings.Split(folder.Path, "/")
			parentPath = strings.Join(parts[:len(parts)-1], "/")
		}
		var parentID *string
		if id := known[parentPath]; id != "" {
			parentID = &id
		}
		created, err := s.taxonomy.CreateFolder(ctx, userID, domain.FolderCreateRequest{Name: folder.Name, ParentID: parentID})
		if err != nil {
			return ensured, err
		}
		known[created.Path] = created.ID
		ensured++
	}
	return ensured, nil
}
func (s *BackupService) ensureTags(ctx context.Context, userID string, tags []domain.Tag) (int, error) {
	existing, err := s.taxonomy.ListTags(ctx, userID)
	if err != nil {
		return 0, err
	}
	known := map[string]bool{}
	for _, tag := range existing {
		known[tag.Name] = true
	}
	ensured := 0
	for _, tag := range tags {
		if known[tag.Name] {
			continue
		}
		if _, err := s.taxonomy.CreateTag(ctx, userID, domain.TagCreateRequest{Name: tag.Name, Color: tag.Color}); err != nil {
			return ensured, err
		}
		known[tag.Name] = true
		ensured++
	}
	return ensured, nil
}
func encodeBackup(pkg backupPackage) ([]byte, error) {
	raw, err := json.Marshal(pkg)
	if err != nil {
		return nil, err
	}
	var b bytes.Buffer
	z := gzip.NewWriter(&b)
	if _, err = z.Write(raw); err != nil {
		return nil, err
	}
	if err = z.Close(); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}
func decodeBackup(body []byte) (backupPackage, error) {
	z, err := gzip.NewReader(bytes.NewReader(body))
	if err != nil {
		return backupPackage{}, httperror.BadRequest("InvalidBackupPackage", "Backup package must be gzip encoded.", nil)
	}
	defer z.Close()
	raw, err := io.ReadAll(io.LimitReader(z, 256<<20))
	if err != nil {
		return backupPackage{}, err
	}
	var pkg backupPackage
	if err = json.Unmarshal(raw, &pkg); err != nil {
		return backupPackage{}, httperror.BadRequest("InvalidBackupPackage", "Backup package JSON is invalid.", nil)
	}
	if pkg.Format != backupFormat || pkg.Version != backupVersion || pkg.Scope != "normal-bookmarks" {
		return backupPackage{}, httperror.BadRequest("InvalidBackupPackage", "Unsupported backup package.", nil)
	}
	return pkg, nil
}
func folderPath(f *domain.Folder) string {
	if f == nil {
		return ""
	}
	return f.Path
}
func tagNames(tags []domain.Tag) []string {
	out := make([]string, 0, len(tags))
	for _, t := range tags {
		out = append(out, t.Name)
	}
	return out
}
