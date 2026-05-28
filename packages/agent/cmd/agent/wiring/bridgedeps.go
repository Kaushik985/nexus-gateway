package wiring

import (
	"context"
	"fmt"
	"log/slog"
	"path/filepath"
	"time"

	agentcompliance "github.com/AlphaBitCore/nexus-gateway/packages/agent/internal/compliance"
	"github.com/AlphaBitCore/nexus-gateway/packages/agent/internal/identity/attestation"
	agentproxy "github.com/AlphaBitCore/nexus-gateway/packages/agent/internal/network/proxy"
	agentTLS "github.com/AlphaBitCore/nexus-gateway/packages/agent/internal/network/tls"
	auditqueue "github.com/AlphaBitCore/nexus-gateway/packages/agent/internal/observability/audit/queue"
	"github.com/AlphaBitCore/nexus-gateway/packages/agent/internal/platform/paths"
	"github.com/AlphaBitCore/nexus-gateway/packages/shared/policy/payloadcapture"
	"github.com/AlphaBitCore/nexus-gateway/packages/shared/storage/spillstore/spillsweep"
	normalizecore "github.com/AlphaBitCore/nexus-gateway/packages/shared/transport/normalize/core"
	streampolicy "github.com/AlphaBitCore/nexus-gateway/packages/shared/transport/streaming/policy"
	"github.com/AlphaBitCore/nexus-gateway/packages/shared/transport/tlsbump"
)

// BridgeDepsArgs bundles the cross-platform ingredients proxy.BridgeDeps
// needs. Every field is platform-agnostic, so all three platform shims
// (macOS NE bridge, Linux iptables, Windows WFP) build their inspect path
// from the same dependencies.
type BridgeDepsArgs struct {
	Logger               *slog.Logger
	AgentPipeline        *agentcompliance.AgentPipeline
	PayloadCaptureStore  *payloadcapture.Store
	AuditQueue           *auditqueue.Queue
	StreamingPolicyStore *streampolicy.Store
	NormalizeRegistry    *normalizecore.Registry
	// AttestationSigner — when non-nil, every outbound HTTPS request through
	// the bridge's UpstreamTransport gets the X-Nexus-Attestation header
	// injected. Nil disables attestation (no per-request signing cost).
	AttestationSigner *attestation.Signer
}

// BuildBridgeDeps assembles the shared/tlsbump-backed proxy.BridgeDeps the
// agent's inspect path runs through on every platform. It loads (or
// generates) the device CA, builds the tlsbump UpstreamTransport (wiring the
// attestation injector when present), opens the local spill store for
// oversize bodies, and binds the live policy resolver / domain engine /
// adapter registry from the agent pipeline.
//
// A nil AgentPipeline or a CA / upstream-transport failure returns an error;
// the caller logs it and leaves the platform's inspect path unwired (flows
// fall through to passthrough — fail-open). A spill-store failure is
// non-fatal: oversize bodies truncate instead of spilling.
func BuildBridgeDeps(args BridgeDepsArgs) (*agentproxy.BridgeDeps, error) {
	if args.AgentPipeline == nil {
		return nil, fmt.Errorf("BuildBridgeDeps: AgentPipeline is required")
	}
	logger := args.Logger
	if logger == nil {
		logger = slog.Default()
	}

	p := paths.DefaultPaths()
	caCertPath := filepath.Join(p.StateDir, "device-ca.pem")
	caKeyPath := filepath.Join(p.StateDir, "device-ca.key")
	caCert, caKey, generated, err := agentTLS.LoadOrGenerateCA(caCertPath, caKeyPath)
	if err != nil {
		return nil, fmt.Errorf("BuildBridgeDeps: load device CA: %w", err)
	}
	engine, err := agentTLS.NewEngine(caCert, caKey, 2000, time.Hour)
	if err != nil {
		return nil, fmt.Errorf("BuildBridgeDeps: new TLS engine: %w", err)
	}
	logger.Info("bridge deps: TLS engine ready", "ca_cert", caCertPath, "ca_generated_now", generated)

	upstreamOpts := tlsbump.UpstreamOptions{}
	if args.AttestationSigner != nil {
		upstreamOpts.RequestInjector = args.AttestationSigner.InjectInto
		logger.Info("attestation: request injector installed on UpstreamTransport")
	}
	upstream, err := tlsbump.NewUpstreamTransportWith(100, 90*time.Second, 10*time.Second, upstreamOpts)
	if err != nil {
		return nil, fmt.Errorf("BuildBridgeDeps: new upstream transport: %w", err)
	}

	// Same root the audit drain reads back from (SpillRoot is the single
	// source of truth) so spilled bodies can be uploaded to S3 at drain time.
	spill, spillErr := NewLocalSpillStore()
	if spillErr != nil {
		logger.Warn("bridge deps: localfs spillstore init failed; oversize bodies will truncate",
			"root", SpillRoot(), "error", spillErr)
	} else {
		// Sweep the agent's local spill dir so its retention horizon and
		// total-size cap are enforced. The store is hardcoded localfs with no
		// configured retention, so use the default horizon.
		go spillsweep.Run(context.Background(), spill, spillsweep.Options{
			Retention: spillsweep.DefaultRetention,
		}, logger)
	}

	return &agentproxy.BridgeDeps{
		Logger:              logger,
		TLSEngine:           engine,
		Upstream:            upstream,
		PolicyResolver:      args.AgentPipeline.Resolver(),
		DomainEngine:        args.AgentPipeline.DomainEngine(),
		AdapterRegistry:     args.AgentPipeline.AdapterRegistry(),
		NormalizeRegistry:   args.NormalizeRegistry,
		PayloadCaptureStore: args.PayloadCaptureStore,
		SpillStore:          spill,
		AuditQueue:          args.AuditQueue,
		StreamingPolicy:     args.StreamingPolicyStore,
		PerHookTimeout:      5 * time.Second,
		TotalTimeout:        30 * time.Second,
	}, nil
}
