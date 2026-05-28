package quotastore

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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
func fp(f float64) *float64 { return &f }
func i64p(i int64) *int64   { return &i }

var qpCols = []string{
	"id", "name", "description", "scope", "organizationId", "vkType",
	"periodType", "costLimitUsd", "tokenLimit", "enforcementMode",
	"alertThresholds", "priority", "enabled", "createdBy", "createdAt", "updatedAt",
}

func qpRow(id, name string) []any {
	return []any{
		id, name, sp("d"), "organization", sp("org1"), sp("application"),
		"monthly", fp(100.0), i64p(1_000_000), "hard",
		json.RawMessage(`[80,100]`), 10, true, sp("admin"), tNow, tNow,
	}
}

// quota override scanQuotaOverride order (11 cols, no targetName).
var qoCols = []string{"id", "targetType", "targetId", "reason", "costLimitUsd", "tokenLimit", "enforcementMode", "periodType", "createdBy", "createdAt", "updatedAt"}

// the List/Get JOIN projection adds targetName as the 4th column (12 cols).
var qoJoinCols = []string{"id", "targetType", "targetId", "targetName", "reason", "costLimitUsd", "tokenLimit", "enforcementMode", "periodType", "createdBy", "createdAt", "updatedAt"}

func qoRow(id string) []any {
	return []any{id, "organization", "org1", sp("vip"), fp(50.0), i64p(500_000), sp("soft"), sp("monthly"), sp("admin"), tNow, tNow}
}
func qoJoinRow(id, name string) []any {
	return []any{id, "organization", "org1", name, sp("vip"), fp(50.0), i64p(500_000), sp("soft"), sp("monthly"), sp("admin"), tNow, tNow}
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

func TestListQuotaPolicies(t *testing.T) {
	s, m := newMock(t)
	enabled := true
	p := QuotaPolicyListParams{Scope: "organization", VKType: "application", Enabled: &enabled, Q: "x", Limit: 10}
	m.ExpectQuery(`SELECT COUNT\(\*\) FROM "QuotaPolicy"`).WithArgs("organization", "application", true, "%x%").
		WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(1))
	m.ExpectQuery(`SELECT .* FROM "QuotaPolicy"`).WithArgs("organization", "application", true, "%x%", 10, 0).
		WillReturnRows(pgxmock.NewRows(qpCols).AddRow(qpRow("qp1", "k")...))
	pols, total, err := s.ListQuotaPolicies(context.Background(), p)
	if err != nil || total != 1 || len(pols) != 1 || pols[0].ID != "qp1" || pols[0].EnforcementMode != "hard" {
		t.Fatalf("ListQuotaPolicies: %+v total=%d err=%v", pols, total, err)
	}
}

func TestListQuotaPolicies_Errors(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`SELECT COUNT`).WillReturnError(errors.New("boom"))
	if _, _, err := s.ListQuotaPolicies(context.Background(), QuotaPolicyListParams{}); err == nil {
		t.Fatal("count error should surface")
	}
	s2, m2 := newMock(t)
	m2.ExpectQuery(`SELECT COUNT`).WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(1))
	m2.ExpectQuery(`FROM "QuotaPolicy"`).WithArgs(anyArgs(2)...).WillReturnError(errors.New("q"))
	if _, _, err := s2.ListQuotaPolicies(context.Background(), QuotaPolicyListParams{Limit: 5}); err == nil {
		t.Fatal("data query error should surface")
	}
	s3, m3 := newMock(t)
	bad := qpRow("qp1", "k")
	bad[12] = "not-a-bool"
	m3.ExpectQuery(`SELECT COUNT`).WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(1))
	m3.ExpectQuery(`FROM "QuotaPolicy"`).WithArgs(anyArgs(2)...).WillReturnRows(pgxmock.NewRows(qpCols).AddRow(bad...))
	if _, _, err := s3.ListQuotaPolicies(context.Background(), QuotaPolicyListParams{Limit: 5}); err == nil {
		t.Fatal("scan error should surface")
	}
}

