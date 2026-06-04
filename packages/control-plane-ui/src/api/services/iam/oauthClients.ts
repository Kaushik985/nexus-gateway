/**
 * OAuth client admin service — manage the OAuthClient registrations that
 * authenticate to /oauth/token. Distinct from the per-user admin API key
 * surface above: this controls *which third-party application* may speak
 * OAuth to the platform, not which user issued an API key.
 *
 * Routes: /api/admin/oauth-clients/*, gated by the oauth-client:* IAM
 * verbs. The plaintext client secret is returned exactly once on create
 * (for confidential clients) and on every rotate-secret call — the UI is
 * responsible for showing it through a hard-gated modal so the admin
 * cannot accidentally lose it.
 */
import { api } from '../../client';

/**
 * Public OAuth client shape returned by every read endpoint.
 * `clientSecretHash` is NEVER in the response; the column exists at rest but
 * the handler omits it. `activeRefreshTokenCount` is embedded in `getOne`
 * only — list responses skip the per-row aggregate to keep them cheap.
 */
export interface OAuthClient {
  id: string;
  name: string;
  type: 'public' | 'confidential';
  redirectUris: string[];
  allowedScopes: string[];
  requirePkce: boolean;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  /** Stamp of the last successful secret rotation; null if never rotated. */
  lastSecretRotatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present only on getOne — used by the Activity card. */
  activeRefreshTokenCount?: number;
}

/**
 * Create response. For `confidential` clients the plaintext `clientSecret`
 * appears EXACTLY ONCE here. For `public` clients it is absent.
 */
export interface OAuthClientCreateResponse extends OAuthClient {
  clientSecret?: string;
}

/** Rotate response is structurally identical to create — secret returned once. */
export type OAuthClientRotateResponse = OAuthClientCreateResponse;

export interface CreateOAuthClientInput {
  id: string;
  name: string;
  type?: 'public' | 'confidential';
  redirectUris: string[];
  allowedScopes?: string[];
  requirePkce?: boolean;
  accessTtlSeconds?: number;
  refreshTtlSeconds?: number;
}

export interface UpdateOAuthClientInput {
  name?: string;
  redirectUris?: string[];
  allowedScopes?: string[];
  requirePkce?: boolean;
  accessTtlSeconds?: number;
  refreshTtlSeconds?: number;
}

export const oauthClientApi = {
  list: () =>
    api.get<{ data: OAuthClient[] }>('/api/admin/oauth-clients'),

  getOne: (id: string) =>
    api.get<{ data: OAuthClient }>(`/api/admin/oauth-clients/${id}`),

  create: (data: CreateOAuthClientInput) =>
    api.post<{ data: OAuthClientCreateResponse }>('/api/admin/oauth-clients', data),

  update: (id: string, data: UpdateOAuthClientInput) =>
    api.patch<{ data: OAuthClient }>(`/api/admin/oauth-clients/${id}`, data),

  /**
   * Rotate the client secret. Returns the new plaintext exactly once;
   * the caller MUST surface it through the SecretRevealModal so the
   * admin cannot lose it. Active refresh tokens are NOT revoked — the
   * caller is expected to warn about this in the confirm dialog.
   */
  rotateSecret: (id: string) =>
    api.post<{ data: OAuthClientRotateResponse }>(`/api/admin/oauth-clients/${id}/rotate-secret`, {}),

  remove: (id: string) =>
    api.delete(`/api/admin/oauth-clients/${id}`),
};
