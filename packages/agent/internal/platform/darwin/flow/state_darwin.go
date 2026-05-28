//go:build darwin

// Package flow contains the flow state machine types used by the macOS
// DarwinPlatform to track in-flight NE flows from flow_new through flow_closed.
package flow

import "time"

// State holds per-flow tracking state from flow_new through flow_closed.
// Field names are exported so platform.darwin can access them directly.
type State struct {
	// Connection identity — populated by flow_new.
	FlowID  string
	DstHost string
	DstIP   string
	DstPort int
	SrcIP   string
	SrcPort int

	// Process metadata — populated by flow_new via proc.ProcessInfo.
	ProcPID      int
	ProcPath     string
	ProcName     string
	ProcBundleID string
	ProcUser     string

	// Decision returned by the connection handler at flow_new time.
	DecisionInt int // 0=inspect, 1=passthrough, 2=deny (mirrors platform.Decision)

	// Flow lifecycle.
	StartedAt time.Time
}
