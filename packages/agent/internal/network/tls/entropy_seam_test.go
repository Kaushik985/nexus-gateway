package tls

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"errors"
	"io"
	"math/big"
	mathrand "math/rand"
	"strings"
	"testing"
	"time"
)

// detEntropy returns a deterministic but uniformly-distributed byte source.
// The threshold-sweep tests below previously used crypto/rand.Reader as
// failAfter.inner; because each crypto primitive's rejection sampling consumes
// a runtime-variable number of reads, the 1..60 sweep intermittently failed to
// reach x509.CreateCertificate's entropy read, leaving that error branch
// uncovered and dropping package coverage below 95% at random. A fixed-seed
// stream makes the per-call read boundaries identical on every run, so the
// sweep covers every rand consumer (key gen / serial / certificate) reliably.
func detEntropy() io.Reader { return mathrand.New(mathrand.NewSource(0x6e6578757300)) }

// failReader is an io.Reader that always returns a sentinel error;
// drives the rand-failure branches in ecdsa.GenerateKey / rand.Int /
// x509.CreateCertificate through the package-level tlsRandReader seam.
type failReader struct{ err error }

func (f failReader) Read(_ []byte) (int, error) { return 0, f.err }

// failAfter is an io.Reader that delegates to inner for the first n calls
// then returns err. Used to step past ecdsa.GenerateKey + rand.Int and
// force x509.CreateCertificate's entropy read to fail.
type failAfter struct {
	inner io.Reader
	err   error
	calls *int // shared counter
	at    int  // index at which to start failing
}

func (f *failAfter) Read(p []byte) (int, error) {
	*f.calls++
	if *f.calls > f.at {
		return 0, f.err
	}
	return f.inner.Read(p)
}

// swapTLSRandReader injects a failReader, returning a restore func.
func swapTLSRandReader(t *testing.T, r io.Reader) func() {
	t.Helper()
	orig := tlsRandReader
	tlsRandReader = r
	return func() { tlsRandReader = orig }
}

func mustValidCA(t *testing.T) (*x509.Certificate, *ecdsa.PrivateKey) {
	t.Helper()
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("CA key: %v", err)
	}
	serial, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	tmpl := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "test-ca"},
		NotBefore:             time.Now().Add(-time.Minute),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatalf("CA cert: %v", err)
	}
	cert, _ := x509.ParseCertificate(der)
	return cert, caKey
}

// generateCA path

func TestGenerateCA_EntropyError(t *testing.T) {
	want := errors.New("simulated entropy failure")
	restore := swapTLSRandReader(t, failReader{err: want})
	defer restore()

	_, _, err := generateCA()
	if err == nil {
		t.Fatal("generateCA must surface entropy error")
	}
	// generateCA returns the rand-error verbatim from ecdsa.GenerateKey
	// (no wrap on the first arm — first failure short-circuits).
	if !errors.Is(err, want) && !strings.Contains(err.Error(), want.Error()) {
		t.Errorf("err should carry sentinel; got %q", err)
	}
}

func TestNewEngine_GenerateCAErrorWraps(t *testing.T) {
	restore := swapTLSRandReader(t, failReader{err: errors.New("entropy starved")})
	defer restore()

	_, err := NewEngine(nil, nil, 0, 0)
	if err == nil {
		t.Fatal("NewEngine with nil CA + failing entropy must surface error")
	}
	if !strings.Contains(err.Error(), "generate CA") {
		t.Errorf("err should wrap 'generate CA'; got %q", err)
	}
}

func TestLoadOrGenerateCA_GenerateError(t *testing.T) {
	restore := swapTLSRandReader(t, failReader{err: errors.New("entropy")})
	defer restore()

	dir := t.TempDir()
	cert, key, fresh, err := LoadOrGenerateCA(dir+"/ca.crt", dir+"/ca.key")
	if err == nil {
		t.Fatal("LoadOrGenerateCA missing files + failing entropy must error")
	}
	if cert != nil || key != nil || fresh {
		t.Errorf("error path must return (nil,nil,false,err); got cert=%v key=%v fresh=%v", cert, key, fresh)
	}
	if !strings.Contains(err.Error(), "generate CA") {
		t.Errorf("err should wrap 'generate CA'; got %q", err)
	}
}

