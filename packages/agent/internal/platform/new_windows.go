//go:build windows

package platform

import (
	"github.com/AlphaBitCore/nexus-gateway/packages/agent/internal/platform/windows"
)

// WindowsPlatform is re-exported for optional type assertions.
type WindowsPlatform = windows.WindowsPlatform

// NewPlatform creates the Windows platform shim.
func NewPlatform(addr string) Platform {
	return windows.NewPlatform(addr)
}
