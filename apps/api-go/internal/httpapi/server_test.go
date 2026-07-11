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
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/keeppage/keeppage/apps/api-go/internal/access"
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

func TestRefactoredRoutesAreRegistered(t *testing.T) {
	server := newTestServer()
	routes := map[string]bool{}
	router, ok := server.Router().(chi.Routes)
	if !ok {
		t.Fatal("server router does not expose chi routes")
	}
	if err := chi.Walk(router, func(method string, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		routes[method+" "+route] = true
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	expected := []string{
		"GET /private-mode/status", "POST /private-mode/setup", "POST /private-mode/unlock", "POST /private-mode/password", "POST /private-mode/lock",
		"POST /extension/connect", "POST /extension/connect/redeem", "GET /extension/devices", "DELETE /extension/devices/{deviceID}",
		"POST /captures/init", "POST /captures/complete", "POST /private/captures/init", "POST /private/captures/complete",
		"POST /bookmarks/icons/refresh", "POST /bookmarks/icons/refresh-all",
		"GET /backups/bookmarks/export", "POST /backups/bookmarks/import/preview", "POST /backups/bookmarks/import",
		"GET /public/objects", "GET /objects", "GET /objects/{encodedObjectKey}", "PUT /uploads/{encodedObjectKey}", "PUT /uploads/{encodedObjectKey}/chunks/{uploadID}",
		"GET /bookmarks/sidebar-stats", "GET /bookmarks/status", "GET /bookmarks/{bookmarkID}", "DELETE /bookmarks/{bookmarkID}", "PATCH /bookmarks/{bookmarkID}/metadata",
		"GET /private/bookmarks", "GET /private/bookmarks/{bookmarkID}",
		"POST /imports/preview", "POST /imports", "GET /imports", "GET /imports/{taskID}",
		"GET /shares", "POST /shares", "GET /shares/{shareID}", "PATCH /shares/{shareID}", "POST /shares/{shareID}/revoke", "GET /public/shares/{token}",
	}
	for _, route := range expected {
		if !routes[route] {
			t.Errorf("missing route %s", route)
		}
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

func TestRegisterLoginAndCurrentUser(t *testing.T) {
	server := newTestServer()
	registerRequest := httptest.NewRequest(http.MethodPost, "/auth/register", bytes.NewBufferString(`{"email":"go@example.com","password":"correct-horse","name":"Go User"}`))
	registerResponse := httptest.NewRecorder()
	server.Router().ServeHTTP(registerResponse, registerRequest)
	if registerResponse.Code != http.StatusCreated {
		t.Fatalf("register status = %d, body = %s", registerResponse.Code, registerResponse.Body.String())
	}
	var session struct {
		Token string `json:"token"`
		User  struct {
			Email string `json:"email"`
		} `json:"user"`
	}
	if err := json.Unmarshal(registerResponse.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	if session.Token == "" || session.User.Email != "go@example.com" {
		t.Fatalf("unexpected registration response: %s", registerResponse.Body.String())
	}

	meRequest := httptest.NewRequest(http.MethodGet, "/auth/me", nil)
	meRequest.Header.Set("authorization", "Bearer "+session.Token)
	meResponse := httptest.NewRecorder()
	server.Router().ServeHTTP(meResponse, meRequest)
	if meResponse.Code != http.StatusOK {
		t.Fatalf("me status = %d, body = %s", meResponse.Code, meResponse.Body.String())
	}

	loginRequest := httptest.NewRequest(http.MethodPost, "/auth/login", bytes.NewBufferString(`{"email":"GO@EXAMPLE.COM","password":"correct-horse"}`))
	loginResponse := httptest.NewRecorder()
	server.Router().ServeHTTP(loginResponse, loginRequest)
	if loginResponse.Code != http.StatusOK {
		t.Fatalf("login status = %d, body = %s", loginResponse.Code, loginResponse.Body.String())
	}
}

func TestAPITokenCanIngestBookmark(t *testing.T) {
	server := newTestServer()
	session := registerTestUser(t, server, "token@example.com")
	createRequest := httptest.NewRequest(http.MethodPost, "/api-tokens", bytes.NewBufferString(`{"name":"CLI","scopes":["bookmark:create"]}`))
	createRequest.Header.Set("authorization", "Bearer "+session)
	createResponse := httptest.NewRecorder()
	server.Router().ServeHTTP(createResponse, createRequest)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("create token status = %d, body = %s", createResponse.Code, createResponse.Body.String())
	}
	var tokenPayload struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(createResponse.Body.Bytes(), &tokenPayload); err != nil {
		t.Fatal(err)
	}
	ingestRequest := httptest.NewRequest(http.MethodPost, "/ingest/bookmarks", bytes.NewBufferString(`{"url":"https://example.com/api","title":"API"}`))
	ingestRequest.Header.Set("x-keeppage-api-key", tokenPayload.Token)
	ingestResponse := httptest.NewRecorder()
	server.Router().ServeHTTP(ingestResponse, ingestRequest)
	if ingestResponse.Code != http.StatusCreated {
		t.Fatalf("ingest status = %d, body = %s", ingestResponse.Code, ingestResponse.Body.String())
	}
}

func TestUserIsolationForBookmarks(t *testing.T) {
	server := newTestServer()
	alice := registerTestUser(t, server, "alice@example.com")
	bob := registerTestUser(t, server, "bob@example.com")

	createRequest := httptest.NewRequest(http.MethodPost, "/bookmarks", bytes.NewBufferString(`{"url":"https://alice.example/private","title":"Alice Only"}`))
	createRequest.Header.Set("authorization", "Bearer "+alice)
	createResponse := httptest.NewRecorder()
	server.Router().ServeHTTP(createResponse, createRequest)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", createResponse.Code, createResponse.Body.String())
	}
	var created struct {
		Bookmark struct {
			ID string `json:"id"`
		} `json:"bookmark"`
	}
	if err := json.Unmarshal(createResponse.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Bookmark.ID == "" {
		// ingest/create may wrap differently
		var alt map[string]any
		_ = json.Unmarshal(createResponse.Body.Bytes(), &alt)
		if bookmark, ok := alt["bookmark"].(map[string]any); ok {
			if id, ok := bookmark["id"].(string); ok {
				created.Bookmark.ID = id
			}
		}
	}

	// Bob must not see Alice's bookmark in list.
	listRequest := httptest.NewRequest(http.MethodGet, "/bookmarks?limit=20", nil)
	listRequest.Header.Set("authorization", "Bearer "+bob)
	listResponse := httptest.NewRecorder()
	server.Router().ServeHTTP(listResponse, listRequest)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list status = %d, body = %s", listResponse.Code, listResponse.Body.String())
	}
	if bytes.Contains(listResponse.Body.Bytes(), []byte("Alice Only")) {
		t.Fatalf("bob listed alice bookmark: %s", listResponse.Body.String())
	}

	if created.Bookmark.ID != "" {
		detailRequest := httptest.NewRequest(http.MethodGet, "/bookmarks/"+created.Bookmark.ID, nil)
		detailRequest.Header.Set("authorization", "Bearer "+bob)
		detailResponse := httptest.NewRecorder()
		server.Router().ServeHTTP(detailResponse, detailRequest)
		if detailResponse.Code == http.StatusOK {
			t.Fatalf("bob should not read alice bookmark detail: %s", detailResponse.Body.String())
		}
	}
}

func TestPrivateModeRequiresUnlock(t *testing.T) {
	server := newTestServer()
	token := registerTestUser(t, server, "private@example.com")

	// Without private token, private bookmarks must be locked.
	listRequest := httptest.NewRequest(http.MethodGet, "/private/bookmarks", nil)
	listRequest.Header.Set("authorization", "Bearer "+token)
	listResponse := httptest.NewRecorder()
	server.Router().ServeHTTP(listResponse, listRequest)
	if listResponse.Code == http.StatusOK {
		t.Fatalf("expected private mode lock, got 200: %s", listResponse.Body.String())
	}
	if !bytes.Contains(listResponse.Body.Bytes(), []byte("PrivateModeLocked")) && listResponse.Code != http.StatusUnauthorized && listResponse.Code != http.StatusForbidden {
		// Accept locked/unauthorized responses.
		t.Fatalf("expected private lock response, got %d %s", listResponse.Code, listResponse.Body.String())
	}

	setupRequest := httptest.NewRequest(http.MethodPost, "/private-mode/setup", bytes.NewBufferString(`{"password":"super-secret"}`))
	setupRequest.Header.Set("authorization", "Bearer "+token)
	setupResponse := httptest.NewRecorder()
	server.Router().ServeHTTP(setupResponse, setupRequest)
	if setupResponse.Code != http.StatusOK && setupResponse.Code != http.StatusCreated {
		t.Fatalf("setup status = %d, body = %s", setupResponse.Code, setupResponse.Body.String())
	}
	var unlock struct {
		PrivateToken string `json:"privateToken"`
	}
	_ = json.Unmarshal(setupResponse.Body.Bytes(), &unlock)
	if unlock.PrivateToken == "" {
		// some responses nest under summary
		var alt map[string]any
		_ = json.Unmarshal(setupResponse.Body.Bytes(), &alt)
		if tokenValue, ok := alt["privateToken"].(string); ok {
			unlock.PrivateToken = tokenValue
		}
	}
	if unlock.PrivateToken == "" {
		t.Fatalf("missing private token: %s", setupResponse.Body.String())
	}

	lockedAgain := httptest.NewRequest(http.MethodGet, "/private/bookmarks", nil)
	lockedAgain.Header.Set("authorization", "Bearer "+token)
	lockedResponse := httptest.NewRecorder()
	server.Router().ServeHTTP(lockedResponse, lockedAgain)
	if lockedResponse.Code == http.StatusOK {
		t.Fatal("session auth alone should not unlock private bookmarks")
	}

	unlockedRequest := httptest.NewRequest(http.MethodGet, "/private/bookmarks", nil)
	unlockedRequest.Header.Set("authorization", "Bearer "+token)
	unlockedRequest.Header.Set("x-keeppage-private-token", unlock.PrivateToken)
	unlockedResponse := httptest.NewRecorder()
	server.Router().ServeHTTP(unlockedResponse, unlockedRequest)
	if unlockedResponse.Code != http.StatusOK {
		t.Fatalf("unlocked private list status = %d, body = %s", unlockedResponse.Code, unlockedResponse.Body.String())
	}
}

func TestExtensionConnectCodeRedeem(t *testing.T) {
	server := newTestServer()
	token := registerTestUser(t, server, "ext@example.com")
	connectRequest := httptest.NewRequest(http.MethodPost, "/extension/connect", bytes.NewBufferString(`{"deviceName":"Chrome","platform":"chrome"}`))
	connectRequest.Header.Set("authorization", "Bearer "+token)
	connectResponse := httptest.NewRecorder()
	server.Router().ServeHTTP(connectResponse, connectRequest)
	if connectResponse.Code != http.StatusCreated {
		t.Fatalf("connect status = %d, body = %s", connectResponse.Code, connectResponse.Body.String())
	}
	var connect struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(connectResponse.Body.Bytes(), &connect); err != nil {
		t.Fatal(err)
	}
	if connect.Code == "" {
		t.Fatalf("missing code: %s", connectResponse.Body.String())
	}
	redeemRequest := httptest.NewRequest(http.MethodPost, "/extension/connect/redeem", bytes.NewBufferString(`{"code":"`+connect.Code+`"}`))
	redeemResponse := httptest.NewRecorder()
	server.Router().ServeHTTP(redeemResponse, redeemRequest)
	if redeemResponse.Code != http.StatusOK && redeemResponse.Code != http.StatusCreated {
		t.Fatalf("redeem status = %d, body = %s", redeemResponse.Code, redeemResponse.Body.String())
	}
	// Second redeem must fail.
	redeemAgain := httptest.NewRequest(http.MethodPost, "/extension/connect/redeem", bytes.NewBufferString(`{"code":"`+connect.Code+`"}`))
	againResponse := httptest.NewRecorder()
	server.Router().ServeHTTP(againResponse, redeemAgain)
	if againResponse.Code == http.StatusOK || againResponse.Code == http.StatusCreated {
		t.Fatal("connect code should be single-use")
	}
}

func TestAPITokenRejectsUnsupportedScopes(t *testing.T) {
	server := newTestServer()
	session := registerTestUser(t, server, "scope@example.com")
	// Only bookmark:create is allowed; unrelated scopes must be rejected at create time.
	createRequest := httptest.NewRequest(http.MethodPost, "/api-tokens", bytes.NewBufferString(`{"name":"Admin","scopes":["admin:all"]}`))
	createRequest.Header.Set("authorization", "Bearer "+session)
	createResponse := httptest.NewRecorder()
	server.Router().ServeHTTP(createResponse, createRequest)
	if createResponse.Code == http.StatusCreated || createResponse.Code == http.StatusOK {
		t.Fatalf("unsupported scopes should be rejected: %d %s", createResponse.Code, createResponse.Body.String())
	}
}

func TestTaxonomyAndWorkspaceBootstrap(t *testing.T) {
	server := newTestServer()
	token := registerTestUser(t, server, "taxonomy@example.com")
	root := createFolder(t, server, token, `{"name":"Engineering"}`)
	child := createFolder(t, server, token, `{"name":"Go","parentId":"`+root.ID+`"}`)
	request := httptest.NewRequest(http.MethodPatch, "/folders/"+root.ID, bytes.NewBufferString(`{"name":"Platform"}`))
	request.Header.Set("authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	server.Router().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("update folder status = %d, body = %s", response.Code, response.Body.String())
	}

	tagRequest := httptest.NewRequest(http.MethodPost, "/tags", bytes.NewBufferString(`{"name":"backend","color":"#123456"}`))
	tagRequest.Header.Set("authorization", "Bearer "+token)
	tagResponse := httptest.NewRecorder()
	server.Router().ServeHTTP(tagResponse, tagRequest)
	if tagResponse.Code != http.StatusCreated {
		t.Fatalf("create tag status = %d, body = %s", tagResponse.Code, tagResponse.Body.String())
	}

	bootstrapRequest := httptest.NewRequest(http.MethodGet, "/workspace/bootstrap", nil)
	bootstrapRequest.Header.Set("authorization", "Bearer "+token)
	bootstrapResponse := httptest.NewRecorder()
	server.Router().ServeHTTP(bootstrapResponse, bootstrapRequest)
	if bootstrapResponse.Code != http.StatusOK {
		t.Fatalf("bootstrap status = %d, body = %s", bootstrapResponse.Code, bootstrapResponse.Body.String())
	}
	var bootstrap struct {
		Folders []struct {
			ID   string `json:"id"`
			Path string `json:"path"`
		} `json:"folders"`
		Tags []struct {
			Name string `json:"name"`
		} `json:"tags"`
	}
	if err := json.Unmarshal(bootstrapResponse.Body.Bytes(), &bootstrap); err != nil {
		t.Fatal(err)
	}
	if len(bootstrap.Folders) != 2 || bootstrap.Folders[1].ID != child.ID || bootstrap.Folders[1].Path != "Platform/Go" || len(bootstrap.Tags) != 1 || bootstrap.Tags[0].Name != "backend" {
		t.Fatalf("unexpected workspace bootstrap: %s", bootstrapResponse.Body.String())
	}
}

func createFolder(t *testing.T, server *Server, token string, body string) struct {
	ID string `json:"id"`
} {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/folders", bytes.NewBufferString(body))
	request.Header.Set("authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	server.Router().ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("create folder status = %d, body = %s", response.Code, response.Body.String())
	}
	var folder struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &folder); err != nil {
		t.Fatal(err)
	}
	return folder
}

func registerTestUser(t *testing.T, server *Server, email string) string {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/auth/register", bytes.NewBufferString(`{"email":"`+email+`","password":"correct-horse"}`))
	response := httptest.NewRecorder()
	server.Router().ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("register status = %d, body = %s", response.Code, response.Body.String())
	}
	var payload struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	return payload.Token
}

func newTestServer() *Server {
	cfg := config.Config{
		APIHost:             "127.0.0.1",
		APIPort:             8788,
		StorageDriver:       "memory",
		ObjectStorageDriver: "localfs",
		AuthTokenSecret:     "keeppage-dev-secret",
		AuthTokenTTLDays:    30,
		UploadBodyLimitMB:   32,
	}
	repo := repository.NewMemoryRepository()
	objectStorage := storage.NewLocalFS(tTempRoot())
	return NewServer(
		cfg,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		repo,
		auth.NewService(cfg.AuthTokenSecret, 30*24*time.Hour, repo),
		service.NewBookmarkService(repo, objectStorage),
		access.NewTokenService(repo),
		objectStorage,
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
