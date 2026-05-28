package login

import (
	"net/http"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"

	"github.com/AlphaBitCore/nexus-gateway/packages/control-plane/internal/identity/authserver/store"
)

// These tests exercise the security-critical REJECTION behaviour of the ACS
// handler through the real crewjam ParseResponse: a validly-signed response is
// minted, then the signing key / InResponseTo / bytes are made wrong, and the
// handler must refuse. They are the tests that prove the SP actually validates,
// not just that the happy path works.
func TestSAMLACSHandler_RejectsInvalidAssertions(t *testing.T) {
	const idpEntityID = "https://idp.acme.test/metadata"
	configuredKP := newTestIDPKeypair(t)
	cfg := samlConfigJSON(idpEntityID, "https://idp.acme.test/sso", configuredKP.CertPEM)
	sp, err := buildSAMLServiceProvider(store.DecodeSAMLConfig(&store.IdentityProvider{Type: "saml", Config: map[string]any{
		"entityId": idpEntityID, "ssoUrl": "https://idp.acme.test/sso", "certificatePem": configuredKP.CertPEM,
	}}), samlIssuer)
	if err != nil {
		t.Fatalf("build sp: %v", err)
	}

	// mkDeps wires an ACS handler whose IdP (idp-1, enabled, jit) is the one the
	// SP trusts. authctx ctx-1 has an outstanding request id "id-good".
	mkDeps := func(t *testing.T, idpEnabled bool) (SAMLDeps, func()) {
		mock, _ := pgxmock.NewPool()
		mock.ExpectQuery(idpRowQuery).WithArgs("idp-1").
			WillReturnRows(samlIdPRows("idp-1", "Acme", idpEnabled, true, cfg))
		pending := store.NewPendingAuthzStore()
		reqs := store.NewSAMLRequestStore()
		pending.Put("ctx-1", store.PendingAuthzEntry{IdPID: "idp-1", RedirectURI: "http://127.0.0.1/cb", ExpiresAt: time.Now().Add(time.Minute)})
		reqs.Put("ctx-1", "id-good")
		d := SAMLDeps{
			IdPs: store.NewIdPStoreWithPool(mock), Federated: store.NewFederatedStoreWithPool(mock),
			Pending: pending, AuthCodes: store.NewAuthCodeStore(time.Minute), Requests: reqs, Issuer: samlIssuer,
		}
		return d, func() { mock.Close(); pending.Close(); reqs.Close(); d.AuthCodes.Close() }
	}

	t.Run("response signed by a key the SP does not trust -> 401", func(t *testing.T) {
		d, done := mkDeps(t, true)
		defer done()
		wrongKP := newTestIDPKeypair(t) // different key than configuredKP
		resp := mintSignedSAMLResponse(t, wrongKP, sp, idpEntityID, "id-good", "alice@acme.test", nil)
		c, rec := newSAMLACSCtx("ctx-1", resp)
		_ = SAMLACSHandler(d)(c)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("got %d (body=%q), want 401 — wrong signing key must be rejected", rec.Code, rec.Body.String())
		}
	})

	t.Run("InResponseTo not matching the outstanding request -> 401", func(t *testing.T) {
		d, done := mkDeps(t, true)
		defer done()
		// Correctly signed, but the assertion's InResponseTo is "id-evil" while
		// the only outstanding request id is "id-good".
		resp := mintSignedSAMLResponse(t, configuredKP, sp, idpEntityID, "id-evil", "alice@acme.test", nil)
		c, rec := newSAMLACSCtx("ctx-1", resp)
		_ = SAMLACSHandler(d)(c)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("got %d (body=%q), want 401 — InResponseTo mismatch must be rejected", rec.Code, rec.Body.String())
		}
	})

	t.Run("tampered signed bytes -> 401", func(t *testing.T) {
		d, done := mkDeps(t, true)
		defer done()
		resp := mintSignedSAMLResponse(t, configuredKP, sp, idpEntityID, "id-good", "alice@acme.test", nil)
		// Flip characters in the middle of the base64 payload so the signed XML
		// no longer matches its signature.
		b := []byte(resp)
		mid := len(b) / 2
		for i := mid; i < mid+8 && i < len(b); i++ {
			if b[i] == 'A' {
				b[i] = 'B'
			} else {
				b[i] = 'A'
			}
		}
		c, rec := newSAMLACSCtx("ctx-1", string(b))
		_ = SAMLACSHandler(d)(c)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("got %d (body=%q), want 401 — tampered bytes must be rejected", rec.Code, rec.Body.String())
		}
	})

	t.Run("disabled IdP -> 400 (in-flight login invalidated)", func(t *testing.T) {
		d, done := mkDeps(t, false) // idp.Enabled = false
		defer done()
		resp := mintSignedSAMLResponse(t, configuredKP, sp, idpEntityID, "id-good", "alice@acme.test", nil)
		c, rec := newSAMLACSCtx("ctx-1", resp)
		_ = SAMLACSHandler(d)(c)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("got %d (body=%q), want 400 — disabled IdP must reject", rec.Code, rec.Body.String())
		}
	})
}
