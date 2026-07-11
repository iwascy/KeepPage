package httperror

import "net/http"

type Error struct {
	StatusCode int
	Code       string
	Message    string
	Details    any
}

func (e *Error) Error() string {
	return e.Message
}

func New(statusCode int, code string, message string, details any) *Error {
	return &Error{
		StatusCode: statusCode,
		Code:       code,
		Message:    message,
		Details:    details,
	}
}

func BadRequest(code string, message string, details any) *Error {
	return New(http.StatusBadRequest, code, message, details)
}

func Conflict(code string, message string) *Error {
	return New(http.StatusConflict, code, message, nil)
}

func Unauthorized(code string, message string) *Error {
	return New(http.StatusUnauthorized, code, message, nil)
}

func Forbidden(code string, message string) *Error {
	return New(http.StatusForbidden, code, message, nil)
}

func NotFound(code string, message string) *Error {
	return New(http.StatusNotFound, code, message, nil)
}
