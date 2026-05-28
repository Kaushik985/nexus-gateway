package orgstore

import (
	"context"
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

// ── Project ──────────────────────────────────────────────────────────

var projCols = []string{"id", "name", "code", "organizationId", "description", "contactName", "contactEmail", "status", "createdAt", "updatedAt"}

func projRow(id string) []any {
	return []any{id, "Proj", "P1", "org1", sp("d"), sp("Alice"), sp("a@x.com"), "active", tNow, tNow}
}

func TestListProjects(t *testing.T) {
	s, m := newMock(t)
	p := ProjectListParams{Q: "x", Status: "active", OrganizationID: "org1", Limit: 10}
	m.ExpectQuery(`SELECT COUNT\(\*\) FROM "Project"`).WithArgs("%x%", "%x%", "active", "org1").
		WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(1))
	m.ExpectQuery(`FROM "Project"`).WithArgs("%x%", "%x%", "active", "org1", 10, 0).
		WillReturnRows(pgxmock.NewRows(projCols).AddRow(projRow("p1")...))
	pr, total, err := s.ListProjects(context.Background(), p)
	if err != nil || total != 1 || len(pr) != 1 || pr[0].ID != "p1" {
		t.Fatalf("ListProjects: %+v total=%d err=%v", pr, total, err)
	}
	// limit≤0 default 20 + no filters
	s2, m2 := newMock(t)
	m2.ExpectQuery(`SELECT COUNT`).WithArgs().WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(0))
	m2.ExpectQuery(`FROM "Project"`).WithArgs(20, 0).WillReturnRows(pgxmock.NewRows(projCols))
	if _, _, err := s2.ListProjects(context.Background(), ProjectListParams{}); err != nil {
		t.Fatalf("default limit: %v", err)
	}
	if err := m2.ExpectationsWereMet(); err != nil {
		t.Fatalf("limit default 20 not applied: %v", err)
	}
	// count error / data error / scan error
	s3, m3 := newMock(t)
	m3.ExpectQuery(`SELECT COUNT`).WillReturnError(errors.New("boom"))
	if _, _, err := s3.ListProjects(context.Background(), ProjectListParams{}); err == nil {
		t.Fatal("count error should surface")
	}
	s4, m4 := newMock(t)
	m4.ExpectQuery(`SELECT COUNT`).WithArgs().WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(1))
	m4.ExpectQuery(`FROM "Project"`).WithArgs(anyArgs(2)...).WillReturnError(errors.New("q"))
	if _, _, err := s4.ListProjects(context.Background(), ProjectListParams{}); err == nil {
		t.Fatal("data query error should surface")
	}
	s5, m5 := newMock(t)
	bad := projRow("p1")
	bad[8] = "not-a-time"
	m5.ExpectQuery(`SELECT COUNT`).WithArgs().WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(1))
	m5.ExpectQuery(`FROM "Project"`).WithArgs(anyArgs(2)...).WillReturnRows(pgxmock.NewRows(projCols).AddRow(bad...))
	if _, _, err := s5.ListProjects(context.Background(), ProjectListParams{}); err == nil {
		t.Fatal("scan error should surface")
	}
}

