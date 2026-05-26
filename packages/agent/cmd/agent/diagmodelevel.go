package main

import (
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/AlphaBitCore/nexus-gateway/packages/shared/core/logging"
)

// diagModeTimer is the subset of *time.Timer the controller needs. It is
// abstracted so tests can drive window expiry deterministically instead of
// waiting on wall-clock time.
type diagModeTimer interface {
	Stop() bool
}

// diagModeLevelController drives the process-wide slog level from the
// admin-set diagnostic-mode window carried on the agent_settings shadow.
//
// While a window is open (diagModeUntil in the future) the agent raises its
// log level to debug so the local log file captures the verbose detail an
// operator needs to diagnose an incident. The controller arms a local timer
// that restores the startup baseline level at the window's end, so the agent
// returns to quiet logging on its own even when it never receives the Hub
// diag-mode-expiry signal (offline / disconnected device). A window that is
// closed, cleared, or already in the past restores the baseline immediately.
//
// The level swap reuses shared/logging.SetLevel — the same process-wide
// LevelVar the four server Things drive through their log_level shadow key.
// The agent deliberately has no log_level key of its own: diag mode is the
// agent's window-scoped, audited, auto-expiring equivalent. The Hub-bound
// diag SlogSink threshold is never touched, so raising the level floods only
// the local log file, never the diag-event upload path.
type diagModeLevelController struct {
	baseline  string // startup cfg.Log.Level; "" resolves to info
	logger    *slog.Logger
	now       func() time.Time
	setLevel  func(string) slog.Level
	afterFunc func(time.Duration, func()) diagModeTimer

	mu    sync.Mutex
	until time.Time     // zero = no active window
	timer diagModeTimer // nil = no timer armed
}

// newDiagModeLevelController builds a controller seeded with the startup
// baseline level name (cfg.Log.Level). Production callers get the real
// logging.SetLevel + time-based scheduler; tests override now/setLevel/
// afterFunc via the exported fields before first use.
func newDiagModeLevelController(baseline string, logger *slog.Logger) *diagModeLevelController {
	return &diagModeLevelController{
		baseline: baseline,
		logger:   logger,
		now:      time.Now,
		setLevel: logging.SetLevel,
		afterFunc: func(d time.Duration, f func()) diagModeTimer {
			return time.AfterFunc(d, f)
		},
	}
}

// apply reconciles the controller against the diagModeUntil value on the
// latest agent_settings shadow. raw is the RFC3339 timestamp ("" when no
// window). It is idempotent: re-applying the same future timestamp does not
// re-arm the timer or re-log, so a shadow re-push every heartbeat is cheap.
func (c *diagModeLevelController) apply(diagModeUntil string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	until, ok := parseDiagModeUntil(diagModeUntil)
	now := c.now()

	// Closed / cleared / already past → ensure the baseline level.
	if !ok || !until.After(now) {
		c.restoreLocked()
		return
	}

	// Already tracking this exact window → nothing to do.
	if c.until.Equal(until) {
		return
	}

	// Open (or extend) the window: raise to debug + arm a fresh expiry timer.
	if c.timer != nil {
		c.timer.Stop()
	}
	c.until = until
	applied := c.setLevel("debug")
	window := until.Sub(now)
	c.timer = c.afterFunc(window, c.onExpiry)
	c.logger.Info("diag mode active — log level raised",
		slog.String("level", applied.String()),
		slog.Time("until", until),
		slog.Duration("window", window),
	)
}

// onExpiry restores the baseline when the local window timer fires.
func (c *diagModeLevelController) onExpiry() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.restoreLocked()
}

// restoreLocked drops back to the startup baseline level and clears window
// state. Caller holds c.mu. No-op when no window is active, so an empty
// shadow on every heartbeat does not re-log or re-set the level.
func (c *diagModeLevelController) restoreLocked() {
	if c.until.IsZero() && c.timer == nil {
		return
	}
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
	c.until = time.Time{}
	applied := c.setLevel(c.baseline)
	c.logger.Info("diag mode inactive — log level restored",
		slog.String("level", applied.String()),
	)
}

// stop cancels any armed timer on shutdown. The current level is left as-is;
// the process is exiting.
func (c *diagModeLevelController) stop() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
}

// parseDiagModeUntil parses the RFC3339 diagModeUntil string. ok=false on
// empty or unparseable input so callers treat a malformed payload as "no
// window" — failing safe to quiet logging rather than raising verbosity on
// garbage.
func parseDiagModeUntil(raw string) (time.Time, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return time.Time{}, false
	}
	return t.UTC(), true
}
