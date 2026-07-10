package httpapi

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/config"
	"github.com/keeppage/keeppage/apps/api-go/internal/repository"
	"github.com/keeppage/keeppage/apps/api-go/internal/service"
	"github.com/keeppage/keeppage/apps/api-go/internal/storage"
)

func TestHealth(t *testing.T) {
	server := newTestServer()
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	response := httptest.NewRecorder()

	server.Router().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["status"] != "ok" || payload["storage"] != "memory" {
		t.Fatalf("unexpected health payload: %#v", payload)
	}
}

func TestCreateAndListBookmark(t *testing.T) {
	server := newTestServer()
	token := signTestToken("dev-user", "dev@keeppage.local")
	createBody := bytes.NewBufferString(`{"url":"https://Example.com/path/?b=2&a=1#top","title":"Example","tags":["go"],"folderPath":"Engineering/Go"}`)
	createRequest := httptest.NewRequest(http.MethodPost, "/bookmarks", createBody)
	createRequest.Header.Set("authorization", "Bearer "+token)
	createResponse := httptest.NewRecorder()

	server.Router().ServeHTTP(createResponse, createRequest)

	if createResponse.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", createResponse.Code, createResponse.Body.String())
	}

	listRequest := httptest.NewRequest(http.MethodGet, "/bookmarks?limit=10", nil)
	listRequest.Header.Set("authorization", "Bearer "+token)
	listResponse := httptest.NewRecorder()
	server.Router().ServeHTTP(listResponse, listRequest)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list status = %d, body = %s", listResponse.Code, listResponse.Body.String())
	}
	body, _ := io.ReadAll(listResponse.Body)
	if !bytes.Contains(body, []byte(`"total":1`)) {
		t.Fatalf("unexpected list body: %s", string(body))
	}
	if !bytes.Contains(body, []byte(`"sourceUrl":"https://example.com/path?a=1\u0026b=2"`)) {
		t.Fatalf("expected normalized URL in body: %s", string(body))
	}
}

func newTestServer() *Server {
	cfg := config.Config{
		APIHost:             "127.0.0.1",
		APIPort:             8788,
		StorageDriver:       "memory",
		ObjectStorageDriver: "localfs",
		AuthTokenSecret:     "keeppage-dev-secret",
		UploadBodyLimitMB:   32,
	}
	repo := repository.NewMemoryRepository()
	objectStorage := storage.NewLocalFS(tTempRoot())
	return NewServer(
		cfg,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		repo,
		auth.NewService(cfg.AuthTokenSecret, repo),
		service.NewBookmarkService(repo, objectStorage),
	)
}

func tTempRoot() string {
	return "/tmp/keeppage-api-go-test"
}

func signTestToken(userID string, email string) string {
	payload := base64.RawURLEncoding.EncodeToString([]byte(`{"sub":"` + userID + `","email":"` + email + `","iat":1,"exp":4102444800}`))
	mac := hmac.New(sha256.New, []byte("keeppage-dev-secret"))
	mac.Write([]byte(payload))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return payload + "." + signature
}
