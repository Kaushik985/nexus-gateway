package systemmetastore

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
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

func TestGetSystemMetadata(t *testing.T) {
	s, m := newMock(t)
	// Happy: returns the stored JSON value.
	m.ExpectQuery(`SELECT value FROM system_metadata WHERE key = \$1`).WithArgs("k1").
		WillReturnRows(pgxmock.NewRows([]string{"value"}).AddRow([]byte(`{"a":1}`)))
	val, err := s.GetSystemMetadata(context.Background(), "k1")
	if err != nil || string(val) != `{"a":1}` {
		t.Fatalf("GetSystemMetadata: %s %v", val, err)
	}

	// Missing key → (nil, nil).
	m.ExpectQuery(`SELECT value FROM system_metadata`).WithArgs("gone").WillReturnError(pgx.ErrNoRows)
	if val, err := s.GetSystemMetadata(context.Background(), "gone"); err != nil || val != nil {
		t.Fatalf("missing key should be (nil,nil): %s %v", val, err)
	}

	// DB error surfaces.
	m.ExpectQuery(`SELECT value FROM system_metadata`).WithArgs("x").WillReturnError(errors.New("boom"))
	if _, err := s.GetSystemMetadata(context.Background(), "x"); err == nil {
		t.Fatal("db error must surface")
	}
}

func TestSetSystemMetadata(t *testing.T) {
	s, m := newMock(t)
	// Happy upsert.
	m.ExpectExec(`INSERT INTO system_metadata`).WithArgs("k1", pgxmock.AnyArg(), "admin").
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	if err := s.SetSystemMetadata(context.Background(), "k1", map[string]int{"a": 1}, "admin"); err != nil {
		t.Fatalf("SetSystemMetadata: %v", err)
	}

	// Exec error.
	m.ExpectExec(`INSERT INTO system_metadata`).WithArgs("k1", pgxmock.AnyArg(), "admin").WillReturnError(errors.New("boom"))
	if err := s.SetSystemMetadata(context.Background(), "k1", 42, "admin"); err == nil {
		t.Fatal("exec error must surface")
	}

	// Marshal error: a channel is not JSON-serialisable → fails before any DB call.
	s2, _ := newMock(t)
	if err := s2.SetSystemMetadata(context.Background(), "k1", make(chan int), "admin"); err == nil {
		t.Fatal("marshal error must surface")
	}
}
