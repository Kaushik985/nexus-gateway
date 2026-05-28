package store

import (
	"sync"
	"time"
)

// samlRequestTTL bounds how long an outstanding SP-initiated SAML
// AuthnRequest ID is remembered for InResponseTo validation. It must
// outlast the slowest realistic IdP round-trip (credentials + MFA) but
// stay short so abandoned flows do not accumulate. Matches the
// pending-authorize window.
const samlRequestTTL = 10 * time.Minute

// SAMLRequestStore remembers the AuthnRequest ID issued by a SP-initiated
// SAML login, keyed by the authctx handle carried as RelayState. The ACS
// handler validates the response's InResponseTo against the stored ID and
// consumes it, so a replayed or unsolicited response cannot complete login.
// Entries live in process memory only; a restart invalidates in-flight SAML
// logins, acceptable given the short TTL.
type SAMLRequestStore struct {
	mu   sync.Mutex
	data map[string]samlRequestEntry

	done     chan struct{}
	closeOne sync.Once
	ticker   *time.Ticker
	wg       sync.WaitGroup
}

type samlRequestEntry struct {
	requestID string
	expiresAt time.Time
}

// NewSAMLRequestStore returns a store whose janitor sweeps expired entries on
// a cadence tied to samlRequestTTL. Callers must invoke Close to stop it.
func NewSAMLRequestStore() *SAMLRequestStore {
	s := &SAMLRequestStore{
		data:   make(map[string]samlRequestEntry),
		done:   make(chan struct{}),
		ticker: time.NewTicker(janitorInterval(samlRequestTTL)),
	}
	s.wg.Add(1)
	go s.run()
	return s
}

// Put records requestID under authctx, overwriting any prior value.
func (s *SAMLRequestStore) Put(authctx, requestID string) {
	s.mu.Lock()
	s.data[authctx] = samlRequestEntry{requestID: requestID, expiresAt: time.Now().Add(samlRequestTTL)}
	s.mu.Unlock()
}

// Take returns the AuthnRequest ID for authctx and deletes it. Expired
// entries are removed and reported as missing. Single-use: a replayed
// authctx cannot satisfy a second InResponseTo check.
func (s *SAMLRequestStore) Take(authctx string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.data[authctx]
	if !ok {
		return "", false
	}
	delete(s.data, authctx)
	if time.Now().After(e.expiresAt) {
		return "", false
	}
	return e.requestID, true
}

// Close stops the janitor. Safe to call more than once.
func (s *SAMLRequestStore) Close() {
	s.closeOne.Do(func() {
		close(s.done)
		s.ticker.Stop()
	})
	s.wg.Wait()
}

func (s *SAMLRequestStore) run() {
	defer s.wg.Done()
	for {
		select {
		case <-s.done:
			return
		case <-s.ticker.C:
			s.sweep()
		}
	}
}

func (s *SAMLRequestStore) sweep() {
	now := time.Now()
	s.mu.Lock()
	for k, v := range s.data {
		if now.After(v.expiresAt) {
			delete(s.data, k)
		}
	}
	s.mu.Unlock()
}
