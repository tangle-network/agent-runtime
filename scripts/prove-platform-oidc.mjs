#!/usr/bin/env node
/** Live-only proof. Run from an isolated consumer with the packed/published SDK installed. */
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

async function main() {
const require = createRequire(pathToFileURL(resolve('package.json')))
const entry = require.resolve('@tangle-network/agent-runtime/platform')
assert(entry.startsWith(resolve('node_modules') + sep), 'Run inside the isolated installed consumer, not the Runtime repository')
const { PlatformOidcClient, PlatformAuthError, createPkcePair } = await import(pathToFileURL(entry).href)
const base = new URL(required('TANGLE_OIDC_BASE_URL'))
assert.equal(base.protocol, 'https:', 'Use the HTTPS staging issuer')
assert.notEqual(base.hostname, 'id.tangle.tools', 'This proof must not use production')
assert.equal(base.pathname, '/')
assert(!base.search && !base.hash && !base.username && !base.password)
const origin = base.origin
const callback = new URL(process.env.TANGLE_OIDC_REDIRECT_URI ?? 'http://127.0.0.1:48763/oidc/callback')
assert.equal(callback.protocol, 'http:')
assert.equal(callback.hostname, '127.0.0.1', 'Use an SSH loopback forward for a remote GTR operator')
assert(!callback.search && !callback.hash && !callback.username && !callback.password)
assert(callback.port, 'Register an explicit loopback callback port')
const clientId = required('TANGLE_OIDC_CLIENT_ID')
const resources = (process.env.TANGLE_OIDC_RESOURCES ?? '').split(/\s+/).filter(Boolean)
const client = new PlatformOidcClient({
  baseUrl: origin,
  clientId,
  clientSecret: process.env.TANGLE_OIDC_CLIENT_SECRET || undefined,
  redirectUri: callback.href,
  scope: process.env.TANGLE_OIDC_SCOPE ?? 'openid profile email offline_access',
  resources,
  fetchImpl: async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    assert.equal(url.origin, origin, 'Credential-bearing request escaped the configured issuer')
    assert(!url.pathname.startsWith('/cross-site/'), 'Legacy request is forbidden in this proof')
    const signal = init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000)
    const response = await fetch(input, { ...init, signal, redirect: 'error' })
    receipt('http', { method: init?.method ?? 'GET', path: url.pathname, status: response.status })
    return response
  },
})

function required(name) {
  const value = process.env[name]?.trim()
  assert(value, `${name} is required`)
  return value
}
function hash(value) { return createHash('sha256').update(value).digest('hex').slice(0, 16) }
function receipt(step, data) { console.log(JSON.stringify({ at: new Date().toISOString(), step, ...data })) }