func TestProjectGetCreateUpdateDelete(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`FROM "Project" WHERE id = \$1`).WithArgs("p1").
		WillReturnRows(pgxmock.NewRows(projCols).AddRow(projRow("p1")...))
	if pr, err := s.GetProject(context.Background(), "p1"); err != nil || pr == nil || pr.ID != "p1" {
		t.Fatalf("GetProject: %+v %v", pr, err)
	}
	m.ExpectQuery(`FROM "Project" WHERE id`).WithArgs("missing").WillReturnError(pgx.ErrNoRows)
	if pr, err := s.GetProject(context.Background(), "missing"); err != nil || pr != nil {
		t.Fatalf("missing → (nil,nil), got %+v %v", pr, err)
	}
	m.ExpectQuery(`FROM "Project" WHERE id`).WithArgs("e").WillReturnError(errors.New("db"))
	if _, err := s.GetProject(context.Background(), "e"); err == nil {
		t.Fatal("get error should surface")
	}
	m.ExpectQuery(`INSERT INTO "Project"`).WithArgs(anyArgs(7)...).
		WillReturnRows(pgxmock.NewRows(projCols).AddRow(projRow("p1")...))
	if pr, err := s.CreateProject(context.Background(), map[string]any{"name": "Proj", "code": "P1", "organizationId": "org1", "status": "active"}); err != nil || pr == nil {
		t.Fatalf("CreateProject: %+v %v", pr, err)
	}
	m.ExpectQuery(`INSERT INTO "Project"`).WithArgs(anyArgs(7)...).WillReturnError(errors.New("dup"))
	if _, err := s.CreateProject(context.Background(), map[string]any{}); err == nil {
		t.Fatal("create error should surface")
	}
	m.ExpectQuery(`UPDATE "Project" SET`).WithArgs(anyArgs(8)...).
		WillReturnRows(pgxmock.NewRows(projCols).AddRow(projRow("p1")...))
	if _, err := s.UpdateProject(context.Background(), "p1", UpdateProjectParams{Name: sp("New")}); err != nil {
		t.Fatalf("UpdateProject: %v", err)
	}
	m.ExpectQuery(`UPDATE "Project"`).WithArgs(anyArgs(8)...).WillReturnError(errors.New("boom"))
	if _, err := s.UpdateProject(context.Background(), "p1", UpdateProjectParams{}); err == nil {
		t.Fatal("update error should surface")
	}
	m.ExpectExec(`DELETE FROM "Project" WHERE id = \$1`).WithArgs("p1").WillReturnResult(pgxmock.NewResult("DELETE", 1))
	if err := s.DeleteProject(context.Background(), "p1"); err != nil {
		t.Fatalf("DeleteProject: %v", err)
	}
	m.ExpectExec(`DELETE FROM "Project"`).WithArgs("gone").WillReturnResult(pgxmock.NewResult("DELETE", 0))
	if err := s.DeleteProject(context.Background(), "gone"); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("missing → ErrNoRows, got %v", err)
	}
	m.ExpectExec(`DELETE FROM "Project"`).WithArgs("p1").WillReturnError(errors.New("fk"))
	if err := s.DeleteProject(context.Background(), "p1"); err == nil {
		t.Fatal("delete exec error should surface")
	}
	m.ExpectQuery(`SELECT COUNT\(\*\) FROM "VirtualKey" WHERE "projectId" = \$1`).WithArgs("p1").
		WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(4))
	if n, err := s.CountProjectVirtualKeys(context.Background(), "p1"); err != nil || n != 4 {
		t.Fatalf("CountProjectVirtualKeys: %d %v", n, err)
	}
}

// ── Organization ─────────────────────────────────────────────────────

var orgCols = []string{"id", "name", "code", "parentId", "path", "description", "contactName", "contactEmail", "contactPhone", "enabled", "timezone", "source", "externalGroupId", "createdAt", "updatedAt"}
var orgListCols = append(append([]string{}, orgCols...), "childCount", "projectCount", "userCount")

// orgVals returns the 15 base columns. parent is the *string parentId.
func orgVals(id string, parent *string) []any {
	return []any{id, "Org", "O1", parent, "/" + id + "/", sp("d"), sp("Alice"), sp("a@x.com"), sp("555"), true, "UTC", "local", (*string)(nil), tNow, tNow}
}

func TestListOrganizations(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`FROM "Organization" o\s+LEFT JOIN`).
		WillReturnRows(pgxmock.NewRows(orgListCols).AddRow(append(orgVals("o1", nil), 2, 3, 5)...))
	if os, err := s.ListOrganizations(context.Background()); err != nil || len(os) != 1 || os[0].ChildCount == nil || *os[0].ChildCount != 2 {
		t.Fatalf("ListOrganizations: %+v %v", os, err)
	}
	m.ExpectQuery(`FROM "Organization" o`).WillReturnError(errors.New("boom"))
	if _, err := s.ListOrganizations(context.Background()); err == nil {
		t.Fatal("query error should surface")
	}
	s2, m2 := newMock(t)
	bad := append(orgVals("o1", nil), 2, 3, 5)
	bad[9] = "not-a-bool"
	m2.ExpectQuery(`FROM "Organization" o`).WillReturnRows(pgxmock.NewRows(orgListCols).AddRow(bad...))
	if _, err := s2.ListOrganizations(context.Background()); err == nil {
		t.Fatal("scan error should surface")
	}
}

