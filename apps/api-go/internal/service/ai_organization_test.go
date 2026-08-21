package service

import (
	"strings"
	"testing"

	"github.com/keeppage/keeppage/apps/api-go/internal/config"
)

func TestValidateModelOutputRejectsUnknownTaxonomyIDs(t *testing.T) {
	idMap := map[string]string{"item-000001": "bookmark-1"}
	folders := []aiFolderOption{{ID: "folder-1", Path: "技术"}}
	tags := []aiTagOption{{ID: "tag-1", Name: "待读"}}

	unknownFolder := "folder-unknown"
	err := validateModelOutput(aiModelOutput{Assignments: []aiModelAssignment{{
		ID: "item-000001", FolderID: &unknownFolder, TagIDs: []string{"tag-1"}, Confidence: 0.9,
	}}}, idMap, folders, tags)
	if err == nil || !strings.Contains(err.Error(), "folder") {
		t.Fatalf("expected unknown folder to fail, got %v", err)
	}

	folderID := "folder-1"
	err = validateModelOutput(aiModelOutput{Assignments: []aiModelAssignment{{
		ID: "item-000001", FolderID: &folderID, TagIDs: []string{"tag-unknown"}, Confidence: 0.9,
	}}}, idMap, folders, tags)
	if err == nil || !strings.Contains(err.Error(), "tag") {
		t.Fatalf("expected unknown tag to fail, got %v", err)
	}
}

func TestValidateModelOutputRequiresEveryArticle(t *testing.T) {
	err := validateModelOutput(aiModelOutput{}, map[string]string{"item-000001": "bookmark-1"}, nil, nil)
	if err == nil || !strings.Contains(err.Error(), "omitted") {
		t.Fatalf("expected omitted article to fail, got %v", err)
	}
}

func TestAIProviderCredentialEncryptionRoundTrip(t *testing.T) {
	service := NewAIOrganizationService(config.Config{
		AuthTokenSecret:           "test-auth-secret",
		AICredentialEncryptionKey: "test-encryption-key",
	}, nil, nil)

	ciphertext, err := service.encrypt("sk-secret-value")
	if err != nil {
		t.Fatal(err)
	}
	if ciphertext == "sk-secret-value" || strings.Contains(ciphertext, "secret-value") {
		t.Fatal("ciphertext must not contain plaintext")
	}
	plaintext, err := service.decrypt(ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	if plaintext != "sk-secret-value" {
		t.Fatalf("unexpected plaintext %q", plaintext)
	}
}
