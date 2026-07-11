package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
	"github.com/keeppage/keeppage/apps/api-go/internal/repository"
)

type errorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message,omitempty"`
	Details any    `json:"details,omitempty"`
}

func writeJSON(w http.ResponseWriter, statusCode int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeNoContent(w http.ResponseWriter) {
	w.WriteHeader(http.StatusNoContent)
}

func writeError(logger *slog.Logger, w http.ResponseWriter, err error) {
	var httpErr *httperror.Error
	if errors.As(err, &httpErr) {
		writeJSON(w, httpErr.StatusCode, errorResponse{
			Error:   httpErr.Code,
			Message: httpErr.Message,
			Details: httpErr.Details,
		})
		return
	}
	if errors.Is(err, repository.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorResponse{
			Error:   "NotFound",
			Message: "Resource not found.",
		})
		return
	}
	logger.Error("unhandled API error", "err", err)
	// Never expose internal driver/path details to clients.
	writeJSON(w, http.StatusInternalServerError, errorResponse{
		Error:   "InternalServerError",
		Message: "Internal server error.",
	})
}

func decodeJSON(r *http.Request, target any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return httperror.BadRequest("ValidationError", "Invalid JSON request body.", err.Error())
	}
	return nil
}
