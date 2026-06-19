package proxy

import (
	"log/slog"
	"testing"

	"github.com/AlphaBitCore/nexus-gateway/packages/ai-gateway/internal/platform/audit"
)

// enqueueAudit must enqueue exactly when NEXUS_AUDIT_DISABLED is unset (default)
// and drop the record when it is set. Asserted against a real audit.Writer wired
// to a captureProducer (defined in proxy_cache_capture_test.go), so the test
// observes the actual MQ enqueue, not a re-implementation.
func TestEnqueueAudit_FlagGatesEnqueue(t *testing.T) {
	cases := []struct {
		name     string
		disabled bool
		wantMsgs int
	}{
		{"enabled (default) → record enqueued", false, 1},
		{"disabled → record dropped", true, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			prev := auditDisabled
			t.Cleanup(func() { auditDisabled = prev })
			auditDisabled = tc.disabled

			cp := &captureProducer{}
			w := audit.NewWriter(cp, "test", nil, slog.Default())
			h := &Handler{deps: &Deps{Logger: slog.Default(), AuditWriter: w}}

			h.enqueueAudit(&audit.Record{RequestID: "audit-flag-test"})
			w.Close() // drains the ring buffer (wg.Wait) so the producer sees it

			cp.mu.Lock()
			got := len(cp.messages)
			cp.mu.Unlock()
			if got != tc.wantMsgs {
				t.Fatalf("%s: producer saw %d message(s), want %d", tc.name, got, tc.wantMsgs)
			}
		})
	}
}
