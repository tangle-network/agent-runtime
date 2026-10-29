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
  const { stdout } = await execute(
    process.execPath,
    [
      '--dns-result-order=ipv4first',
      fileURLToPath(new URL('./fixtures/runtime-secret-bindings.mjs', import.meta.url)),
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
  return JSON.parse(stdout.trim().split('\n').at(-1)!)
}

it('passes direct and authored host declarations through the public Sandbox adapter and Tangle provider', async () => {
  expect(await run('selectors')).toEqual({ selectorsPreserved: true, authoredBindingLowered: true })
})
it('keeps string selector ordering stable and binds retained identity to host and header', async () => {
  expect(await run('identity')).toEqual({
    stringSelectionOrderStable: true,
    legacyWireIdentityPreserved: true,
    hostChangesIdentity: true,
    headerChangesIdentity: true,
    portableHostChangesIdentity: true,
  })
})
it('stores coordination outside create.env, authenticates MCP over TLS, and revokes at settlement', async () => {
  expect(await run('bound')).toMatchObject({
    settled: true,
    mcpAccepted: true,
    mcpRefusedWrongBearer: true,
    noRawCreate: true,
    namesValid: true,
    creates: 1,
    stored: 0,
    deleteCalls: 1,
    secretPosts: 1,
  })
})
it('confirms absent custody after a refused store create and a real DELETE 404', async () => {
  expect(await run('create-refused')).toMatchObject({
    rejected: true,
    creates: 0,
    stored: 0,
    deleteCalls: 1,
    secretPosts: 1,
  })
})
it('reports failed revocation without claiming the stored value was deleted', async () => {
  expect(await run('delete-refused')).toMatchObject({
    rejected: true,
    mcpAccepted: true,
    noRawCreate: true,
    stored: 1,
    deleteCalls: 1,
  })
})
it('uses the SDK isolated preparation transport for loopback coordination without create-time secrets', async () => {
  expect(await run('fallback')).toMatchObject({
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
it('refuses unbounded provider authority before storing a credential or creating a box', async () => {
  expect(await run('unbounded')).toMatchObject({
    rejected: true,
    creates: 0,
    stored: 0,
    secretPosts: 0,
  })
})
