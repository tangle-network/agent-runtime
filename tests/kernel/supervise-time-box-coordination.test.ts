import { describe, expect, it } from 'vitest'
import { InMemorySpawnJournal } from '../../src/durable/in-memory-spawn-stores'
import { DEADLINE_CHECK_IN_MESSAGE } from '../../src/runtime/supervise/deadline'
import type { DriveHarness } from '../../src/runtime/supervise/supervisor-agent'
import { testContinuation } from '../helpers/continuation'
import { superviseForTest } from '../helpers/runtime-with-test-brain'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

/** `ok` for an answered call, else what came back instead. */
async function callTool(
  url: string,
  headers: Readonly<Record<string, string>> | undefined,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: name,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  const text = await response.text()
  if (response.status !== 200) return `HTTP ${response.status} ${text}`
  const body = JSON.parse(text) as { error?: { message?: string }; result?: { isError?: boolean } }
  if (body.error) return `error: ${body.error.message}`
  return body.result?.isError ? `tool error: ${text}` : 'ok'
}

const stopped = (signal: AbortSignal) =>
  new Promise<'stopped'>((resolve) => {
    if (signal.aborted) resolve('stopped')
    else signal.addEventListener('abort', () => resolve('stopped'), { once: true })
  })

const isCheckIn = (message: unknown): boolean =>
  typeof message === 'object' &&
  message !== null &&
  (message as { steer?: unknown }).steer === DEADLINE_CHECK_IN_MESSAGE

describe("a manager's own time box", () => {
  it('leaves its coordination credential valid, so the checked-in manager can record and submit', async () => {
    // 2026-10-10, eu-datacenter-power-2030-20261010b:s3: its root time-boxed it at 20 minutes, the
    // box checked it in and kept it running, and its own coordination server refused every call
    // for the 41 minutes it had left, so it could neither record its state nor submit.
    const director = testAgentProfile('director', {
      tools: runtimeToolDeclarations('read_journal', 'submit_result'),
    })
    const outcomes: Record<string, string> = {}
    let checkedIn!: () => void
    const reachedCheckIn = new Promise<void>((resolve) => {
      checkedIn = resolve
    })
    let directorFinished!: () => void
    const directorDone = new Promise<void>((resolve) => {
      directorFinished = resolve
    })
    let rootDrives = 0
    const drive: DriveHarness = async ({
      profile,
      scope,
      coordinationMcpUrl,
      coordinationMcpHeaders,
    }) => {
      const call = (name: string, args: Record<string, unknown>) =>
        callTool(coordinationMcpUrl, coordinationMcpHeaders, name, args)
      if (profile.name === 'root') {
        // The root's later drives are wakes with the director's result; it has nothing to do.
        if (rootDrives++ > 0) return
        outcomes.spawn = await call('spawn_worker', {
          profile: director,
          task: 'write the section',
          budget: { deadlineMs: 500 },
        })
        await directorDone
        return
      }
      outcomes['read before the box'] = await call('read_journal', {})
      outcomes.box = await Promise.race([
        reachedCheckIn.then(() => 'checked in'),
        stopped(scope.signal),
      ])
      outcomes['read after the check-in'] = await call('read_journal', {})
      outcomes['submit after the check-in'] = await call('submit_result', {
        result: { saved: '3 of 5 sections' },
      })
      directorFinished()
    }
    // One steerable session per manager, as a product gives each recursive manager its own.
    const resolveDriveHarness = (): DriveHarness => {
      const harness: DriveHarness = (input) => drive(input)
      harness.deliver = (message) => {
        if (!isCheckIn(message)) return false
        checkedIn()
        return true
      }
      return harness
    }

    await superviseForTest(
      testAgentProfile('root', { tools: runtimeToolDeclarations('spawn_worker') }),
      'research',
      {
        budget: { maxTokens: 20_000, maxIterations: 20 },
        perWorker: { maxTokens: 1000, maxIterations: 4 },
        makeLeafAgent: () => ({ name: 'unused', act: async () => undefined }),
        resolveDriveHarness,
        coordination: { authentication: true },
        driverRetry: { enabled: false },
        wake: { debounceMs: 0 },
        journal: new InMemorySpawnJournal(),
        runId: 'time-box-credential',
        deliverable: { check: () => true },
        continuation: testContinuation({ deadline: 1 }),
      },
    )

    expect(outcomes).toEqual({
      spawn: 'ok',
      'read before the box': 'ok',
      box: 'checked in',
      'read after the check-in': 'ok',
      'submit after the check-in': 'ok',
    })
  })
})
