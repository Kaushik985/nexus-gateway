// Package api defines the OS-abstraction boundary types and interfaces.
// macOS and Windows provide implementations.
package api

import (
	"context"
	"time"

	"github.com/AlphaBitCore/nexus-gateway/packages/agent/internal/network/proxy"
)

// ProcessMeta contains metadata about the process that initiated a connection.
type ProcessMeta struct {
	PID         int
	Path        string // Full executable path
	Name        string // Short process name
	BundleID    string // macOS bundle ID or empty
	User        string // OS username or SID
	SigningInfo string // Code signature info
}

// InterceptedConn represents a network connection captured by the platform shim.
type InterceptedConn struct {
	FlowID  string
	SrcIP   string
	SrcPort int
	DstIP   string
	DstPort int
	DstHost string // SNI hostname (may be empty)
	Process ProcessMeta
}

// Decision tells the platform shim how to handle an intercepted connection.
type Decision int

const (
	DecisionInspect     Decision = iota // TLS terminate + inspect + forward
	DecisionPassthrough                 // Forward without inspection + audit metadata
	DecisionDeny                        // RST the connection + audit
)

// ConnectionHandler is called by the platform shim for each intercepted flow.
type ConnectionHandler interface {
	HandleConnection(conn InterceptedConn) Decision
}

// Platform abstracts OS-specific network interception.
type Platform interface {
	Start(ctx context.Context, handler ConnectionHandler) error
	Stop() error
	ProcessInfo(pid int) (ProcessMeta, error)
}

// BridgeDepsReceiver is an optional interface a Platform implementation
// satisfies when its inspect path runs through shared/tlsbump.BumpConnection
// (via proxy.BumpFlow). cmd_run builds the cross-platform proxy.BridgeDeps
// once and hands them to every platform that accepts them; the inspect
// branch then bumps each flow through the same engine the macOS NE bridge,
// the compliance proxy, and the AI gateway use. All three platforms
// (macOS / Linux / Windows) satisfy it.
type BridgeDepsReceiver interface {
	SetBridgeDeps(deps *proxy.BridgeDeps)
}

// InterceptionMode identifies which kernel/userspace mechanism is
// currently capturing traffic. Surfaced by statusapi GET_DIAGNOSTICS so
// the Dashboard's Diagnostics page and the tray icon can react.
type InterceptionMode string

const (
	// macOS: NETransparentProxyProvider system extension. This is the
	// sole macOS intercept path — the experimental pf alternative
	// (E74) was retired before shipping.
	ModeNETransparentProxy InterceptionMode = "NETransparentProxy"
	// Linux: iptables REDIRECT + SO_ORIGINAL_DST.
	ModeIPTables InterceptionMode = "iptables"
	// Windows: NexusWFP in-house kernel driver capture (E59).
	// Implements connect-time redirect at WFP layer
	// ALE_CONNECT_REDIRECT_V4/V6 for TCP + UDP, cross-arch on
	// amd64 and arm64.
	ModeNexusWFP InterceptionMode = "NexusWFP"
	// Windows: degraded fallback when NexusWFP load fails — explicit
	// HTTP CONNECT proxy reliant on system-proxy / PAC. Bypassable by
	// apps that ignore WinINet; tray turns yellow.
	ModeSystemProxyFallback InterceptionMode = "SystemProxyFallback"
)

// InterceptionModeReporter is an optional interface a Platform
// implementation may satisfy. statusapi uses it to surface the active
// mode via GET_DIAGNOSTICS. Implementations that don't satisfy this
// interface get the empty string in the response — Dashboard renders
// "unknown" then.
type InterceptionModeReporter interface {
	InterceptionMode() InterceptionMode
}

// InterceptionHealth captures whether the OS-level capture layer
// (macOS NE Transparent Proxy, Linux iptables redirector, Windows
// WinDivert) is actually attached to the daemon and forwarding flows.
//
// Without this signal the daemon can look perfectly healthy on every
// other axis — Hub WS connected, shadow applied, kill switch active —
// while capturing zero traffic because the user never approved the
// macOS proxy-configuration dialog (or the Windows WinDivert driver
// failed to load, or iptables rules got flushed). The status collector
// converts a stale Health into state=degraded so the tray icon turns
// yellow within seconds rather than the user shipping a quiet, broken
// install.
type InterceptionHealth struct {
	// StartedAt is the time the platform shim started listening for
	// flows. Zero when Start has not run yet. The status collector
	// uses (now - StartedAt) against InterceptionGracePeriod to
	// suppress the "not connected" alert during the brief window
	// after daemon launch where the OS still needs to spin up the
	// extension / driver / netfilter table.
	StartedAt time.Time
	// Connected is true after the OS-level capture layer has opened
	// at least one IPC / control connection to the daemon since
	// startup. Stays true after the first connect even if the layer
	// momentarily drops — repeated disconnects flow through
	// ActiveSessions / ConnectionsTotal so a chronic drop is still
	// detectable.
	Connected bool
	// ConnectionsTotal counts cumulative attaches over the daemon's
	// lifetime — useful for the diagnostics dashboard to spot
	// flapping extensions.
	ConnectionsTotal int64
	// ActiveSessions is the number of capture sessions currently
	// attached. On darwin this is the count of in-flight NE IPC
	// connections (typically 0 or 1); on linux/windows it tracks the
	// equivalent control sockets.
	ActiveSessions int
	// LastFlowAt is the time of the most recent flow handled by the
	// capture layer. Zero when no flow has been observed yet. A long
	// gap is normal on idle hosts and is NOT treated as degraded on
	// its own — only the absence of an initial connect is.
	LastFlowAt time.Time
}

