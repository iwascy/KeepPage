package repository

import (
	"context"

	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
)

type AIOrganizationRepository interface {
	GetAIProviderSetting(ctx context.Context, userID string) (*domain.AIProviderSettingRecord, error)
	UpsertAIProviderSetting(ctx context.Context, record domain.AIProviderSettingRecord) (domain.AIProviderSettingRecord, error)
	ListAIOrganizationSourceItems(ctx context.Context, userID string) ([]domain.AIOrganizationSourceItem, error)
	CreateAIOrganizationJob(ctx context.Context, userID string, totalItems int) (domain.AIOrganizationJob, error)
	GetCurrentAIOrganizationJob(ctx context.Context, userID string) (*domain.AIOrganizationJob, error)
	GetAIOrganizationJob(ctx context.Context, userID, jobID string) (*domain.AIOrganizationJob, error)
	UpdateAIOrganizationJob(ctx context.Context, userID, jobID string, progress domain.AIOrganizationJobProgress) error
	ApplyAIOrganizationAssignments(ctx context.Context, userID, jobID string, source []domain.AIOrganizationSourceItem, assignments []domain.AIOrganizationAssignment, folders []domain.Folder, tags []domain.Tag, confidenceThreshold float64) (domain.AIOrganizationJobProgress, error)
	ListAIOrganizationJobItems(ctx context.Context, userID, jobID, status string, limit, offset int) (domain.AIOrganizationJobItemList, error)
	FailInterruptedAIOrganizationJobs(ctx context.Context) error
}
