import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  claimWorkerSteerDelivery,
  readWorkerSteerAcknowledgement,
  supervisorRunDir,
  writeWorkerSteer,
} from '../../src/runtime/supervise/run-layout'
import type { DriveHarness } from '../../src/runtime/supervise/supervisor-agent'
import { supervise } from '../helpers/runtime-with-test-brain'
import { scriptedBrain } from './scripted-brain'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'root-steer-'))
  roots.push(root)
  const runId = 'root-run'
  const runDir = supervisorRunDir(root, runId)
  const options = {
    runId,
    runDir,
    budget: { maxTokens: 10_000, maxIterations: 8 },
    driverRetry: { enabled: false },
    makeWorkerAgent: () => ({ name: 'unused', act: async () => undefined }),
  }
  const write = (operationId: string) =>
    writeWorkerSteer(root, runId, runId, {
      operationId,
      message: 'use the corrected evidence',
      interrupt: true,
    })
  return { root, runId, runDir, options, write }
}
async function acknowledged(dir: string, id: string) {
  const until = Date.now() + 5000
  while (Date.now() < until) {
    const ack = readWorkerSteerAcknowledgement(dir, id)
    if (ack && ack.effect !== 'unknown') return ack
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('root steer was not acknowledged')
}

describe('durable root steering through the existing operation protocol', () => {
  it('folds a queued root correction before the next router turn', async () => {
    const { runDir, options, write } = fixture()
    write('before-first-turn')
    const seen: Array<ReadonlyArray<Record<string, unknown>>> = []
    await supervise(testAgentProfile('root', { harness: 'cli-base' }), 'research', {
      ...options,
      brain: scriptedBrain([{ content: 'done' }], seen),
    })
    expect(JSON.stringify(seen[0])).toContain('use the corrected evidence')
    expect(readWorkerSteerAcknowledgement(runDir, 'before-first-turn')?.effect).toBe('delivered')
  })

  it('delivers an external-process retry once during one native invocation', async () => {
    const { root, runId, runDir, options } = fixture()
    const received: unknown[] = []
    let turns = 0
    const driveHarness: DriveHarness = Object.assign(
      async () => {
        turns += 1
        await promisify(execFile)(
          process.execPath,
          [
            '--import',
            'tsx',
            '--input-type=module',
            '-e',
            `
        import { writeWorkerSteer } from './src/runtime/supervise/run-layout.ts';
        const args = ${JSON.stringify([root, runId, runId, { operationId: 'native-root', message: 'use the corrected evidence', interrupt: true }])};
        writeWorkerSteer(...args); writeWorkerSteer(...args);
      `,
          ],
          { cwd: process.cwd() },
        )
        await acknowledged(runDir, 'native-root')
      },
      {
        deliver: (message: unknown) => {
          received.push(message)
          return true
        },
      },
    )
    await supervise(
      testAgentProfile('root', { tools: runtimeToolDeclarations('ask_parent') }),
      'research',
      { ...options, driveHarness },
    )
    expect(turns).toBe(1)
    expect(received).toEqual([{ steer: 'use the corrected evidence', interrupt: true }])
    expect(readWorkerSteerAcknowledgement(runDir, 'native-root')?.effect).toBe('delivered')
  })

  it('returns unsupported when a native root has no accepting inbox', async () => {
    const { runDir, options, write } = fixture()
    await supervise(
      testAgentProfile('root', { tools: runtimeToolDeclarations('ask_parent') }),
      'research',
      {
        ...options,
        driveHarness: async () => {
          write('unsupported-root')
          await acknowledged(runDir, 'unsupported-root')
        },
      },
    )
    expect(readWorkerSteerAcknowledgement(runDir, 'unsupported-root')?.effect).toBe('unsupported')
  })

  it('retains an uncertain native delivery instead of retrying a throwing inbox', async () => {
    const { runDir, options, write } = fixture()
    let delivered!: () => void
    const attempted = new Promise<void>((resolve) => {
      delivered = resolve
    })
    let attempts = 0
    const driveHarness: DriveHarness = Object.assign(
      async () => {
        write('throwing-root')
        await attempted
        write('throwing-root')
      },
      {
        deliver: () => {
          attempts += 1
          delivered()
          throw new Error('acceptance response lost')
        },
      },
    )
    await supervise(
      testAgentProfile('root', { tools: runtimeToolDeclarations('ask_parent') }),
      'research',
      { ...options, driveHarness },
    )
    expect(attempts).toBe(1)
    expect(readWorkerSteerAcknowledgement(runDir, 'throwing-root')?.effect).toBe('unknown')
  })

  it('never repeats a root instruction claimed before a coordinator interruption', async () => {
    const { runDir, options, write } = fixture()
    const { request } = write('in-doubt-root')
    expect(
      claimWorkerSteerDelivery(runDir, {
        schemaVersion: 1,
        operationId: request.operationId,
        requestDigest: request.requestDigest,
        worker: request.worker,
        requestedAt: request.at,
        observedAt: request.at,
        effect: 'unknown',
        detail: 'prior delivery interrupted',
      }),
    ).toBe(true)
    const seen: Array<ReadonlyArray<Record<string, unknown>>> = []
    await supervise(testAgentProfile('root', { harness: 'cli-base' }), 'research', {
      ...options,
      brain: scriptedBrain([{ content: 'done' }], seen),
    })
    expect(JSON.stringify(seen)).not.toContain('use the corrected evidence')
    expect(readWorkerSteerAcknowledgement(runDir, 'in-doubt-root')?.effect).toBe('unknown')
  })

  it('expires a late root correction without delivering after the final turn', async () => {
    const { runDir, options, write } = fixture()
    await supervise(testAgentProfile('root', { harness: 'cli-base' }), 'research', {
      ...options,
      brain: async () => {
        write('late-root')
        return { content: 'done', toolCalls: [] }
      },
    })
    expect(readWorkerSteerAcknowledgement(runDir, 'late-root')?.effect).toBe('not_live')
  })
})
