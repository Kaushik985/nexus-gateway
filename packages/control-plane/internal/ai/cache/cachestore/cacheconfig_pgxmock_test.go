package cachestore

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"

	"github.com/AlphaBitCore/nexus-gateway/packages/shared/storage/cacheconfig"
)

func newMock(t *testing.T) (*Store, pgxmock.PgxPoolIface) {
	t.Helper()
	m, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock: %v", err)
	}
	t.Cleanup(m.Close)
	return New(m), m
}

func TestGetCacheGlobalConfig(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`SELECT config FROM cache_global_config WHERE id = 'singleton'`).
		WillReturnRows(pgxmock.NewRows([]string{"config"}).AddRow([]byte(`{"enabled":true}`)))
	cfg, err := s.GetCacheGlobalConfig(context.Background())
	if err != nil {
		t.Fatalf("GetCacheGlobalConfig: %v", err)
	}
	_ = cfg

	// Missing singleton row → zero config, no error (seeded-by-migration invariant).
	m.ExpectQuery(`cache_global_config`).WillReturnError(pgx.ErrNoRows)
	if _, err := s.GetCacheGlobalConfig(context.Background()); err != nil {
		t.Fatalf("ErrNoRows should be tolerated, got %v", err)
	}
	// Query error surfaces.
	m.ExpectQuery(`cache_global_config`).WillReturnError(errors.New("db"))
	if _, err := s.GetCacheGlobalConfig(context.Background()); err == nil {
		t.Fatal("query error should surface")
	}
	// Corrupt JSON → unmarshal error.
	m.ExpectQuery(`cache_global_config`).WillReturnRows(pgxmock.NewRows([]string{"config"}).AddRow([]byte(`{bad`)))
	if _, err := s.GetCacheGlobalConfig(context.Background()); err == nil {
		t.Fatal("corrupt JSON should surface an unmarshal error")
	}
}

func TestPutCacheGlobalConfig(t *testing.T) {
	s, m := newMock(t)
	m.ExpectExec(`INSERT INTO cache_global_config`).WithArgs(pgxmock.AnyArg(), "admin").
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	if err := s.PutCacheGlobalConfig(context.Background(), cacheconfig.GlobalConfig{}, "admin"); err != nil {
		t.Fatalf("PutCacheGlobalConfig: %v", err)
	}
	m.ExpectExec(`INSERT INTO cache_global_config`).WithArgs(pgxmock.AnyArg(), "admin").WillReturnError(errors.New("boom"))
	if err := s.PutCacheGlobalConfig(context.Background(), cacheconfig.GlobalConfig{}, "admin"); err == nil {
		t.Fatal("exec error should surface")
	}
}

func TestGetCacheAdapterConfig(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`FROM cache_adapter_config WHERE adapter_type = \$1`).WithArgs("openai").
		WillReturnRows(pgxmock.NewRows([]string{"config"}).AddRow([]byte(`{}`)))
	_, ok, err := s.GetCacheAdapterConfig(context.Background(), "openai")
	if err != nil || !ok {
		t.Fatalf("GetCacheAdapterConfig found: ok=%v err=%v", ok, err)
	}
	m.ExpectQuery(`cache_adapter_config`).WithArgs("missing").WillReturnError(pgx.ErrNoRows)
	if _, ok, err := s.GetCacheAdapterConfig(context.Background(), "missing"); err != nil || ok {
		t.Fatalf("missing → (zero,false,nil), got ok=%v err=%v", ok, err)
	}
	m.ExpectQuery(`cache_adapter_config`).WithArgs("e").WillReturnError(errors.New("db"))
	if _, _, err := s.GetCacheAdapterConfig(context.Background(), "e"); err == nil {
		t.Fatal("query error should surface")
	}
	m.ExpectQuery(`cache_adapter_config`).WithArgs("bad").WillReturnRows(pgxmock.NewRows([]string{"config"}).AddRow([]byte(`{bad`)))
	if _, ok, err := s.GetCacheAdapterConfig(context.Background(), "bad"); err == nil || !ok {
		t.Fatalf("corrupt JSON → (zero,true,err), got ok=%v err=%v", ok, err)
	}
}

func TestPutCacheAdapterConfig(t *testing.T) {
	s, m := newMock(t)
	m.ExpectExec(`INSERT INTO cache_adapter_config`).WithArgs("openai", pgxmock.AnyArg(), "admin").
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	if err := s.PutCacheAdapterConfig(context.Background(), "openai", cacheconfig.AdapterConfig{}, "admin"); err != nil {
		t.Fatalf("PutCacheAdapterConfig: %v", err)
	}
	m.ExpectExec(`INSERT INTO cache_adapter_config`).WithArgs("openai", pgxmock.AnyArg(), "admin").WillReturnError(errors.New("boom"))
	if err := s.PutCacheAdapterConfig(context.Background(), "openai", cacheconfig.AdapterConfig{}, "admin"); err == nil {
		t.Fatal("exec error should surface")
	}
}

