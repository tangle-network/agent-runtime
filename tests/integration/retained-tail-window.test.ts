import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, expect, it } from 'vitest'
import { appendCommittedJsonLine } from '../../src/durable/jsonl-file'
import { RetainedObservation } from '../../src/runtime/environment-provider/provider-retained-observation'
import { exactSession } from '../../src/runtime/retained-run-binding'
import { startRetainedRun } from '../../src/runtime/retained-run-start'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'

// The native run spends 95 of the 100 ms tail window between its last progress frame and its
// result; the provider then needs one more read before its terminal frame, 60 ms after the result.
const NATIVE_FINISH_MS = 95
const TERMINAL_AFTER_RESULT_MS = 60

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

it('reads a terminal frame that arrives one provider read after the exact result', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'retained-tail-window-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const at: { frame?: number; result?: number; terminal?: number } = {}
  let frameYielded!: () => void
  const frameDelivered = new Promise<void>((resolve) => {
    frameYielded = resolve
  })
  let releaseTerminal!: () => void
  const terminalReleased = new Promise<void>((resolve) => {
    releaseTerminal = resolve
  })
  const base = durableRetainedProvider(join(directory, 'provider.json'))
  const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
    ...environment,
    session(id, options) {
      const session = environment.session!(id, options)
      return {
        ...session,
        async *events(): AsyncIterable<AgentEnvironmentEvent> {
          at.frame = Date.now()
          frameYielded()
          yield { id: 'tail-0', type: 'message', data: { content: 'native progress' } }
          await terminalReleased
          at.terminal = Date.now()
          yield {
            id: 'tail-1',
            type: 'result',
            data: { finalText: 'durable result', finishReason: 'stop', status: 'completed' },
          }
        },
        async result() {
          await frameDelivered
          await delay(NATIVE_FINISH_MS)
          const result = await session.result()
          at.result = Date.now()
          setTimeout(releaseTerminal, TERMINAL_AFTER_RESULT_MS)
          return result
        },
      }
    },
  })
  const provider: AgentEnvironmentProvider = {
    ...base,
    create: async (input) => wrap(await base.create(input)),
    get: async (id) => {
      const environment = await base.get!(id)
      return environment && wrap(environment)
    },
  }
  const handle = await startRetainedRun({
    provider,
    environment: {
      idempotencyKey: 'tail-window',
      profile: {
        name: 'native',
        harness: 'opencode',
        model: { provider: 'fixture', default: 'fixture/native' },
      },
    },
    turn: { turnId: 'tail-window-turn', prompt: 'offline native work' },
    journalRoot: join(directory, 'admissions'),
    async onAdmission(admission) {
      await appendCommittedJsonLine(join(directory, 'admissions.jsonl'), admission)
    },
  })
  const environment = (await provider.get!(handle.controlRef.environmentId))!
  const session = exactSession(environment, handle.controlRef).session
  const stop = new AbortController()
  cleanups.push(async () => stop.abort())

  const rows: unknown[] = []
  for await (const row of new RetainedObservation(handle, stop.signal).observe(session))
    rows.push(row)

  // The flipped order the window must absorb: the result settles first, late in the window.
  expect(at.result! - at.frame!).toBeGreaterThanOrEqual(NATIVE_FINISH_MS)
  expect(at.terminal!).toBeGreaterThan(at.result!)
  expect(rows).toContainEqual(expect.objectContaining({ id: 'tail-1', type: 'result' }))
  const settled = rows.at(-1) as { type: string; data: Record<string, unknown> }
  expect(settled.type).toBe('result')
  expect(settled.data, JSON.stringify(settled.data)).toMatchObject({ success: true })
  expect(settled.data).not.toHaveProperty('eventStreamComplete')
  expect(settled.data).not.toHaveProperty('eventStreamError')
})
