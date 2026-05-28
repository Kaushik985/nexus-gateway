package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
)

var tNow = time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)

func anyArgs(n int) []any {
	a := make([]any, n)
	for i := range a {
		a[i] = pgxmock.AnyArg()
	}
	return a
}

func newMock(t *testing.T) (*Store, pgxmock.PgxPoolIface) {
	t.Helper()
	m, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock: %v", err)
	}
	t.Cleanup(m.Close)
	return New(m), m
}

func TestFindPendingIdentityEvents(t *testing.T) {
	cols := []string{"id", "trace_id", "source_ip", "entity_id", "identity", "created_at"}

	// Happy: one row with identity JSON + one row with empty identity (decodeJSONB len-0 branch).
	s, m := newMock(t)
	m.ExpectQuery(`FROM traffic_event\s+WHERE identity->>'status' = 'pending'`).WithArgs(anyArgs(2)...).
		WillReturnRows(pgxmock.NewRows(cols).
			AddRow("e1", "tr1", "1.2.3.4", "ent1", []byte(`{"status":"pending"}`), tNow).
			AddRow("e2", "tr2", "5.6.7.8", "ent2", []byte(``), tNow))
	evs, err := s.FindPendingIdentityEvents(context.Background(), time.Hour, 100)
	if err != nil || len(evs) != 2 || evs[0].ID != "e1" || evs[0].Identity["status"] != "pending" || evs[1].Identity != nil {
		t.Fatalf("FindPendingIdentityEvents: %+v err=%v", evs, err)
	}

	// Query error.
	s2, m2 := newMock(t)
	m2.ExpectQuery(`FROM traffic_event`).WillReturnError(errors.New("boom"))
	if _, err := s2.FindPendingIdentityEvents(context.Background(), time.Hour, 100); err == nil {
		t.Fatal("query error must surface")
	}

	// Scan error (bad created_at).
	s3, m3 := newMock(t)
	m3.ExpectQuery(`FROM traffic_event`).WithArgs(anyArgs(2)...).
		WillReturnRows(pgxmock.NewRows(cols).AddRow("e1", "tr1", "1.2.3.4", "ent1", []byte(`{}`), "not-a-time"))
	if _, err := s3.FindPendingIdentityEvents(context.Background(), time.Hour, 100); err == nil {
		t.Fatal("scan error must surface")
	}

	// decodeJSONB error (malformed identity JSON).
	s4, m4 := newMock(t)
	m4.ExpectQuery(`FROM traffic_event`).WithArgs(anyArgs(2)...).
		WillReturnRows(pgxmock.NewRows(cols).AddRow("e1", "tr1", "1.2.3.4", "ent1", []byte(`{bad`), tNow))
	if _, err := s4.FindPendingIdentityEvents(context.Background(), time.Hour, 100); err == nil {
		t.Fatal("decodeJSONB error must surface")
	}
}

func TestFindMatchedEventByTraceID(t *testing.T) {
	cols := []string{"entity_id", "entity_name", "identity"}

	// Empty traceID → ErrNotFound (no query).
	s, m := newMock(t)
	if _, err := s.FindMatchedEventByTraceID(context.Background(), ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("empty traceID should be ErrNotFound: %v", err)
	}

	// Happy.
	m.ExpectQuery(`FROM traffic_event\s+WHERE trace_id = \$1`).WithArgs("tr1").
		WillReturnRows(pgxmock.NewRows(cols).AddRow("ent1", "Alice", []byte(`{"status":"matched"}`)))
	got, err := s.FindMatchedEventByTraceID(context.Background(), "tr1")
	if err != nil || got.EntityID != "ent1" || got.EntityName != "Alice" || got.Identity["status"] != "matched" {
		t.Fatalf("FindMatchedEventByTraceID: %+v %v", got, err)
	}

	// ErrNoRows → ErrNotFound.
	m.ExpectQuery(`FROM traffic_event`).WithArgs("gone").WillReturnError(pgx.ErrNoRows)
	if _, err := s.FindMatchedEventByTraceID(context.Background(), "gone"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("no rows should be ErrNotFound: %v", err)
	}

	// Other DB error.
	m.ExpectQuery(`FROM traffic_event`).WithArgs("x").WillReturnError(errors.New("boom"))
	if _, err := s.FindMatchedEventByTraceID(context.Background(), "x"); err == nil || errors.Is(err, ErrNotFound) {
		t.Fatalf("db error must surface (not ErrNotFound): %v", err)
	}

	// decodeJSONB error.
	s2, m2 := newMock(t)
	m2.ExpectQuery(`FROM traffic_event`).WithArgs("tr2").
		WillReturnRows(pgxmock.NewRows(cols).AddRow("ent2", "Bob", []byte(`{bad`)))
	if _, err := s2.FindMatchedEventByTraceID(context.Background(), "tr2"); err == nil {
		t.Fatal("decodeJSONB error must surface")
	}
}

