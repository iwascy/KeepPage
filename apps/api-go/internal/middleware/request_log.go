package middleware

import (
	"log/slog"
	"net/http"
	"time"
)

func RequestLog(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			recorder := &statusRecorder{ResponseWriter: w, statusCode: http.StatusOK}
			next.ServeHTTP(recorder, r)
			logger.Info("request completed",
				"method", r.Method,
				"url", r.URL.RequestURI(),
				"status", recorder.statusCode,
				"durationMs", float64(time.Since(start).Microseconds())/1000,
			)
		})
	}
}

type statusRecorder struct {
	http.ResponseWriter
	statusCode int
}

func (r *statusRecorder) WriteHeader(statusCode int) {
	r.statusCode = statusCode
	r.ResponseWriter.WriteHeader(statusCode)
}
