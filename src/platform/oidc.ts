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

import { PlatformAuthError } from './auth.js'

export interface PlatformOidcClientOptions {
  /** Platform base URL, e.g. `https://id.tangle.tools`. */
  baseUrl: string
  /** Client id from the platform `oauthClient` registry. */
  clientId: string
  /**
   * Client secret for a confidential client. Sent with HTTP Basic, the
   * provider's default `client_secret_basic` method. Omit for a public client
   * registered with `token_endpoint_auth_method: none`.
   */
  clientSecret?: string
  /** Registered callback URI. */
  redirectUri: string
  /** Requested scopes. Defaults to `openid profile email offline_access`. */
  scope?: string
  /** Override the global fetch (useful for tests + edge runtimes). */
  fetchImpl?: typeof fetch
}

export interface OidcAuthorizeUrlOptions {
  /** Required CSRF token; the consumer verifies it on the callback. */
  state: string
  /** RFC 7636 S256 code challenge. See {@link createPkcePair}. */
  codeChallenge: string
  /** OIDC nonce; the consumer checks it against the ID token. */
  nonce?: string
  prompt?: 'login' | 'consent' | 'none'
  /** Pre-fill the email field on the login screen. */
  loginHint?: string
}

export interface OidcTokens {
  accessToken: string
  tokenType: string
  expiresIn?: number
  refreshToken?: string
  idToken?: string
  scope?: string
}

export interface OidcUser {
  id: string
  email: string
  emailVerified: true
  name?: string
}

export interface OidcExchangeResult {
  tokens: OidcTokens
  user: OidcUser
}

const DEFAULT_SCOPE = 'openid profile email offline_access'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Create an RFC 7636 verifier and its S256 challenge with Web Crypto. */
export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(new Uint8Array(digest)) }
}

function oauthError(body: unknown, fallback: string): string {
  if (!isRecord(body)) return fallback
  if (isNonemptyString(body.error_description)) return body.error_description
  if (isNonemptyString(body.error)) return body.error
  return fallback
}

function parseTokens(body: unknown, status: number): OidcTokens {
  if (!isRecord(body) || !isNonemptyString(body.access_token)) {
    // A malformed success response may still hold a secret; never echo it.
    throw new PlatformAuthError('Platform token response is malformed', status, {
      code: 'INVALID_TOKEN_RESPONSE',
    })
  }
  return {
    accessToken: body.access_token,
    tokenType: isNonemptyString(body.token_type) ? body.token_type : 'Bearer',
    ...(typeof body.expires_in === 'number' ? { expiresIn: body.expires_in } : {}),
    ...(isNonemptyString(body.refresh_token) ? { refreshToken: body.refresh_token } : {}),
    ...(isNonemptyString(body.id_token) ? { idToken: body.id_token } : {}),
    ...(isNonemptyString(body.scope) ? { scope: body.scope } : {}),
  }
}

/** Standard OIDC authorization-code + PKCE client for "Sign in with Tangle". */
export class PlatformOidcClient {
  private readonly baseUrl: string
  private readonly clientId: string
  private readonly clientSecret: string | undefined
  private readonly redirectUri: string
  private readonly scope: string
  private readonly fetchImpl: typeof fetch

