package userstore

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

var userCols = []string{"id", "organizationId", "displayName", "email", "status", "canAccessControlPlane", "source", "osUsername", "osDomain", "passwordHash", "lastLoginAt", "preferredTimezone", "createdAt", "updatedAt"}

func userRow(id string) []any {
	return []any{id, "org1", "Alice", sp("a@x.com"), "active", true, "local", sp("alice"), sp("CORP"), sp("hash"), (*time.Time)(nil), sp("UTC"), tNow, tNow}
}

func TestFindNexusUser(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`FROM "NexusUser"\s+WHERE email = \$1 AND "canAccessControlPlane" = true`).WithArgs("a@x.com").
		WillReturnRows(pgxmock.NewRows(userCols).AddRow(userRow("u1")...))
	if u, err := s.FindNexusUserByEmail(context.Background(), "a@x.com"); err != nil || u == nil || u.ID != "u1" {
		t.Fatalf("FindNexusUserByEmail: %+v %v", u, err)
	}
	m.ExpectQuery(`WHERE email`).WithArgs("missing").WillReturnError(pgx.ErrNoRows)
	if u, err := s.FindNexusUserByEmail(context.Background(), "missing"); err != nil || u != nil {
		t.Fatalf("missing → (nil,nil), got %+v %v", u, err)
	}
	m.ExpectQuery(`WHERE email`).WithArgs("e").WillReturnError(errors.New("db"))
	if _, err := s.FindNexusUserByEmail(context.Background(), "e"); err == nil {
		t.Fatal("email db error should surface")
	}
	m.ExpectQuery(`FROM "NexusUser"\s+WHERE id = \$1`).WithArgs("u1").
		WillReturnRows(pgxmock.NewRows(userCols).AddRow(userRow("u1")...))
	if u, err := s.FindNexusUserByID(context.Background(), "u1"); err != nil || u == nil {
		t.Fatalf("FindNexusUserByID: %+v %v", u, err)
	}
	m.ExpectQuery(`WHERE id = \$1`).WithArgs("e").WillReturnError(errors.New("db"))
	if _, err := s.FindNexusUserByID(context.Background(), "e"); err == nil {
		t.Fatal("id db error should surface")
	}
}

var safeListCols = []string{"id", "displayName", "email", "status", "canAccessControlPlane", "source", "lastLoginAt", "preferredTimezone", "createdAt", "updatedAt", "organizationId", "organizationName"}

func safeListRow(id string) []any {
	return []any{id, "Alice", sp("a@x.com"), "active", true, "local", (*time.Time)(nil), sp("UTC"), tNow, tNow, sp("org1"), sp("Acme")}
}