func TestGetQuotaPolicy(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`FROM "QuotaPolicy" WHERE id = \$1`).WithArgs("qp1").
		WillReturnRows(pgxmock.NewRows(qpCols).AddRow(qpRow("qp1", "k")...))
	if pol, err := s.GetQuotaPolicy(context.Background(), "qp1"); err != nil || pol == nil || pol.ID != "qp1" {
		t.Fatalf("GetQuotaPolicy found: %+v %v", pol, err)
	}
	m.ExpectQuery(`FROM "QuotaPolicy" WHERE id`).WithArgs("missing").WillReturnError(pgx.ErrNoRows)
	if pol, err := s.GetQuotaPolicy(context.Background(), "missing"); err != nil || pol != nil {
		t.Fatalf("missing → (nil,nil), got %+v %v", pol, err)
	}
	m.ExpectQuery(`FROM "QuotaPolicy" WHERE id`).WithArgs("e").WillReturnError(errors.New("db"))
	if _, err := s.GetQuotaPolicy(context.Background(), "e"); err == nil {
		t.Fatal("db error should surface")
	}
}

func TestCreateUpdateDeleteQuotaPolicy(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`INSERT INTO "QuotaPolicy"`).WithArgs(anyArgs(13)...).
		WillReturnRows(pgxmock.NewRows(qpCols).AddRow(qpRow("qp1", "k")...))
	if pol, err := s.CreateQuotaPolicy(context.Background(), CreateQuotaPolicyParams{Name: "k", Scope: "organization", PeriodType: "monthly", EnforcementMode: "hard"}); err != nil || pol == nil {
		t.Fatalf("CreateQuotaPolicy: %+v %v", pol, err)
	}
	m.ExpectQuery(`INSERT INTO "QuotaPolicy"`).WithArgs(anyArgs(13)...).WillReturnError(errors.New("boom"))
	if _, err := s.CreateQuotaPolicy(context.Background(), CreateQuotaPolicyParams{}); err == nil {
		t.Fatal("create error should surface")
	}
	m.ExpectQuery(`UPDATE "QuotaPolicy" SET`).WithArgs(anyArgs(13)...).
		WillReturnRows(pgxmock.NewRows(qpCols).AddRow(qpRow("qp1", "k")...))
	if _, err := s.UpdateQuotaPolicy(context.Background(), "qp1", UpdateQuotaPolicyParams{Name: sp("New")}); err != nil {
		t.Fatalf("UpdateQuotaPolicy: %v", err)
	}
	m.ExpectQuery(`UPDATE "QuotaPolicy"`).WithArgs(anyArgs(13)...).WillReturnError(errors.New("boom"))
	if _, err := s.UpdateQuotaPolicy(context.Background(), "qp1", UpdateQuotaPolicyParams{}); err == nil {
		t.Fatal("update error should surface")
	}
	m.ExpectExec(`DELETE FROM "QuotaPolicy" WHERE id = \$1`).WithArgs("qp1").WillReturnResult(pgxmock.NewResult("DELETE", 1))
	if err := s.DeleteQuotaPolicy(context.Background(), "qp1"); err != nil {
		t.Fatalf("DeleteQuotaPolicy: %v", err)
	}
	m.ExpectExec(`DELETE FROM "QuotaPolicy"`).WithArgs("gone").WillReturnResult(pgxmock.NewResult("DELETE", 0))
	if err := s.DeleteQuotaPolicy(context.Background(), "gone"); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("missing → ErrNoRows, got %v", err)
	}
	m.ExpectExec(`DELETE FROM "QuotaPolicy"`).WithArgs("qp1").WillReturnError(errors.New("fk"))
	if err := s.DeleteQuotaPolicy(context.Background(), "qp1"); err == nil {
		t.Fatal("delete exec error should surface")
	}
}

