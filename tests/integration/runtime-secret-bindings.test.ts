import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, expect, it } from 'vitest'

const execute = promisify(execFile)
let directory: string
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'runtime-secret-boundary-'))
  await execute('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '1',
    '-subj',
    '/CN=localhost.localdomain',
    '-addext',
    'subjectAltName=DNS:localhost.localdomain',
    '-keyout',
    join(directory, 'key.pem'),
    '-out',
    join(directory, 'cert.pem'),
  ])
})
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

/** Real SDK and Runtime exports in a fresh process trust only this fixture's local TLS certificate. */
async function run(mode: string) {
  const certificate = join(directory, 'cert.pem')
  const { stdout, stderr } = await execute(
    process.execPath,
    [
      '--dns-result-order=ipv4first',
      fileURLToPath(
        new URL(
          `./fixtures/${['selectors', 'identity'].includes(mode) ? 'runtime-binding-forwarding' : 'runtime-secret-bindings'}.mjs`,
          import.meta.url,
        ),
      ),
      mode,
      certificate,
      join(directory, 'key.pem'),
    ],
    {
      timeout: 20000,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: tmpdir(),
        NODE_EXTRA_CA_CERTS: certificate,
      },
    },
  )
  expect(stderr.includes('TimeoutOverflowWarning')).toBe(false)
  const result = JSON.parse(stdout.trim().split('\n').at(-1)!)
  if (result.resultKind === 'no-winner')
    console.error(
      JSON.stringify({
        mode,
        kind: result.resultKind,
        reason: result.resultReason,
        failure: result.failureText,
        protocol: result.protocolFailures,
      }),
    )
  return result
}

it('passes direct and authored host declarations through the public Sandbox adapter and Tangle provider', async () => {
  expect(await run('selectors')).toEqual({
    selectorsPreserved: true,
    canonicalDeclarationPreserved: true,
    fullSchemaPreserved: true,
    legacyDeliveryPreserved: true,
    candidateRoundTripPreserved: true,
  })
})
it('keeps string selector ordering stable and binds retained identity to host and header', async () => {
  expect(await run('identity')).toEqual({
    stringSelectionOrderStable: true,
    legacyWireIdentityPreserved: true,
    hostChangesIdentity: true,
    headerChangesIdentity: true,
    canonicalScopeChangesIdentity: true,
  })
})
it('stores coordination outside create.env, authenticates MCP over TLS, and revokes at settlement', async () => {
  expect(await run('bound')).toMatchObject({
    resultKind: 'winner',
    settled: true,
    mcpAccepted: true,
    mcpRefusedWrongBearer: true,
    noRawCreate: true,
    namesValid: true,
    issuerPolicyPreserved: true,
    unrelatedDeclarationPreserved: true,
    legacyCoordinationEnvNormalized: true,
    creates: 1,
    stored: 0,
    deleteCalls: 1,
    secretPosts: 1,
  })
})
it('confirms absent custody after a refused store create through real metadata discovery', async () => {
  expect(await run('create-refused')).toMatchObject({
    resultKind: 'no-winner',
    resultReason: 'driver-failed',
    rejected: true,
    creates: 0,
    stored: 0,
    deleteCalls: 0,
    metadataGets: 1,
    secretPosts: 1,
  })
})
it('preserves unrelated caller env names sharing the coordination prefix', async () => {
  expect(await run('prefix-env')).toMatchObject({
    resultKind: 'winner',
    settled: true,
    mcpAccepted: true,
    noRawCreate: true,
    prefixEnvPreserved: true,
    stored: 0,
  })
})
it('preserves unknown custody when persistence has no acknowledged receipt', async () => {
  expect(await run('uncertain-create')).toMatchObject({
    resultKind: 'no-winner',
    resultReason: 'driver-failed',
    rejected: true,
    creates: 0,
    stored: 1,
    deleteCalls: 0,
    metadataGets: 2,
  })
})
it('refuses stale takeover without acquiring cleanup authority over the prior revision', async () => {
  expect(await run('rekey-conflict')).toMatchObject({
    resultKind: 'no-winner',
    resultReason: 'driver-failed',
    rejected: true,
    creates: 0,
    stored: 1,
    updates: 0,
    deleteCalls: 0,
    metadataGets: 3,
  })
})
it('preserves a newer holder when conditional cleanup detects a changed revision', async () => {
  expect(await run('delete-conflict')).toMatchObject({
    resultKind: 'no-winner',
    resultReason: 'driver-failed',
    rejected: true,
    mcpAccepted: true,
    noRawCreate: true,
    stored: 1,
    deleteCalls: 1,
  })
})
it('reports failed revocation without claiming the stored value was deleted', async () => {
  expect(await run('delete-refused')).toMatchObject({
    resultKind: 'no-winner',
    resultReason: 'driver-failed',
    rejected: true,
    mcpAccepted: true,
    noRawCreate: true,
    stored: 1,
    deleteCalls: 1,
  })
})
it('uses the SDK isolated preparation transport for loopback coordination without create-time secrets', async () => {
  expect(await run('fallback')).toMatchObject({
    resultKind: 'winner',
    settled: true,
    mcpAccepted: true,
    mcpRefusedWrongBearer: true,
    noRawCreate: true,
    secretPosts: 0,
    prepared: true,
    publicSessionSafe: true,
    privateTurns: 1,
  })
})

