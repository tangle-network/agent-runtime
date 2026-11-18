import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
import { Sandbox } from '@tangle-network/sandbox'
import { expect } from 'vitest'
import { FileSpawnJournal } from '../../../src/durable/spawn-journal/journal-store'
import { createFileRunContext, supervise } from '../../../src/runtime'
import { runtimeToolDeclarations, testAgentProfile } from '../../kernel/test-agent-profile'
import { ProcessFixture, prepareExecutables } from './uncertain-create-harness'

/**
 * Drive a provider root whose every create a Sandbox-shaped HTTP service refuses with the real
 * 503 placement body and Retry-After, through the real SDK and Tangle provider, until its room
 * returns (`success`, after 8 min) or never (`deadline`). In real time: three unchanged drives of
 * the SDK's ~2 min create budget once ended such a run as `repeated-failure` near 6.7 min.
 */
export async function runPlacementCapacityRoot(end: 'success' | 'deadline', deadlineMs: number) {
  const { bundle, executables } = await prepareExecutables()
  const fixture = await ProcessFixture.start(
    `json-observation-long-create-capacity-${end}`,
    executables,
    { coordinator: false },
  )
  const runId = `placement-capacity-${end}`
  const runDir = join(fixture.directory, 'run')
  try {
    await fixture.control({ finish: true })
    const context = createFileRunContext(runDir)
    const provider = createTangleProvider({
      client: new Sandbox({
        apiKey: 'offline-not-a-secret',
        baseUrl: fixture.url,
        platformUrl: fixture.url,
        trustLocalCliAuth: false,
        directExec: false,
      }),
    })
    const result = await supervise(
      testAgentProfile('placement-capacity-root', {
        harness: 'opencode',
        model: { provider: 'openai', default: 'fixture-model' },
        tools: runtimeToolDeclarations('stop'),
      }),
      'Report the offline native result.',
      {
        runDir,
        runId,
        journal: context.journal,
        blobs: context.blobs,
        backend: { backend: 'provider', provider },
        driverBackend: { backend: 'provider', provider },
        budget: { maxTokens: 100, maxIterations: 4, deadlineMs },
        coordination: {
          host: '127.0.0.1',
          port: 0,
          authentication: true,
          publicUrl: (address) => `http://127.0.0.1:${address.port}/manager`,
        },
      },
    )
    const state = await fixture.state()
    const events = await new FileSpawnJournal(join(runDir, 'spawn-journal.jsonl')).loadTree(runId)
    const records = (events ?? []).flatMap((event) =>
      event.kind === 'driver-attempt' ? [event.record] : [],
    )
    const refused = state.requests.filter((row) => row.kind === 'capacity-create-refused')
    // No drive ended on the unchanged refusal, though it outlasted three such drives.
    expect(records.filter((record) => record.stop === 'repeated-failure')).toEqual([])
    expect(result).not.toMatchObject({ reason: 'driver-failed' })
    expect(Date.parse(refused.at(-1)!.at) - Date.parse(refused[0]!.at)).toBeGreaterThan(420_000)
    // Every create, refused or admitted, carried the one environment key.
    const creates = [...refused, ...state.requests.filter((row) => row.kind === 'create')]
    expect(new Set(creates.map((row) => row.key)).size).toBe(1)
    return { result, records, state }
  } finally {
    await fixture.close()
    await rm(bundle, { recursive: true, force: true })
  }
}
