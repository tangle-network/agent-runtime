import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { type AgentProfile, canonicalAgentProfileDigest } from '@tangle-network/agent-interface'
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
import { Sandbox } from '@tangle-network/sandbox'
import { expect, it } from 'vitest'
import {
  type DriveHarness,
  type ExecutorConfig,
  supervise,
} from '../../src/runtime/index'
import { testContinuation } from '../helpers/continuation'

// A real external process consumes the custom driver's canonical profile and authenticated MCP.
// It does filesystem work and returns a terminal receipt; it starts no model or Sandbox execution.
const harnessProgram = String.raw`
const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')
const authored = JSON.parse(process.env.SEAT_TEST_AUTHORED_PROFILE)
const projected = JSON.parse(process.env.SEAT_TEST_PROVIDER_PROFILE)
assert.deepEqual(authored.seats, [{ harness: 'codex', provider: 'openai', model: 'gpt-6.1-sol', selector: { kind: 'all-eligible' } }])
assert.equal(projected.seats, undefined)
assert.deepEqual(projected.model, authored.model)
assert.equal(projected.harness, authored.harness)
assert.match(process.env.SEAT_TEST_SYSTEM_PROMPT, /Preserve the exact subscription model/u)
const url = process.env.SEAT_TEST_MCP_URL
const headers = JSON.parse(process.env.SEAT_TEST_MCP_HEADERS)
const rpc = async (method, params, authenticated = true) => {
  const response = await fetch(url, {
    method: 'POST', signal: AbortSignal.timeout(5000),
    headers: { 'content-type': 'application/json', ...(authenticated ? headers : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }),
  })
  return { status: response.status, body: await response.json() }
}
;(async () => {
  assert.equal((await rpc('tools/list', undefined, false)).status, 401)
  const listed = await rpc('tools/list')
  assert.equal(listed.status, 200)
  assert.deepEqual(listed.body.result.tools.map(tool => tool.name).sort(), ['observe_agent', 'read_journal', 'run_graph', 'spawn_worker', 'submit_result'])
  const early = await rpc('tools/call', { name: 'submit_result', arguments: { result: { pid: 0 } } })
  const refused = JSON.parse(early.body.result.content.find(part => part.type === 'text').text)
  assert.equal(refused.accepted, false)
  assert.equal(refused.stop, false)
  const text = JSON.stringify({ seats: authored.seats, model: authored.model, systemPrompt: process.env.SEAT_TEST_SYSTEM_PROMPT }) + '\n'
  fs.writeFileSync('observation.json', text)
  process.stdout.write(JSON.stringify({ pid: process.pid, sha256: crypto.createHash('sha256').update(text).digest('hex') }) + '\n')
})().catch(error => { console.error(error); process.exitCode = 1 })
`

const execute = promisify(execFile)
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

it.each(['driveHarness', 'resolveDriveHarness'] as const)(
  '%s owns subscription selection while Runtime preserves exact grants and automatic-driver refusal',
  async (customDriver, context) => {
    const directory = await mkdtemp(join(tmpdir(), 'runtime-custom-seats-'))
    context.onTestFinished(() => rm(directory, { recursive: true, force: true }))
    const requests: string[] = []
    const boundary = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`)
      response.writeHead(503, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'No Sandbox execution is admitted by this proof.' }))
    })
    await new Promise<void>((resolve) => boundary.listen(0, '127.0.0.1', resolve))
    context.onTestFinished(
      () => new Promise<void>((resolve) => { boundary.close(() => resolve()); boundary.closeAllConnections() }),
    )
    const address = boundary.address()
    if (!address || typeof address === 'string') throw new Error('missing local Sandbox boundary')
    const backend: ExecutorConfig = {
      backend: 'provider',
      provider: createTangleProvider({
        client: new Sandbox({ apiKey: 'no-live-credentials', baseUrl: `http://127.0.0.1:${address.port}` }),
      }),
    }
    const profile: AgentProfile = {
      name: 'caller-owned-subscription', harness: 'codex',
      model: { provider: 'openai', default: 'gpt-6.1-sol', reasoningEffort: 'xhigh', metadata: { credentialSource: 'subscription' } },
      seats: [{ harness: 'codex', provider: 'openai', model: 'gpt-6.1-sol', selector: { kind: 'all-eligible' } }],
      prompt: { instructions: ['Preserve the exact subscription model and finish one external turn.'] },
      tools: Object.fromEntries(['observe_agent', 'read_journal', 'run_graph', 'spawn_worker', 'submit_result'].map(name => [`agent_runtime_coordination_${name}`, true])),
    }
    const original = structuredClone(profile)
    const budget = { maxIterations: 8, maxTokens: 10000, deadlineMs: 15000 }
    const coordination = { host: '127.0.0.1', port: 0, authentication: true } as const
    expect(() => supervise(profile, 'automatic execution', { backend, budget, coordination })).toThrow(
      'AgentProfile.seats requires selectSeat before execution',
    )
    let observed: { pid: number; sha256: string } | undefined
    let nativeTurns = 0
    const driveHarness: DriveHarness = async (driver) => {
      expect(++nativeTurns).toBe(1)
      expect(driver.reentry).toBeUndefined()
      expect(canonicalAgentProfileDigest(driver.authoredProfile)).toBe(canonicalAgentProfileDigest(profile))
      expect(driver.profile.model).toEqual(profile.model)
      const child = await execute(process.execPath, ['--input-type=commonjs', '-e', harnessProgram], {
        cwd: directory, timeout: 10000, signal: driver.scope.signal,
        env: {
          ...process.env,
          SEAT_TEST_AUTHORED_PROFILE: JSON.stringify(driver.authoredProfile),
          SEAT_TEST_PROVIDER_PROFILE: JSON.stringify(driver.profile),
          SEAT_TEST_SYSTEM_PROMPT: driver.systemPrompt,
          SEAT_TEST_MCP_URL: driver.coordinationMcpUrl,
          SEAT_TEST_MCP_HEADERS: JSON.stringify(driver.coordinationMcpHeaders),
        },
      })
      observed = JSON.parse(child.stdout.trim())
    }
    const driverOption = customDriver === 'driveHarness'
      ? { driveHarness }
      : { resolveDriveHarness: () => driveHarness }
    const result = await supervise(profile, 'Write one checked native observation.', {
      backend, budget, coordination, ...driverOption,
      continuation: testContinuation(), driverRetry: { enabled: false }, maxDepth: 0,
      finalizer: () => observed,
      deliverable: {
        async check(candidate) {
          return observed !== undefined && typeof candidate === 'object' && candidate !== null &&
            'pid' in candidate && candidate.pid === observed.pid &&
            observed.sha256 === digest(await readFile(join(directory, 'observation.json')))
        },
      },
    })
    expect(result.kind).toBe('winner')
    expect(nativeTurns).toBe(1)
    expect(profile).toEqual(original)
    expect(JSON.parse(await readFile(join(directory, 'observation.json'), 'utf8')).seats).toEqual(original.seats)
    expect(requests).toEqual([])
    expect(() => supervise({ ...profile, seats: [] }, 'invalid seats', { backend, budget, coordination, ...driverOption })).toThrow()
  },
)
