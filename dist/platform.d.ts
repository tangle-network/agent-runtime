//#region src/platform/auth.d.ts
/**
 * Server-side client for the Tangle platform's cross-site SSO bridge.
 *
 * Consumer apps (gtm-agent, tax-agent, legal-agent, creative-agent, …)
 * use this to:
 *   1. Build an /authorize URL that lands the user on id.tangle.tools
 *      and brings them back with a single-use code.
 *   2. Exchange that code for an API key + the user's identity.
 *
 * The platform endpoint contract is documented in
 * `products/platform/api/src/routes/cross-site.ts`. This client only
 * speaks HTTP — no SDK weight, no transitive deps.
 */
interface PlatformAuthClientOptions {
  /** Platform base URL, e.g. `https://id.tangle.tools`. */
  baseUrl: string;
  /** App id as registered in the platform's TRUSTED_APPS registry. */
  appId: string;
  /** Override the global fetch (useful for tests + edge runtimes). */
  fetchImpl?: typeof fetch;
}
interface AuthorizeUrlOptions {
  /** Required CSRF token; the consumer verifies it on the callback. */
  state: string;
  /**
   * Final redirect URI. Must be one of the URIs registered for `appId`
   * on the platform. Omit to use the first registered URI.
   */
  redirectUri?: string;
  /** Force the login screen even if a session is already active. */
  prompt?: 'login';
  /** Pre-fill the email field on the login screen. */
  email?: string;
}
interface ExchangeCodeResult {
  apiKey: string;
  emailVerified: true;
  user: {
    id: string;
    email: string;
    name?: string | null;
  };
  /** Null when the platform could not provide a subscription. This is not a paid-access grant. */
  plan: {
    tier: string;
  } | null;
}
/** Thrown when a `PlatformAuthClient` request returns a non-success status. */
declare class PlatformAuthError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown);
}
/** HTTP client for the Tangle Platform SSO: builds authorize URLs and exchanges auth codes for API keys. */
declare class PlatformAuthClient {
  private readonly baseUrl;
  private readonly appId;
  private readonly fetchImpl;
  constructor(options: PlatformAuthClientOptions);
  /**
   * Build the URL the user is redirected to in order to start SSO.
   * The platform redirects back to one of `appId`'s registered
   * `redirectUris` with `?code=...&app=...&state=...`.
   */
  authorizeUrl(options: AuthorizeUrlOptions): string;
  /**
   * Exchange a single-use auth code (delivered to the consumer's
   * callback by the platform) for an API key + the user's identity.
   * Codes are single-use and expire ~5 minutes after issue.
   */
  exchange(code: string): Promise<ExchangeCodeResult>;
}
//#endregion
//#region src/platform/integrations.d.ts
/**
 * Server-side client for the Tangle platform's integration hub
 * (`/v1/hub/*`). Consumer apps use this instead of rolling their own
 * OAuth + connection tables.
 *
 * Auth: the caller supplies a bearer (either the user's API key from
 * cross-site exchange, or a platform service token) on construction.
 *
 * Endpoint contract (authoritative): the platform's `src/lib/hub-contract.ts`
 * + `src/routes/hub.ts`. The platform wraps every response in
 * `{ success, data }`; non-2xx or `success:false` surfaces as `PlatformHubError`
 * carrying the real upstream status.
 */