// IssueLeafCertByHostname path

func TestIssueLeafCertByHostname_GenerateKeyError(t *testing.T) {
	caCert, caKey := mustValidCA(t)
	eng, err := NewEngine(caCert, caKey, 10, time.Hour)
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}

	restore := swapTLSRandReader(t, failReader{err: errors.New("starved")})
	defer restore()

	_, err = eng.IssueLeafCertByHostname("example.com")
	if err == nil {
		t.Fatal("must surface entropy error from ecdsa.GenerateKey")
	}
	if !strings.Contains(err.Error(), "generate leaf key") {
		t.Errorf("err should wrap 'generate leaf key'; got %q", err)
	}
}

// Production-default pin: the package init wires the real rand.Reader.

func TestTLSRandReader_ProductionDefault(t *testing.T) {
	if tlsRandReader == nil {
		t.Error("tlsRandReader must not be nil at package init")
	}
}

// Step-past-GenerateKey tests: drive rand.Int + CreateCertificate err arms.

func TestIssueLeafCertByHostname_DownstreamEntropyError(t *testing.T) {
	caCert, caKey := mustValidCA(t)
	eng, err := NewEngine(caCert, caKey, 10, time.Hour)
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}

	// Probe thresholds — ecdsa.GenerateKey + x509.CreateCertificate
	// consume entropy at runtime-determined boundaries.
	hostname := "probe.example"
	for at := 1; at < 60; at++ {
		calls := 0
		tlsRandReader = &failAfter{
			inner: detEntropy(),
			err:   errors.New("starved at downstream"),
			calls: &calls,
			at:    at,
		}
		_, err := eng.IssueLeafCertByHostname(hostname + ".v" + strings.Repeat("x", at))
		tlsRandReader = rand.Reader
		if err == nil {
			continue
		}
		msg := err.Error()
		if !strings.Contains(msg, "generate leaf key") &&
			!strings.Contains(msg, "generate serial") &&
			!strings.Contains(msg, "create leaf cert") {
			t.Errorf("err should wrap a downstream rand consumer; got %q", msg)
		}
		return
	}
	t.Fatal("no failAfter threshold in [1,60) surfaced an entropy error")
}

func TestGenerateCA_AllRandConsumerArms(t *testing.T) {
	// Sweep thresholds 1..60 — each threshold may cause a different rand
	// consumer in generateCA (ecdsa.GenerateKey internal reads, rand.Int
	// for serial, x509.CreateCertificate for signature randomization)
	// to surface the failure. Sweeping covers all arms.
	sawAnyError := false
	for at := 1; at < 60; at++ {
		calls := 0
		restore := swapTLSRandReader(t, &failAfter{
			inner: detEntropy(),
			err:   errors.New("starved"),
			calls: &calls,
			at:    at,
		})
		_, _, err := generateCA()
		restore()
		if err != nil {
			sawAnyError = true
		}
	}
	if !sawAnyError {
		t.Fatal("no failAfter threshold in [1,60) surfaced an entropy error from generateCA")
	}
}

func TestIssueLeafCertByHostname_AllRandConsumerArms(t *testing.T) {
	caCert, caKey := mustValidCA(t)
	eng, err := NewEngine(caCert, caKey, 200, time.Hour)
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	sawAny := false
	for at := 1; at < 60; at++ {
		calls := 0
		tlsRandReader = &failAfter{
			inner: detEntropy(),
			err:   errors.New("starved"),
			calls: &calls,
			at:    at,
		}
		// Unique hostname per iter so cache doesn't short-circuit.
		host := "h" + strings.Repeat("a", at) + ".example"
		_, err := eng.IssueLeafCertByHostname(host)
		tlsRandReader = rand.Reader
		if err != nil {
			sawAny = true
		}
	}
	if !sawAny {
		t.Fatal("no failAfter threshold surfaced entropy err in IssueLeafCertByHostname")
	}
}

