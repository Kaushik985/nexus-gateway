package login

import (
	"context"
	"encoding/xml"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/crewjam/saml"
	"github.com/labstack/echo/v4"

	"github.com/AlphaBitCore/nexus-gateway/packages/control-plane/internal/identity/authserver/store"
)

// SAMLDeps carries the collaborators for the SP-initiated SAML login handlers.
// It mirrors OIDCDeps plus a Requests store for InResponseTo tracking and the
// auth-server Issuer the SP entityID / ACS URL derive from.
type SAMLDeps struct {
	IdPs      *store.IdPStore
	Federated *store.FederatedStore
	Pending   *store.PendingAuthzStore
	AuthCodes *store.AuthCodeStore
	Requests  *store.SAMLRequestStore
	Issuer    string
}

// SAMLACSHandler returns POST /authserver/saml/acs — the Assertion Consumer
// Service. It consumes the signed SAMLResponse, validates it (signature,
// conditions, audience, destination, and InResponseTo against the outstanding
// AuthnRequest ID bound to the RelayState authctx), extracts the NameID and
// the email / groups attributes, then runs the shared match-or-JIT-provision
// path and mints an authorization code — rejoining the OAuth flow exactly as
// OIDC login does.
func SAMLACSHandler(d SAMLDeps) echo.HandlerFunc {
	return func(c echo.Context) error {
		ctx := c.Request().Context()

		authctx := c.FormValue("RelayState")
		if authctx == "" {
			return c.JSON(http.StatusBadRequest, errorResponse{Error: errAuthctxExpired})
		}
		// Take both the pending authorize request and the outstanding
		// AuthnRequest ID single-use. A response with no outstanding request
		// (replay, or an IdP-initiated response) cannot proceed.
		pending, ok := d.Pending.Take(authctx)
		if !ok || pending.IdPID == "" {
			return c.JSON(http.StatusBadRequest, errorResponse{Error: errAuthctxExpired})
		}
		requestID, ok := d.Requests.Take(authctx)
		if !ok {
			return c.JSON(http.StatusBadRequest, errorResponse{Error: errAuthctxExpired})
		}

		idp, err := d.IdPs.GetByID(ctx, pending.IdPID)
		if err != nil || !idp.Enabled {
			// Reject a missing or disabled IdP: disabling a SAML IdP must
			// invalidate in-flight logins, not just hide it from the picker.
			return c.JSON(http.StatusBadRequest, errorResponse{Error: "saml_not_configured"})
		}
		cfg := store.DecodeSAMLConfig(idp)
		sp, err := buildSAMLServiceProvider(cfg, d.Issuer)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, errorResponse{Error: errInternal})
		}

		// ParseResponse validates the XML signature against the IdP cert, the
		// audience (SP entityID), the not-before / not-on-or-after window, the
		// destination (ACS URL), and InResponseTo against the supplied IDs.
		assertion, err := sp.ParseResponse(c.Request(), []string{requestID})
		if err != nil {
			return c.JSON(http.StatusUnauthorized, errorResponse{Error: "saml_invalid_response"})
		}
		subject := samlNameID(assertion)
		if subject == "" {
			return c.JSON(http.StatusUnauthorized, errorResponse{Error: "saml_invalid_response"})
		}
		email := samlFirstAttr(assertion, cfg.EmailAttr)
		groups := samlAttrValues(assertion, cfg.GroupsAttr)

		userID, provisionErr := d.resolveOrProvision(ctx, idp, subject, email, groups)
		if provisionErr != "" {
			return c.JSON(http.StatusUnauthorized, errorResponse{Error: provisionErr})
		}

		authCode := store.RandomOpaqueToken(32)
		d.AuthCodes.Put(authCode, store.AuthCodeEntry{
			ClientID:      pending.ClientID,
			UserID:        userID,
			RedirectURI:   pending.RedirectURI,
			PKCEChallenge: pending.CodeChallenge,
			Scope:         pending.Scope,
			IdPID:         idp.ID,
			DeviceID:      pending.DeviceID,
			Nonce:         pending.Nonce,
			Email:         email,
			AMR:           []string{"sso"},
			ExpiresAt:     time.Now().Add(authCodeTTL),
		})
		redirect, err := buildRedirect(pending.RedirectURI, authCode, pending.State)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, errorResponse{Error: errInternal})
		}
		return c.Redirect(http.StatusFound, redirect)
	}
}

