package login

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"testing"
	"time"
)

// testIDPKeypair is a generated RSA key + self-signed certificate standing in
// for an external IdP's signing key. Tests use Cert (PEM) as the IdP config's
// certificatePem and Key to sign SAMLResponses the way a real IdP would.
type testIDPKeypair struct {
	Key     *rsa.PrivateKey
	Cert    *x509.Certificate
	CertPEM string
}

// newTestIDPKeypair generates a fresh 2048-bit RSA key and a self-signed
// certificate. Shared by the SP-builder and ACS handler tests.
func newTestIDPKeypair(t *testing.T) *testIDPKeypair {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("rsa.GenerateKey: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "test-idp"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("CreateCertificate: %v", err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("ParseCertificate: %v", err)
	}
	pemStr := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
	return &testIDPKeypair{Key: key, Cert: cert, CertPEM: pemStr}
}