func TestFindAgentByIP(t *testing.T) {
	cols := []string{"id", "metadata"}

	s, m := newMock(t)
	// Empty IP → ErrNotFound.
	if _, err := s.FindAgentByIP(context.Background(), ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("empty IP should be ErrNotFound: %v", err)
	}

	// Happy.
	m.ExpectQuery(`FROM thing\s+WHERE type = 'agent'`).WithArgs("1.2.3.4").
		WillReturnRows(pgxmock.NewRows(cols).AddRow("agent1", []byte(`{"hostname":"mac1"}`)))
	got, err := s.FindAgentByIP(context.Background(), "1.2.3.4")
	if err != nil || got.ID != "agent1" || got.Metadata["hostname"] != "mac1" {
		t.Fatalf("FindAgentByIP: %+v %v", got, err)
	}

	// ErrNoRows → ErrNotFound.
	m.ExpectQuery(`FROM thing`).WithArgs("9.9.9.9").WillReturnError(pgx.ErrNoRows)
	if _, err := s.FindAgentByIP(context.Background(), "9.9.9.9"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("no rows should be ErrNotFound: %v", err)
	}

	// Other error.
	m.ExpectQuery(`FROM thing`).WithArgs("8.8.8.8").WillReturnError(errors.New("boom"))
	if _, err := s.FindAgentByIP(context.Background(), "8.8.8.8"); err == nil || errors.Is(err, ErrNotFound) {
		t.Fatalf("db error must surface: %v", err)
	}

	// decodeJSONB error.
	s2, m2 := newMock(t)
	m2.ExpectQuery(`FROM thing`).WithArgs("1.1.1.1").
		WillReturnRows(pgxmock.NewRows(cols).AddRow("agent2", []byte(`{bad`)))
	if _, err := s2.FindAgentByIP(context.Background(), "1.1.1.1"); err == nil {
		t.Fatal("decodeJSONB error must surface")
	}
}