func TestListChildAndGetOrganization(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`FROM "Organization" WHERE "parentId" = \$1`).WithArgs("p1").
		WillReturnRows(pgxmock.NewRows(orgCols).AddRow(orgVals("o2", sp("p1"))...))
	if os, err := s.ListChildOrganizations(context.Background(), "p1"); err != nil || len(os) != 1 || os[0].ID != "o2" {
		t.Fatalf("ListChildOrganizations: %+v %v", os, err)
	}
	m.ExpectQuery(`WHERE "parentId"`).WithArgs("p1").WillReturnError(errors.New("boom"))
	if _, err := s.ListChildOrganizations(context.Background(), "p1"); err == nil {
		t.Fatal("query error should surface")
	}
	m.ExpectQuery(`FROM "Organization" WHERE id = \$1`).WithArgs("o1").
		WillReturnRows(pgxmock.NewRows(orgCols).AddRow(orgVals("o1", nil)...))
	if o, err := s.GetOrganization(context.Background(), "o1"); err != nil || o == nil || o.ID != "o1" {
		t.Fatalf("GetOrganization: %+v %v", o, err)
	}
	m.ExpectQuery(`FROM "Organization" WHERE id`).WithArgs("missing").WillReturnError(pgx.ErrNoRows)
	if o, err := s.GetOrganization(context.Background(), "missing"); err != nil || o != nil {
		t.Fatalf("missing → (nil,nil), got %+v %v", o, err)
	}
	m.ExpectQuery(`FROM "Organization" WHERE id`).WithArgs("e").WillReturnError(errors.New("db"))
	if _, err := s.GetOrganization(context.Background(), "e"); err == nil {
		t.Fatal("get error should surface")
	}
}

