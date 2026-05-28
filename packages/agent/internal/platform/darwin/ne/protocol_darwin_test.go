//go:build darwin

package ne

import (
	"errors"
	"testing"
)

func TestSocketPath(t *testing.T) {
	origUID, origHome := osGetuid, osUserHomeDir
	t.Cleanup(func() { osGetuid, osUserHomeDir = origUID, origHome })

	// Root → system-wide /var/run socket.
	osGetuid = func() int { return 0 }
	if got := SocketPath(); got != "/var/run/nexus-agent/ne.sock" {
		t.Fatalf("root: got %q", got)
	}

	// Non-root with a home dir → user-local ~/.nexus/ne.sock.
	osGetuid = func() int { return 501 }
	osUserHomeDir = func() (string, error) { return "/Users/alice", nil }
	if got := SocketPath(); got != "/Users/alice/.nexus/ne.sock" {
		t.Fatalf("user: got %q", got)
	}

	// Non-root, no resolvable home → /tmp fallback.
	osUserHomeDir = func() (string, error) { return "", errors.New("no home") }
	if got := SocketPath(); got != "/tmp/nexus-agent-ne.sock" {
		t.Fatalf("no-home fallback: got %q", got)
	}
}