// InterceptionGracePeriod is how long the status collector waits after
// daemon startup before treating a missing capture-layer connection as
// degraded. Empirically the macOS Network Extension daemon needs a few
// seconds to load the bundled .systemextension and call back; on
// Linux/Windows the equivalent boot path is faster but the same window
// is harmless.
const InterceptionGracePeriod = 30 * time.Second

// InterceptionHealthReporter is the optional interface platform shims
// implement to surface their attach state to the status collector.
// Implementations that don't satisfy this interface keep the original
// behaviour (no degraded-state surfacing).
type InterceptionHealthReporter interface {
	InterceptionHealth() InterceptionHealth
}

// FlowResult contains the full outcome of an intercepted flow, emitted after
// the flow completes for audit recording.
type FlowResult struct {
	FlowID         string
	SrcIP          string
	DstHost        string
	DstIP          string
	DstPort        int
	Method         string // HTTP method when available from inspection
	Path           string // HTTP request path when available from inspection
	Process        ProcessMeta
	Decision       Decision
	PolicyRuleID   string // matched policy rule pattern (from policy engine)
	BytesIn        int64
	BytesOut       int64
	DurationMs     int
	BumpStatus     string
	StartedAt      time.Time
	HookDecision   string // Hook pipeline decision (approve/reject_hard/block_soft)
	HookReason     string // Human-readable reason from hook pipeline
	HookReasonCode string // Machine-readable reason code
	// ComplianceTags is the merged compliance tag set emitted by the
	// pipeline (severity:*, detector:*, category:*, …). Forwarded to the
	// audit queue so OnFlowComplete can stamp it onto the uploaded event.
	ComplianceTags []string

	// Request-side LLM signals populated by the traffic adapter when
	// InspectRequest ran for this flow. Empty when the flow did not match
	// a known provider adapter or no request inspection occurred.
	Provider          string
	Model             string
	ApiKeyClass       string
	ApiKeyFingerprint string

	// Response-side usage populated by the agent MITM relay's response
	// inspection path (adapter DetectResponseUsage for JSON, UsageAccumulator
	// for SSE). Token pointers are nil when usage was unavailable;
	// UsageExtractionStatus matches traffic.UsageStatus values.
	PromptTokens          *int
	CompletionTokens      *int
	UsageExtractionStatus string

	// Payload capture bytes populated when the payload_capture.config admin
	// toggle has the corresponding flag enabled. Bounded by the per-flow
	// inspectBodyCap (spill.perObjectCap, default 256 MiB); the audit stamp
	// at OnFlowComplete is a plain copy. Hub demuxes inline-vs-spill on
	// receipt. Nil when capture is disabled.
	PayloadRequest  []byte
	PayloadResponse []byte

	// Latency phase breakdown. Populated by proxy.MITMRelay from a per-flow
	// traffic.PhaseSink attached to the upstream relayClient.Do context. Nil
	// when the flow did not reach the upstream call (e.g. hook block,
	// intercept-only). connectionBridge.OnFlowComplete copies these onto
	// audit.Event for SQLite persistence + Hub upload.
	UpstreamTtfbMs   *int
	UpstreamTotalMs  *int
	RequestHooksMs   *int
	ResponseHooksMs  *int
	LatencyBreakdown map[string]int

	// Classification inputs propagated from the bridge / Swift side.
	// DomainRuleID is the matched interception_domain.id (empty when host
	// wasn't configured for inspection). PathAction is the resolved per-path
	// action ("PROCESS"/"PASSTHROUGH"/"BLOCK"). connectionBridge.OnFlowComplete
	// copies these onto audit.Event so audit.Classify() distinguishes Inspect
	// (matched + PASSTHROUGH) from Processed (matched + PROCESS + hooks ran).
	DomainRuleID string
	PathAction   string
}

// FlowAuditor is an optional interface that ConnectionHandler implementations
// may satisfy. When present, the platform calls OnFlowComplete after each
// intercepted flow finishes (with bytes transferred, duration, bump status).
type FlowAuditor interface {
	OnFlowComplete(result FlowResult)
}