func TestFindActiveAssignmentByIPAndTime(t *testing.T) {
	cols := []string{"user_id", "device_id", "displayName", "email"}

	s, m := newMock(t)
	// Empty IP → ErrNotFound.
	if _, err := s.FindActiveAssignmentByIPAndTime(context.Background(), "", tNow); !errors.Is(err, ErrNotFound) {
		t.Fatalf("empty IP should be ErrNotFound: %v", err)
	}

	// Exactly one → match.
	m.ExpectQuery(`FROM "DeviceAssignment" da`).WithArgs("1.2.3.4", tNow).
		WillReturnRows(pgxmock.NewRows(cols).AddRow("u1", "d1", "Alice", "a@x.com"))
	got, err := s.FindActiveAssignmentByIPAndTime(context.Background(), "1.2.3.4", tNow)
	if err != nil || got.UserID != "u1" || got.Email != "a@x.com" {
		t.Fatalf("single match: %+v %v", got, err)
	}

	// Zero rows → ErrNotFound.
	m.ExpectQuery(`FROM "DeviceAssignment"`).WithArgs("5.5.5.5", tNow).WillReturnRows(pgxmock.NewRows(cols))
	if _, err := s.FindActiveAssignmentByIPAndTime(context.Background(), "5.5.5.5", tNow); !errors.Is(err, ErrNotFound) {
		t.Fatalf("zero rows should be ErrNotFound: %v", err)
	}

	// Two rows (shared NAT egress) → ErrAmbiguous.
	m.ExpectQuery(`FROM "DeviceAssignment"`).WithArgs("6.6.6.6", tNow).
		WillReturnRows(pgxmock.NewRows(cols).AddRow("u1", "d1", "Alice", "a@x.com").AddRow("u2", "d2", "Bob", "b@x.com"))
	if _, err := s.FindActiveAssignmentByIPAndTime(context.Background(), "6.6.6.6", tNow); !errors.Is(err, ErrAmbiguous) {
		t.Fatalf("two rows should be ErrAmbiguous: %v", err)
	}

	// Query error.
	s2, m2 := newMock(t)
	m2.ExpectQuery(`FROM "DeviceAssignment"`).WillReturnError(errors.New("boom"))
	if _, err := s2.FindActiveAssignmentByIPAndTime(context.Background(), "1.2.3.4", tNow); err == nil {
		t.Fatal("query error must surface")
	}

	// Scan error (row yields fewer columns than the 4 Scan destinations).
	s3, m3 := newMock(t)
	m3.ExpectQuery(`FROM "DeviceAssignment"`).WithArgs("1.2.3.4", tNow).
		WillReturnRows(pgxmock.NewRows([]string{"user_id", "device_id", "displayName"}).AddRow("u1", "d1", "Alice"))
	if _, err := s3.FindActiveAssignmentByIPAndTime(context.Background(), "1.2.3.4", tNow); err == nil {
		t.Fatal("scan error must surface")
	}

	// Mid-stream iteration error (connection drop after a row yielded).
	s4, m4 := newMock(t)
	m4.ExpectQuery(`FROM "DeviceAssignment"`).WithArgs("1.2.3.4", tNow).
		WillReturnRows(pgxmock.NewRows(cols).AddRow("u1", "d1", "Alice", "a@x.com").CloseError(errors.New("conn reset")))
	if _, err := s4.FindActiveAssignmentByIPAndTime(context.Background(), "1.2.3.4", tNow); err == nil {
		t.Fatal("iterate error must surface")
	}
}

func TestUpdateEventIdentity(t *testing.T) {
	s, m := newMock(t)
	m.ExpectExec(`UPDATE traffic_event\s+SET entity_id`).
		WithArgs("e1", "ent1", "Alice", pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	err := s.UpdateEventIdentity(context.Background(), UpdateEventIdentityParams{
		EventID: "e1", EntityID: "ent1", EntityName: "Alice", Identity: map[string]any{"status": "matched"},
	})
	if err != nil {
		t.Fatalf("UpdateEventIdentity: %v", err)
	}

	// Exec error.
	m.ExpectExec(`UPDATE traffic_event`).WithArgs("e1", "ent1", "Alice", pgxmock.AnyArg()).WillReturnError(errors.New("boom"))
	if err := s.UpdateEventIdentity(context.Background(), UpdateEventIdentityParams{
		EventID: "e1", EntityID: "ent1", EntityName: "Alice", Identity: map[string]any{"status": "matched"},
	}); err == nil {
		t.Fatal("exec error must surface")
	}

	// Marshal error: a channel value is not JSON-serialisable → marshal identity fails
	// before any DB call.
	s2, _ := newMock(t)
	if err := s2.UpdateEventIdentity(context.Background(), UpdateEventIdentityParams{
		EventID: "e1", Identity: map[string]any{"bad": make(chan int)},
	}); err == nil {
		t.Fatal("marshal error must surface")
	}
}