func TestListNexusUsers(t *testing.T) {
	s, m := newMock(t)
	en := true
	ca := true
	p := NexusUserListParams{Q: "al", Enabled: &en, CanAccessControlPlane: &ca, OrgID: "org1", Limit: 10}
	// Q(1 arg) + CanAccess(1) + OrgID(1) = 3 filter args (Enabled is inline status).
	m.ExpectQuery(`SELECT COUNT\(\*\) FROM "NexusUser" u`).WithArgs("%al%", true, "org1").
		WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(1))
	m.ExpectQuery(`FROM "NexusUser" u\s+LEFT JOIN "Organization"`).WithArgs("%al%", true, "org1", 10, 0).
		WillReturnRows(pgxmock.NewRows(safeListCols).AddRow(safeListRow("u1")...))
	us, total, err := s.ListNexusUsers(context.Background(), p)
	if err != nil || total != 1 || len(us) != 1 || us[0].OrganizationName == nil || *us[0].OrganizationName != "Acme" {
		t.Fatalf("ListNexusUsers: %+v total=%d err=%v", us, total, err)
	}
	// IncludeSubOrgs path + Enabled=false branch
	s2, m2 := newMock(t)
	dis := false
	m2.ExpectQuery(`SELECT COUNT`).WithArgs("org1").WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(0))
	m2.ExpectQuery(`FROM "NexusUser" u`).WithArgs("org1", 0, 0).WillReturnRows(pgxmock.NewRows(safeListCols))
	if _, _, err := s2.ListNexusUsers(context.Background(), NexusUserListParams{Enabled: &dis, OrgID: "org1", IncludeSubOrgs: true}); err != nil {
		t.Fatalf("IncludeSubOrgs: %v", err)
	}
	// errors
	s3, m3 := newMock(t)
	m3.ExpectQuery(`SELECT COUNT`).WillReturnError(errors.New("boom"))
	if _, _, err := s3.ListNexusUsers(context.Background(), NexusUserListParams{}); err == nil {
		t.Fatal("count error should surface")
	}
	s4, m4 := newMock(t)
	m4.ExpectQuery(`SELECT COUNT`).WithArgs().WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(1))
	m4.ExpectQuery(`FROM "NexusUser" u`).WithArgs(anyArgs(2)...).WillReturnError(errors.New("q"))
	if _, _, err := s4.ListNexusUsers(context.Background(), NexusUserListParams{}); err == nil {
		t.Fatal("data query error should surface")
	}
	s5, m5 := newMock(t)
	bad := safeListRow("u1")
	bad[8] = "not-a-time"
	m5.ExpectQuery(`SELECT COUNT`).WithArgs().WillReturnRows(pgxmock.NewRows([]string{"c"}).AddRow(1))
	m5.ExpectQuery(`FROM "NexusUser" u`).WithArgs(anyArgs(2)...).WillReturnRows(pgxmock.NewRows(safeListCols).AddRow(bad...))
	if _, _, err := s5.ListNexusUsers(context.Background(), NexusUserListParams{}); err == nil {
		t.Fatal("scan error should surface")
	}
}

func TestNexusUserOrgInfoAndDefaultOrg(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`FROM "NexusUser" u\s+LEFT JOIN "Organization"`).WithArgs("u1").
		WillReturnRows(pgxmock.NewRows([]string{"orgId", "orgName"}).AddRow("org1", "Acme"))
	if id, name, err := s.GetNexusUserOrgInfo(context.Background(), "u1"); err != nil || id != "org1" || name != "Acme" {
		t.Fatalf("GetNexusUserOrgInfo: %q %q %v", id, name, err)
	}
	m.ExpectQuery(`SELECT id FROM "Organization"`).WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow("org-root"))
	if id, err := s.FindDefaultOrganizationID(context.Background()); err != nil || id != "org-root" {
		t.Fatalf("FindDefaultOrganizationID: %q %v", id, err)
	}
	m.ExpectQuery(`SELECT id FROM "Organization"`).WillReturnError(pgx.ErrNoRows)
	if id, err := s.FindDefaultOrganizationID(context.Background()); err != nil || id != "" {
		t.Fatalf("empty org table → (\"\",nil), got %q %v", id, err)
	}
	m.ExpectQuery(`SELECT id FROM "Organization"`).WillReturnError(errors.New("db"))
	if _, err := s.FindDefaultOrganizationID(context.Background()); err == nil {
		t.Fatal("default org db error should surface")
	}
}

var safeCols = []string{"id", "displayName", "email", "status", "canAccessControlPlane", "source", "lastLoginAt", "preferredTimezone", "createdAt", "updatedAt"}

func safeRow(id string) []any {
	return []any{id, "Alice", sp("a@x.com"), "active", true, "local", (*time.Time)(nil), sp("UTC"), tNow, tNow}
}