// resolveOrProvision maps an external SAML subject to a Nexus user id, mirroring
// the OIDC callback: a known federated identity matches; otherwise the user is
// JIT-provisioned when the IdP allows it (resolving the groups attribute through
// IdpGroupMapping into IamGroupMembership), else the login is refused. Returns
// the user id, or a structured error string for the response body.
func (d SAMLDeps) resolveOrProvision(ctx context.Context, idp *store.IdentityProvider, subject, email string, groups []string) (string, string) {
	fi, found, err := d.Federated.FindByIdPSubject(ctx, idp.ID, subject)
	if err != nil {
		return "", errInternal
	}
	if found {
		_ = d.Federated.UpdateRawClaims(ctx, fi.ID, map[string]any{"sub": subject, "email": email})
		return fi.UserID, ""
	}
	if !idp.JITEnabled {
		return "", "user_not_provisioned"
	}
	displayName := email
	if displayName == "" {
		displayName = subject
	}
	u, _, jitErr := d.Federated.JITProvisionUser(ctx, store.JITProvisionParams{
		IdPID:           idp.ID,
		ExternalSubject: subject,
		Email:           email,
		DisplayName:     displayName,
		Groups:          groups,
		CreatedBy:       "saml-jit",
	})
	if jitErr != nil {
		return "", errInternal
	}
	return u.ID, ""
}

// SAMLMetadataHandler returns GET /authserver/saml/metadata — the SP metadata
// (entityID + ACS URL) admins import into their IdP. It is IdP-independent:
// the SP identity derives solely from the auth-server issuer.
func SAMLMetadataHandler(d SAMLDeps) echo.HandlerFunc {
	return func(c echo.Context) error {
		base := strings.TrimRight(d.Issuer, "/")
		acsURL, err1 := url.Parse(base + samlACSPath)
		metaURL, err2 := url.Parse(base + samlMetadataPath)
		if err1 != nil || err2 != nil {
			return c.JSON(http.StatusInternalServerError, errorResponse{Error: errInternal})
		}
		sp := &saml.ServiceProvider{EntityID: metaURL.String(), AcsURL: *acsURL, MetadataURL: *metaURL}
		out, err := xml.MarshalIndent(sp.Metadata(), "", "  ")
		if err != nil {
			return c.JSON(http.StatusInternalServerError, errorResponse{Error: errInternal})
		}
		return c.Blob(http.StatusOK, "application/samlmetadata+xml", out)
	}
}

// samlNameID returns the assertion's NameID value (the external subject), or
// "" when the assertion carries no subject.
func samlNameID(a *saml.Assertion) string {
	if a == nil || a.Subject == nil || a.Subject.NameID == nil {
		return ""
	}
	return strings.TrimSpace(a.Subject.NameID.Value)
}

// samlAttrValues returns every non-empty value of the assertion attribute whose
// Name or FriendlyName matches name, across all attribute statements.
func samlAttrValues(a *saml.Assertion, name string) []string {
	if a == nil || name == "" {
		return nil
	}
	var out []string
	for _, stmt := range a.AttributeStatements {
		for _, attr := range stmt.Attributes {
			if attr.Name != name && attr.FriendlyName != name {
				continue
			}
			for _, v := range attr.Values {
				if s := strings.TrimSpace(v.Value); s != "" {
					out = append(out, s)
				}
			}
		}
	}
	return out
}

// samlFirstAttr returns the first value of the named attribute, or "".
func samlFirstAttr(a *saml.Assertion, name string) string {
	if vs := samlAttrValues(a, name); len(vs) > 0 {
		return vs[0]
	}
	return ""
}
