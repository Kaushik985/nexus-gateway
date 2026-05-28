package federatedstore

import (
	"context"
	"errors"
	"testing"

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

func TestListUserIDsByIdPType(t *testing.T) {
	s, m := newMock(t)
	// Happy: distinct user ids across enabled IdPs of a type.
	m.ExpectQuery(`FROM "UserFederatedIdentity" ufi\s+JOIN "IdentityProvider"`).WithArgs("oidc").
		WillReturnRows(pgxmock.NewRows([]string{"userId"}).AddRow("u1").AddRow("u2"))
	ids, err := s.ListUserIDsByIdPType(context.Background(), "oidc")
	if err != nil || len(ids) != 2 || ids[0] != "u1" {
		t.Fatalf("ListUserIDsByIdPType: %+v %v", ids, err)
	}

	// Empty → non-nil empty slice (nil-guard branch).
	m.ExpectQuery(`JOIN "IdentityProvider"`).WithArgs("saml").WillReturnRows(pgxmock.NewRows([]string{"userId"}))
	if ids, err := s.ListUserIDsByIdPType(context.Background(), "saml"); err != nil || ids == nil || len(ids) != 0 {
		t.Fatalf("empty must be non-nil: %+v %v", ids, err)
	}

	// Query error.
	m.ExpectQuery(`JOIN "IdentityProvider"`).WithArgs("x").WillReturnError(errors.New("boom"))
	if _, err := s.ListUserIDsByIdPType(context.Background(), "x"); err == nil {
		t.Fatal("query error must surface")
	}

	// Scan error (2-col row vs single Scan dest).
	s2, m2 := newMock(t)
	m2.ExpectQuery(`JOIN "IdentityProvider"`).WithArgs("oidc").
		WillReturnRows(pgxmock.NewRows([]string{"a", "b"}).AddRow("x", "y"))
	if _, err := s2.ListUserIDsByIdPType(context.Background(), "oidc"); err == nil {
		t.Fatal("scan error must surface")
	}
}

func TestListUserIDsByIdP(t *testing.T) {
	s, m := newMock(t)
	// Happy: snapshot of users linked to a specific IdP row.
	m.ExpectQuery(`FROM "UserFederatedIdentity"\s+WHERE "idpId" = \$1`).WithArgs("idp1").
		WillReturnRows(pgxmock.NewRows([]string{"userId"}).AddRow("u1"))
	ids, err := s.ListUserIDsByIdP(context.Background(), "idp1")
	if err != nil || len(ids) != 1 || ids[0] != "u1" {
		t.Fatalf("ListUserIDsByIdP: %+v %v", ids, err)
	}

	// Empty → non-nil.
	m.ExpectQuery(`WHERE "idpId"`).WithArgs("idp2").WillReturnRows(pgxmock.NewRows([]string{"userId"}))
	if ids, err := s.ListUserIDsByIdP(context.Background(), "idp2"); err != nil || ids == nil {
		t.Fatalf("empty must be non-nil: %+v %v", ids, err)
	}

	// Query error.
	m.ExpectQuery(`WHERE "idpId"`).WithArgs("x").WillReturnError(errors.New("boom"))
	if _, err := s.ListUserIDsByIdP(context.Background(), "x"); err == nil {
		t.Fatal("query error must surface")
	}

	// Scan error.
	s2, m2 := newMock(t)
	m2.ExpectQuery(`WHERE "idpId"`).WithArgs("idp1").
		WillReturnRows(pgxmock.NewRows([]string{"a", "b"}).AddRow("x", "y"))
	if _, err := s2.ListUserIDsByIdP(context.Background(), "idp1"); err == nil {
		t.Fatal("scan error must surface")
	}
}