interface PlatformHubClientOptions {
  /** Platform base URL, e.g. `https://id.tangle.tools`. */
  baseUrl: string;
  /** Bearer credential — user API key or service token. */
  bearer: string;
  /** Override fetch (tests + edge runtimes). */
  fetchImpl?: typeof fetch;
}
/** A live integration connection, as returned by `/v1/hub/connections`. */
interface PlatformConnection {
  id: string;
  providerId: string;
  displayName: string;
  accountDisplay: string | null;
  scopes: string[];
  status: 'active' | 'revoked' | 'unhealthy' | 'reconnect_required' | (string & {});
  health: 'unknown' | 'healthy' | 'unhealthy' | 'rate_limited' | (string & {});
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}
/** A connectable provider in the catalog (`/v1/hub/providers`). */
interface PlatformCatalogProvider {
  providerId: string;
  title?: string;
  authKind?: string;
  category?: string;
  scopes?: string[];
  capabilityCount?: number;
  native?: boolean;
  /** Whether the OAuth app's credentials are wired — the UI offers Connect
   *  only when true. */
  configured?: boolean;
  [k: string]: unknown;
}
interface CatalogResult {
  providers: PlatformCatalogProvider[];
  /** Count of substrate-bundled connectors behind the catalog. */
  substrateBundled?: number;
  [k: string]: unknown;
}
interface StartAuthInput {
  /** The provider to connect (goes in the URL path). */
  providerId: string;
  /** Accepted for interface compatibility; the platform's start endpoint is
   *  provider-level and does not consume a connector id. */
  connectorId?: string;
  /** Where the platform redirects the user back to after OAuth. */
  returnUrl: string;
  /** Accepted for interface compatibility; not consumed by the start endpoint. */
  requestedScopes?: string[];
  /** CLI flow flag — affects the platform's post-auth redirect handling. */
  cli?: boolean;
}
interface StartAuthResult {
  /** The URL to send the user to. Normalized across the platform's two start
   *  branches: github returns `authorizationUrl`, substrate returns
   *  `redirectUrl`. */
  authorizationUrl: string;
  state: string;
  expiresAt?: string;
  scopes?: string[];
}
interface ConnectionHealth {
  status: 'unknown' | 'healthy' | 'unhealthy' | 'rate_limited' | (string & {});
  checkedAt: string;
  error?: {
    code: string;
    message: string;
  };
}
interface ConnectionHealthResult {
  connection: PlatformConnection;
  health: ConnectionHealth;
}
/** Last-known health for a connection, derived from the connection row. */
interface HealthCheck {
  connectionId: string;
  providerId: string;
  /** Mirrors `PlatformConnection.health`. */
  status: ConnectionHealth['status'];
  checkedAt?: string;
}
interface MintTokenInput {
  /** The hub action the token authorizes (e.g. `slack.chat.postMessage`). */
  actionPath: string;
  /** Bind to a specific connection, or … */
  connectionId?: string;
  /** … resolve the connection by provider for the calling user. */
  provider?: string;
}
interface MintTokenResult {
  tokenId: string;
  token: string;
  expiresAt: string;
}
interface ExecInput {
  /** The hub action path to execute. */
  path: string;
  input?: unknown;
  connectionId?: string;
}
interface PlatformHubStatus {
  contract?: unknown;
  principal: {
    kind: string;
    userId: string;
    [k: string]: unknown;
  };
  connections: {
    connectedProviderCount: number;
    unhealthyProviderCount: number;
  };
}
/** Thrown when a `PlatformHubClient` request returns a non-success status. */
declare class PlatformHubError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly body: unknown;
  constructor(message: string, status: number, code: string | undefined, body: unknown);
}
/** HTTP client for the Tangle Platform Hub API: provider catalog, connection flow, and status. */
declare class PlatformHubClient {
  private readonly baseUrl;
  private readonly bearer;
  private readonly fetchImpl;
  constructor(options: PlatformHubClientOptions);
  /** GET /v1/hub/providers — the connectable provider catalog. */
  catalog(): Promise<CatalogResult>;
  /** GET /v1/hub/connections — the calling user's live connections. */
  listConnections(): Promise<PlatformConnection[]>;
  /** DELETE /v1/hub/connections/:connectionId — revoke + disable a connection. */
  revokeConnection(connectionId: string): Promise<{
    connection: PlatformConnection;
  }>;
  /**
   * POST /v1/hub/connections/:provider/start — begin OAuth/grant. The provider
   * is taken from the URL; the body carries `returnUrl` (+ `cli`). The platform's
   * two start branches name the URL field differently (github → `authorizationUrl`,
   * substrate → `redirectUrl`); this normalizes to `authorizationUrl`.
   */
  startAuth(input: StartAuthInput): Promise<StartAuthResult>;
  /**
   * Last-known health for every connection. The platform has no global
   * healthcheck listing — health rides on each connection row — so this derives
   * the list from `listConnections()` (one request, no extra round-trips).
   */
  listHealthchecks(): Promise<HealthCheck[]>;
  /**
   * POST /v1/hub/connections/:connectionId/health — trigger a fresh health
   * probe for one connection and return its updated state.
   */
  checkConnectionHealth(connectionId: string): Promise<ConnectionHealthResult>;
  /**
   * Trigger a fresh health probe across all of the user's connections. The
   * platform exposes health per-connection only, so this fans out over
   * `listConnections()`. `scheduled` is the number of probes dispatched.
   */
  runHealthchecks(): Promise<{
    scheduled: number;
  }>;
  /** GET /v1/hub/status — principal + aggregate connection counts. */
  status(): Promise<PlatformHubStatus>;
  /**
   * POST /v1/hub/tokens — mint a short-lived, action-scoped capability token a
   * sandbox can use to invoke one hub action on the user's behalf without
   * seeing the underlying provider credential.
   */
  mintToken(input: MintTokenInput): Promise<MintTokenResult>;
  /** POST /v1/hub/exec — execute a hub action and return its result. */
  exec(input: ExecInput): Promise<unknown>;
  private request;
}
//#endregion
//#region src/platform/oidc.d.ts
/**
 * Server-side OpenID Connect client for the Tangle authorization server
 * (Better Auth `oauthProvider`, mounted at `/api/auth/oauth2/*`).
 *
 * This is the standard authorization-code + S256 PKCE path. It returns OIDC
 * tokens and a verified identity, not the `sk-tan` API key that
 * {@link PlatformAuthClient} returns. Identity scopes do not authorize paid
 * platform calls, so a consumer that uses the legacy API key as its Hub
 * bearer must keep {@link PlatformAuthClient} until it no longer needs one.
 *
 * The client id and redirect URI must be registered in the platform's
 * `oauthClient` registry. The legacy `TRUSTED_APPS` registration does not
 * carry over.
 */
