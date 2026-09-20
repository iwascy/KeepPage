package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/config"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
)

func browserRequest(server *Server, path, body, origin string, cookie *http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", path, strings.NewReader(body))
	req.Header.Set("X-KeepPage-Session", "web")
	req.Header.Set("Origin", origin)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	server.Router().ServeHTTP(response, req)
	return response
}
func decodeSession(t *testing.T, response *httptest.ResponseRecorder) domain.AuthSession {
	t.Helper()
	var session domain.AuthSession
	if err := json.Unmarshal(response.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	if session.Token == "" {
		t.Fatalf("missing session: %s", response.Body.String())
	}
	return session
}
func authStatus(server *Server, token string) int {
	req := httptest.NewRequest("GET", "/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	res := httptest.NewRecorder()
	server.Router().ServeHTTP(res, req)
	return res.Code
}
func TestBrowserSessionLifecycle(t *testing.T) {
	server := newTestServer()
	server.cfg.NodeEnv = config.Production
	server.cfg.WebPublicBaseURL = "https://keeppage.test"
	origin := server.cfg.WebPublicBaseURL
	res := browserRequest(server, "/auth/register", `{"email":"browser@test.local","password":"correct-horse"}`, origin, nil)
	if res.Code != 201 {
		t.Fatalf("register %d %s", res.Code, res.Body.String())
	}
	session := decodeSession(t, res)
	cookie := res.Result().Cookies()[0]
	if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteStrictMode || cookie.MaxAge < 29*86400 || res.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("bad cookie attributes: %#v", cookie)
	}
	raw, _ := base64.RawURLEncoding.DecodeString(strings.Split(session.Token, ".")[0])
	var claims auth.TokenPayload
	json.Unmarshal(raw, &claims)
	if claims.SessionID == "" || claims.Exp-claims.Iat != 1200 {
		t.Fatalf("bad access claims: %s", raw)
	}
	if authStatus(server, session.Token) != 200 {
		t.Fatal("access rejected")
	}
	for _, path := range []string{"/auth/refresh", "/auth/logout", "/auth/login"} {
		if got := browserRequest(server, path, `{}`, "https://evil.test", cookie).Code; got != 403 {
			t.Fatalf("CSRF %s = %d", path, got)
		}
	}
	req := httptest.NewRequest("POST", "/auth/refresh", nil)
	req.Header.Set("Origin", origin)
	req.AddCookie(cookie)
	missingHeader := httptest.NewRecorder()
	server.Router().ServeHTTP(missingHeader, req)
	if missingHeader.Code != 403 {
		t.Fatal("missing custom header accepted")
	}
	var wg sync.WaitGroup
	results := make(chan *httptest.ResponseRecorder, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); results <- browserRequest(server, "/auth/refresh", "", origin, cookie) }()
	}
	wg.Wait()
	close(results)
	var nextCookie *http.Cookie
	for result := range results {
		if result.Code != 200 {
			t.Fatalf("refresh %d %s", result.Code, result.Body.String())
		}
		current := result.Result().Cookies()[0]
		if nextCookie != nil && nextCookie.Value != current.Value {
			t.Fatal("concurrent refresh returned different successors")
		}
		nextCookie = current
	}
	if nextCookie.Value == cookie.Value {
		t.Fatal("refresh token was not rotated")
	}
	store := server.repo.(auth.RefreshStore)
	record, _ := store.GetRefreshSession(t.Context(), claims.SessionID)
	record.RotatedAt = time.Now().Add(-time.Minute)
	store.CreateRefreshSession(t.Context(), record)
	if browserRequest(server, "/auth/refresh", "", origin, cookie).Code != 401 {
		t.Fatal("replayed old token accepted")
	}
	if authStatus(server, session.Token) != 401 {
		t.Fatal("replayed family still authorized")
	}
	res = browserRequest(server, "/auth/login", `{"email":"browser@test.local","password":"correct-horse"}`, origin, nil)
	session = decodeSession(t, res)
	cookie = res.Result().Cookies()[0]
	res = browserRequest(server, "/auth/logout", "", origin, cookie)
	if res.Code != 204 || res.Result().Cookies()[0].MaxAge != -1 {
		t.Fatal("logout failed")
	}
	if authStatus(server, session.Token) != 401 || browserRequest(server, "/auth/refresh", "", origin, cookie).Code != 401 {
		t.Fatal("logout did not revoke session")
	}
}

func TestLegacySessionAndAbsoluteRefreshExpiry(t *testing.T) {
	server := newTestServer()
	legacy := registerTestUser(t, server, "legacy@test.local")
	if authStatus(server, legacy) != 200 {
		t.Fatal("legacy rejected")
	}
	user, err := server.auth.AuthenticateBearer(t.Context(), legacy, auth.RequireOptions{})
	if err != nil {
		t.Fatal(err)
	}
	session, cookie, _, err := server.auth.NewBrowserSession(t.Context(), user, time.Minute, -time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if authStatus(server, session.Token) != 401 {
		t.Fatal("expired access accepted")
	}
	if _, _, _, err = server.auth.RefreshBrowserSession(t.Context(), cookie, time.Minute); err == nil {
		t.Fatal("absolute expiry extended")
	}
	if browserRequest(server, "/auth/refresh", "", "http://localhost:5173", nil).Code != 401 {
		t.Fatal("missing cookie accepted")
	}
}
