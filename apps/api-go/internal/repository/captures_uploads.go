package repository

import (
	"context"

	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
)

// CaptureUploadRepository is intentionally separate from Repository so older
// repository implementations can keep compiling while this API surface lands.
type CaptureUploadRepository interface {
	InitCapture(ctx context.Context, userID string, input domain.CaptureInitRequest) (domain.CaptureInitResponse, error)
	CompleteCapture(ctx context.Context, userID string, input domain.CaptureCompleteRequest) (domain.CaptureCompleteResult, error)
	InitPrivateCapture(ctx context.Context, userID string, input domain.CaptureInitRequest) (domain.CaptureInitResponse, error)
	CompletePrivateCapture(ctx context.Context, userID string, input domain.CaptureCompleteRequest) (domain.CaptureCompleteResult, error)
	UserCanReadObject(ctx context.Context, userID string, objectKey string) (bool, error)
	UserCanWriteObject(ctx context.Context, userID string, objectKey string) (bool, error)
}