  constructor(options: PlatformOidcClientOptions) {
    if (!options.baseUrl) throw new Error('PlatformOidcClient: baseUrl is required')
    if (!options.clientId) throw new Error('PlatformOidcClient: clientId is required')
    if (!options.redirectUri) throw new Error('PlatformOidcClient: redirectUri is required')
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.clientId = options.clientId
    this.clientSecret = options.clientSecret || undefined
    this.redirectUri = options.redirectUri
    this.scope = options.scope ?? DEFAULT_SCOPE
    // Arrow wrapper: an unbound global fetch throws "Illegal invocation" on Workers.
    this.fetchImpl =
      options.fetchImpl ??
      ((url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetch(url, init))
  }

  /** Build the `/api/auth/oauth2/authorize` URL for a browser redirect. */
  authorizeUrl(options: OidcAuthorizeUrlOptions): string {
    if (!options.state)
      throw new Error('PlatformOidcClient.authorizeUrl: state is required for CSRF')
    if (!options.codeChallenge) {
      throw new Error('PlatformOidcClient.authorizeUrl: codeChallenge is required for PKCE')
    }
    const url = new URL('/api/auth/oauth2/authorize', this.baseUrl)
    url.searchParams.set('client_id', this.clientId)
    url.searchParams.set('redirect_uri', this.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', this.scope)
    url.searchParams.set('state', options.state)
    url.searchParams.set('code_challenge', options.codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
    if (options.nonce) url.searchParams.set('nonce', options.nonce)
    if (options.prompt) url.searchParams.set('prompt', options.prompt)
    if (options.loginHint) url.searchParams.set('login_hint', options.loginHint)
    return url.toString()
  }

  /** Exchange the callback code, then resolve the verified identity from userinfo. */
  async exchange(code: string, codeVerifier: string): Promise<OidcExchangeResult> {
    if (!code) throw new Error('PlatformOidcClient.exchange: code is required')
    if (!codeVerifier)
      throw new Error('PlatformOidcClient.exchange: codeVerifier is required for PKCE')
    const tokens = await this.token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      code_verifier: codeVerifier,
    })
    return { tokens, user: await this.userinfo(tokens.accessToken) }
  }

  /** Redeem a refresh token. Store the returned refresh token; the provider rotates it. */
  async refresh(refreshToken: string): Promise<OidcTokens> {
    if (!refreshToken) throw new Error('PlatformOidcClient.refresh: refreshToken is required')
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken })
  }

  /** Read the verified identity behind an access token. */
  async userinfo(accessToken: string): Promise<OidcUser> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/auth/oauth2/userinfo`, {
      headers: { authorization: `Bearer ${accessToken}` },
    })
    const body: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      throw new PlatformAuthError(
        oauthError(body, `Platform userinfo failed (${res.status})`),
        res.status,
        body,
      )
    }
    if (
      !isRecord(body) ||
      !isNonemptyString(body.sub) ||
      !isNonemptyString(body.email) ||
      body.email_verified !== true
    ) {
      throw new PlatformAuthError('Platform userinfo has no verified identity', res.status, {
        code: 'INVALID_USERINFO_RESPONSE',
      })
    }
    return {
      id: body.sub,
      email: body.email,
      emailVerified: true,
      ...(isNonemptyString(body.name) ? { name: body.name } : {}),
    }
  }

  /** Revoke an access or refresh token (RFC 7009). Disconnect revokes the refresh token. */
  async revoke(token: string, tokenTypeHint?: 'access_token' | 'refresh_token'): Promise<void> {
    if (!token) throw new Error('PlatformOidcClient.revoke: token is required')
    const res = await this.post('/api/auth/oauth2/revoke', {
      token,
      ...(tokenTypeHint ? { token_type_hint: tokenTypeHint } : {}),
    })
    if (!res.ok) {
      const body: unknown = await res.json().catch(() => null)
      throw new PlatformAuthError(
        oauthError(body, `Platform revoke failed (${res.status})`),
        res.status,
        body,
      )
    }
  }

  private async token(params: Record<string, string>): Promise<OidcTokens> {
    const res = await this.post('/api/auth/oauth2/token', params)
    const body: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      throw new PlatformAuthError(
        oauthError(body, `Platform token request failed (${res.status})`),
        res.status,
        body,
      )
    }
    return parseTokens(body, res.status)
  }

  private post(path: string, params: Record<string, string>): Promise<Response> {
    const body = new URLSearchParams(params)
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' }
    if (this.clientSecret) {
      headers.authorization = `Basic ${btoa(`${this.clientId}:${this.clientSecret}`)}`
    } else {
      body.set('client_id', this.clientId)
    }
    return this.fetchImpl(`${this.baseUrl}${path}`, { method: 'POST', headers, body })
  }
}