func TestNexusUserCRUD(t *testing.T) {
	s, m := newMock(t)
	m.ExpectQuery(`FROM "NexusUser" WHERE id = \$1`).WithArgs("u1").
		WillReturnRows(pgxmock.NewRows(safeCols).AddRow(safeRow("u1")...))
	if u, err := s.GetNexusUserSafe(context.Background(), "u1"); err != nil || u == nil || u.ID != "u1" {
		t.Fatalf("GetNexusUserSafe: %+v %v", u, err)
	}
	m.ExpectQuery(`FROM "NexusUser" WHERE id`).WithArgs("missing").WillReturnError(pgx.ErrNoRows)
	if u, err := s.GetNexusUserSafe(context.Background(), "missing"); err != nil || u != nil {
		t.Fatalf("missing → (nil,nil), got %+v %v", u, err)
	}
	// Create with defaults (source ""→local, canAccess nil→false, pwd ""→nil) asserted via WithArgs
	m.ExpectQuery(`INSERT INTO "NexusUser"`).WithArgs("Alice", sp("a@x.com"), (*string)(nil), false, sp("org1"), "admin", "local").
		WillReturnRows(pgxmock.NewRows(safeCols).AddRow(safeRow("u1")...))
	if u, err := s.CreateNexusUser(context.Background(), CreateNexusUserParams{DisplayName: "Alice", Email: sp("a@x.com"), OrganizationID: sp("org1"), CreatedBy: "admin", PasswordHash: sp("")}); err != nil || u == nil {
		t.Fatalf("CreateNexusUser: %+v %v", u, err)
	}
	if err := m.ExpectationsWereMet(); err != nil {
		t.Fatalf("create defaults not applied: %v", err)
	}
	m.ExpectQuery(`INSERT INTO "NexusUser"`).WithArgs(anyArgs(7)...).WillReturnError(errors.New("dup"))
	if _, err := s.CreateNexusUser(context.Background(), CreateNexusUserParams{}); err == nil {
		t.Fatal("create error should surface")
	}
	// Update with Enabled=false → status suspended (resolve branch)
	m.ExpectQuery(`UPDATE "NexusUser" SET`).WithArgs(anyArgs(8)...).
		WillReturnRows(pgxmock.NewRows(safeCols).AddRow(safeRow("u1")...))
	dis := false
	if _, err := s.UpdateNexusUser(context.Background(), "u1", UpdateNexusUserParams{Enabled: &dis}); err != nil {
		t.Fatalf("UpdateNexusUser: %v", err)
	}
	m.ExpectQuery(`UPDATE "NexusUser"`).WithArgs(anyArgs(8)...).WillReturnError(errors.New("boom"))
	if _, err := s.UpdateNexusUser(context.Background(), "u1", UpdateNexusUserParams{Status: sp("active")}); err == nil {
		t.Fatal("update error should surface")
	}
	m.ExpectExec(`DELETE FROM "NexusUser" WHERE id = \$1`).WithArgs("u1").WillReturnResult(pgxmock.NewResult("DELETE", 1))
	if err := s.DeleteNexusUser(context.Background(), "u1"); err != nil {
		t.Fatalf("DeleteNexusUser: %v", err)
	}
	m.ExpectExec(`DELETE FROM "NexusUser"`).WithArgs("gone").WillReturnResult(pgxmock.NewResult("DELETE", 0))
	if err := s.DeleteNexusUser(context.Background(), "gone"); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("missing → ErrNoRows, got %v", err)
	}
}

var keyCols = []string{"id", "name", "keyPrefix", "enabled", "status", "lastUsedAt", "expiresAt", "rotatedAt", "rotatedFromId", "createdBy", "createdAt", "ownerUserId"}

func keyRow(id string) []any {
	return []any{id, "key", "nxs_abc", true, "active", (*time.Time)(nil), (*time.Time)(nil), (*time.Time)(nil), (*string)(nil), "admin", tNow, sp("u1")}
}

