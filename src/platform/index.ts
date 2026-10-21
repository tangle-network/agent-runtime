/**
 * `@tangle-network/agent-runtime/platform` — typed server-side clients
 * for the Tangle platform's cross-site SSO bridge and integrations
 * hub. Apps consume these to avoid rolling their own OAuth, session,
 * and connection storage.
 *
 * See:
 *   - {@link PlatformAuthClient} for the cross-site "Login with Tangle" API-key exchange (the classic mode; OIDC is the newer one — both are live)
 *   - {@link PlatformOidcClient} for standard OIDC authorization code + PKCE and device grants
 *   - {@link PlatformHubClient} for the `/v1/hub/*` surface
 */

export type { AuthorizeUrlOptions, ExchangeCodeResult } from './auth'
export { PlatformAuthClient, type PlatformAuthClientOptions, PlatformAuthError } from './auth.js'
export type {
  CatalogResult,
  ConnectionHealthResult,
  ExecInput,
  MintTokenInput,
  PlatformCatalogProvider,
  PlatformHubStatus,
  StartAuthInput,
  StartAuthResult,
} from './integrations'
export {
  type ConnectionHealth,
  type HealthCheck,
  type MintTokenResult,
  type PlatformConnection,
  PlatformHubClient,
  type PlatformHubClientOptions,
  PlatformHubError,
} from './integrations.js'
export type {
  OidcAuthorizeUrlOptions,
  OidcDeviceAuthorization,
  OidcExchangeResult,
  OidcTokens,
  OidcUser,
  PlatformOidcClientOptions,
} from './oidc'
export { createPkcePair, PlatformOidcClient } from './oidc.js'