func TestListQuotaOverrides(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`SELECT COUNT\(\*\) FROM "QuotaOverride" qo`).WithArgs("organization", "%x%").
		WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(1))
	m.ExpectQuery(`FROM "QuotaOverride" qo\s+LEFT JOIN`).WithArgs("organization", "%x%", 10, 0).
		WillReturnRows(pgxmock.NewRows(qoJoinCols).AddRow(qoJoinRow("qo1", "Acme Org")...))
	ovs, total, err := s.ListQuotaOverrides(context.Background(), QuotaOverrideListParams{TargetType: "organization", Q: "x", Limit: 10})
	if err != nil || total != 1 || len(ovs) != 1 || ovs[0].TargetName != "Acme Org" {
		t.Fatalf("ListQuotaOverrides: %+v total=%d err=%v", ovs, total, err)
	}
	m.ExpectQuery(`SELECT COUNT\(\*\) FROM "QuotaOverride"`).WillReturnError(errors.New("boom"))
	if _, _, err := s.ListQuotaOverrides(context.Background(), QuotaOverrideListParams{}); err == nil {
		t.Fatal("count error should surface")
	}
	s2, m2 := newMock(t)
	m2.ExpectQuery(`COUNT\(\*\) FROM "QuotaOverride"`).WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(1))
	m2.ExpectQuery(`FROM "QuotaOverride" qo`).WithArgs(anyArgs(2)...).WillReturnError(errors.New("q"))
	if _, _, err := s2.ListQuotaOverrides(context.Background(), QuotaOverrideListParams{Limit: 5}); err == nil {
		t.Fatal("data query error should surface")
	}
}

func TestGetQuotaOverride(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`FROM "QuotaOverride" qo\s+LEFT JOIN`).WithArgs("qo1").
		WillReturnRows(pgxmock.NewRows(qoJoinCols).AddRow(qoJoinRow("qo1", "Acme")...))
	if o, err := s.GetQuotaOverride(context.Background(), "qo1"); err != nil || o == nil || o.TargetName != "Acme" {
		t.Fatalf("GetQuotaOverride: %+v %v", o, err)
	}
	m.ExpectQuery(`FROM "QuotaOverride" qo`).WithArgs("missing").WillReturnError(pgx.ErrNoRows)
	if o, err := s.GetQuotaOverride(context.Background(), "missing"); err != nil || o != nil {
		t.Fatalf("missing → (nil,nil), got %+v %v", o, err)
	}
	m.ExpectQuery(`FROM "QuotaOverride" qo`).WithArgs("e").WillReturnError(errors.New("db"))
	if _, err := s.GetQuotaOverride(context.Background(), "e"); err == nil {
		t.Fatal("db error should surface")
	}
}

func TestGetQuotaOverrideByTarget(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`FROM "QuotaOverride" WHERE "targetType" = \$1 AND "targetId" = \$2`).WithArgs("organization", "org1").
		WillReturnRows(pgxmock.NewRows(qoCols).AddRow(qoRow("qo1")...))
	if o, err := s.GetQuotaOverrideByTarget(context.Background(), "organization", "org1"); err != nil || o == nil || o.ID != "qo1" {
		t.Fatalf("GetQuotaOverrideByTarget: %+v %v", o, err)
	}
	m.ExpectQuery(`FROM "QuotaOverride" WHERE "targetType"`).WithArgs("organization", "missing").WillReturnError(pgx.ErrNoRows)
	if o, err := s.GetQuotaOverrideByTarget(context.Background(), "organization", "missing"); err != nil || o != nil {
		t.Fatalf("missing → (nil,nil), got %+v %v", o, err)
	}
	m.ExpectQuery(`FROM "QuotaOverride" WHERE "targetType"`).WithArgs("organization", "e").WillReturnError(errors.New("db"))
	if _, err := s.GetQuotaOverrideByTarget(context.Background(), "organization", "e"); err == nil {
		t.Fatal("db error should surface")
	}
}

