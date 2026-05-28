package store

import (
	"testing"
	"time"
)

func TestSAMLRequestStore_PutTakeRoundTrip(t *testing.T) {
	s := NewSAMLRequestStore()
	defer s.Close()

	s.Put("authctx-1", "id-abc")
	got, ok := s.Take("authctx-1")
	if !ok || got != "id-abc" {
		t.Fatalf("Take = (%q, %v), want (id-abc, true)", got, ok)
	}
}

func TestSAMLRequestStore_TakeIsSingleUse(t *testing.T) {
	s := NewSAMLRequestStore()
	defer s.Close()

	s.Put("authctx-1", "id-abc")
	if _, ok := s.Take("authctx-1"); !ok {
		t.Fatal("first Take should succeed")
	}
	// A replayed authctx must not satisfy a second InResponseTo check.
	if _, ok := s.Take("authctx-1"); ok {
		t.Fatal("second Take must fail — request IDs are single-use")
	}
}

func TestSAMLRequestStore_TakeUnknownReturnsFalse(t *testing.T) {
	s := NewSAMLRequestStore()
	defer s.Close()
	if _, ok := s.Take("never-put"); ok {
		t.Fatal("Take of unknown authctx must return false")
	}
}

func TestSAMLRequestStore_ExpiredEntryRejected(t *testing.T) {
	s := NewSAMLRequestStore()
	defer s.Close()

	// Write an already-expired entry directly to exercise the expiry branch
	// without waiting out the TTL.
	s.mu.Lock()
	s.data["stale"] = samlRequestEntry{requestID: "id-old", expiresAt: time.Now().Add(-time.Minute)}
	s.mu.Unlock()

	if _, ok := s.Take("stale"); ok {
		t.Fatal("expired entry must be reported as missing")
	}
	// And it must be deleted (not lingering).
	s.mu.Lock()
	_, present := s.data["stale"]
	s.mu.Unlock()
	if present {
		t.Fatal("expired entry should be deleted on Take")
	}
}

func TestSAMLRequestStore_SweepDropsExpired(t *testing.T) {
	s := NewSAMLRequestStore()
	defer s.Close()

	s.mu.Lock()
	s.data["live"] = samlRequestEntry{requestID: "id-live", expiresAt: time.Now().Add(time.Hour)}
	s.data["dead"] = samlRequestEntry{requestID: "id-dead", expiresAt: time.Now().Add(-time.Hour)}
	s.mu.Unlock()

	s.sweep()

	s.mu.Lock()
	_, liveOK := s.data["live"]
	_, deadOK := s.data["dead"]
	s.mu.Unlock()
	if !liveOK {
		t.Error("sweep dropped a live entry")
	}
	if deadOK {
		t.Error("sweep kept an expired entry")
	}
}

func TestSAMLRequestStore_CloseIdempotent(t *testing.T) {
	s := NewSAMLRequestStore()
	s.Close()
	s.Close() // must not panic
}
