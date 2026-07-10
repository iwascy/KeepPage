package repository

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
)

type memoryCaptureVersion struct {
	userID     string
	bookmarkID string
	versionID  string
	hash       string
	objectKey  string
	objects    map[string]struct{}
	mediaFiles []domain.CaptureMediaFile
}

type memoryCaptureState struct {
	pending          map[string]domain.CaptureUpload
	privatePending   map[string]domain.CaptureUpload
	versions         map[string]memoryCaptureVersion
	privateVersions  map[string]memoryCaptureVersion
	privateBookmarks map[string]domain.Bookmark
}

var memoryCaptureStates sync.Map // map[*MemoryRepository]*memoryCaptureState

func (r *MemoryRepository) captureState() *memoryCaptureState {
	state, _ := memoryCaptureStates.LoadOrStore(r, &memoryCaptureState{
		pending: map[string]domain.CaptureUpload{}, privatePending: map[string]domain.CaptureUpload{},
		versions: map[string]memoryCaptureVersion{}, privateVersions: map[string]memoryCaptureVersion{}, privateBookmarks: map[string]domain.Bookmark{},
	})
	return state.(*memoryCaptureState)
}

func (r *MemoryRepository) InitCapture(_ context.Context, userID string, input domain.CaptureInitRequest) (domain.CaptureInitResponse, error) {
	return r.initMemoryCapture(userID, input, false)
}

func (r *MemoryRepository) InitPrivateCapture(_ context.Context, userID string, input domain.CaptureInitRequest) (domain.CaptureInitResponse, error) {
	return r.initMemoryCapture(userID, input, true)
}

func (r *MemoryRepository) initMemoryCapture(userID string, input domain.CaptureInitRequest, private bool) (domain.CaptureInitResponse, error) {
	normalized, err := normalizeSourceURL(input.URL)
	if err != nil {
		return domain.CaptureInitResponse{}, httperror.BadRequest("ValidationError", "url must be a valid URL.", nil)
	}
	hash := hashNormalizedURL(normalized)
	r.mu.Lock()
	defer r.mu.Unlock()
	state := r.captureState()
	versions := state.versions
	pending := state.pending
	prefix := "captures/"
	if private {
		versions, pending, prefix = state.privateVersions, state.privatePending, "private-captures/"
	}
	for _, version := range versions {
		if private && version.userID != userID {
			continue
		}
		if version.hash != input.HTMLSHA256 {
			continue
		}
		bookmark := r.findCaptureBookmarkByID(userID, version.bookmarkID, private)
		if bookmark != nil && hashNormalizedURL(bookmark.SourceURL) == hash {
			bookmarkID, versionID := version.bookmarkID, version.versionID
			return domain.CaptureInitResponse{AlreadyExists: true, BookmarkID: &bookmarkID, VersionID: &versionID, ObjectKey: version.objectKey}, nil
		}
	}
	for _, item := range pending {
		if item.UserID == userID && item.NormalizedURLHash == hash && item.HTMLSHA256 == input.HTMLSHA256 {
			return domain.CaptureInitResponse{ObjectKey: item.ObjectKey}, nil
		}
	}
	key := fmt.Sprintf("%s%s/%s.html", prefix, userID, auth.NewUUID())
	pending[key] = domain.CaptureUpload{ObjectKey: key, UserID: userID, NormalizedURLHash: hash, SourceURL: normalized, Title: input.Title, HTMLSHA256: input.HTMLSHA256, FileSize: input.FileSize, Profile: input.Profile, DeviceID: input.DeviceID, CreatedAt: time.Now().UTC()}
	return domain.CaptureInitResponse{ObjectKey: key}, nil
}

func (r *MemoryRepository) CompleteCapture(_ context.Context, userID string, input domain.CaptureCompleteRequest) (domain.CaptureCompleteResult, error) {
	return r.completeMemoryCapture(userID, input, false)
}

func (r *MemoryRepository) CompletePrivateCapture(_ context.Context, userID string, input domain.CaptureCompleteRequest) (domain.CaptureCompleteResult, error) {
	return r.completeMemoryCapture(userID, input, true)
}