func TestCreateQuotaOverride(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`INSERT INTO "QuotaOverride"`).WithArgs(anyArgs(8)...).
		WillReturnRows(pgxmock.NewRows(qoCols).AddRow(qoRow("qo1")...))
	if o, err := s.CreateQuotaOverride(context.Background(), CreateQuotaOverrideParams{TargetType: "organization", TargetID: "org1"}); err != nil || o == nil {
		t.Fatalf("CreateQuotaOverride: %+v %v", o, err)
	}
	// Unique violation (23505) → ErrQuotaOverrideConflict (a named business failure).
	m.ExpectQuery(`INSERT INTO "QuotaOverride"`).WithArgs(anyArgs(8)...).WillReturnError(&pgconn.PgError{Code: "23505"})
	if _, err := s.CreateQuotaOverride(context.Background(), CreateQuotaOverrideParams{}); !errors.Is(err, ErrQuotaOverrideConflict) {
		t.Fatalf("23505 → ErrQuotaOverrideConflict, got %v", err)
	}
	// Other error → wrapped generic.
	m.ExpectQuery(`INSERT INTO "QuotaOverride"`).WithArgs(anyArgs(8)...).WillReturnError(errors.New("boom"))
	if _, err := s.CreateQuotaOverride(context.Background(), CreateQuotaOverrideParams{}); err == nil || errors.Is(err, ErrQuotaOverrideConflict) {
		t.Fatalf("non-23505 error should be generic, got %v", err)
	}
}

func TestUpdateDeleteQuotaOverride(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`UPDATE "QuotaOverride" SET`).WithArgs(anyArgs(6)...).
		WillReturnRows(pgxmock.NewRows(qoCols).AddRow(qoRow("qo1")...))
	if _, err := s.UpdateQuotaOverride(context.Background(), "qo1", UpdateQuotaOverrideParams{Reason: sp("r")}); err != nil {
		t.Fatalf("UpdateQuotaOverride: %v", err)
	}
	m.ExpectQuery(`UPDATE "QuotaOverride"`).WithArgs(anyArgs(6)...).WillReturnError(errors.New("boom"))
	if _, err := s.UpdateQuotaOverride(context.Background(), "qo1", UpdateQuotaOverrideParams{}); err == nil {
		t.Fatal("update error should surface")
	}
	m.ExpectExec(`DELETE FROM "QuotaOverride" WHERE id = \$1`).WithArgs("qo1").WillReturnResult(pgxmock.NewResult("DELETE", 1))
	if err := s.DeleteQuotaOverride(context.Background(), "qo1"); err != nil {
		t.Fatalf("DeleteQuotaOverride: %v", err)
	}
	m.ExpectExec(`DELETE FROM "QuotaOverride"`).WithArgs("gone").WillReturnResult(pgxmock.NewResult("DELETE", 0))
	if err := s.DeleteQuotaOverride(context.Background(), "gone"); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("missing → ErrNoRows, got %v", err)
	}
	m.ExpectExec(`DELETE FROM "QuotaOverride"`).WithArgs("qo1").WillReturnError(errors.New("fk"))
	if err := s.DeleteQuotaOverride(context.Background(), "qo1"); err == nil {
		t.Fatal("delete exec error should surface")
	}
}

func TestUpsertQuotaAlert(t *testing.T) {
	s, m := newMock(t)
	m.ExpectExec(`INSERT INTO "QuotaAlert"`).WithArgs(anyArgs(12)...).WillReturnResult(pgxmock.NewResult("INSERT", 1))
	if err := s.UpsertQuotaAlert(context.Background(), UpsertQuotaAlertParams{AlertType: "threshold", TargetType: "organization", TargetID: "org1", PeriodKey: "2026-05", ThresholdPct: 80, CurrentUsagePct: 0.85}); err != nil {
		t.Fatalf("UpsertQuotaAlert: %v", err)
	}
	m.ExpectExec(`INSERT INTO "QuotaAlert"`).WithArgs(anyArgs(12)...).WillReturnError(errors.New("boom"))
	if err := s.UpsertQuotaAlert(context.Background(), UpsertQuotaAlertParams{}); err == nil {
		t.Fatal("exec error should surface")
	}
}
