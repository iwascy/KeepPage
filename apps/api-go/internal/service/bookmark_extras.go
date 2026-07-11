package service

import (
	"context"
	"errors"

	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
	"github.com/keeppage/keeppage/apps/api-go/internal/repository"
	"github.com/keeppage/keeppage/apps/api-go/internal/storage"
)

type BookmarkExtrasService struct {
	repo    repository.BookmarkExtrasRepository
	objects storage.ObjectStorage
}

func NewBookmarkExtrasService(repo repository.Repository, objects storage.ObjectStorage) *BookmarkExtrasService {
	return &BookmarkExtrasService{repo: repo.(repository.BookmarkExtrasRepository), objects: objects}
}
func (s *BookmarkExtrasService) Status(ctx context.Context, u, url string) (domain.BookmarkStatusResponse, error) {
	b, e := s.repo.FindBookmarkByURL(ctx, u, url)
	return domain.BookmarkStatusResponse{Exists: b != nil, Bookmark: b}, e
}
func (s *BookmarkExtrasService) Detail(ctx context.Context, u, id string) (domain.BookmarkDetailResponse, error) {
	d, e := s.repo.GetBookmarkDetail(ctx, u, id)
	if e != nil {
		return domain.BookmarkDetailResponse{}, e
	}
	if d == nil {
		return domain.BookmarkDetailResponse{}, httperror.NotFound("BookmarkNotFound", "Bookmark not found.")
	}
	for i := range d.Versions {
		v := &d.Versions[i]
		if info, e := s.objects.StatObject(ctx, v.HTMLObjectKey); e == nil {
			v.ArchiveAvailable = true
			v.ArchiveSizeBytes = &info.Size
		}
		if v.ReaderHTMLObjectKey != nil {
			if info, e := s.objects.StatObject(ctx, *v.ReaderHTMLObjectKey); e == nil {
				v.ReaderArchiveAvailable = true
				v.ReaderArchiveSizeBytes = &info.Size
			}
		}
	}
	return *d, nil
}
func (s *BookmarkExtrasService) Delete(ctx context.Context, u, id string) error {
	d, e := s.repo.GetBookmarkDetail(ctx, u, id)
	if e != nil {
		return e
	}
	ok, e := s.repo.DeleteBookmark(ctx, u, id)
	if e != nil {
		return e
	}
	if !ok {
		return httperror.NotFound("BookmarkNotFound", "Bookmark not found.")
	}
	if d != nil {
		for _, v := range d.Versions {
			_ = s.objects.DeleteObject(ctx, v.HTMLObjectKey)
			if v.ReaderHTMLObjectKey != nil {
				_ = s.objects.DeleteObject(ctx, *v.ReaderHTMLObjectKey)
			}
		}
	}
	return nil
}
func (s *BookmarkExtrasService) Update(ctx context.Context, u, id string, in domain.BookmarkMetadataUpdateRequest) (domain.Bookmark, error) {
	b, e := s.repo.UpdateBookmarkMetadata(ctx, u, id, in)
	if e != nil {
		return domain.Bookmark{}, e
	}
	if b == nil {
		return domain.Bookmark{}, httperror.NotFound("BookmarkNotFound", "Bookmark not found.")
	}
	return *b, nil
}
func (s *BookmarkExtrasService) RefreshIcon(ctx context.Context, u string, in domain.BookmarkIconRefreshRequest) (domain.BookmarkIconRefreshResponse, error) {
	return s.repo.RefreshBookmarkIcon(ctx, u, in)
}
func (s *BookmarkExtrasService) RefreshAllIcons(ctx context.Context, u string) (domain.BookmarkIconRefreshResponse, error) {
	return s.repo.RefreshAllBookmarkIcons(ctx, u)
}

var _ = errors.Is
