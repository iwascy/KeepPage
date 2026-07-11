package service

import (
	"context"
	"net/url"
	"strings"

	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
	"github.com/keeppage/keeppage/apps/api-go/internal/repository"
	"github.com/keeppage/keeppage/apps/api-go/internal/storage"
)

type BookmarkService struct {
	repository repository.Repository
	storage    storage.ObjectStorage
}

func NewBookmarkService(repository repository.Repository, storage storage.ObjectStorage) *BookmarkService {
	return &BookmarkService{repository: repository, storage: storage}
}

func (s *BookmarkService) Search(ctx context.Context, userID string, query domain.BookmarkSearchQuery) (domain.BookmarkSearchResponse, error) {
	return s.repository.SearchBookmarks(ctx, userID, query)
}

func (s *BookmarkService) Create(ctx context.Context, userID string, input domain.IngestBookmarkRequest) (domain.IngestBookmarkResult, error) {
	if err := validateIngestBookmarkRequest(input); err != nil {
		return domain.IngestBookmarkResult{}, err
	}
	return s.repository.IngestBookmark(ctx, userID, input)
}

func validateIngestBookmarkRequest(input domain.IngestBookmarkRequest) error {
	parsed, err := url.ParseRequestURI(input.URL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return httperror.BadRequest("ValidationError", "url must be a valid URL.", nil)
	}
	if strings.TrimSpace(input.Title) != "" && len(strings.TrimSpace(input.Title)) > 500 {
		return httperror.BadRequest("ValidationError", "title must be at most 500 characters.", nil)
	}
	if input.Note != nil && len(*input.Note) > 4000 {
		return httperror.BadRequest("ValidationError", "note must be at most 4000 characters.", nil)
	}
	if len(input.Tags) > 100 {
		return httperror.BadRequest("ValidationError", "tags must contain at most 100 items.", nil)
	}
	if input.DedupeStrategy == "" {
		input.DedupeStrategy = "merge"
	}
	if input.DedupeStrategy != "merge" && input.DedupeStrategy != "skip" {
		return httperror.BadRequest("ValidationError", "dedupeStrategy must be merge or skip.", nil)
	}
	return nil
}
