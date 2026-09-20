package httpapi

import (
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/keeppage/keeppage/apps/api-go/internal/config"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
)

const refreshCookieName = "keeppage_refresh"

// Custom header prevents HTML forms from exercising cookie-authenticated routes.
// Origin verification also protects against permissive proxies / same-site siblings.
func (s *Server) requireBrowserOrigin(r *http.Request) error {
	if r.Header.Get("X-KeepPage-Session") != "web" {
		return httperror.Forbidden("InvalidOrigin", "无效的会话请求。")
	}
	origin, err := url.Parse(r.Header.Get("Origin"))
	if err != nil || origin.Host == "" || origin.User != nil || origin.RawQuery != "" || origin.Fragment != "" || origin.Path != "" || (origin.Scheme != "http" && origin.Scheme != "https") {
		return httperror.Forbidden("InvalidOrigin", "会话请求来源无效。")
	}
	expected := strings.TrimRight(s.cfg.WebPublicBaseURL, "/")
	if expected != "" {
		if origin.String() == expected {
			return nil
		}
	} else if s.cfg.NodeEnv != config.Production {
		// Vite's local proxy changes Host to the upstream address.
		host := origin.Hostname()
		if host == "localhost" || host == "127.0.0.1" || host == "::1" {
			return nil
		}
	} else if origin.Scheme == "https" && origin.Host == r.Host {
		return nil
	}
	return httperror.Forbidden("InvalidOrigin", "会话请求来源不匹配。")
}

func (s *Server) setRefreshCookie(w http.ResponseWriter, value string, expires time.Time) {
	maxAge := int(time.Until(expires).Seconds())
	if value == "" {
		maxAge = -1
	}
	http.SetCookie(w, &http.Cookie{Name: refreshCookieName, Value: value, Path: "/", HttpOnly: true,
		Secure: s.cfg.NodeEnv == config.Production || strings.HasPrefix(s.cfg.WebPublicBaseURL, "https://"), SameSite: http.SameSiteStrictMode, Expires: expires, MaxAge: maxAge})
	w.Header().Set("Cache-Control", "no-store")
}

func (s *Server) writeLoginSession(w http.ResponseWriter, r *http.Request, session domain.AuthSession, status int) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Header.Get("X-KeepPage-Session") == "web" {
		browserSession, token, expires, err := s.auth.NewBrowserSession(r.Context(), session.User, s.cfg.AccessTokenTTL(), s.cfg.RefreshTokenTTL())
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		// Signing in replaces this browser's previous refresh family.
		if cookie, err := r.Cookie(refreshCookieName); err == nil {
			if err := s.auth.RevokeBrowserSession(r.Context(), cookie.Value); err != nil {
				writeError(s.logger, w, err)
				return
			}
		}
		s.setRefreshCookie(w, token, expires)
		session = browserSession
	}
	writeJSON(w, status, session)
}

func (s *Server) handleRefreshSession(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if err := s.requireBrowserOrigin(r); err != nil {
		writeError(s.logger, w, err)
		return
	}
	cookie, err := r.Cookie(refreshCookieName)
	if err != nil {
		writeError(s.logger, w, httperror.Unauthorized("SessionExpired", "请重新登录。"))
		return
	}
	session, token, expires, err := s.auth.RefreshBrowserSession(r.Context(), cookie.Value, s.cfg.AccessTokenTTL())
	if err != nil {
		var httpErr *httperror.Error
		if errors.As(err, &httpErr) && httpErr.StatusCode == http.StatusUnauthorized {
			s.setRefreshCookie(w, "", time.Unix(1, 0))
		}
		writeError(s.logger, w, err)
		return
	}
	s.setRefreshCookie(w, token, expires)
	writeJSON(w, http.StatusOK, session)
}

func (s *Server) handleLogoutSession(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if err := s.requireBrowserOrigin(r); err != nil {
		writeError(s.logger, w, err)
		return
	}
	if cookie, err := r.Cookie(refreshCookieName); err == nil {
		if err := s.auth.RevokeBrowserSession(r.Context(), cookie.Value); err != nil {
			writeError(s.logger, w, err)
			return
		}
	}
	s.setRefreshCookie(w, "", time.Unix(1, 0))
	writeNoContent(w)
}
