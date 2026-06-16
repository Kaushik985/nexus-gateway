// stage_hooks_timing_test.go — pins the request-hooks stage latency
// attribution: the framing work (content extraction, pipeline build,
// execute wall-clock, body rewrite) is recorded into the PhaseTimer
// independently of the per-hook RequestHooksMs aggregate, which covers only
// the hooks' own Execute self-timing and leaves the framing work
// unrepresented in latency_breakdown.
package proxy

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/AlphaBitCore/nexus-gateway/packages/ai-gateway/internal/platform/audit"
	routingcore "github.com/AlphaBitCore/nexus-gateway/packages/ai-gateway/internal/routing/core"
	"github.com/AlphaBitCore/nexus-gateway/packages/shared/policy/hooks/builtins"
	goHooks "github.com/AlphaBitCore/nexus-gateway/packages/shared/policy/hooks/core"
	compliance "github.com/AlphaBitCore/nexus-gateway/packages/shared/policy/pipeline"
	"github.com/AlphaBitCore/nexus-gateway/packages/shared/traffic"
	"github.com/AlphaBitCore/nexus-gateway/packages/shared/traffic/adapters/api/openai"
)

// newEmptyRequestStageHookCache builds a HookConfigCache that resolves to zero
// request-stage hooks, exercising the no-hooks-configured path in
// runRequestHooks (BuildPipeline yields a nil pipeline → early return after
// extract + build).
func newEmptyRequestStageHookCache(t *testing.T) *compliance.HookConfigCache {
	t.Helper()
	reg := builtins.Registry.Clone()
	reg.Freeze()
	loader := func(_ context.Context) ([]goHooks.HookConfig, error) { return nil, nil }
	cache := compliance.NewHookConfigCache(loader, reg, 0, slog.Default())
	if err := cache.Start(context.Background()); err != nil {
		t.Fatalf("cache.Start: %v", err)
	}
	time.Sleep(50 * time.Millisecond)
	return cache
}

