package store

import (
	"context"
)

// LinkUserToIdP creates a UserFederatedIdentity row tying a NexusUser
// to an external IdP. Used by SCIM CreateUser to stamp provenance on
// users that arrive via SCIM push: their parent IdP is the one the
// SCIM bearer token was scoped to.
//
// Idempotent — if a link already exists for (idpId, externalSubject),
// the call succeeds without creating a duplicate.
func (db *DB) LinkUserToIdP(ctx context.Context, userID, idpID, externalSubject string, externalEmail *string) error {
	_, err := db.pool.Exec(ctx, `
		INSERT INTO "UserFederatedIdentity" (id, "userId", "idpId", "externalSubject", "externalEmail", "linkedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())
		ON CONFLICT ("idpId", "externalSubject") DO NOTHING
	`, userID, idpID, externalSubject, externalEmail)
	return err
}
