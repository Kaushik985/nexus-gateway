package main

import (
	"context"
	"testing"

	"github.com/AlphaBitCore/nexus-gateway/packages/agent/internal/sync/status"
)

// TestBuildQueryStatsFn_Validation covers the request validation that runs
// before the rollup query — bad timestamps and an inverted window are rejected
// without touching the aggregator (so a nil aggregator is safe here; the
// happy-path query requires a live SQLCipher rollup DB and is integration-bound).
func TestBuildQueryStatsFn_Validation(t *testing.T) {
	fn := buildQueryStatsFn(nil)
	ctx := context.Background()

	if _, err := fn(ctx, status.QueryStatsRequest{EndRFC3339: "not-a-time"}); err == nil {
		t.Fatal("invalid end must error")
	}
	if _, err := fn(ctx, status.QueryStatsRequest{StartRFC3339: "not-a-time"}); err == nil {
		t.Fatal("invalid start must error")
	}
	// Valid timestamps but end <= start → rejected.
	if _, err := fn(ctx, status.QueryStatsRequest{
		EndRFC3339:   "2026-05-27T00:00:00Z",
		StartRFC3339: "2026-05-27T01:00:00Z",
	}); err == nil {
		t.Fatal("end-before-start must error")
	}
}