func TestAdminAPIKeyCRUD(t *testing.T) {
	s, m := newMock(t)
	// List with owner filter
	m.ExpectQuery(`FROM "AdminApiKey" WHERE "ownerUserId" = \$1`).WithArgs("u1").
		WillReturnRows(pgxmock.NewRows(keyCols).AddRow(keyRow("k1")...))
	if ks, err := s.ListAdminAPIKeys(context.Background(), "u1"); err != nil || len(ks) != 1 {
		t.Fatalf("ListAdminAPIKeys owner: %+v %v", ks, err)
	}
	// List no owner
	m.ExpectQuery(`FROM "AdminApiKey" ORDER BY`).
		WillReturnRows(pgxmock.NewRows(keyCols).AddRow(keyRow("k1")...))
	if ks, err := s.ListAdminAPIKeys(context.Background(), ""); err != nil || len(ks) != 1 {
		t.Fatalf("ListAdminAPIKeys all: %+v %v", ks, err)
	}
	m.ExpectQuery(`FROM "AdminApiKey"`).WillReturnError(errors.New("boom"))
	if _, err := s.ListAdminAPIKeys(context.Background(), ""); err == nil {
		t.Fatal("list query error should surface")
	}
	// scan error
	s2, m2 := newMock(t)
	bad := keyRow("k1")
	bad[3] = "not-a-bool"
	m2.ExpectQuery(`FROM "AdminApiKey"`).WillReturnRows(pgxmock.NewRows(keyCols).AddRow(bad...))
	if _, err := s2.ListAdminAPIKeys(context.Background(), ""); err == nil {
		t.Fatal("list scan error should surface")
	}
	// Get
	m.ExpectQuery(`FROM "AdminApiKey" WHERE id = \$1`).WithArgs("k1").WillReturnRows(pgxmock.NewRows(keyCols).AddRow(keyRow("k1")...))
	if k, err := s.GetAdminAPIKey(context.Background(), "k1"); err != nil || k == nil || k.ID != "k1" {
		t.Fatalf("GetAdminAPIKey: %+v %v", k, err)
	}
	m.ExpectQuery(`FROM "AdminApiKey" WHERE id`).WithArgs("missing").WillReturnError(pgx.ErrNoRows)
	if k, err := s.GetAdminAPIKey(context.Background(), "missing"); err != nil || k != nil {
		t.Fatalf("missing → (nil,nil), got %+v %v", k, err)
	}
	// Create / Update / Regenerate / Delete
	m.ExpectQuery(`INSERT INTO "AdminApiKey"`).WithArgs(anyArgs(6)...).WillReturnRows(pgxmock.NewRows(keyCols).AddRow(keyRow("k1")...))
	if _, err := s.CreateAdminAPIKey(context.Background(), CreateAdminAPIKeyParams{Name: "key", KeyHash: "h", KeyPrefix: "nxs_abc", CreatedBy: "admin"}); err != nil {
		t.Fatalf("CreateAdminAPIKey: %v", err)
	}
	m.ExpectQuery(`INSERT INTO "AdminApiKey"`).WithArgs(anyArgs(6)...).WillReturnError(errors.New("dup"))
	if _, err := s.CreateAdminAPIKey(context.Background(), CreateAdminAPIKeyParams{}); err == nil {
		t.Fatal("create error should surface")
	}
	m.ExpectQuery(`UPDATE "AdminApiKey" SET`).WithArgs(anyArgs(4)...).WillReturnRows(pgxmock.NewRows(keyCols).AddRow(keyRow("k1")...))
	if _, err := s.UpdateAdminAPIKey(context.Background(), "k1", UpdateAdminAPIKeyParams{Name: sp("renamed")}); err != nil {
		t.Fatalf("UpdateAdminAPIKey: %v", err)
	}
	m.ExpectExec(`UPDATE "AdminApiKey" SET "keyHash"`).WithArgs("k1", "h2", "nxs_xyz").WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	if err := s.RegenerateAdminAPIKey(context.Background(), "k1", "h2", "nxs_xyz"); err != nil {
		t.Fatalf("RegenerateAdminAPIKey: %v", err)
	}
	m.ExpectExec(`DELETE FROM "AdminApiKey" WHERE id = \$1`).WithArgs("k1").WillReturnResult(pgxmock.NewResult("DELETE", 1))
	if err := s.DeleteAdminAPIKey(context.Background(), "k1"); err != nil {
		t.Fatalf("DeleteAdminAPIKey: %v", err)
	}
	m.ExpectExec(`DELETE FROM "AdminApiKey"`).WithArgs("gone").WillReturnResult(pgxmock.NewResult("DELETE", 0))
	if err := s.DeleteAdminAPIKey(context.Background(), "gone"); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("missing → ErrNoRows, got %v", err)
	}
}

