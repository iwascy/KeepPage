package access

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"strings"
	"time"

	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
	"github.com/keeppage/keeppage/apps/api-go/internal/repository"
)

type TokenService struct {
	repository repository.Repository
}

func NewTokenService(repository repository.Repository) *TokenService {
	return &TokenService{repository: repository}
}

func (s *TokenService) Create(ctx context.Context, userID string, input domain.APITokenCreateRequest) (domain.APITokenCreateResponse, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" || len(name) > 120 {
		return domain.APITokenCreateResponse{}, httperror.BadRequest("ValidationError", "name must be between 1 and 120 characters.", nil)
	}
	scopes := deduplicateScopes(input.Scopes)
	if len(scopes) == 0 {
		scopes = []string{"bookmark:create"}
	}
	if len(scopes) > 10 || !allBookmarkCreate(scopes) {
		return domain.APITokenCreateResponse{}, httperror.BadRequest("ValidationError", "scopes must contain bookmark:create.", nil)
	}
	if input.ExpiresAt != nil && !input.ExpiresAt.After(time.Now()) {
		return domain.APITokenCreateResponse{}, httperror.BadRequest("InvalidApiTokenExpiry", "API token 过期时间必须晚于当前时间。", nil)
	}
	secret, err := randomSecret()
	if err != nil {
		return domain.APITokenCreateResponse{}, err
	}
	id := auth.NewUUID()
	rawToken := "kp_" + id + "." + secret
	item, err := s.repository.CreateAPIToken(ctx, userID, id, name, "kp_"+id[:8]+"."+secret[:6], hashToken(rawToken), scopes, input.ExpiresAt)
	if err != nil {
		return domain.APITokenCreateResponse{}, err
	}
	return domain.APITokenCreateResponse{Token: rawToken, Item: item}, nil
}

func (s *TokenService) List(ctx context.Context, userID string) (domain.APITokenListResponse, error) {
	items, err := s.repository.ListAPITokens(ctx, userID)
	if err != nil {
		return domain.APITokenListResponse{}, err
	}
	return domain.APITokenListResponse{Items: items}, nil
}

func (s *TokenService) Revoke(ctx context.Context, userID string, tokenID string) (bool, error) {
	return s.repository.RevokeAPIToken(ctx, userID, tokenID, time.Now().UTC())
}

func randomSecret() (string, error) {
	bytes := make([]byte, 24)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func hashToken(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func deduplicateScopes(values []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	return result
}

func allBookmarkCreate(scopes []string) bool {
	for _, scope := range scopes {
		if scope != "bookmark:create" {
			return false
		}
	}
	return true
}
