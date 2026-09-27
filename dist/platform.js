//#region src/platform/auth.ts
/** Thrown when a `PlatformAuthClient` request returns a non-success status. */
var PlatformAuthError = class extends Error {
	status;
	body;
	constructor(message, status, body) {
		super(message);
		this.status = status;
		this.body = body;
		this.name = "PlatformAuthError";
	}
};
function isRecord$1(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isNonemptyString$1(value) {
	return typeof value === "string" && value.trim().length > 0;
}
/** Validate the platform's verified identity before consumers create a local session. */
function parseExchangeResult(body, status) {
	const invalid = () => {
		throw new PlatformAuthError("Platform exchange response has no valid verified identity", status, { code: "INVALID_EXCHANGE_RESPONSE" });
	};
	if (!isRecord$1(body) || !isNonemptyString$1(body.apiKey) || body.emailVerified !== true || !isRecord$1(body.user)) return invalid();
	const user = body.user;
	if (!isNonemptyString$1(user.id) || !isNonemptyString$1(user.email)) return invalid();
	const email = user.email.trim();
	if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /(?:@users\.noreply\.tangle\.tools$|^0x[a-f0-9]{40}@tangle\.tools$)/i.test(email)) return invalid();
	if (user.name !== void 0 && user.name !== null && typeof user.name !== "string") return invalid();
	let plan = null;
	if (body.subscription !== void 0) {
		if (!isRecord$1(body.subscription) || !isNonemptyString$1(body.subscription.plan)) return invalid();
		plan = { tier: body.subscription.plan };
	}
	return {
		apiKey: body.apiKey,
		emailVerified: true,
		user: {
			id: user.id,
			email,
			...user.name !== void 0 ? { name: user.name } : {}
		},
		plan
	};
}
/** HTTP client for the Tangle Platform SSO: builds authorize URLs and exchanges auth codes for API keys. */
var PlatformAuthClient = class {
	baseUrl;
	appId;
	fetchImpl;
	constructor(options) {
		if (!options.baseUrl) throw new Error("PlatformAuthClient: baseUrl is required");
		if (!options.appId) throw new Error("PlatformAuthClient: appId is required");
		this.baseUrl = options.baseUrl.replace(/\/+$/, "");
		this.appId = options.appId;
		this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
	}
	/**
	* Build the URL the user is redirected to in order to start SSO.
	* The platform redirects back to one of `appId`'s registered
	* `redirectUris` with `?code=...&app=...&state=...`.
	*/
	authorizeUrl(options) {
		if (!options.state) throw new Error("PlatformAuthClient.authorizeUrl: state is required for CSRF");
		const url = new URL("/cross-site/authorize", this.baseUrl);
		url.searchParams.set("app", this.appId);
		url.searchParams.set("state", options.state);
		if (options.redirectUri) url.searchParams.set("redirect", options.redirectUri);
		if (options.prompt) url.searchParams.set("prompt", options.prompt);
		if (options.email) url.searchParams.set("email", options.email);
		return url.toString();
	}
	/**
	* Exchange a single-use auth code (delivered to the consumer's
	* callback by the platform) for an API key + the user's identity.
	* Codes are single-use and expire ~5 minutes after issue.
	*/
	async exchange(code) {
		if (!code) throw new Error("PlatformAuthClient.exchange: code is required");
		const res = await this.fetchImpl(`${this.baseUrl}/cross-site/exchange`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				code,
				app: this.appId
			})
		});
		const body = await res.json().catch(() => null);
		if (!res.ok) throw new PlatformAuthError(body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : `Platform exchange failed (${res.status})`, res.status, body);
		return parseExchangeResult(body, res.status);
	}
};
//#endregion
//#region src/platform/integrations.ts
/** Thrown when a `PlatformHubClient` request returns a non-success status. */
var PlatformHubError = class extends Error {
	status;
	code;
	body;
	constructor(message, status, code, body) {
		super(message);
		this.status = status;
		this.code = code;
		this.body = body;
		this.name = "PlatformHubError";
	}
};
/** HTTP client for the Tangle Platform Hub API: provider catalog, connection flow, and status. */
var PlatformHubClient = class {
	baseUrl;
	bearer;
	fetchImpl;
	constructor(options) {
		if (!options.baseUrl) throw new Error("PlatformHubClient: baseUrl is required");
		if (!options.bearer) throw new Error("PlatformHubClient: bearer is required");
		this.baseUrl = options.baseUrl.replace(/\/+$/, "");
		this.bearer = options.bearer;
		this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
	}
	/** GET /v1/hub/providers — the connectable provider catalog. */
	catalog() {
		return this.request("GET", "/v1/hub/providers");
	}
	/** GET /v1/hub/connections — the calling user's live connections. */
	async listConnections() {
		return (await this.request("GET", "/v1/hub/connections")).connections;
	}
	/** DELETE /v1/hub/connections/:connectionId — revoke + disable a connection. */
	revokeConnection(connectionId) {
		return this.request("DELETE", `/v1/hub/connections/${encodeURIComponent(connectionId)}`);
	}
	/**
	* POST /v1/hub/connections/:provider/start — begin OAuth/grant. The provider
	* is taken from the URL; the body carries `returnUrl` (+ `cli`). The platform's
	* two start branches name the URL field differently (github → `authorizationUrl`,
	* substrate → `redirectUrl`); this normalizes to `authorizationUrl`.
	*/
	async startAuth(input) {
		const body = { returnUrl: input.returnUrl };
		if (input.cli !== void 0) body.cli = input.cli;
		const data = await this.request("POST", `/v1/hub/connections/${encodeURIComponent(input.providerId)}/start`, body);
		const authorizationUrl = data.authorizationUrl ?? data.redirectUrl;
		if (!authorizationUrl) throw new PlatformHubError("Platform hub start response missing an authorization URL", 502, "HUB_INVALID_START_RESPONSE", data);
		return {
			authorizationUrl,
			state: data.state,
			expiresAt: data.expiresAt,
			scopes: data.scopes
		};
	}
	/**
	* Last-known health for every connection. The platform has no global
	* healthcheck listing — health rides on each connection row — so this derives
	* the list from `listConnections()` (one request, no extra round-trips).
	*/
	async listHealthchecks() {
		return (await this.listConnections()).map((c) => ({
			connectionId: c.id,
			providerId: c.providerId,
			status: c.health,
			checkedAt: c.updatedAt
		}));
	}
	/**
	* POST /v1/hub/connections/:connectionId/health — trigger a fresh health
	* probe for one connection and return its updated state.
	*/
	checkConnectionHealth(connectionId) {
		return this.request("POST", `/v1/hub/connections/${encodeURIComponent(connectionId)}/health`);
	}
	/**
	* Trigger a fresh health probe across all of the user's connections. The
	* platform exposes health per-connection only, so this fans out over
	* `listConnections()`. `scheduled` is the number of probes dispatched.
	*/
	async runHealthchecks() {
		const connections = await this.listConnections();
		await Promise.allSettled(connections.map((c) => this.checkConnectionHealth(c.id)));
		return { scheduled: connections.length };
	}
	/** GET /v1/hub/status — principal + aggregate connection counts. */
	status() {
		return this.request("GET", "/v1/hub/status");
	}
	/**
	* POST /v1/hub/tokens — mint a short-lived, action-scoped capability token a
	* sandbox can use to invoke one hub action on the user's behalf without
	* seeing the underlying provider credential.
	*/
	mintToken(input) {
		return this.request("POST", "/v1/hub/tokens", input);
	}
	/** POST /v1/hub/exec — execute a hub action and return its result. */
	async exec(input) {
		return (await this.request("POST", "/v1/hub/exec", input)).result;
	}
	async request(method, path, body) {
		const headers = {
			authorization: `Bearer ${this.bearer}`,
			accept: "application/json"
		};
		if (body !== void 0) headers["content-type"] = "application/json";
		const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
			method,
			headers,
			body: body !== void 0 ? JSON.stringify(body) : void 0
		});
		const text = await res.text();
		let parsed = null;
		if (text) try {
			parsed = JSON.parse(text);
		} catch {}
		if (!res.ok || parsed && parsed.success === false) {
			const code = parsed?.error && typeof parsed.error === "object" ? parsed.error.code : void 0;
			throw new PlatformHubError(parsed?.error && typeof parsed.error === "object" && parsed.error.message || (typeof parsed?.error === "string" ? parsed.error : `Platform hub error (${res.status})`), res.status, code, parsed ?? text);
		}
		if (!parsed) throw new PlatformHubError(`Platform hub returned non-JSON success (${res.status})`, res.status, void 0, text);
		if (parsed.data === void 0) throw new PlatformHubError("Platform hub envelope missing `data`", res.status, void 0, parsed);
		return parsed.data;
	}
};
//#endregion
//#region src/platform/oidc.ts
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
const DEFAULT_SCOPE = "openid profile email offline_access";
function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isNonemptyString(value) {
	return typeof value === "string" && value.trim().length > 0;
}
function base64url(bytes) {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/** Create an RFC 7636 verifier and its S256 challenge with Web Crypto. */
async function createPkcePair() {
	const verifier = base64url(crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(32)));
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	return {
		verifier,
		challenge: base64url(new Uint8Array(digest))
	};
}
function oauthError(body, fallback) {
	if (!isRecord(body)) return fallback;
	if (isNonemptyString(body.error_description)) return body.error_description;
	if (isNonemptyString(body.error)) return body.error;
	return fallback;
}
function parseTokens(body, status) {
	if (!isRecord(body) || !isNonemptyString(body.access_token)) throw new PlatformAuthError("Platform token response is malformed", status, { code: "INVALID_TOKEN_RESPONSE" });
	return {
		accessToken: body.access_token,
		tokenType: isNonemptyString(body.token_type) ? body.token_type : "Bearer",
		...typeof body.expires_in === "number" ? { expiresIn: body.expires_in } : {},
		...isNonemptyString(body.refresh_token) ? { refreshToken: body.refresh_token } : {},
		...isNonemptyString(body.id_token) ? { idToken: body.id_token } : {},
		...isNonemptyString(body.scope) ? { scope: body.scope } : {}
	};
}
/** Standard OIDC authorization-code + PKCE client for "Sign in with Tangle". */
var PlatformOidcClient = class {
	baseUrl;
	clientId;
	clientSecret;
	redirectUri;
	scope;
	fetchImpl;
	constructor(options) {
		if (!options.baseUrl) throw new Error("PlatformOidcClient: baseUrl is required");
		if (!options.clientId) throw new Error("PlatformOidcClient: clientId is required");
		if (!options.redirectUri) throw new Error("PlatformOidcClient: redirectUri is required");
		this.baseUrl = options.baseUrl.replace(/\/+$/, "");
		this.clientId = options.clientId;
		this.clientSecret = options.clientSecret || void 0;
		this.redirectUri = options.redirectUri;
		this.scope = options.scope ?? DEFAULT_SCOPE;
		this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
	}
	/** Build the `/api/auth/oauth2/authorize` URL for a browser redirect. */
	authorizeUrl(options) {
		if (!options.state) throw new Error("PlatformOidcClient.authorizeUrl: state is required for CSRF");
		if (!options.codeChallenge) throw new Error("PlatformOidcClient.authorizeUrl: codeChallenge is required for PKCE");
		const url = new URL("/api/auth/oauth2/authorize", this.baseUrl);
		url.searchParams.set("client_id", this.clientId);
		url.searchParams.set("redirect_uri", this.redirectUri);
		url.searchParams.set("response_type", "code");
		url.searchParams.set("scope", this.scope);
		url.searchParams.set("state", options.state);
		url.searchParams.set("code_challenge", options.codeChallenge);
		url.searchParams.set("code_challenge_method", "S256");
		if (options.nonce) url.searchParams.set("nonce", options.nonce);
		if (options.prompt) url.searchParams.set("prompt", options.prompt);
		if (options.loginHint) url.searchParams.set("login_hint", options.loginHint);
		return url.toString();
	}
	/** Exchange the callback code, then resolve the verified identity from userinfo. */
	async exchange(code, codeVerifier) {
		if (!code) throw new Error("PlatformOidcClient.exchange: code is required");
		if (!codeVerifier) throw new Error("PlatformOidcClient.exchange: codeVerifier is required for PKCE");
		const tokens = await this.token({
			grant_type: "authorization_code",
			code,
			redirect_uri: this.redirectUri,
			code_verifier: codeVerifier
		});
		return {
			tokens,
			user: await this.userinfo(tokens.accessToken)
		};
	}
	/** Redeem a refresh token. Store the returned refresh token; the provider rotates it. */
	async refresh(refreshToken) {
		if (!refreshToken) throw new Error("PlatformOidcClient.refresh: refreshToken is required");
		return this.token({
			grant_type: "refresh_token",
			refresh_token: refreshToken
		});
	}
	/** Read the verified identity behind an access token. */
	async userinfo(accessToken) {
		const res = await this.fetchImpl(`${this.baseUrl}/api/auth/oauth2/userinfo`, { headers: { authorization: `Bearer ${accessToken}` } });
		const body = await res.json().catch(() => null);
		if (!res.ok) throw new PlatformAuthError(oauthError(body, `Platform userinfo failed (${res.status})`), res.status, body);
		if (!isRecord(body) || !isNonemptyString(body.sub) || !isNonemptyString(body.email) || body.email_verified !== true) throw new PlatformAuthError("Platform userinfo has no verified identity", res.status, { code: "INVALID_USERINFO_RESPONSE" });
		return {
			id: body.sub,
			email: body.email,
			emailVerified: true,
			...isNonemptyString(body.name) ? { name: body.name } : {}
		};
	}
	/** Revoke an access or refresh token (RFC 7009). Disconnect revokes the refresh token. */
	async revoke(token, tokenTypeHint) {
		if (!token) throw new Error("PlatformOidcClient.revoke: token is required");
		const res = await this.post("/api/auth/oauth2/revoke", {
			token,
			...tokenTypeHint ? { token_type_hint: tokenTypeHint } : {}
		});
		if (!res.ok) {
			const body = await res.json().catch(() => null);
			throw new PlatformAuthError(oauthError(body, `Platform revoke failed (${res.status})`), res.status, body);
		}
	}
	async token(params) {
		const res = await this.post("/api/auth/oauth2/token", params);
		const body = await res.json().catch(() => null);
		if (!res.ok) throw new PlatformAuthError(oauthError(body, `Platform token request failed (${res.status})`), res.status, body);
		return parseTokens(body, res.status);
	}
	post(path, params) {
		const body = new URLSearchParams(params);
		const headers = { "content-type": "application/x-www-form-urlencoded" };
		if (this.clientSecret) headers.authorization = `Basic ${btoa(`${this.clientId}:${this.clientSecret}`)}`;
		else body.set("client_id", this.clientId);
		return this.fetchImpl(`${this.baseUrl}${path}`, {
			method: "POST",
			headers,
			body
		});
	}
};
//#endregion
export { PlatformAuthClient, PlatformAuthError, PlatformHubClient, PlatformHubError, PlatformOidcClient, createPkcePair };

//# sourceMappingURL=platform.js.map