// TestUserstoreBranchesAndErrors covers the remaining param-branches and
// error arms not hit by the happy-path tests above.
func TestUserstoreBranchesAndErrors(t *testing.T) {
	s, m := newMock(t)
	// GetNexusUserSafe non-ErrNoRows db error
	m.ExpectQuery(`FROM "NexusUser" WHERE id`).WithArgs("e").WillReturnError(errors.New("db"))
	if _, err := s.GetNexusUserSafe(context.Background(), "e"); err == nil {
		t.Fatal("GetNexusUserSafe db error should surface")
	}
	// CreateNexusUser with canAccess=&true + non-empty password (covers both override branches)
	ca := true
	m.ExpectQuery(`INSERT INTO "NexusUser"`).WithArgs("Bob", (*string)(nil), sp("secret"), true, (*string)(nil), "admin", "oidc").
		WillReturnRows(pgxmock.NewRows(safeCols).AddRow(safeRow("u2")...))
	if _, err := s.CreateNexusUser(context.Background(), CreateNexusUserParams{DisplayName: "Bob", PasswordHash: sp("secret"), CanAccessControlPlane: &ca, CreatedBy: "admin", Source: "oidc"}); err != nil {
		t.Fatalf("CreateNexusUser non-default: %v", err)
	}
	// UpdateNexusUser Enabled=true → status active branch
	en := true
	m.ExpectQuery(`UPDATE "NexusUser" SET`).WithArgs(anyArgs(8)...).WillReturnRows(pgxmock.NewRows(safeCols).AddRow(safeRow("u1")...))
	if _, err := s.UpdateNexusUser(context.Background(), "u1", UpdateNexusUserParams{Enabled: &en}); err != nil {
		t.Fatalf("UpdateNexusUser enable: %v", err)
	}
	// DeleteNexusUser exec error
	m.ExpectExec(`DELETE FROM "NexusUser"`).WithArgs("u1").WillReturnError(errors.New("fk"))
	if err := s.DeleteNexusUser(context.Background(), "u1"); err == nil {
		t.Fatal("DeleteNexusUser exec error should surface")
	}
	// GetAdminAPIKey non-ErrNoRows error
	m.ExpectQuery(`FROM "AdminApiKey" WHERE id`).WithArgs("e").WillReturnError(errors.New("db"))
	if _, err := s.GetAdminAPIKey(context.Background(), "e"); err == nil {
		t.Fatal("GetAdminAPIKey db error should surface")
	}
	// UpdateAdminAPIKey error
	m.ExpectQuery(`UPDATE "AdminApiKey" SET`).WithArgs(anyArgs(4)...).WillReturnError(errors.New("boom"))
	if _, err := s.UpdateAdminAPIKey(context.Background(), "k1", UpdateAdminAPIKeyParams{}); err == nil {
		t.Fatal("UpdateAdminAPIKey error should surface")
	}
	// RegenerateAdminAPIKey exec error
	m.ExpectExec(`UPDATE "AdminApiKey" SET "keyHash"`).WithArgs("k1", "h", "p").WillReturnError(errors.New("boom"))
	if err := s.RegenerateAdminAPIKey(context.Background(), "k1", "h", "p"); err == nil {
		t.Fatal("RegenerateAdminAPIKey error should surface")
	}
	// DeleteAdminAPIKey exec error
	m.ExpectExec(`DELETE FROM "AdminApiKey"`).WithArgs("k1").WillReturnError(errors.New("fk"))
	if err := s.DeleteAdminAPIKey(context.Background(), "k1"); err == nil {
		t.Fatal("DeleteAdminAPIKey exec error should surface")
	}
	// GetNexusUserOrgInfo error (it returns the scan error directly)
	m.ExpectQuery(`FROM "NexusUser" u\s+LEFT JOIN`).WithArgs("e").WillReturnError(errors.New("db"))
	if _, _, err := s.GetNexusUserOrgInfo(context.Background(), "e"); err == nil {
		t.Fatal("GetNexusUserOrgInfo error should surface")
	}
}