it('honors explicit finite authentication TTL when the root budget has no deadline', async () => {
  expect(await run('explicit-ttl')).toMatchObject({
    settled: true,
    mcpAccepted: true,
    noRawCreate: true,
    stored: 0,
    deleteCalls: 1,
    secretPosts: 1,
  })
})
it('automatically bounds and protects existing deadline-free provider callers', async () => {
  expect(await run('unbounded')).toMatchObject({
    settled: true,
    mcpAccepted: true,
    noRawCreate: true,
    creates: 1,
    stored: 0,
    secretPosts: 1,
  })
})
it('protects a long finite lease without clamped timers or spurious hot rekey', async () => {
  expect(await run('long-ttl')).toMatchObject({
    settled: true,
    mcpAccepted: true,
    noRawCreate: true,
    updates: 0,
    stored: 0,
    secretPosts: 1,
  })
})
it('isolates sequential default caller credentials even when callers reuse a run label', async () => {
  expect(await run('namespace')).toMatchObject({
    settled: true,
    mcpAccepted: true,
    noRawCreate: true,
    creates: 2,
    distinctCredentialNames: 2,
    stored: 0,
    deleteCalls: 2,
    secretPosts: 2,
  })
})

it('keeps old and new authority valid until hot-rekey acknowledgement, then revokes old authority', async () => {
  expect(await run('renewal')).toMatchObject({
    settled: true,
    mcpAccepted: true,
    noRawCreate: true,
    handoverOverlap: true,
    issuerPolicyPreserved: true,
    oldRevokedAfterAcknowledgement: true,
    stored: 0,
    deleteCalls: 1,
    updates: 1,
  })
})
it('rebinds an existing quiescent host secret through acknowledged update before dispatch', async () => {
  expect(await run('quiescent-rebind')).toMatchObject({
    settled: true,
    mcpAccepted: true,
    noRawCreate: true,
    creates: 1,
    stored: 0,
    deleteCalls: 1,
    updates: 1,
  })
})
it('resumes a committed retained run in a new process and rekeys before its next dispatch', async () => {
  expect(await run('restart')).toMatchObject({
    resumed: true,
    priorProcessKilledAfterCommit: true,
    rekeyBeforeResumedDispatch: true,
    issuerPolicyPreserved: true,
    creates: 1,
    nativeTurns: 2,
    updates: 1,
    stored: 0,
    noRawCreate: true,
  })
})