interface PlatformOidcClientOptions {
  /** Platform base URL, e.g. `https://id.tangle.tools`. */
  baseUrl: string;
  /** Client id from the platform `oauthClient` registry. */
  clientId: string;
  /**
   * Client secret for a confidential client. Sent with HTTP Basic, the
   * provider's default `client_secret_basic` method. Omit for a public client
   * registered with `token_endpoint_auth_method: none`.
   */
  clientSecret?: string;
  /** Registered callback URI. */
  redirectUri: string;
  /** Requested scopes. Defaults to `openid profile email offline_access`. */
  scope?: string;
  /** Override the global fetch (useful for tests + edge runtimes). */
  fetchImpl?: typeof fetch;
}
interface OidcAuthorizeUrlOptions {
  /** Required CSRF token; the consumer verifies it on the callback. */
  state: string;
  /** RFC 7636 S256 code challenge. See {@link createPkcePair}. */
  codeChallenge: string;
  /** OIDC nonce; the consumer checks it against the ID token. */
  nonce?: string;
  prompt?: 'login' | 'consent' | 'none';
  /** Pre-fill the email field on the login screen. */
  loginHint?: string;
}
interface OidcTokens {
  accessToken: string;
  tokenType: string;
  expiresIn?: number;
  refreshToken?: string;
  idToken?: string;
  scope?: string;
}
interface OidcUser {
  id: string;
  email: string;
  emailVerified: true;
  name?: string;
}
interface OidcExchangeResult {
  tokens: OidcTokens;
  user: OidcUser;
}
/** Create an RFC 7636 verifier and its S256 challenge with Web Crypto. */
declare function createPkcePair(): Promise<{
  verifier: string;
  challenge: string;
}>;
/** Standard OIDC authorization-code + PKCE client for "Sign in with Tangle". */
declare class PlatformOidcClient {
  private readonly baseUrl;
  private readonly clientId;
  private readonly clientSecret;
  private readonly redirectUri;
  private readonly scope;
  private readonly fetchImpl;
  constructor(options: PlatformOidcClientOptions);
  /** Build the `/api/auth/oauth2/authorize` URL for a browser redirect. */
  authorizeUrl(options: OidcAuthorizeUrlOptions): string;
  /** Exchange the callback code, then resolve the verified identity from userinfo. */
  exchange(code: string, codeVerifier: string): Promise<OidcExchangeResult>;
  /** Redeem a refresh token. Store the returned refresh token; the provider rotates it. */
  refresh(refreshToken: string): Promise<OidcTokens>;
  /** Read the verified identity behind an access token. */
  userinfo(accessToken: string): Promise<OidcUser>;
  /** Revoke an access or refresh token (RFC 7009). Disconnect revokes the refresh token. */
  revoke(token: string, tokenTypeHint?: 'access_token' | 'refresh_token'): Promise<void>;
  private token;
  private post;
}
//#endregion
export { type AuthorizeUrlOptions, type CatalogResult, type ConnectionHealth, type ConnectionHealthResult, type ExchangeCodeResult, type ExecInput, type HealthCheck, type MintTokenInput, type MintTokenResult, type OidcAuthorizeUrlOptions, type OidcExchangeResult, type OidcTokens, type OidcUser, PlatformAuthClient, type PlatformAuthClientOptions, PlatformAuthError, type PlatformCatalogProvider, type PlatformConnection, PlatformHubClient, type PlatformHubClientOptions, PlatformHubError, type PlatformHubStatus, PlatformOidcClient, type PlatformOidcClientOptions, type StartAuthInput, type StartAuthResult, createPkcePair };
//# sourceMappingURL=platform.d.ts.map