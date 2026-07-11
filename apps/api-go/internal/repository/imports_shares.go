package repository

import (
	"context"

	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
)

// ImportShareRepository is intentionally separate from Repository while the Go migration is incremental.
type ImportShareRepository interface {
	FindImportBookmarkMatches(context.Context, string, []string) ([]domain.ImportBookmarkMatch, error)
	CreateImportTask(context.Context, string, domain.CreateImportTaskInput) (domain.ImportTaskDetailResponse, error)
	ListImportTasks(context.Context, string) ([]domain.ImportTask, error)
	GetImportTaskDetail(context.Context, string, string) (*domain.ImportTaskDetailResponse, error)
	CountActiveShares(context.Context, string) (int, error)
	FindMissingOwnedBookmarkIDs(context.Context, string, []string) ([]string, error)
	CreateShare(context.Context, string, domain.CreateShareRecordInput) (domain.Share, error)
	ListShares(context.Context, string) ([]domain.Share, error)
	GetShareDetail(context.Context, string, string) (*domain.ShareDetail, error)
	UpdateShare(context.Context, string, string, domain.UpdateShareRecordInput) (*domain.ShareDetail, error)
	RevokeShare(context.Context, string, string) (*domain.Share, error)
	GetPublicShareByToken(context.Context, string) (*domain.PublicShareResponse, error)
}