func TestListCacheAdapterConfigs(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`SELECT adapter_type, config FROM cache_adapter_config`).
		WillReturnRows(pgxmock.NewRows([]string{"adapter_type", "config"}).
			AddRow("openai", []byte(`{}`)).AddRow("anthropic", []byte(`{}`)))
	out, err := s.ListCacheAdapterConfigs(context.Background())
	if err != nil || len(out) != 2 {
		t.Fatalf("ListCacheAdapterConfigs: %v %v", out, err)
	}
	m.ExpectQuery(`cache_adapter_config`).WillReturnError(errors.New("boom"))
	if _, err := s.ListCacheAdapterConfigs(context.Background()); err == nil {
		t.Fatal("query error should surface")
	}
	// scan error: only one column returned
	s2, m2 := newMock(t)
	m2.ExpectQuery(`cache_adapter_config`).WillReturnRows(pgxmock.NewRows([]string{"adapter_type"}).AddRow("openai"))
	if _, err := s2.ListCacheAdapterConfigs(context.Background()); err == nil {
		t.Fatal("scan error should surface")
	}
	// unmarshal error
	s3, m3 := newMock(t)
	m3.ExpectQuery(`cache_adapter_config`).WillReturnRows(pgxmock.NewRows([]string{"adapter_type", "config"}).AddRow("openai", []byte(`{bad`)))
	if _, err := s3.ListCacheAdapterConfigs(context.Background()); err == nil {
		t.Fatal("unmarshal error should surface")
	}
}

func TestGetCacheProviderConfig(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`FROM cache_provider_config WHERE provider_id = \$1`).WithArgs("p1").
		WillReturnRows(pgxmock.NewRows([]string{"config"}).AddRow([]byte(`{}`)))
	if _, ok, err := s.GetCacheProviderConfig(context.Background(), "p1"); err != nil || !ok {
		t.Fatalf("found: ok=%v err=%v", ok, err)
	}
	m.ExpectQuery(`cache_provider_config`).WithArgs("missing").WillReturnError(pgx.ErrNoRows)
	if _, ok, err := s.GetCacheProviderConfig(context.Background(), "missing"); err != nil || ok {
		t.Fatalf("missing → (zero,false,nil), got ok=%v err=%v", ok, err)
	}
	m.ExpectQuery(`cache_provider_config`).WithArgs("e").WillReturnError(errors.New("db"))
	if _, _, err := s.GetCacheProviderConfig(context.Background(), "e"); err == nil {
		t.Fatal("query error should surface")
	}
	m.ExpectQuery(`cache_provider_config`).WithArgs("bad").WillReturnRows(pgxmock.NewRows([]string{"config"}).AddRow([]byte(`{bad`)))
	if _, ok, err := s.GetCacheProviderConfig(context.Background(), "bad"); err == nil || !ok {
		t.Fatalf("corrupt JSON → (zero,true,err), got ok=%v err=%v", ok, err)
	}
}

func TestPutAndDeleteCacheProviderConfig(t *testing.T) {
	s, m := newMock(t)
	m.ExpectExec(`INSERT INTO cache_provider_config`).WithArgs("p1", pgxmock.AnyArg(), "admin").
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	if err := s.PutCacheProviderConfig(context.Background(), "p1", cacheconfig.ProviderConfig{}, "admin"); err != nil {
		t.Fatalf("PutCacheProviderConfig: %v", err)
	}
	m.ExpectExec(`INSERT INTO cache_provider_config`).WithArgs("p1", pgxmock.AnyArg(), "admin").WillReturnError(errors.New("boom"))
	if err := s.PutCacheProviderConfig(context.Background(), "p1", cacheconfig.ProviderConfig{}, "admin"); err == nil {
		t.Fatal("put exec error should surface")
	}
	m.ExpectExec(`DELETE FROM cache_provider_config WHERE provider_id = \$1`).WithArgs("p1").
		WillReturnResult(pgxmock.NewResult("DELETE", 1))
	if err := s.DeleteCacheProviderConfig(context.Background(), "p1"); err != nil {
		t.Fatalf("DeleteCacheProviderConfig: %v", err)
	}
	m.ExpectExec(`DELETE FROM cache_provider_config`).WithArgs("p1").WillReturnError(errors.New("boom"))
	if err := s.DeleteCacheProviderConfig(context.Background(), "p1"); err == nil {
		t.Fatal("delete exec error should surface")
	}
}

func TestListCacheProviderConfigs(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`SELECT provider_id, config FROM cache_provider_config`).
		WillReturnRows(pgxmock.NewRows([]string{"provider_id", "config"}).AddRow("p1", []byte(`{}`)))
	out, err := s.ListCacheProviderConfigs(context.Background())
	if err != nil || len(out) != 1 {
		t.Fatalf("ListCacheProviderConfigs: %v %v", out, err)
	}
	m.ExpectQuery(`cache_provider_config`).WillReturnError(errors.New("boom"))
	if _, err := s.ListCacheProviderConfigs(context.Background()); err == nil {
		t.Fatal("query error should surface")
	}
	s2, m2 := newMock(t)
	m2.ExpectQuery(`cache_provider_config`).WillReturnRows(pgxmock.NewRows([]string{"provider_id"}).AddRow("p1"))
	if _, err := s2.ListCacheProviderConfigs(context.Background()); err == nil {
		t.Fatal("scan error should surface")
	}
	s3, m3 := newMock(t)
	m3.ExpectQuery(`cache_provider_config`).WillReturnRows(pgxmock.NewRows([]string{"provider_id", "config"}).AddRow("p1", []byte(`{bad`)))
	if _, err := s3.ListCacheProviderConfigs(context.Background()); err == nil {
		t.Fatal("unmarshal error should surface")
	}
}