func TestCreateOrganization(t *testing.T) {
	// root org: insert → ParentID nil → path /id/ → update path → commit
	s, m := newMock(t)
	m.ExpectBegin()
	m.ExpectQuery(`INSERT INTO "Organization"`).WithArgs(anyArgs(9)...).
		WillReturnRows(pgxmock.NewRows(orgCols).AddRow(orgVals("o1", nil)...))
	m.ExpectExec(`UPDATE "Organization" SET path = \$1 WHERE id = \$2`).WithArgs("/o1/", "o1").WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	m.ExpectCommit()
	if o, err := s.CreateOrganization(context.Background(), map[string]any{"name": "Org", "code": "O1"}); err != nil || o == nil || o.Path != "/o1/" {
		t.Fatalf("CreateOrganization root: %+v %v", o, err)
	}
	// child org: insert (parent) → query parent path → update path → commit
	s2, m2 := newMock(t)
	m2.ExpectBegin()
	m2.ExpectQuery(`INSERT INTO "Organization"`).WithArgs(anyArgs(9)...).
		WillReturnRows(pgxmock.NewRows(orgCols).AddRow(orgVals("o2", sp("p1"))...))
	m2.ExpectQuery(`SELECT path FROM "Organization" WHERE id = \$1`).WithArgs("p1").
		WillReturnRows(pgxmock.NewRows([]string{"path"}).AddRow("/p1/"))
	m2.ExpectExec(`UPDATE "Organization" SET path`).WithArgs("/p1/o2/", "o2").WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	m2.ExpectCommit()
	if o, err := s2.CreateOrganization(context.Background(), map[string]any{"name": "Org", "code": "O2", "parentId": "p1"}); err != nil || o == nil || o.Path != "/p1/o2/" {
		t.Fatalf("CreateOrganization child: %+v %v", o, err)
	}
	// error arms
	for _, tc := range []struct {
		name  string
		setup func(m pgxmock.PgxPoolIface)
	}{
		{"begin", func(m pgxmock.PgxPoolIface) { m.ExpectBegin().WillReturnError(errors.New("x")) }},
		{"insert", func(m pgxmock.PgxPoolIface) {
			m.ExpectBegin()
			m.ExpectQuery(`INSERT INTO "Organization"`).WithArgs(anyArgs(9)...).WillReturnError(errors.New("x"))
			m.ExpectRollback()
		}},
		{"path update", func(m pgxmock.PgxPoolIface) {
			m.ExpectBegin()
			m.ExpectQuery(`INSERT INTO "Organization"`).WithArgs(anyArgs(9)...).WillReturnRows(pgxmock.NewRows(orgCols).AddRow(orgVals("o1", nil)...))
			m.ExpectExec(`UPDATE "Organization" SET path`).WithArgs("/o1/", "o1").WillReturnError(errors.New("x"))
			m.ExpectRollback()
		}},
		{"commit", func(m pgxmock.PgxPoolIface) {
			m.ExpectBegin()
			m.ExpectQuery(`INSERT INTO "Organization"`).WithArgs(anyArgs(9)...).WillReturnRows(pgxmock.NewRows(orgCols).AddRow(orgVals("o1", nil)...))
			m.ExpectExec(`UPDATE "Organization" SET path`).WithArgs("/o1/", "o1").WillReturnResult(pgxmock.NewResult("UPDATE", 1))
			m.ExpectCommit().WillReturnError(errors.New("x"))
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, m := newMock(t)
			tc.setup(m)
			if _, err := s.CreateOrganization(context.Background(), map[string]any{"name": "Org"}); err == nil {
				t.Fatalf("%s error should surface", tc.name)
			}
		})
	}
	// parent-path query error (child path)
	s3, m3 := newMock(t)
	m3.ExpectBegin()
	m3.ExpectQuery(`INSERT INTO "Organization"`).WithArgs(anyArgs(9)...).WillReturnRows(pgxmock.NewRows(orgCols).AddRow(orgVals("o2", sp("p1"))...))
	m3.ExpectQuery(`SELECT path FROM "Organization"`).WithArgs("p1").WillReturnError(errors.New("x"))
	m3.ExpectRollback()
	if _, err := s3.CreateOrganization(context.Background(), map[string]any{"name": "Org", "parentId": "p1"}); err == nil {
		t.Fatal("parent path query error should surface")
	}
}

