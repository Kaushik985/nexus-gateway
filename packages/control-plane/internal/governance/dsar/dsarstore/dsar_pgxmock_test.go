package dsarstore

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
)

func anyArgs(n int) []any {
	a := make([]any, n)
	for i := range a {
		a[i] = pgxmock.AnyArg()
	}
	return a
}

var tNow = time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)

func sp(s string) *string   { return &s }
func ip(i int) *int         { return &i }
func fp(f float64) *float64 { return &f }

var dsarCols = []string{"id", "subjectId", "contact", "type", "status", "notes", "completedAt", "outcome", "createdAt", "createdBy", "updatedAt", "updatedBy"}

func dsarRow(id string) []any {
	return []any{id, "subj1", sp("a@x.com"), "ACCESS", "PENDING", sp("n"), (*time.Time)(nil), json.RawMessage(`{}`), tNow, "admin", tNow, (*string)(nil)}
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

func TestListDSARRequests(t *testing.T) {
	s, m := newMock(t)
	// status filter present → 1 filter arg; limit defaults nothing (passed 10).
	m.ExpectQuery(`SELECT COUNT\(\*\) FROM dsar_request`).WithArgs("PENDING").
		WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(1))
	m.ExpectQuery(`FROM dsar_request`).WithArgs("PENDING", 10, 0).
		WillReturnRows(pgxmock.NewRows(dsarCols).AddRow(dsarRow("d1")...))
	reqs, total, err := s.ListDSARRequests(context.Background(), "PENDING", 10, 0)
	if err != nil || total != 1 || len(reqs) != 1 || reqs[0].ID != "d1" || reqs[0].Type != "ACCESS" {
		t.Fatalf("ListDSARRequests: %+v total=%d err=%v", reqs, total, err)
	}
	// limit<=0 defaults to 20 (no status filter → 0 filter args, then 20,0).
	s2, m2 := newMock(t)
	m2.ExpectQuery(`SELECT COUNT`).WithArgs().WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(0))
	m2.ExpectQuery(`FROM dsar_request`).WithArgs(20, 0).WillReturnRows(pgxmock.NewRows(dsarCols))
	if _, _, err := s2.ListDSARRequests(context.Background(), "", 0, 0); err != nil {
		t.Fatalf("limit default: %v", err)
	}
	if err := m2.ExpectationsWereMet(); err != nil {
		t.Fatalf("limit default 20 not applied: %v", err)
	}
}

func TestListDSARRequests_Errors(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`SELECT COUNT`).WithArgs().WillReturnError(errors.New("boom"))
	if _, _, err := s.ListDSARRequests(context.Background(), "", 10, 0); err == nil {
		t.Fatal("count error should surface")
	}
	s2, m2 := newMock(t)
	m2.ExpectQuery(`SELECT COUNT`).WithArgs().WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(1))
	m2.ExpectQuery(`FROM dsar_request`).WithArgs(anyArgs(2)...).WillReturnError(errors.New("q"))
	if _, _, err := s2.ListDSARRequests(context.Background(), "", 10, 0); err == nil {
		t.Fatal("data query error should surface")
	}
	s3, m3 := newMock(t)
	bad := dsarRow("d1")
	bad[8] = "not-a-time"
	m3.ExpectQuery(`SELECT COUNT`).WithArgs().WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(1))
	m3.ExpectQuery(`FROM dsar_request`).WithArgs(anyArgs(2)...).WillReturnRows(pgxmock.NewRows(dsarCols).AddRow(bad...))
	if _, _, err := s3.ListDSARRequests(context.Background(), "", 10, 0); err == nil {
		t.Fatal("scan error should surface")
	}
}

