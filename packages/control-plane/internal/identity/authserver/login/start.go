package login

import (
	"net/http"
	"net/url"

	"github.com/crewjam/saml"
	"github.com/labstack/echo/v4"

	"github.com/AlphaBitCore/nexus-gateway/packages/control-plane/internal/identity/authserver/store"
)

// loginPagePath is the SPA-hosted login picker. Every non-happy-path outcome of
// the SSO-start endpoint 302s here rather than returning JSON: the login UI
// (method picker + local password form) lives entirely in the front end, so a
// browser that navigated to start must always land back on that page, never on
// a raw server error body. The picker re-fetches the enabled IdP list on load,
// so a provider that was disabled or deleted between picker render and click
// simply disappears from the list on the bounce — no error loop.
const loginPagePath = "/login"

// StartDeps carries the collaborators the unified SSO-start endpoint needs. It
// is intentionally the minimal initiation surface: resolving the IdP (IdPs),
// validating + stamping the pending authorize handle (Pending), and — for SAML
// — recording the outstanding AuthnRequest ID (Requests) plus the issuer the SP
// identity derives from. The Federated / AuthCode collaborators are absent on
// purpose: those come into play only on the return leg (OIDC callback / SAML
// ACS), after the external IdP has authenticated the user.
type StartDeps struct {
	IdPs     *store.IdPStore
	Pending  *store.PendingAuthzStore
	Requests *store.SAMLRequestStore
	Issuer   string
}

// StartHandler returns GET /authserver/idp/:idpId/start?authctx=<authctx>. It is
// the single browser entry point the SPA login picker navigates to for every
// external IdP, regardless of protocol — the SPA stays protocol-agnostic and
// this handler owns the OIDC-vs-SAML divergence:
//
//   - oidc → 302 redirect to the IdP's authorization endpoint.
//   - saml → 200 with an auto-submitting HTML POST form that delivers the
//     AuthnRequest to the IdP (HTTP-POST binding).
//   - local / unknown → bounce to the login page: the built-in local store
//     authenticates through the SPA's password form (POST /authserver/password),
//     never through SSO start.
//
// The browser reaches start as a full-page navigation (window.location), so
// every branch emits a browser-navigable response (a redirect or an HTML page),
// never JSON. The return leg lands on /authserver/oidc/callback (OIDC) or
// /authserver/saml/acs (SAML).
func StartHandler(d StartDeps) echo.HandlerFunc {
	return func(c echo.Context) error {
		ctx := c.Request().Context()
		authctx := c.QueryParam("authctx")
		if authctx == "" || !d.Pending.Has(authctx) {
			// No live authorize handle: send the browser to the login page with
			// no handle so the SPA re-bootstraps the OAuth dance from scratch.
			return c.Redirect(http.StatusFound, loginPagePath)
		}

		idp, err := d.IdPs.GetByID(ctx, c.Param("idpId"))
		if err != nil || !idp.Enabled {
			// Missing or disabled IdP: a disabled IdP must not start a login
			// (parity with the callback / ACS Enabled guards). The handle is
			// still live, so keep it on the bounce — the reloaded picker drops
			// the stale provider and the user can pick another.
			return bounceToLogin(c, authctx)
		}

		switch idp.Type {
		case "oidc":
			return startOIDC(c, d, idp, authctx)
		case "saml":
			return startSAML(c, d, idp, authctx)
		default:
			// "local" and any unknown type are not SSO-startable.
			return bounceToLogin(c, authctx)
		}
	}
}

// bounceToLogin 302s the browser back to the SPA login picker, preserving the
// still-live authctx so the picker reloads against the same authorize handle.
func bounceToLogin(c echo.Context, authctx string) error {
	u := url.URL{Path: loginPagePath, RawQuery: url.Values{"authctx": {authctx}}.Encode()}
	return c.Redirect(http.StatusFound, u.String())
}

// startOIDC builds the IdP authorization URL, stamps the chosen IdP id onto the
// pending authorize entry so the callback loads the same config, and 302s the
// browser to the IdP. state carries the authctx back on the callback.
func startOIDC(c echo.Context, d StartDeps, idp *store.IdentityProvider, authctx string) error {
	cfg := store.DecodeOIDCConfig(idp)
	if cfg == nil || cfg.AuthorizeURL == "" || cfg.ClientID == "" {
		return bounceToLogin(c, authctx)
	}
	if !d.Pending.SetIdPID(authctx, idp.ID) {
		return c.Redirect(http.StatusFound, loginPagePath)
	}
	u, err := url.Parse(cfg.AuthorizeURL)
	if err != nil {
		return bounceToLogin(c, authctx)
	}
	q := u.Query()
	q.Set("response_type", "code")
	q.Set("client_id", cfg.ClientID)
	q.Set("redirect_uri", cfg.RedirectURI)
	q.Set("scope", "openid profile email")
	q.Set("state", authctx)
	u.RawQuery = q.Encode()
	return c.Redirect(http.StatusFound, u.String())
}

// startSAML builds an SP-initiated AuthnRequest, records its ID against the
// authctx for InResponseTo validation on the ACS, stamps the IdP id onto the
// pending entry, and renders an auto-submitting POST form (HTTP-POST binding)
// that delivers the AuthnRequest to the IdP with RelayState=<authctx>.
func startSAML(c echo.Context, d StartDeps, idp *store.IdentityProvider, authctx string) error {
	cfg := store.DecodeSAMLConfig(idp)
	sp, err := buildSAMLServiceProvider(cfg, d.Issuer)
	if err != nil {
		return bounceToLogin(c, authctx)
	}
	req, err := sp.MakeAuthenticationRequest(cfg.SSOURL, saml.HTTPPostBinding, saml.HTTPPostBinding)
	if err != nil {
		return bounceToLogin(c, authctx)
	}
	if !d.Pending.SetIdPID(authctx, idp.ID) {
		return c.Redirect(http.StatusFound, loginPagePath)
	}
	d.Requests.Put(authctx, req.ID)
	return c.HTMLBlob(http.StatusOK, req.Post(authctx))
}