func TestUpdateOrganization(t *testing.T) {
	// no parent change: fetch current → update → commit (ptrEq nil==nil short-circuits cascade)
	s, m := newMock(t)
	m.ExpectBegin()
	m.ExpectQuery(`SELECT path, "parentId" FROM "Organization" WHERE id = \$1`).WithArgs("o1").
		WillReturnRows(pgxmock.NewRows([]string{"path", "parentId"}).AddRow("/o1/", (*string)(nil)))
	m.ExpectQuery(`UPDATE "Organization" SET`).WithArgs(anyArgs(10)...).
		WillReturnRows(pgxmock.NewRows(orgCols).AddRow(orgVals("o1", nil)...))
	m.ExpectCommit()
	if o, err := s.UpdateOrganization(context.Background(), "o1", UpdateOrganizationParams{Name: sp("New")}); err != nil || o == nil {
		t.Fatalf("UpdateOrganization no-reparent: %+v %v", o, err)
	}
	// reparent: parent changes → query new parent path → cascade update → commit
	s2, m2 := newMock(t)
	newParent := "p2"
	m2.ExpectBegin()
	m2.ExpectQuery(`SELECT path, "parentId"`).WithArgs("o1").
		WillReturnRows(pgxmock.NewRows([]string{"path", "parentId"}).AddRow("/o1/", (*string)(nil)))
	m2.ExpectQuery(`UPDATE "Organization" SET`).WithArgs(anyArgs(10)...).
		WillReturnRows(pgxmock.NewRows(orgCols).AddRow(orgVals("o1", sp("p2"))...))
	m2.ExpectQuery(`SELECT path FROM "Organization" WHERE id = \$1`).WithArgs("p2").
		WillReturnRows(pgxmock.NewRows([]string{"path"}).AddRow("/p2/"))
	m2.ExpectExec(`UPDATE "Organization"\s+SET path = \$1`).WithArgs("/p2/o1/", "/o1/").WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	m2.ExpectCommit()
	if o, err := s2.UpdateOrganization(context.Background(), "o1", UpdateOrganizationParams{ParentID: &newParent}); err != nil || o == nil || o.Path != "/p2/o1/" {
		t.Fatalf("UpdateOrganization reparent: %+v %v", o, err)
	}
	// reparent to root ("")
	s3, m3 := newMock(t)
	root := ""
	m3.ExpectBegin()
	m3.ExpectQuery(`SELECT path, "parentId"`).WithArgs("o1").
		WillReturnRows(pgxmock.NewRows([]string{"path", "parentId"}).AddRow("/x/o1/", sp("x")))
	m3.ExpectQuery(`UPDATE "Organization" SET`).WithArgs(anyArgs(10)...).
		WillReturnRows(pgxmock.NewRows(orgCols).AddRow(orgVals("o1", nil)...))
	m3.ExpectExec(`SET path = \$1`).WithArgs("/o1/", "/x/o1/").WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	m3.ExpectCommit()
	if o, err := s3.UpdateOrganization(context.Background(), "o1", UpdateOrganizationParams{ParentID: &root}); err != nil || o == nil || o.Path != "/o1/" {
		t.Fatalf("UpdateOrganization to-root: %+v %v", o, err)
	}
	// error arms
	s4, m4 := newMock(t)
	m4.ExpectBegin().WillReturnError(errors.New("x"))
	if _, err := s4.UpdateOrganization(context.Background(), "o1", UpdateOrganizationParams{}); err == nil {
		t.Fatal("begin error should surface")
	}
	s5, m5 := newMock(t)
	m5.ExpectBegin()
	m5.ExpectQuery(`SELECT path, "parentId"`).WithArgs("o1").WillReturnError(errors.New("x"))
	m5.ExpectRollback()
	if _, err := s5.UpdateOrganization(context.Background(), "o1", UpdateOrganizationParams{}); err == nil {
		t.Fatal("fetch current error should surface")
	}
	s6, m6 := newMock(t)
	m6.ExpectBegin()
	m6.ExpectQuery(`SELECT path, "parentId"`).WithArgs("o1").WillReturnRows(pgxmock.NewRows([]string{"path", "parentId"}).AddRow("/o1/", (*string)(nil)))
	m6.ExpectQuery(`UPDATE "Organization" SET`).WithArgs(anyArgs(10)...).WillReturnError(errors.New("x"))
	m6.ExpectRollback()
	if _, err := s6.UpdateOrganization(context.Background(), "o1", UpdateOrganizationParams{}); err == nil {
		t.Fatal("update error should surface")
	}
}

func TestDeleteOrganizationAndCount(t *testing.T) {
	s, m := newMock(t)
	m.ExpectExec(`DELETE FROM "Organization" WHERE id = \$1`).WithArgs("o1").WillReturnResult(pgxmock.NewResult("DELETE", 1))
	if err := s.DeleteOrganization(context.Background(), "o1"); err != nil {
		t.Fatalf("DeleteOrganization: %v", err)
	}
	m.ExpectExec(`DELETE FROM "Organization"`).WithArgs("gone").WillReturnResult(pgxmock.NewResult("DELETE", 0))
	if err := s.DeleteOrganization(context.Background(), "gone"); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("missing → ErrNoRows, got %v", err)
	}
	m.ExpectExec(`DELETE FROM "Organization"`).WithArgs("o1").WillReturnError(errors.New("fk"))
	if err := s.DeleteOrganization(context.Background(), "o1"); err == nil {
		t.Fatal("delete exec error should surface")
	}
	// CountOrgDependents (2 counts)
	m.ExpectQuery(`COUNT\(\*\) FROM "Organization" WHERE "parentId" = \$1`).WithArgs("o1").WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(2))
	m.ExpectQuery(`COUNT\(\*\) FROM "Project" WHERE "organizationId" = \$1`).WithArgs("o1").WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(3))
	if c, p, err := s.CountOrgDependents(context.Background(), "o1"); err != nil || c != 2 || p != 3 {
		t.Fatalf("CountOrgDependents: c=%d p=%d err=%v", c, p, err)
	}
}