func TestGetCreateUpdateDSARRequest(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`FROM dsar_request WHERE id = \$1`).WithArgs("d1").
		WillReturnRows(pgxmock.NewRows(dsarCols).AddRow(dsarRow("d1")...))
	if d, err := s.GetDSARRequest(context.Background(), "d1"); err != nil || d == nil || d.ID != "d1" {
		t.Fatalf("GetDSARRequest: %+v %v", d, err)
	}
	m.ExpectQuery(`FROM dsar_request WHERE id`).WithArgs("missing").WillReturnError(pgx.ErrNoRows)
	if d, err := s.GetDSARRequest(context.Background(), "missing"); err != nil || d != nil {
		t.Fatalf("missing → (nil,nil), got %+v %v", d, err)
	}
	m.ExpectQuery(`INSERT INTO dsar_request`).WithArgs("subj1", sp("a@x.com"), "ACCESS", sp("n"), "admin").
		WillReturnRows(pgxmock.NewRows(dsarCols).AddRow(dsarRow("d1")...))
	if d, err := s.CreateDSARRequest(context.Background(), CreateDSARRequestParams{SubjectID: "subj1", Contact: sp("a@x.com"), Type: "ACCESS", Notes: sp("n"), CreatedBy: "admin"}); err != nil || d == nil {
		t.Fatalf("CreateDSARRequest: %+v %v", d, err)
	}
	m.ExpectQuery(`INSERT INTO dsar_request`).WithArgs(anyArgs(5)...).WillReturnError(errors.New("boom"))
	if _, err := s.CreateDSARRequest(context.Background(), CreateDSARRequestParams{}); err == nil {
		t.Fatal("create error should surface")
	}
	m.ExpectQuery(`UPDATE dsar_request SET`).WithArgs(anyArgs(6)...).
		WillReturnRows(pgxmock.NewRows(dsarCols).AddRow(dsarRow("d1")...))
	if _, err := s.UpdateDSARRequest(context.Background(), "d1", UpdateDSARParams{Status: sp("COMPLETED")}); err != nil {
		t.Fatalf("UpdateDSARRequest: %v", err)
	}
	m.ExpectQuery(`UPDATE dsar_request`).WithArgs(anyArgs(6)...).WillReturnError(errors.New("boom"))
	if _, err := s.UpdateDSARRequest(context.Background(), "d1", UpdateDSARParams{}); err == nil {
		t.Fatal("update error should surface")
	}
}

func TestFulfillDSARAccess(t *testing.T) {
	s, m := newMock(t)
	vkCols := []string{"id", "timestamp", "provider", "method", "path", "statusCode", "model", "cost", "pt", "ct"}
	agentCols := []string{"id", "timestamp", "thingId", "sourceProcess", "targetHost", "action", "hookDecision", "latencyMs"}
	devCols := []string{"deviceId", "hostname", "assignedAt", "releasedAt"}
	m.ExpectQuery(`source = 'ai-gateway' AND entity_id = \$1`).WithArgs("subj1", 10000).
		WillReturnRows(pgxmock.NewRows(vkCols).AddRow("e1", tNow, "openai", sp("POST"), sp("/v1"), ip(200), sp("gpt-4o"), fp(0.01), ip(10), ip(20)))
	m.ExpectQuery(`JOIN "DeviceAssignment" da ON da."deviceId" = t.thing_id`).WithArgs("subj1", 10000).
		WillReturnRows(pgxmock.NewRows(agentCols).AddRow("a1", tNow, sp("dev1"), "curl", "api.x", sp("allow"), sp("pass"), ip(50)))
	m.ExpectQuery(`FROM "DeviceAssignment" da\s+JOIN thing t`).WithArgs("subj1").
		WillReturnRows(pgxmock.NewRows(devCols).AddRow("dev1", "host1", tNow, (*time.Time)(nil)))
	exp, err := s.FulfillDSARAccess(context.Background(), "subj1")
	if err != nil || len(exp.VKRows) != 1 || len(exp.AgentRows) != 1 || len(exp.Devices) != 1 {
		t.Fatalf("FulfillDSARAccess: %+v %v", exp, err)
	}
}

func TestFulfillDSARAccess_QueryErrors(t *testing.T) {
	// vk query error
	s, m := newMock(t)
	m.ExpectQuery(`source = 'ai-gateway'`).WithArgs(anyArgs(2)...).WillReturnError(errors.New("vk"))
	if _, err := s.FulfillDSARAccess(context.Background(), "subj1"); err == nil {
		t.Fatal("vk query error should surface")
	}
	// agent query error (vk ok)
	s2, m2 := newMock(t)
	m2.ExpectQuery(`source = 'ai-gateway'`).WithArgs(anyArgs(2)...).WillReturnRows(pgxmock.NewRows([]string{"id", "timestamp", "provider", "method", "path", "statusCode", "model", "cost", "pt", "ct"}))
	m2.ExpectQuery(`JOIN "DeviceAssignment"`).WithArgs(anyArgs(2)...).WillReturnError(errors.New("agent"))
	if _, err := s2.FulfillDSARAccess(context.Background(), "subj1"); err == nil {
		t.Fatal("agent query error should surface")
	}
	// device query error (vk + agent ok)
	s3, m3 := newMock(t)
	m3.ExpectQuery(`source = 'ai-gateway'`).WithArgs(anyArgs(2)...).WillReturnRows(pgxmock.NewRows([]string{"id", "timestamp", "provider", "method", "path", "statusCode", "model", "cost", "pt", "ct"}))
	m3.ExpectQuery(`JOIN "DeviceAssignment" da ON`).WithArgs(anyArgs(2)...).WillReturnRows(pgxmock.NewRows([]string{"id", "timestamp", "thingId", "sourceProcess", "targetHost", "action", "hookDecision", "latencyMs"}))
	m3.ExpectQuery(`FROM "DeviceAssignment" da\s+JOIN thing t`).WithArgs("subj1").WillReturnError(errors.New("dev"))
	if _, err := s3.FulfillDSARAccess(context.Background(), "subj1"); err == nil {
		t.Fatal("device query error should surface")
	}
}

