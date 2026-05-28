package wiring

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/labstack/echo/v4"
	pgxmock "github.com/pashagolub/pgxmock/v4"

	"github.com/AlphaBitCore/nexus-gateway/packages/control-plane/cmd/control-plane/config"
	"github.com/AlphaBitCore/nexus-gateway/packages/control-plane/internal/store"
)

func TestInitAuthServer_NilDB_ReturnsNoopCloserAndNilError(t *testing.T) {
	e := echo.New()
	d := AuthServerDeps{
		Cfg:    &config.Config{},
		DB:     nil,
		Logger: silentLogger(),
	}
	closer, err := InitAuthServer(context.Background(), e, d)
	if err != nil {
		t.Fatalf("expected nil error when db is nil, got %v", err)
	}
	if closer == nil {
		t.Error("expected non-nil closer")
	}
	// closer must be callable without panic.
	closer()
}

// TestInitAuthServer_WithDB_GeneratesKey verifies the full InitAuthServer path
// with a non-nil DB (using pgxmock) and a temp keystore directory.
// The keystore is empty → generates an initial key, mounts OIDC routes.
func TestInitAuthServer_WithDB_GeneratesKey(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	db := store.NewWithPgxPool(mock)
	e := echo.New()
	keystoreDir := t.TempDir()

	cfg := &config.Config{}
	cfg.AuthServer.KeystoreDir = keystoreDir
	cfg.AuthServer.Issuer = "http://localhost:3001"

	d := AuthServerDeps{
		Cfg:    cfg,
		DB:     db,
		Logger: silentLogger(),
	}

	closer, err := InitAuthServer(context.Background(), e, d)
	if err != nil {
		t.Fatalf("InitAuthServer failed: %v", err)
	}
	if closer == nil {
		t.Error("expected non-nil closer")
	}
	closer()
}

// TestInitAuthServer_WithDB_UnreadableKeystore_ReturnsError verifies that when
// OpenKeystore fails (dir exists but is unreadable), InitAuthServer returns
// the error. This covers the `return closer, err` branch after OpenKeystore.
// Skipped when running as root (root bypasses permission checks).
func TestInitAuthServer_WithDB_UnreadableKeystore_ReturnsError(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("running as root; cannot test unreadable dir")
	}

	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	db := store.NewWithPgxPool(mock)
	e := echo.New()

	// Create a dir then chmod 000 so ReadDir fails inside OpenKeystore.
	keystoreParent := t.TempDir()
	keystoreDir := filepath.Join(keystoreParent, "keystore")
	if err := os.MkdirAll(keystoreDir, 0o000); err != nil {
		t.Fatalf("setup: %v", err)
	}
	// Restore permissions so t.TempDir cleanup can remove the dir.
	t.Cleanup(func() { os.Chmod(keystoreDir, 0o700) })

	cfg := &config.Config{}
	cfg.AuthServer.KeystoreDir = keystoreDir
	cfg.AuthServer.Issuer = "http://localhost:3001"

	d := AuthServerDeps{
		Cfg:    cfg,
		DB:     db,
		Logger: silentLogger(),
	}

	_, err = InitAuthServer(context.Background(), e, d)
	if err == nil {
		t.Fatal("expected error when keystore dir is unreadable, got nil")
	}
}
