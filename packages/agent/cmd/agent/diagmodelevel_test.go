package main

import (
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/AlphaBitCore/nexus-gateway/packages/shared/core/logging"
)

// dmlFakeTimer is a test double for diagModeTimer that records Stop calls
// instead of scheduling real wall-clock work.
type dmlFakeTimer struct{ stopped bool }

func (t *dmlFakeTimer) Stop() bool { t.stopped = true; return true }

// dmlProbe captures the controller's observable side effects: the sequence
// of level names it set, how many expiry timers it armed, the most recent
// armed duration, and the captured expiry callback so a test can fire it
// deterministically.
type dmlProbe struct {
	base     time.Time
	setCalls []string
	armCount int
	lastDur  time.Duration
	fired    func()
	timers   []*dmlFakeTimer
}

// newTestDiagCtl builds a controller with now/setLevel/afterFunc swapped for
// deterministic probes. The base clock is fixed so window math is exact.
func newTestDiagCtl(baseline string) (*diagModeLevelController, *dmlProbe) {
	p := &dmlProbe{base: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	ctl := newDiagModeLevelController(baseline, slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctl.now = func() time.Time { return p.base }
	ctl.setLevel = func(name string) slog.Level {
		p.setCalls = append(p.setCalls, name)
		return logging.ParseLevel(name)
	}
	ctl.afterFunc = func(d time.Duration, f func()) diagModeTimer {
		p.armCount++
		p.lastDur = d
		p.fired = f
		t := &dmlFakeTimer{}
		p.timers = append(p.timers, t)
		return t
	}
	return ctl, p
}

func rfc(t time.Time) string { return t.Format(time.RFC3339) }

func TestDiagModeLevel_OpenWindowRaisesToDebug(t *testing.T) {
	ctl, p := newTestDiagCtl("info")
	until := p.base.Add(time.Hour)

	ctl.apply(rfc(until))

	if len(p.setCalls) != 1 || p.setCalls[0] != "debug" {
		t.Fatalf("expected one set to debug, got %v", p.setCalls)
	}
	if p.armCount != 1 {
		t.Fatalf("expected 1 timer armed, got %d", p.armCount)
	}
	if p.lastDur != time.Hour {
		t.Fatalf("expected 1h window, got %s", p.lastDur)
	}
	if !ctl.until.Equal(until.UTC()) {
		t.Fatalf("expected tracked until %s, got %s", until.UTC(), ctl.until)
	}
}

func TestDiagModeLevel_ExpiryRestoresBaseline(t *testing.T) {
	ctl, p := newTestDiagCtl("info")
	ctl.apply(rfc(p.base.Add(time.Hour)))

	// Fire the expiry callback as the real timer would.
	p.fired()

	if got := p.setCalls; len(got) != 2 || got[1] != "info" {
		t.Fatalf("expected restore to info on expiry, got %v", got)
	}
	if !ctl.until.IsZero() {
		t.Fatalf("expected window cleared, got until=%s", ctl.until)
	}
	if ctl.timer != nil {
		t.Fatalf("expected timer cleared after expiry")
	}
}

func TestDiagModeLevel_IdempotentSameWindow(t *testing.T) {
	ctl, p := newTestDiagCtl("info")
	until := rfc(p.base.Add(time.Hour))

	ctl.apply(until)
	ctl.apply(until) // same window — must not re-arm or re-set

	if len(p.setCalls) != 1 {
		t.Fatalf("expected level set once, got %v", p.setCalls)
	}
	if p.armCount != 1 {
		t.Fatalf("expected timer armed once, got %d", p.armCount)
	}
}

func TestDiagModeLevel_ExtendWindowReArms(t *testing.T) {
	ctl, p := newTestDiagCtl("info")
	ctl.apply(rfc(p.base.Add(time.Hour)))
	ctl.apply(rfc(p.base.Add(2 * time.Hour))) // admin extends the window

	if p.armCount != 2 {
		t.Fatalf("expected 2 timers armed, got %d", p.armCount)
	}
	if !p.timers[0].stopped {
		t.Fatalf("expected first timer stopped when window extended")
	}
	if p.lastDur != 2*time.Hour {
		t.Fatalf("expected re-armed 2h window, got %s", p.lastDur)
	}
	if got := p.setCalls; len(got) != 2 || got[0] != "debug" || got[1] != "debug" {
		t.Fatalf("expected debug set on both opens, got %v", got)
	}
}

func TestDiagModeLevel_EmptyClearsActiveWindow(t *testing.T) {
	ctl, p := newTestDiagCtl("info")
	ctl.apply(rfc(p.base.Add(time.Hour)))
	ctl.apply("") // window cleared

	if got := p.setCalls; len(got) != 2 || got[1] != "info" {
		t.Fatalf("expected restore to baseline on clear, got %v", got)
	}
	if !p.timers[0].stopped {
		t.Fatalf("expected timer stopped on clear")
	}
	if !ctl.until.IsZero() {
		t.Fatalf("expected window cleared")
	}
}

func TestDiagModeLevel_EmptyOnFreshIsNoop(t *testing.T) {
	ctl, p := newTestDiagCtl("info")
	ctl.apply("") // no window ever opened

	if len(p.setCalls) != 0 {
		t.Fatalf("expected no level change on fresh empty apply, got %v", p.setCalls)
	}
	if p.armCount != 0 {
		t.Fatalf("expected no timer armed, got %d", p.armCount)
	}
}

func TestDiagModeLevel_PastTimeOnFreshIsNoop(t *testing.T) {
	ctl, p := newTestDiagCtl("info")
	ctl.apply(rfc(p.base.Add(-time.Hour))) // already expired

	if len(p.setCalls) != 0 || p.armCount != 0 {
		t.Fatalf("expected past-time apply to be a noop, setCalls=%v armCount=%d", p.setCalls, p.armCount)
	}
}

func TestDiagModeLevel_UnparseableIsFailSafe(t *testing.T) {
	ctl, p := newTestDiagCtl("info")
	ctl.apply("not-a-timestamp") // malformed → treat as no window

	if len(p.setCalls) != 0 || p.armCount != 0 {
		t.Fatalf("expected malformed apply to fail safe to noop, setCalls=%v armCount=%d", p.setCalls, p.armCount)
	}
}

func TestDiagModeLevel_StopCancelsTimerLeavesLevel(t *testing.T) {
	ctl, p := newTestDiagCtl("info")
	ctl.apply(rfc(p.base.Add(time.Hour)))

	ctl.stop()

	if !p.timers[0].stopped {
		t.Fatalf("expected timer stopped on stop()")
	}
	if ctl.timer != nil {
		t.Fatalf("expected timer reference cleared on stop()")
	}
	// Level is intentionally left raised — process is exiting.
	if got := p.setCalls; len(got) != 1 || got[0] != "debug" {
		t.Fatalf("expected level unchanged by stop(), got %v", got)
	}
}

func TestDiagModeLevel_StopOnFreshIsNoop(t *testing.T) {
	ctl, _ := newTestDiagCtl("info")
	ctl.stop() // no timer armed — must not panic
	if ctl.timer != nil {
		t.Fatalf("expected nil timer")
	}
}

func TestDiagModeLevel_NonInfoBaselineRestores(t *testing.T) {
	ctl, p := newTestDiagCtl("warn")
	ctl.apply(rfc(p.base.Add(time.Hour)))
	p.fired()

	if got := p.setCalls; len(got) != 2 || got[0] != "debug" || got[1] != "warn" {
		t.Fatalf("expected raise to debug then restore to warn baseline, got %v", got)
	}
}

func TestParseDiagModeUntil(t *testing.T) {
	cases := []struct {
		name string
		in   string
		ok   bool
	}{
		{"empty", "", false},
		{"whitespace", "   ", false},
		{"garbage", "not-a-time", false},
		{"valid", "2026-01-01T01:00:00Z", true},
		{"valid offset", "2026-01-01T01:00:00+08:00", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := parseDiagModeUntil(c.in)
			if ok != c.ok {
				t.Fatalf("parseDiagModeUntil(%q) ok=%v, want %v", c.in, ok, c.ok)
			}
			if ok && got.Location() != time.UTC {
				t.Fatalf("expected UTC-normalized time, got %s", got.Location())
			}
		})
	}
}

// TestDiagModeLevel_DefaultAfterFuncSchedules covers the production timer
// path (the real time.AfterFunc wrapper the constructor installs) which the
// other tests replace with a probe.
func TestDiagModeLevel_DefaultAfterFuncSchedules(t *testing.T) {
	ctl := newDiagModeLevelController("info", slog.New(slog.NewTextHandler(io.Discard, nil)))
	done := make(chan struct{})
	tm := ctl.afterFunc(time.Millisecond, func() { close(done) })
	if tm == nil {
		t.Fatal("expected non-nil timer from default afterFunc")
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("default afterFunc never fired")
	}
}

// TestDiagModeLevel_IntegrationWithRealSetLevel exercises the real
// logging.SetLevel path (not the injected fake) to confirm the controller is
// wired to the process-wide LevelVar the rest of the agent logs through.
func TestDiagModeLevel_IntegrationWithRealSetLevel(t *testing.T) {
	prior := logging.CurrentLevel()
	t.Cleanup(func() { logging.SetLevel(prior.String()) })

	logging.SetLevel("info")
	ctl := newDiagModeLevelController("info", slog.New(slog.NewTextHandler(io.Discard, nil)))
	// Keep the deterministic clock + timer, but use the real setLevel.
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	ctl.now = func() time.Time { return base }
	var fired func()
	ctl.afterFunc = func(_ time.Duration, f func()) diagModeTimer { fired = f; return &dmlFakeTimer{} }

	ctl.apply(rfc(base.Add(time.Hour)))
	if logging.CurrentLevel() != slog.LevelDebug {
		t.Fatalf("expected real level debug while window open, got %s", logging.CurrentLevel())
	}
	fired()
	if logging.CurrentLevel() != slog.LevelInfo {
		t.Fatalf("expected real level restored to info on expiry, got %s", logging.CurrentLevel())
	}
}