func TestFulfillDSARErasure(t *testing.T) {
	s, m := newMock(t)
	m.ExpectBegin()
	m.ExpectExec(`UPDATE traffic_event\s+SET entity_id = NULL`).WithArgs("subj1").WillReturnResult(pgxmock.NewResult("UPDATE", 3))
	m.ExpectExec(`UPDATE traffic_event t\s+SET source_ip = NULL`).WithArgs("subj1").WillReturnResult(pgxmock.NewResult("UPDATE", 2))
	m.ExpectCommit()
	res, err := s.FulfillDSARErasure(context.Background(), "subj1")
	if err != nil || res.VKAnonymised != 3 || res.AgentAnonymised != 2 || res.TotalAnonymised != 5 {
		t.Fatalf("FulfillDSARErasure: %+v %v", res, err)
	}
	// error arms
	for _, tc := range []struct {
		name  string
		setup func(m pgxmock.PgxPoolIface)
	}{
		{"begin", func(m pgxmock.PgxPoolIface) { m.ExpectBegin().WillReturnError(errors.New("x")) }},
		{"vk exec", func(m pgxmock.PgxPoolIface) {
			m.ExpectBegin()
			m.ExpectExec(`entity_id = NULL`).WithArgs("subj1").WillReturnError(errors.New("x"))
			m.ExpectRollback()
		}},
		{"agent exec", func(m pgxmock.PgxPoolIface) {
			m.ExpectBegin()
			m.ExpectExec(`entity_id = NULL`).WithArgs("subj1").WillReturnResult(pgxmock.NewResult("UPDATE", 1))
			m.ExpectExec(`source_ip = NULL`).WithArgs("subj1").WillReturnError(errors.New("x"))
			m.ExpectRollback()
		}},
		{"commit", func(m pgxmock.PgxPoolIface) {
			m.ExpectBegin()
			m.ExpectExec(`entity_id = NULL`).WithArgs("subj1").WillReturnResult(pgxmock.NewResult("UPDATE", 1))
			m.ExpectExec(`source_ip = NULL`).WithArgs("subj1").WillReturnResult(pgxmock.NewResult("UPDATE", 1))
			m.ExpectCommit().WillReturnError(errors.New("x"))
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, m := newMock(t)
			tc.setup(m)
			if _, err := s.FulfillDSARErasure(context.Background(), "subj1"); err == nil {
				t.Fatalf("%s error should surface", tc.name)
			}
		})
	}
}

func TestDSARStatusCountsAndPeriod(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`FROM dsar_request`).
		WillReturnRows(pgxmock.NewRows([]string{"pending", "inProgress", "completed", "rejected"}).AddRow(2, 1, 5, 1))
	c, err := s.GetDSARStatusCounts(context.Background())
	if err != nil || c.Pending != 2 || c.Completed != 5 {
		t.Fatalf("GetDSARStatusCounts: %+v %v", c, err)
	}
	m.ExpectQuery(`FROM dsar_request`).WillReturnError(errors.New("boom"))
	if _, err := s.GetDSARStatusCounts(context.Background()); err == nil {
		t.Fatal("status counts error should surface")
	}
	m.ExpectQuery(`status = 'COMPLETED' AND completed_at`).WithArgs(tNow, tNow).
		WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(7))
	if n, err := s.GetDSARCompletedInPeriod(context.Background(), tNow, tNow); err != nil || n != 7 {
		t.Fatalf("GetDSARCompletedInPeriod: %d %v", n, err)
	}
	m.ExpectQuery(`completed_at`).WithArgs(tNow, tNow).WillReturnError(errors.New("boom"))
	if _, err := s.GetDSARCompletedInPeriod(context.Background(), tNow, tNow); err == nil {
		t.Fatal("period count error should surface")
	}
}