async function lifecycle(initial, user) {
  assert(initial.refreshToken, 'offline_access did not produce a refresh token')
  const oldRefresh = initial.refreshToken
  let replacement
  try {
    receipt('signed-in', { subjectHash: hash(user.id), verified: user.emailVerified, accessHash: hash(initial.accessToken) })
    replacement = await client.refresh(oldRefresh)
    assert(replacement.refreshToken, 'Refresh returned no replacement token')
    assert.notEqual(replacement.refreshToken, oldRefresh, 'Refresh did not rotate')
    const refreshedUser = await client.userinfo(replacement.accessToken)
    assert.equal(refreshedUser.id, user.id, 'Refresh changed the subject')
    receipt('refreshed', { subjectHash: hash(refreshedUser.id), refreshHash: hash(replacement.refreshToken) })

    // Resource acceptance is separate from identity. This is a real read, not a paid workload.
    if (process.env.TANGLE_OIDC_PROOF_RESOURCE_URL) {
      const resource = new URL(process.env.TANGLE_OIDC_PROOF_RESOURCE_URL)
      assert.equal(resource.protocol, 'https:')
      assert(!resource.username && !resource.password && !resource.hash)
      assert(resources.some((r) => new URL(r).origin === resource.origin), 'The resource must be explicitly configured')
      const response = await fetch(resource, {
        headers: { authorization: `Bearer ${replacement.accessToken}` },
        redirect: 'error', signal: AbortSignal.timeout(30_000),
      })
      receipt('resource-read', { origin: resource.origin, path: resource.pathname, status: response.status })
      assert.equal(response.status, 200, 'The resource server has not accepted the OIDC grant')
    }

    await client.revoke(replacement.refreshToken, 'refresh_token')
    await client.revoke(replacement.accessToken, 'access_token')
    await client.revoke(initial.accessToken, 'access_token')
    receipt('disconnected', {})
    for (const [generation, token] of [['old', oldRefresh], ['current', replacement.refreshToken]]) {
      let refusal
      try { await client.refresh(token) } catch (error) { refusal = error }
      assert(refusal instanceof PlatformAuthError, `${generation} refresh token was not refused`)
      assert.equal(refusal.status, 400, 'A wrong client secret or network failure is not revocation proof')
      assert.equal(refusal.body?.error, 'invalid_grant')
      receipt('refresh-refused', { generation, status: refusal.status, error: 'invalid_grant' })
    }
  } finally {
    // Revoke every credential observed even when an assertion or a resource read fails.
    const credentials = [
      [initial.refreshToken, 'refresh_token'], [initial.accessToken, 'access_token'],
      [replacement?.refreshToken, 'refresh_token'], [replacement?.accessToken, 'access_token'],
    ].filter(([token]) => token)
    const results = await Promise.allSettled(credentials.map(([token, hint]) => client.revoke(token, hint)))
    assert(results.every((result) => result.status === 'fulfilled'), 'Remote credential cleanup failed')
  }
  receipt('PASS', { installedEntry: entry, clientId })
}

if (process.env.TANGLE_OIDC_PROOF_FLOW === 'device') {
  assert.equal(typeof client.deviceAuthorize, 'function', 'Installed SDK has no device grant support')
  const grant = await client.deviceAuthorize()
  console.error(`Open ${grant.verificationUri} and enter ${grant.userCode}.`)
  const tokens = await client.pollDeviceAuthorization(grant)
  await lifecycle(tokens, await client.userinfo(tokens.accessToken))
} else {
  const pair = await createPkcePair()
  const state = randomBytes(32).toString('base64url')
  let used = false
  let complete
  let fail
  const finished = new Promise((resolve, reject) => { complete = resolve; fail = reject })
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    const url = new URL(request.url ?? '/', callback.origin)
    if (request.method !== 'GET' || url.pathname !== callback.pathname || url.searchParams.get('state') !== state || used) {
      response.writeHead(400).end('Invalid callback')
      return
    }
    used = true
    try {
      assert(!url.searchParams.has('error'), 'Authorization was refused')
      if (url.searchParams.has('iss')) assert.equal(url.searchParams.get('iss'), `${origin}/api/auth`)
      const code = url.searchParams.get('code')
      assert(code, 'Callback contained no code')
      const exchanged = await client.exchange(code, pair.verifier)
      await lifecycle(exchanged.tokens, exchanged.user)
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('OIDC proof passed. Sign-in, refresh, disconnect and revoked refresh checks completed.')
      complete()
    } catch (error) {
      response.writeHead(500).end('Proof failed. See the redacted GTR output.')
      fail(error)
    }
  })
  server.on('error', (error) => fail(error))
  server.listen(Number(callback.port), '127.0.0.1', () => {
    console.error(`Open in your browser:\n${client.authorizeUrl({ state, codeChallenge: pair.challenge, prompt: 'consent' })}`)
  })
  const timeout = setTimeout(() => fail(new Error('No completed callback within 15 minutes')), 15 * 60_000)
  try { await finished } finally { clearTimeout(timeout); await new Promise((done) => server.close(done)) }
}
}
await main().catch((error) => {
  // Never print an OAuth response body, a token, a secret or a callback code.
  console.error(JSON.stringify({ step: 'FAIL', name: error?.name ?? 'Error', status: error?.status, code: error?.code }))
  process.exitCode = 1
})