// TestAssembleCacheConfigBlob asserts the three tiers are read and combined, and
// that an error from any tier aborts the assembly.
func TestAssembleCacheConfigBlob(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`cache_global_config`).WillReturnRows(pgxmock.NewRows([]string{"config"}).AddRow([]byte(`{}`)))
	m.ExpectQuery(`SELECT adapter_type, config FROM cache_adapter_config`).
		WillReturnRows(pgxmock.NewRows([]string{"adapter_type", "config"}).AddRow("openai", []byte(`{}`)))
	m.ExpectQuery(`SELECT provider_id, config FROM cache_provider_config`).
		WillReturnRows(pgxmock.NewRows([]string{"provider_id", "config"}).AddRow("p1", []byte(`{}`)))
	blob, err := s.AssembleCacheConfigBlob(context.Background())
	if err != nil || len(blob.Adapters) != 1 || len(blob.Providers) != 1 {
		t.Fatalf("AssembleCacheConfigBlob: %+v %v", blob, err)
	}

	// global error aborts
	s2, m2 := newMock(t)
	m2.ExpectQuery(`cache_global_config`).WillReturnError(errors.New("g"))
	if _, err := s2.AssembleCacheConfigBlob(context.Background()); err == nil {
		t.Fatal("global error should abort")
	}
	// adapter error aborts
	s3, m3 := newMock(t)
	m3.ExpectQuery(`cache_global_config`).WillReturnRows(pgxmock.NewRows([]string{"config"}).AddRow([]byte(`{}`)))
	m3.ExpectQuery(`cache_adapter_config`).WillReturnError(errors.New("a"))
	if _, err := s3.AssembleCacheConfigBlob(context.Background()); err == nil {
		t.Fatal("adapter error should abort")
	}
	// provider error aborts
	s4, m4 := newMock(t)
	m4.ExpectQuery(`cache_global_config`).WillReturnRows(pgxmock.NewRows([]string{"config"}).AddRow([]byte(`{}`)))
	m4.ExpectQuery(`cache_adapter_config`).WillReturnRows(pgxmock.NewRows([]string{"adapter_type", "config"}))
	m4.ExpectQuery(`cache_provider_config`).WillReturnError(errors.New("p"))
	if _, err := s4.AssembleCacheConfigBlob(context.Background()); err == nil {
		t.Fatal("provider error should abort")
	}
}

func TestGetProviderAdapterType(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`SELECT adapter_type FROM "Provider" WHERE id = \$1`).WithArgs("p1").
		WillReturnRows(pgxmock.NewRows([]string{"adapter_type"}).AddRow("openai"))
	at, ok, err := s.GetProviderAdapterType(context.Background(), "p1")
	if err != nil || !ok || at != "openai" {
		t.Fatalf("GetProviderAdapterType: %q %v %v", at, ok, err)
	}
	m.ExpectQuery(`adapter_type FROM "Provider"`).WithArgs("missing").WillReturnError(pgx.ErrNoRows)
	if _, ok, err := s.GetProviderAdapterType(context.Background(), "missing"); err != nil || ok {
		t.Fatalf("missing → (\"\",false,nil), got ok=%v err=%v", ok, err)
	}
	m.ExpectQuery(`adapter_type FROM "Provider"`).WithArgs("e").WillReturnError(errors.New("db"))
	if _, _, err := s.GetProviderAdapterType(context.Background(), "e"); err == nil {
		t.Fatal("query error should surface")
	}
}

func TestGetProviderName(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`SELECT name FROM "Provider" WHERE id = \$1`).WithArgs("p1").
		WillReturnRows(pgxmock.NewRows([]string{"name"}).AddRow("OpenAI"))
	name, err := s.GetProviderName(context.Background(), "p1")
	if err != nil || name != "OpenAI" {
		t.Fatalf("GetProviderName: %q %v", name, err)
	}
	m.ExpectQuery(`name FROM "Provider"`).WithArgs("missing").WillReturnError(pgx.ErrNoRows)
	if name, err := s.GetProviderName(context.Background(), "missing"); err != nil || name != "" {
		t.Fatalf("missing → (\"\",nil), got %q %v", name, err)
	}
	m.ExpectQuery(`name FROM "Provider"`).WithArgs("e").WillReturnError(errors.New("db"))
	if _, err := s.GetProviderName(context.Background(), "e"); err == nil {
		t.Fatal("query error should surface")
	}
}