// TestRotateAdminAPIKey covers the atomic rotation tx: lock predecessor →
// status guard → mint successor (inheriting expiry) → flip predecessor to
// rotating → commit.
func TestRotateAdminAPIKey(t *testing.T) {
	lockCols := []string{"name", "enabled", "status", "ownerUserId", "expiresAt"}
	t.Run("ok inherits expiry", func(t *testing.T) {
		s, m := newMock(t)
		m.ExpectBegin()
		m.ExpectQuery(`FOR UPDATE`).WithArgs("pred1").
			WillReturnRows(pgxmock.NewRows(lockCols).AddRow("key", true, "active", sp("u1"), &tNow))
		m.ExpectQuery(`INSERT INTO "AdminApiKey"`).WithArgs(anyArgs(7)...).WillReturnRows(pgxmock.NewRows(keyCols).AddRow(keyRow("succ")...))
		m.ExpectQuery(`UPDATE "AdminApiKey"\s+SET status = 'rotating'`).WithArgs("pred1").WillReturnRows(pgxmock.NewRows(keyCols).AddRow(keyRow("pred1")...))
		m.ExpectCommit()
		res, err := s.RotateAdminAPIKey(context.Background(), RotateAdminAPIKeyParams{PredecessorID: "pred1", NewKeyHash: "h", NewKeyPrefix: "nxs_new", NewCreatedBy: "admin"})
		if err != nil || res == nil || res.Successor.ID != "succ" || res.Predecessor.ID != "pred1" {
			t.Fatalf("RotateAdminAPIKey: %+v %v", res, err)
		}
	})
	t.Run("predecessor not found", func(t *testing.T) {
		s, m := newMock(t)
		m.ExpectBegin()
		m.ExpectQuery(`FOR UPDATE`).WithArgs("gone").WillReturnError(pgx.ErrNoRows)
		m.ExpectRollback()
		if _, err := s.RotateAdminAPIKey(context.Background(), RotateAdminAPIKeyParams{PredecessorID: "gone"}); !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("not found → ErrNoRows, got %v", err)
		}
	})
	t.Run("not active", func(t *testing.T) {
		s, m := newMock(t)
		m.ExpectBegin()
		m.ExpectQuery(`FOR UPDATE`).WithArgs("pred1").WillReturnRows(pgxmock.NewRows(lockCols).AddRow("key", true, "rotating", sp("u1"), (*time.Time)(nil)))
		m.ExpectRollback()
		if _, err := s.RotateAdminAPIKey(context.Background(), RotateAdminAPIKeyParams{PredecessorID: "pred1"}); err == nil || errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("non-active predecessor should error, got %v", err)
		}
	})
	t.Run("begin/lock/insert/update/commit errors", func(t *testing.T) {
		for _, tc := range []struct {
			name  string
			setup func(m pgxmock.PgxPoolIface)
		}{
			{"begin", func(m pgxmock.PgxPoolIface) { m.ExpectBegin().WillReturnError(errors.New("x")) }},
			{"lock", func(m pgxmock.PgxPoolIface) {
				m.ExpectBegin()
				m.ExpectQuery(`FOR UPDATE`).WithArgs("pred1").WillReturnError(errors.New("x"))
				m.ExpectRollback()
			}},
			{"insert successor", func(m pgxmock.PgxPoolIface) {
				m.ExpectBegin()
				m.ExpectQuery(`FOR UPDATE`).WithArgs("pred1").WillReturnRows(pgxmock.NewRows(lockCols).AddRow("key", true, "active", sp("u1"), (*time.Time)(nil)))
				m.ExpectQuery(`INSERT INTO "AdminApiKey"`).WithArgs(anyArgs(7)...).WillReturnError(errors.New("x"))
				m.ExpectRollback()
			}},
			{"update predecessor", func(m pgxmock.PgxPoolIface) {
				m.ExpectBegin()
				m.ExpectQuery(`FOR UPDATE`).WithArgs("pred1").WillReturnRows(pgxmock.NewRows(lockCols).AddRow("key", true, "active", sp("u1"), (*time.Time)(nil)))
				m.ExpectQuery(`INSERT INTO "AdminApiKey"`).WithArgs(anyArgs(7)...).WillReturnRows(pgxmock.NewRows(keyCols).AddRow(keyRow("succ")...))
				m.ExpectQuery(`SET status = 'rotating'`).WithArgs("pred1").WillReturnError(errors.New("x"))
				m.ExpectRollback()
			}},
			{"commit", func(m pgxmock.PgxPoolIface) {
				m.ExpectBegin()
				m.ExpectQuery(`FOR UPDATE`).WithArgs("pred1").WillReturnRows(pgxmock.NewRows(lockCols).AddRow("key", true, "active", sp("u1"), (*time.Time)(nil)))
				m.ExpectQuery(`INSERT INTO "AdminApiKey"`).WithArgs(anyArgs(7)...).WillReturnRows(pgxmock.NewRows(keyCols).AddRow(keyRow("succ")...))
				m.ExpectQuery(`SET status = 'rotating'`).WithArgs("pred1").WillReturnRows(pgxmock.NewRows(keyCols).AddRow(keyRow("pred1")...))
				m.ExpectCommit().WillReturnError(errors.New("x"))
			}},
		} {
			t.Run(tc.name, func(t *testing.T) {
				s, m := newMock(t)
				tc.setup(m)
				if _, err := s.RotateAdminAPIKey(context.Background(), RotateAdminAPIKeyParams{PredecessorID: "pred1"}); err == nil {
					t.Fatalf("%s error should surface", tc.name)
				}
			})
		}
	})
}

