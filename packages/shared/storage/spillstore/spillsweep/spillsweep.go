// Package spillsweep runs a periodic SpillStore.Sweep so a backend's retention
// horizon and total-size cap are actually enforced. Each service that owns a
// SpillStore starts one Run loop; the store is process-local, so sweeping is
// per-process rather than centralised — a localfs store is swept by the process
// that owns its directory, and a shared S3 bucket is swept (idempotently) by
// every process pointed at it.
package spillsweep

import (
	"context"
	"log/slog"
	"time"

	"github.com/AlphaBitCore/nexus-gateway/packages/shared/storage/spillstore"
)

// DefaultInterval is the sweep cadence used when Options.Interval is unset.
const DefaultInterval = 6 * time.Hour

// DefaultRetention is a sensible age horizon for callers that have no
// configured RetentionDays of their own (the agent's fixed local store). It
// matches the localfs backend's own default retention.
const DefaultRetention = 30 * 24 * time.Hour

// Options configures the sweep loop.
type Options struct {
	// Interval between sweeps. Defaults to DefaultInterval when <= 0.
	Interval time.Duration

	// Retention is the age horizon: each sweep deletes objects older than
	// now-Retention. A non-positive Retention disables the loop — the caller
	// asked to keep bodies indefinitely.
	Retention time.Duration
}

// Run sweeps store every Options.Interval until ctx is cancelled. It blocks for
// the lifetime of the loop, so callers start it in a goroutine. It sweeps once
// immediately so a freshly-started process prunes without waiting a full
// interval, then on each tick. A nil store or a non-positive Retention makes
// Run a no-op so callers can wire it unconditionally.
func Run(ctx context.Context, store spillstore.SpillStore, opts Options, logger *slog.Logger) {
	if store == nil || opts.Retention <= 0 {
		return
	}
	if opts.Interval <= 0 {
		opts.Interval = DefaultInterval
	}
	if logger == nil {
		logger = slog.Default()
	}
	logger = logger.With("component", "spillsweep", "backend", store.Backend())

	sweepOnce(ctx, store, opts.Retention, logger)

	ticker := time.NewTicker(opts.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			sweepOnce(ctx, store, opts.Retention, logger)
		}
	}
}

// sweepOnce runs a single sweep against the store. Errors are logged and
// swallowed — a failed sweep is a transient storage problem, not a reason to
// stop the loop or crash the service.
func sweepOnce(ctx context.Context, store spillstore.SpillStore, retention time.Duration, logger *slog.Logger) {
	cutoff := time.Now().Add(-retention)
	deleted, err := store.Sweep(ctx, cutoff)
	if err != nil {
		logger.Warn("spill sweep failed", "error", err, "cutoff", cutoff.Format(time.RFC3339))
		return
	}
	if deleted > 0 {
		logger.Info("spill sweep", "deleted", deleted, "cutoff", cutoff.Format(time.RFC3339))
	}
}
