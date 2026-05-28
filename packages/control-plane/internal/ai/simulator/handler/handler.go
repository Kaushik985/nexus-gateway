// Package aigwsim owns the Control Plane admin API for the
// AI-gateway request simulator (admin UI tooling).
package aigwsim

import (
	"log/slog"
	"net/http"

	"github.com/labstack/echo/v4"
)

type Deps struct {
	Logger *slog.Logger
}

type Handler struct {
	logger *slog.Logger
}

func New(d Deps) *Handler {
	logger := d.Logger
	if logger == nil {
		logger = slog.Default()
	}
	return &Handler{logger: logger}
}

func errJSON(message, errType, code string) map[string]any {
	return map[string]any{
		"error": map[string]any{"message": message, "type": errType, "code": code},
	}
}

func internalServerError(c echo.Context, msg string) error {
	return c.JSON(http.StatusInternalServerError, errJSON(msg, "server_error", ""))
}