// TestRetireAdminAPIKey covers the target-status guard, the success path, and
// the ErrNoRows → existence-probe fork (404 vs already-retired 409).
func TestRetireAdminAPIKey(t *testing.T) {
	s, m := newMock(t)
	// invalid target status — no query issued
	if _, err := s.RetireAdminAPIKey(context.Background(), "k1", "bogus"); err == nil {
		t.Fatal("invalid target status should error")
	}
	// success
	m.ExpectQuery(`UPDATE "AdminApiKey"\s+SET status = \$2`).WithArgs("k1", "expired").WillReturnRows(pgxmock.NewRows(keyCols).AddRow(keyRow("k1")...))
	if k, err := s.RetireAdminAPIKey(context.Background(), "k1", "expired"); err != nil || k == nil {
		t.Fatalf("RetireAdminAPIKey: %+v %v", k, err)
	}
	// ErrNoRows + existence probe → not exists → ErrNoRows
	s2, m2 := newMock(t)
	m2.ExpectQuery(`SET status = \$2`).WithArgs("gone", "expired").WillReturnError(pgx.ErrNoRows)
	m2.ExpectQuery(`SELECT EXISTS`).WithArgs("gone").WillReturnRows(pgxmock.NewRows([]string{"e"}).AddRow(false))
	if _, err := s2.RetireAdminAPIKey(context.Background(), "gone", "expired"); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("not-exists → ErrNoRows, got %v", err)
	}
	// ErrNoRows + exists → already-retired error (not ErrNoRows)
	s3, m3 := newMock(t)
	m3.ExpectQuery(`SET status = \$2`).WithArgs("k1", "unavailable").WillReturnError(pgx.ErrNoRows)
	m3.ExpectQuery(`SELECT EXISTS`).WithArgs("k1").WillReturnRows(pgxmock.NewRows([]string{"e"}).AddRow(true))
	if err := func() error { _, e := s3.RetireAdminAPIKey(context.Background(), "k1", "unavailable"); return e }(); err == nil || errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("already-retired should be a non-ErrNoRows error, got %v", err)
	}
	// existence probe itself errors
	s4, m4 := newMock(t)
	m4.ExpectQuery(`SET status = \$2`).WithArgs("k1", "expired").WillReturnError(pgx.ErrNoRows)
	m4.ExpectQuery(`SELECT EXISTS`).WithArgs("k1").WillReturnError(errors.New("probe boom"))
	if _, err := s4.RetireAdminAPIKey(context.Background(), "k1", "expired"); err == nil {
		t.Fatal("existence probe error should surface")
	}
	// other update error
	s5, m5 := newMock(t)
	m5.ExpectQuery(`SET status = \$2`).WithArgs("k1", "expired").WillReturnError(errors.New("db"))
	if _, err := s5.RetireAdminAPIKey(context.Background(), "k1", "expired"); err == nil {
		t.Fatal("update db error should surface")
	}
}