func (r *MemoryRepository) completeMemoryCapture(userID string, input domain.CaptureCompleteRequest, private bool) (domain.CaptureCompleteResult, error) {
	normalized, err := normalizeSourceURL(input.Source.URL)
	if err != nil {
		return domain.CaptureCompleteResult{}, httperror.BadRequest("ValidationError", "source.url must be a valid URL.", nil)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	state := r.captureState()
	versions, pending := state.versions, state.pending
	if private {
		versions, pending = state.privateVersions, state.privatePending
	}
	if existing, ok := versions[input.ObjectKey]; ok {
		if private && existing.userID != userID {
			return domain.CaptureCompleteResult{}, httperror.NotFound("PendingCaptureNotFound", "Pending capture not found for object key.")
		}
		bookmark := r.findCaptureBookmarkByID(userID, existing.bookmarkID, private)
		if bookmark == nil {
			return domain.CaptureCompleteResult{}, ErrNotFound
		}
		r.updateMemoryCaptureBookmark(bookmark, input)
		if private {
			state.privateBookmarks[bookmark.ID] = *bookmark
		}
		return domain.CaptureCompleteResult{Bookmark: *bookmark, VersionID: existing.versionID, Deduplicated: true}, nil
	}
	pendingCapture, ok := pending[input.ObjectKey]
	if !ok || pendingCapture.UserID != userID {
		return domain.CaptureCompleteResult{}, httperror.NotFound("PendingCaptureNotFound", "Pending capture not found for object key.")
	}
	if pendingCapture.HTMLSHA256 != input.HTMLSHA256 {
		return domain.CaptureCompleteResult{}, httperror.Conflict("CaptureHashMismatch", "Capture HTML hash does not match the initialized upload.")
	}
	bookmark := r.findCaptureBookmarkByHash(userID, hashNormalizedURL(normalized), private)
	if bookmark == nil {
		parsed, _ := url.Parse(normalized)
		bookmark = &domain.Bookmark{ID: auth.NewUUID(), SourceURL: normalized, Title: input.Source.Title, Domain: parsed.Hostname(), Note: "", Tags: []domain.Tag{}, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}
		if private {
			state.privateBookmarks[bookmark.ID] = *bookmark
		} else {
			r.bookmarks[userID] = append(r.bookmarks[userID], *bookmark)
		}
	}
	for _, version := range versions {
		if version.bookmarkID == bookmark.ID && version.hash == input.HTMLSHA256 && (!private || version.userID == userID) {
			delete(pending, input.ObjectKey)
			r.updateMemoryCaptureBookmark(bookmark, input)
			if private {
				state.privateBookmarks[bookmark.ID] = *bookmark
			}
			return domain.CaptureCompleteResult{Bookmark: *bookmark, VersionID: version.versionID, Deduplicated: true}, nil
		}
	}
	objects := map[string]struct{}{input.ObjectKey: {}}
	if input.ReaderHTMLObjectKey != nil {
		objects[*input.ReaderHTMLObjectKey] = struct{}{}
	}
	for _, file := range input.MediaFiles {
		objects[file.ObjectKey] = struct{}{}
	}
	versionID := auth.NewUUID()
	versions[input.ObjectKey] = memoryCaptureVersion{userID: userID, bookmarkID: bookmark.ID, versionID: versionID, hash: input.HTMLSHA256, objectKey: input.ObjectKey, objects: objects, mediaFiles: append([]domain.CaptureMediaFile(nil), input.MediaFiles...)}
	delete(pending, input.ObjectKey)
	r.updateMemoryCaptureBookmark(bookmark, input)
	bookmark.LatestVersionID = &versionID
	bookmark.VersionCount++
	if private {
		state.privateBookmarks[bookmark.ID] = *bookmark
	} else {
		for i := range r.bookmarks[userID] {
			if r.bookmarks[userID][i].ID == bookmark.ID {
				r.bookmarks[userID][i] = *bookmark
				break
			}
		}
	}
	return domain.CaptureCompleteResult{Bookmark: *bookmark, VersionID: versionID, CreatedNewVersion: true}, nil
}

func (r *MemoryRepository) UserCanReadObject(_ context.Context, userID, objectKey string) (bool, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	state := r.captureState()
	for index, collection := range []map[string]memoryCaptureVersion{state.versions, state.privateVersions} {
		for _, version := range collection {
			if versionBelongsToMemoryUser(r, state, userID, version.bookmarkID, index == 1) {
				if _, ok := version.objects[objectKey]; ok {
					return true, nil
				}
				if mediaOwnerKey(objectKey) == version.objectKey {
					return true, nil
				}
			}
		}
	}
	return false, nil
}

func (r *MemoryRepository) UserCanWriteObject(ctx context.Context, userID, objectKey string) (bool, error) {
	if allowed, err := r.UserCanReadObject(ctx, userID, objectKey); allowed || err != nil {
		return allowed, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	state := r.captureState()
	owner := mediaOwnerKey(objectKey)
	for _, pending := range []map[string]domain.CaptureUpload{state.pending, state.privatePending} {
		if item, ok := pending[owner]; ok && item.UserID == userID {
			return true, nil
		}
	}
	return false, nil
}

func (r *MemoryRepository) findMemoryBookmarkByID(userID, bookmarkID string) *domain.Bookmark {
	for i := range r.bookmarks[userID] {
		if r.bookmarks[userID][i].ID == bookmarkID {
			return &r.bookmarks[userID][i]
		}
	}
	return nil
}
func (r *MemoryRepository) findMemoryBookmarkByHash(userID, hash string) *domain.Bookmark {
	for i := range r.bookmarks[userID] {
		if hashNormalizedURL(r.bookmarks[userID][i].SourceURL) == hash {
			return &r.bookmarks[userID][i]
		}
	}
	return nil
}
func (r *MemoryRepository) findCaptureBookmarkByID(userID, bookmarkID string, private bool) *domain.Bookmark {
	if private {
		state := r.captureState()
		if !versionBelongsToMemoryUser(r, state, userID, bookmarkID, true) {
			return nil
		}
		bookmark, ok := state.privateBookmarks[bookmarkID]
		if !ok {
			return nil
		}
		return &bookmark
	}
	return r.findMemoryBookmarkByID(userID, bookmarkID)
}
func (r *MemoryRepository) findCaptureBookmarkByHash(userID, hash string, private bool) *domain.Bookmark {
	if private {
		state := r.captureState()
		for bookmarkID, bookmark := range state.privateBookmarks {
			if !versionBelongsToMemoryUser(r, state, userID, bookmarkID, true) {
				continue
			}
			if hashNormalizedURL(bookmark.SourceURL) == hash {
				copy := bookmark
				return &copy
			}
		}
		return nil
	}
	return r.findMemoryBookmarkByHash(userID, hash)
}
func (r *MemoryRepository) updateMemoryCaptureBookmark(bookmark *domain.Bookmark, input domain.CaptureCompleteRequest) {
	bookmark.SourceURL = input.Source.URL
	bookmark.CanonicalURL = input.Source.CanonicalURL
	bookmark.Title = input.Source.Title
	bookmark.Domain = input.Source.Domain
	bookmark.FaviconURL = input.Source.FaviconURL
	bookmark.CoverImageURL = input.Source.CoverImageURL
	bookmark.LatestQuality = &input.Quality
	bookmark.UpdatedAt = time.Now().UTC()
}
func versionBelongsToMemoryUser(r *MemoryRepository, state *memoryCaptureState, userID, bookmarkID string, private bool) bool {
	if private {
		for _, version := range state.privateVersions {
			if version.bookmarkID == bookmarkID && version.userID == userID {
				return true
			}
		}
		return false
	}
	return r.findMemoryBookmarkByID(userID, bookmarkID) != nil
}
func mediaOwnerKey(key string) string {
	if before, _, ok := strings.Cut(key, ".assets/"); ok {
		return before + ".html"
	}
	return key
}