// (IssueLeafCert fingerprint-keyed path removed; the hostname-keyed path
// above covers the same rand-consumer arms.)

// budgetReader serves exactly len(buf) deterministic bytes, then errors. The
// failAfter sweep above counts Read CALLS, which crypto/internal/randutil's
// MaybeReadByte jitters by ±1 per primitive — so it cannot reliably starve one
// specific operation, and the package coverage flaked 94.8%–96.9%. Each crypto
// primitive here consumes tens of bytes, so a byte budget placed in the gap
// between two operations' cumulative needs starves the intended operation
// deterministically despite the ±1 jitter.
type budgetReader struct {
	buf []byte
	pos int
}

func (b *budgetReader) Read(p []byte) (int, error) {
	if b.pos >= len(b.buf) {
		return 0, errors.New("entropy budget exhausted")
	}
	n := copy(p, b.buf[b.pos:])
	b.pos += n
	return n, nil
}

// detBudget returns a reader that yields n bytes of real entropy then fails.
// Real (vs seeded) bytes are used so P256 key generation never hits its rare
// scalar-rejection retry — it consumes ~33 bytes (32 + the MaybeReadByte
// probe), and rand.Int(2^128) consumes ~16. Budget 40 therefore clears the key
// but starves the serial draw; budget 60 clears both but starves
// x509.CreateCertificate's signature nonce. The ~7–11 byte margins absorb the
// ±1 MaybeReadByte jitter, so the targeted branch fails on every run.
func detBudget(n int) *budgetReader {
	buf := make([]byte, n)
	_, _ = rand.Read(buf)
	return &budgetReader{buf: buf}
}

// TestGenerateCA_SerialEntropyError deterministically covers the serial-draw
// failure arm of generateCA (key succeeds, rand.Int is starved).
func TestGenerateCA_SerialEntropyError(t *testing.T) {
	restore := swapTLSRandReader(t, detBudget(40))
	defer restore()
	if _, _, err := generateCA(); err == nil || !strings.Contains(err.Error(), "generate CA serial") {
		t.Fatalf("starved serial draw should wrap %q, got %v", "generate CA serial", err)
	}
}

// TestGenerateCA_CertEntropyError deterministically covers the certificate
// signing failure arm of generateCA (key + serial succeed, CreateCertificate
// is starved).
func TestGenerateCA_CertEntropyError(t *testing.T) {
	restore := swapTLSRandReader(t, detBudget(60))
	defer restore()
	_, _, err := generateCA()
	if err == nil {
		t.Fatal("starved certificate signing should error")
	}
	if strings.Contains(err.Error(), "generate CA serial") {
		t.Fatalf("budget should clear the serial draw and fail at signing, got %v", err)
	}
}

// TestIssueLeaf_SerialEntropyError covers IssueLeafCertByHostname's serial arm.
func TestIssueLeaf_SerialEntropyError(t *testing.T) {
	caCert, caKey := mustValidCA(t)
	eng, err := NewEngine(caCert, caKey, 10, time.Hour)
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	restore := swapTLSRandReader(t, detBudget(40))
	defer restore()
	if _, err := eng.IssueLeafCertByHostname("starved-serial.example"); err == nil ||
		!strings.Contains(err.Error(), "generate serial") {
		t.Fatalf("starved serial draw should wrap %q, got %v", "generate serial", err)
	}
}

// TestIssueLeaf_CertEntropyError covers IssueLeafCertByHostname's signing arm.
func TestIssueLeaf_CertEntropyError(t *testing.T) {
	caCert, caKey := mustValidCA(t)
	eng, err := NewEngine(caCert, caKey, 10, time.Hour)
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	restore := swapTLSRandReader(t, detBudget(60))
	defer restore()
	_, err = eng.IssueLeafCertByHostname("starved-cert.example")
	if err == nil {
		t.Fatal("starved certificate signing should error")
	}
	if strings.Contains(err.Error(), "generate serial") {
		t.Fatalf("budget should clear the serial draw and fail at signing, got %v", err)
	}
}
