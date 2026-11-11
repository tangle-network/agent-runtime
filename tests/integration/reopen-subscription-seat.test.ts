import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSelectSeat, Sandbox } from '@tangle-network/sandbox'
import { expect, it, onTestFinished } from 'vitest'
import { supervisePursuit } from '../../src/durable/supervise-pursuit'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { nativeSeatProvider } from '../helpers/native-seat-provider'
import { testContinuation } from '../helpers/continuation'
import { testAgentProfile } from '../kernel/test-agent-profile'

it('reopens a retired OpenCode owner on its exact non-exhausted subscription seat', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reopen-subscription-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const requests: Array<{ path: string; selection?: Record<string, unknown> }> = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
    requests.push({ path: request.url!, ...body })
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ seatId: 'original-seat', credentials: {
      apiKeyEnv: 'FIXTURE_MODEL_KEY', baseUrl: 'https://fixture.invalid',
    } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing account boundary')
  const client = new Sandbox({ apiKey: 'fixture', baseUrl: `http://127.0.0.1:${address.port}` })
  const nativeProvider = nativeSeatProvider(directory, { recordOutput: true })
  const provider = { ...nativeProvider, capabilities: async () => ({
    ...(await nativeProvider.capabilities()), create: { runtimeAttachments: { mcp: true } },
  }) }
  const backend = { backend: 'provider' as const, provider }
  const runId = 'reopen-subscription'
  const runDir = join(directory, 'run')
  const profile = testAgentProfile('root', {
    harness: 'opencode', model: { provider: 'fixture', default: 'fixture/native' },
    seats: [{ harness: 'opencode', provider: 'fixture', model: 'fixture/native',
      selector: { kind: 'all-eligible' } }],
  })
  const options = {
    pursuitId: runId, runId, runDir, backend, driverBackend: backend,
    budget: { maxTokens: 1000, maxIterations: 20, deadlineMs: 15000 },
    driverRetry: { enabled: false }, continuation: testContinuation(), maxDepth: 0,
    coordination: { authentication: { signingKeys: { activeKeyId: 'integration', keys: { integration: 'integration-secret-'.repeat(4) } } },
      publicUrl: (address: { port: number }) => `http://127.0.0.1:${address.port}/manager` },
    finalizer: () => 'done', deliverable: { check: (value: unknown) => value === 'done' },
    selectSeat: createSelectSeat({ client, runId,
      minimumValidUntil: new Date(Date.now() + 60000).toISOString(), createBackend: () => backend,
    }),
  }
  const first = await supervisePursuit(profile, 'Produce one checked native result.', options)
  expect(first.result.kind, JSON.stringify(first.result)).toBe('winner')
  const prior = await readFile(join(runDir, 'result.json'), 'utf8')
  const native = () => readFile(join(directory, 'native-receipts.jsonl'), 'utf8')
    .then((text) => text.trim().split('\n').map((line) => JSON.parse(line)))
  const firstReceipt = (await native())[0]
  expect(await provider.get!(firstReceipt.control.environmentId)).toBeNull()
  const reopened = await supervisePursuit(profile, 'Produce one checked native result.', {
    ...options, reopen: { operator: 'integration', reason: 'continue checked work', operationId: 'reopen-1' },
  })
  expect(reopened.result.kind, JSON.stringify(reopened.result)).toBe('winner')
  expect(await readFile(join(runDir, 'settles', '1.json'), 'utf8')).toBe(prior)
  const receipts = await native()
  expect(receipts).toHaveLength(2)
  expect(receipts[1].pid).not.toBe(receipts[0].pid)
  expect(receipts[1].control.environmentId).not.toBe(receipts[0].control.environmentId)
  expect(requests.map((request) => request.path)).toEqual([
    '/v1/model-credentials/resolve', '/v1/model-credentials/resolve',
  ])
  expect(requests[1].selection).toMatchObject({
    resumeSeatId: 'original-seat', requiresNativeTurnGrant: false, excludedSeatIds: [],
  })
  const context = createFileRunContext(runDir)
  const events = (await context.journal.loadTree(runId))!
  expect(events.filter((event) => event.kind === 'seat-segment' && event.phase === 'started')
    .map((event) => [event.segmentIndex, event.seat])).toEqual([[0, 'original-seat'], [1, 'original-seat']])
  expect(events.filter((event) => event.kind === 'workspace-restored')).toEqual([])
}, 30000)