// TestRunRequestHooks_RecordsSubPhaseBreakdown asserts the approve path
// records extract/build/execute sub-phases into latency_breakdown and does
// NOT record a rewrite phase (no Modify decision occurred).
func TestRunRequestHooks_RecordsSubPhaseBreakdown(t *testing.T) {
	h := &Handler{deps: &Deps{
		HookConfigCache: newRequestStageHookCache(t, storagePolicyHook{}),
		TrafficAdapter:  &openai.Adapter{},
		Logger:          slog.Default(),
	}}

	body := []byte(`{"model":"gpt-4o","messages":[{"role":"user","content":"hello world"}]}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()
	auditRec := &audit.Record{RequestID: "req-timing"}
	pt := traffic.NewPhaseTimer()

	_, _, rejected := h.runRequestHooks(req, rec, auditRec, "req-timing", body, routingcore.RoutingTarget{}, openAIIngress, pt, slog.Default())
	if rejected {
		t.Fatalf("unexpected rejection: %s", rec.Body.String())
	}

	// detail=true surfaces sub-millisecond phases (unit-test durations are
	// near-zero); the keys must be present regardless of magnitude.
	snap := pt.SnapshotDetail(true)
	for _, key := range []string{
		string(traffic.PhaseHookExtract),
		string(traffic.PhaseHookBuild),
		string(traffic.PhaseHookPipeline),
	} {
		if _, ok := snap[key]; !ok {
			t.Errorf("latency_breakdown missing %q on the approve path; got %v", key, snap)
		}
	}
	if _, ok := snap[string(traffic.PhaseHookRewrite)]; ok {
		t.Errorf("hook_rewrite_ms must be absent without a Modify decision; got %v", snap)
	}
}

// TestRunRequestHooks_RecordsRewritePhase_OnModify asserts the rewrite
// sub-phase is recorded when a redact hook produces a Modify decision and
// the adapter reverse-encodes the body.
func TestRunRequestHooks_RecordsRewritePhase_OnModify(t *testing.T) {
	h := &Handler{deps: &Deps{
		HookConfigCache: newPiiRedactHookCache(t),
		TrafficAdapter:  &openai.Adapter{},
		Logger:          slog.Default(),
	}}

	body := []byte(`{"model":"gpt-4o","messages":[{"role":"user","content":"contact alice@example.com please"}]}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()
	auditRec := &audit.Record{RequestID: "req-rewrite"}
	pt := traffic.NewPhaseTimer()

	rewritten, _, rejected := h.runRequestHooks(req, rec, auditRec, "req-rewrite", body, routingcore.RoutingTarget{}, openAIIngress, pt, slog.Default())
	if rejected {
		t.Fatalf("unexpected rejection: %s", rec.Body.String())
	}
	if rewritten == nil {
		t.Fatalf("expected the redact hook to produce a rewritten body")
	}

	snap := pt.SnapshotDetail(true)
	if _, ok := snap[string(traffic.PhaseHookRewrite)]; !ok {
		t.Errorf("hook_rewrite_ms must be recorded on the Modify path; got %v", snap)
	}
}

// TestRunRequestHooks_NoHooksConfigured_RecordsExtractBuildOnly pins the
// no-hooks path: extraction and pipeline-build still run (and are timed)
// before the nil-pipeline early return, but no pipeline-execute or rewrite
// phase is recorded. This also documents the ordering cost — a request with
// zero configured hooks still pays content extraction.
func TestRunRequestHooks_NoHooksConfigured_RecordsExtractBuildOnly(t *testing.T) {
	h := &Handler{deps: &Deps{
		HookConfigCache: newEmptyRequestStageHookCache(t),
		TrafficAdapter:  &openai.Adapter{},
		Logger:          slog.Default(),
	}}

	body := []byte(`{"model":"gpt-4o","messages":[{"role":"user","content":"hello"}]}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()
	auditRec := &audit.Record{RequestID: "req-nohooks"}
	pt := traffic.NewPhaseTimer()

	_, result, rejected := h.runRequestHooks(req, rec, auditRec, "req-nohooks", body, routingcore.RoutingTarget{}, openAIIngress, pt, slog.Default())
	if rejected {
		t.Fatalf("unexpected rejection: %s", rec.Body.String())
	}
	if result != nil {
		t.Fatalf("expected nil pipeline result with no hooks configured; got %+v", result)
	}

	snap := pt.SnapshotDetail(true)
	for _, key := range []string{string(traffic.PhaseHookExtract), string(traffic.PhaseHookBuild)} {
		if _, ok := snap[key]; !ok {
			t.Errorf("expected %q recorded even with no hooks configured; got %v", key, snap)
		}
	}
	for _, key := range []string{string(traffic.PhaseHookPipeline), string(traffic.PhaseHookRewrite)} {
		if _, ok := snap[key]; ok {
			t.Errorf("%q must be absent when no pipeline executed; got %v", key, snap)
		}
	}
}

// TestRunRequestHooks_NilPhaseTimer_NoPanic pins the nil-guard: callers that
// do not wire a PhaseTimer (the production bypass-less path always wires one,
// but seams and tests may not) must not panic.
func TestRunRequestHooks_NilPhaseTimer_NoPanic(t *testing.T) {
	h := &Handler{deps: &Deps{
		HookConfigCache: newRequestStageHookCache(t, storagePolicyHook{}),
		TrafficAdapter:  &openai.Adapter{},
		Logger:          slog.Default(),
	}}

	body := []byte(`{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()
	auditRec := &audit.Record{RequestID: "req-nil-pt"}

	_, _, rejected := h.runRequestHooks(req, rec, auditRec, "req-nil-pt", body, routingcore.RoutingTarget{}, openAIIngress, nil, slog.Default())
	if rejected {
		t.Fatalf("unexpected rejection: %s", rec.Body.String())
	}
}
