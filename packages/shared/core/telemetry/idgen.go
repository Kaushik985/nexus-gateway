package telemetry

import (
	"context"
	"crypto/rand"

	"github.com/google/uuid"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"

	nexushttp "github.com/AlphaBitCore/nexus-gateway/packages/shared/transport/http"
)

// requestIDGenerator derives the OTel trace ID for a root span from the
// X-Nexus-Request-Id carried on the request context, so an exported span and
// the trace_id stamped on traffic_event / diag rows share one 128-bit value.
//
// The request id is a UUID, which is exactly the 16 bytes of an OTel trace ID,
// so the mapping is a direct copy — the only difference is the rendered form
// (hyphenated UUID vs 32 hex chars). When the context carries no usable id
// (background spans, or a non-UUID id), the generator falls back to random
// ids, matching the SDK's default behaviour. Span ids are always random.
//
// Only root spans call NewIDs; child spans inherit the trace id from the
// propagated parent context, so a request that crosses services under one
// X-Nexus-Request-Id resolves to one trace id everywhere.
type requestIDGenerator struct{}

var _ sdktrace.IDGenerator = requestIDGenerator{}

// NewIDs returns the trace id derived from the context request id (or random)
// plus a random span id.
func (requestIDGenerator) NewIDs(ctx context.Context) (trace.TraceID, trace.SpanID) {
	if rid := nexushttp.RequestIDFromContext(ctx); rid != "" {
		if u, err := uuid.Parse(rid); err == nil {
			tid := trace.TraceID(u)
			if tid.IsValid() {
				return tid, randomSpanID()
			}
		}
	}
	return randomTraceID(), randomSpanID()
}

// NewSpanID returns a random span id; the trace id is fixed by the caller.
func (requestIDGenerator) NewSpanID(context.Context, trace.TraceID) trace.SpanID {
	return randomSpanID()
}

func randomTraceID() trace.TraceID {
	var tid trace.TraceID
	for {
		_, _ = rand.Read(tid[:])
		if tid.IsValid() {
			return tid
		}
	}
}

func randomSpanID() trace.SpanID {
	var sid trace.SpanID
	for {
		_, _ = rand.Read(sid[:])
		if sid.IsValid() {
			return sid
		}
	}
}
