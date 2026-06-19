package proxy

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
)

// NEXUS_TRACE_LATENCY=1 must surface the breakdown in a structured log line.
func TestMaybeLogLatencyBreakdown_EnabledEmitsLine(t *testing.T) {
	prev := traceLatencyEnabled
	t.Cleanup(func() { traceLatencyEnabled = prev })

	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))

	traceLatencyEnabled = true
	maybeLogLatencyBreakdown(logger, "req-123", map[string]int{"auth": 2, "routing": 5}, 142)

	out := buf.String()
	if !strings.Contains(out, "request_latency_breakdown") {
		t.Fatalf("expected breakdown log line, got: %q", out)
	}
	if !strings.Contains(out, "req-123") {
		t.Fatalf("expected request id in log line, got: %q", out)
	}
	if !strings.Contains(out, "total_ms=142") {
		t.Fatalf("expected total_ms=142 in log line, got: %q", out)
	}
}

// Default (flag unset/false) must emit nothing — no behavior change.
func TestMaybeLogLatencyBreakdown_DisabledNoLine(t *testing.T) {
	prev := traceLatencyEnabled
	t.Cleanup(func() { traceLatencyEnabled = prev })

	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))

	traceLatencyEnabled = false
	maybeLogLatencyBreakdown(logger, "req-456", map[string]int{"auth": 2}, 99)

	if buf.Len() != 0 {
		t.Fatalf("expected NO log line when disabled, got: %q", buf.String())
	}
}

// Env parsing accepts the documented truthy values and rejects everything else.
func TestParseTraceLatencyEnv(t *testing.T) {
	cases := []struct {
		val  string
		want bool
	}{
		{"1", true}, {"true", true}, {"TRUE", true}, {"yes", true}, {" 1 ", true},
		{"", false}, {"0", false}, {"false", false}, {"no", false}, {"off", false},
	}
	for _, tc := range cases {
		t.Setenv("NEXUS_TRACE_LATENCY", tc.val)
		if got := parseTraceLatencyEnv(); got != tc.want {
			t.Errorf("parseTraceLatencyEnv(%q) = %v, want %v", tc.val, got, tc.want)
		}
	}
}
