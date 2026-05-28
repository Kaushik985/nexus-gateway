package diagstore

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
)

var tNow = time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)

func sp(s string) *string { return &s }

func newMock(t *testing.T) (*Store, pgxmock.PgxPoolIface) {
	t.Helper()
	m, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock: %v", err)
	}
	t.Cleanup(m.Close)
	return New(m), m
}

var silenceCols = []string{"id", "message_hash", "level", "silenced_by", "silenced_at", "expires_at", "reason"}

func TestCreateDiagSilence(t *testing.T) {
	s, m := newMock(t)

	// Validation guards (no DB call).
	if _, err := s.CreateDiagSilence(context.Background(), CreateDiagSilenceParams{Level: "error", SilencedBy: "a"}); err == nil {
		t.Fatal("missing messageHash must error")
	}
	if _, err := s.CreateDiagSilence(context.Background(), CreateDiagSilenceParams{MessageHash: "h", SilencedBy: "a"}); err == nil {
		t.Fatal("missing level must error")
	}
	if _, err := s.CreateDiagSilence(context.Background(), CreateDiagSilenceParams{MessageHash: "h", Level: "error"}); err == nil {
		t.Fatal("missing silencedBy must error")
	}

	// Happy with reason.
	m.ExpectQuery(`INSERT INTO diag_silence`).WithArgs(pgxmock.AnyArg(), "h", "error", "alice", &tNow, "noisy").
		WillReturnRows(pgxmock.NewRows(silenceCols).AddRow("id1", "h", "error", "alice", tNow, &tNow, sp("noisy")))
	got, err := s.CreateDiagSilence(context.Background(), CreateDiagSilenceParams{MessageHash: "h", Level: "error", SilencedBy: "alice", ExpiresAt: &tNow, Reason: "noisy"})
	if err != nil || got.ID != "id1" || got.Reason != "noisy" {
		t.Fatalf("CreateDiagSilence: %+v %v", got, err)
	}

	// Happy with NULL reason → Reason stays empty.
	m.ExpectQuery(`INSERT INTO diag_silence`).WithArgs(pgxmock.AnyArg(), "h", "warn", "bob", pgxmock.AnyArg(), "").
		WillReturnRows(pgxmock.NewRows(silenceCols).AddRow("id2", "h", "warn", "bob", tNow, nil, nil))
	got, err = s.CreateDiagSilence(context.Background(), CreateDiagSilenceParams{MessageHash: "h", Level: "warn", SilencedBy: "bob"})
	if err != nil || got.Reason != "" || got.ExpiresAt != nil {
		t.Fatalf("CreateDiagSilence null reason: %+v %v", got, err)
	}

	// Insert error.
	m.ExpectQuery(`INSERT INTO diag_silence`).WillReturnError(errors.New("boom"))
	if _, err := s.CreateDiagSilence(context.Background(), CreateDiagSilenceParams{MessageHash: "h", Level: "error", SilencedBy: "a"}); err == nil {
		t.Fatal("insert error must surface")
	}
}

func TestDeleteDiagSilence(t *testing.T) {
	s, m := newMock(t)
	// Empty id guard.
	if err := s.DeleteDiagSilence(context.Background(), ""); err == nil {
		t.Fatal("empty id must error")
	}
	// Happy.
	m.ExpectExec(`DELETE FROM diag_silence`).WithArgs("id1").WillReturnResult(pgxmock.NewResult("DELETE", 1))
	if err := s.DeleteDiagSilence(context.Background(), "id1"); err != nil {
		t.Fatalf("DeleteDiagSilence: %v", err)
	}
	// 0 rows → ErrSilenceNotFound.
	m.ExpectExec(`DELETE FROM diag_silence`).WithArgs("gone").WillReturnResult(pgxmock.NewResult("DELETE", 0))
	if err := s.DeleteDiagSilence(context.Background(), "gone"); !errors.Is(err, ErrSilenceNotFound) {
		t.Fatalf("0 rows should be ErrSilenceNotFound: %v", err)
	}
	// Exec error.
	m.ExpectExec(`DELETE FROM diag_silence`).WithArgs("x").WillReturnError(errors.New("boom"))
	if err := s.DeleteDiagSilence(context.Background(), "x"); err == nil {
		t.Fatal("exec error must surface")
	}
}

func TestListActiveDiagSilences(t *testing.T) {
	s, m := newMock(t)
	// Happy: one row with reason, one without.
	m.ExpectQuery(`FROM diag_silence\s+WHERE expires_at IS NULL`).
		WillReturnRows(pgxmock.NewRows(silenceCols).
			AddRow("id1", "h1", "error", "alice", tNow, &tNow, sp("noisy")).
			AddRow("id2", "h2", "warn", "bob", tNow, nil, nil))
	out, err := s.ListActiveDiagSilences(context.Background())
	if err != nil || len(out) != 2 || out[0].Reason != "noisy" || out[1].Reason != "" {
		t.Fatalf("ListActiveDiagSilences: %+v %v", out, err)
	}
	// Query error.
	m.ExpectQuery(`FROM diag_silence`).WillReturnError(errors.New("boom"))
	if _, err := s.ListActiveDiagSilences(context.Background()); err == nil {
		t.Fatal("query error must surface")
	}
	// Scan error (bad silenced_at).
	s2, m2 := newMock(t)
	m2.ExpectQuery(`FROM diag_silence`).
		WillReturnRows(pgxmock.NewRows(silenceCols).AddRow("id1", "h", "error", "a", "not-a-time", nil, nil))
	if _, err := s2.ListActiveDiagSilences(context.Background()); err == nil {
		t.Fatal("scan error must surface")
	}
	// Mid-stream iteration error.
	s3, m3 := newMock(t)
	m3.ExpectQuery(`FROM diag_silence`).
		WillReturnRows(pgxmock.NewRows(silenceCols).AddRow("id1", "h", "error", "a", tNow, nil, nil).CloseError(errors.New("conn reset")))
	if _, err := s3.ListActiveDiagSilences(context.Background()); err == nil {
		t.Fatal("iterate error must surface")
	}
}

func TestGetDiagSilence(t *testing.T) {
	s, m := newMock(t)
	// Happy with reason.
	m.ExpectQuery(`FROM diag_silence WHERE id = \$1`).WithArgs("id1").
		WillReturnRows(pgxmock.NewRows(silenceCols).AddRow("id1", "h", "error", "alice", tNow, &tNow, sp("noisy")))
	got, err := s.GetDiagSilence(context.Background(), "id1")
	if err != nil || got.ID != "id1" || got.Reason != "noisy" {
		t.Fatalf("GetDiagSilence: %+v %v", got, err)
	}
	// Not found → ErrSilenceNotFound.
	m.ExpectQuery(`FROM diag_silence`).WithArgs("gone").WillReturnError(pgx.ErrNoRows)
	if _, err := s.GetDiagSilence(context.Background(), "gone"); !errors.Is(err, ErrSilenceNotFound) {
		t.Fatalf("missing should be ErrSilenceNotFound: %v", err)
	}
	// Other DB error.
	m.ExpectQuery(`FROM diag_silence`).WithArgs("x").WillReturnError(errors.New("boom"))
	if _, err := s.GetDiagSilence(context.Background(), "x"); err == nil || errors.Is(err, ErrSilenceNotFound) {
		t.Fatalf("db error must surface: %v", err)
	}
}
