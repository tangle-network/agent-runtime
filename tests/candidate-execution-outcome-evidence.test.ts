import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

import { afterEach, describe, expect, it } from 'vitest'
import { sha256Bytes } from '../src/candidate-execution/digest'
import { sealAgentCandidateExecutorFinalCapture } from '../src/candidate-execution/executor-capture'
import {
  persistCandidateBenchmarkResult,
  persistVerifiedAgentCandidateExecutorCapture,
} from '../src/candidate-execution/outcome-evidence'
import { prepareAgentCandidateExecution } from '../src/candidate-execution/prepare'
import { assertPreparedCandidateIntegrity } from '../src/candidate-execution/prepared-state'
import { verifyAgentCandidateBundle } from '../src/candidate-execution/verify'
import {
  cleanupCandidateFixtures,
  createCandidateExecutionFixture,
  createCandidateOutputExecutionFixture,
  createCandidateOutputFixture,
  unchangedTaskOutcomeCapture,
} from './helpers/candidate-execution-fixture'

afterEach(cleanupCandidateFixtures)

describe('candidate outcome evidence', () => {
  it('persists exact bounded media output and rejects invalid captures', async () => {
    const fixture = createCandidateOutputExecutionFixture('application/json', 32)
    const state = await preparedState(fixture)
    const outputs = createCandidateOutputFixture()
    const source = Buffer.from('{"answer":42}\n', 'utf8')
    const outcome = await persistTaskOutcome(
      state,
      { kind: 'output', bytes: source },
      outputs.outputArtifacts,
      [],
    )

    source.fill(0)
    expect(outcome).toMatchObject({
      kind: 'output',
      spec: { mediaType: 'application/json', maxBytes: 32 },
    })
    if (outcome.kind !== 'output' || outcome.evidence.material.outcome.kind !== 'output') {
      throw new Error('expected exact output evidence')
    }
    expect(Buffer.from(outcome.bytes).toString('utf8')).toBe('{"answer":42}\n')
    await expect(
      outputs.outputArtifacts.read(outcome.evidence.material.outcome.artifact),
    ).resolves.toEqual(Uint8Array.from(Buffer.from('{"answer":42}\n', 'utf8')))

    await expect(
      persistTaskOutcome(
        state,
        { kind: 'output', bytes: new Uint8Array() },
        outputs.outputArtifacts,
        [],
      ),
    ).rejects.toThrow(/cannot be empty/)
    await expect(
      persistTaskOutcome(
        state,
        { kind: 'output', bytes: Buffer.alloc(33) },
        outputs.outputArtifacts,
        [],
      ),
    ).rejects.toThrow(/32-byte maximum/)
    await expect(
      persistTaskOutcome(
        state,
        { kind: 'output', bytes: Buffer.from('sk-output-secret-123456789') },
        outputs.outputArtifacts,
        ['sk-output-secret-123456789'],
      ),
    ).rejects.toThrow(/protected value/)
    await expect(
      persistTaskOutcome(
        state,
        {
          kind: 'workspace',
          resultTree: '0'.repeat(40),
          afterState: fixture.task.workspace.material,
          archive: Buffer.from('archive'),
          gitDiff: new Uint8Array(),
        },
        outputs.outputArtifacts,
        [],
      ),
    ).rejects.toThrow(/does not match the signed outcome kind/)
  })

  it('rejects protected values in the canonical task manifest before any output write', async () => {
    const fixture = createCandidateExecutionFixture()
    const state = await preparedState(fixture)
    const outputs = createCandidateOutputFixture()
    let puts = 0
    const outputArtifacts = {
      read: outputs.outputArtifacts.read,
      put: async (input: Parameters<typeof outputs.outputArtifacts.put>[0]) => {
        puts++
        return await outputs.outputArtifacts.put(input)
      },
    }

    await expect(
      persistTaskOutcome(state, unchangedTaskOutcomeCapture(fixture), outputArtifacts, [
        'source.ts',
      ]),
    ).rejects.toThrow(/protected value/)
    expect(puts).toBe(0)
  })

  it('validates task manifest material before any output write', async () => {
    const fixture = createCandidateExecutionFixture()
    const state = await preparedState(fixture)
    const outputs = createCandidateOutputFixture()
    let puts = 0
    const outputArtifacts = {
      read: outputs.outputArtifacts.read,
      put: async (input: Parameters<typeof outputs.outputArtifacts.put>[0]) => {
        puts++
        return await outputs.outputArtifacts.put(input)
      },
    }
    const capture = unchangedTaskOutcomeCapture(fixture)
    const [file] = capture.afterState.files
    if (!file) throw new Error('fixture task manifest is empty')

    await expect(
      persistTaskOutcome(
        state,
        {
          ...capture,
          afterState: { ...capture.afterState, files: [file, file] },
        },
        outputArtifacts,
        [],
      ),
    ).rejects.toThrow(/workspace manifest paths must be unique/)
    expect(puts).toBe(0)
  })

  it('rejects a compressed invalid archive before any candidate output is persisted', async () => {
    const fixture = createCandidateExecutionFixture()
    fixture.ports.workspaces.materialize = async ({ archive, destination }) => {
      if (destination === fixture.task.stagingRoots.taskRoot) return
      mkdirSync(destination, { recursive: true })
      const output = join(destination, 'source.ts')
      writeFileSync(output, gunzipSync(archive))
      chmodSync(output, 0o644)
    }
    const state = await preparedState(fixture)
    const outputs = createCandidateOutputFixture()
    let puts = 0
    const outputArtifacts = {
      read: outputs.outputArtifacts.read,
      put: async (input: Parameters<typeof outputs.outputArtifacts.put>[0]) => {
        puts++
        return await outputs.outputArtifacts.put(input)
      },
    }
    const secret = 'sk-compressed-before-put-123456789'

    await expect(
      persistTaskOutcome(
        state,
        {
          ...unchangedTaskOutcomeCapture(fixture),
          archive: gzipSync(Buffer.from(secret, 'utf8')),
        },
        outputArtifacts,
        [secret],
      ),
    ).rejects.toThrow(/do not match the signed manifest/)
    expect(puts).toBe(0)
  })

  it('rejects corrupted persisted archive bytes without publishing task outcome evidence', async () => {
    const fixture = createCandidateExecutionFixture()
    const state = await preparedState(fixture)
    const outputs = createCandidateOutputFixture()
    const purposes: string[] = []
    const purposeByDigest = new Map<string, string>()
    const outputArtifacts = {
      put: async (input: Parameters<typeof outputs.outputArtifacts.put>[0]) => {
        purposes.push(input.purpose)
        const ref = await outputs.outputArtifacts.put(input)
        purposeByDigest.set(ref.sha256, input.purpose)
        return ref
      },
      read: async (ref: Parameters<typeof outputs.outputArtifacts.read>[0]) => {
        const bytes = await outputs.outputArtifacts.read(ref)
        if (purposeByDigest.get(ref.sha256) !== 'task-archive') return bytes
        const corrupted = Uint8Array.from(bytes)
        corrupted[0] = (corrupted[0] ?? 0) ^ 0xff
        return corrupted
      },
    }

    await expect(
      persistTaskOutcome(state, unchangedTaskOutcomeCapture(fixture), outputArtifacts, []),
    ).rejects.toThrow(/persisted candidate output digest/)
    expect(purposes.sort()).toEqual(['task-archive', 'task-manifest'])
    expect(purposes).not.toContain('task-patch')
    expect(purposes).not.toContain('task-outcome')
  })

  it('rejects a false archive reference without publishing task outcome evidence', async () => {
    const fixture = createCandidateExecutionFixture()
    const state = await preparedState(fixture)
    const outputs = createCandidateOutputFixture()
    const purposes: string[] = []
    const outputArtifacts = {
      read: outputs.outputArtifacts.read,
      put: async (input: Parameters<typeof outputs.outputArtifacts.put>[0]) => {
        purposes.push(input.purpose)
        const ref = await outputs.outputArtifacts.put(input)
        return input.purpose === 'task-archive' ? { ...ref, byteLength: ref.byteLength + 1 } : ref
      },
    }

    await expect(
      persistTaskOutcome(state, unchangedTaskOutcomeCapture(fixture), outputArtifacts, []),
    ).rejects.toThrow(/does not identify the submitted bytes/)
    expect(purposes.sort()).toEqual(['task-archive', 'task-manifest'])
    expect(purposes).not.toContain('task-patch')
    expect(purposes).not.toContain('task-outcome')
  })

  it('rejects protected access values in task archives and raw grader output', async () => {
    const fixture = createCandidateExecutionFixture()
    const state = await preparedState(fixture)
    const outputs = createCandidateOutputFixture()
    const secret = 'sk-outcome-secret-123456789'
    const capture = unchangedTaskOutcomeCapture(fixture)
    await expect(
      persistTaskOutcome(
        state,
        { ...capture, archive: Buffer.from(secret, 'utf8') },
        outputs.outputArtifacts,
        [secret],
      ),
    ).rejects.toThrow(/protected value/)

    const outcome = await persistTaskOutcome(state, capture, outputs.outputArtifacts, [secret])
    await expect(
      persistCandidateBenchmarkResult(
        state,
        { kind: 'exit', exitCode: 0 },
        outcome,
        {
          ...outputs.grader,
          run: async ({ implementation, outcome }) => {
            const evidence = Buffer.from(secret, 'utf8')
            return {
              evaluation: { score: 1, passed: true, raw: {} },
              evidence,
              binding: {
                implementationDigest: sha256Bytes(implementation.bytes),
                taskOutcomeDigest: outcome.evidence.digest,
                outputDigest: sha256Bytes(evidence),
              },
            }
          },
        },
        outputs.outputArtifacts,
        [secret],
      ),
    ).rejects.toThrow(/protected value/)
  })

  it('retains raw executable-grade evidence but cannot pass a nonzero exit', async () => {
    const fixture = createCandidateExecutionFixture()
    const state = await preparedState(fixture)
    const outputs = createCandidateOutputFixture()
    const outcome = await persistTaskOutcome(
      state,
      unchangedTaskOutcomeCapture(fixture),
      outputs.outputArtifacts,
      [],
    )
    const result = await persistCandidateBenchmarkResult(
      state,
      { kind: 'exit', exitCode: 1 },
      outcome,
      outputs.grader,
      outputs.outputArtifacts,
      [],
    )

    expect(result.material).toMatchObject({
      score: 0,
      passed: false,
      dimensions: [{ name: 'tests', score: 0 }],
    })
    expect(Buffer.from(await outputs.outputArtifacts.read(result.material.evidence))).toEqual(
      Buffer.from('{"reward":1}\n', 'utf8'),
    )
    expect(result.material.evidence.sha256).not.toBe(result.material.grader.artifact.sha256)
  })

  it('cannot persist a result when the runner binding does not match executed bytes', async () => {
    const fixture = createCandidateExecutionFixture()
    const state = await preparedState(fixture)
    const outputs = createCandidateOutputFixture()
    const outcome = await persistTaskOutcome(
      state,
      unchangedTaskOutcomeCapture(fixture),
      outputs.outputArtifacts,
      [],
    )
    const persistedPurposes: string[] = []
    const observingArtifacts = {
      ...outputs.outputArtifacts,
      put: async (input: Parameters<typeof outputs.outputArtifacts.put>[0]) => {
        persistedPurposes.push(input.purpose)
        return await outputs.outputArtifacts.put(input)
      },
    }
    let admittedImplementation = Buffer.alloc(0)

    await expect(
      persistCandidateBenchmarkResult(
        state,
        { kind: 'exit', exitCode: 0 },
        outcome,
        {
          ...outputs.grader,
          run: async ({ implementation, outcome: gradedOutcome }) => {
            admittedImplementation = Buffer.from(implementation.bytes)
            const evidence = Buffer.from('{"reward":1}\n', 'utf8')
            return {
              evaluation: { score: 1, passed: true, raw: {} },
              evidence,
              binding: {
                implementationDigest: sha256Bytes(Buffer.from('different grader', 'utf8')),
                taskOutcomeDigest: gradedOutcome.evidence.digest,
                outputDigest: sha256Bytes(evidence),
              },
            }
          },
        },
        observingArtifacts,
        [],
      ),
    ).rejects.toThrow(/executed implementation digest does not match/)

    expect(admittedImplementation).toEqual(Buffer.from('fixture executable grader', 'utf8'))
    expect(persistedPurposes).toEqual([])
  })

  it('cannot persist a result bound to another task outcome or raw output', async () => {
    const fixture = createCandidateExecutionFixture()
    const state = await preparedState(fixture)
    const outputs = createCandidateOutputFixture()
    const outcome = await persistTaskOutcome(
      state,
      unchangedTaskOutcomeCapture(fixture),
      outputs.outputArtifacts,
      [],
    )
    const persistedPurposes: string[] = []
    const observingArtifacts = {
      ...outputs.outputArtifacts,
      put: async (input: Parameters<typeof outputs.outputArtifacts.put>[0]) => {
        persistedPurposes.push(input.purpose)
        return await outputs.outputArtifacts.put(input)
      },
    }

    for (const mismatch of ['task', 'output'] as const) {
      await expect(
        persistCandidateBenchmarkResult(
          state,
          { kind: 'exit', exitCode: 0 },
          outcome,
          {
            ...outputs.grader,
            run: async ({ implementation, outcome: gradedOutcome }) => {
              const evidence = Buffer.from('{"reward":1}\n', 'utf8')
              return {
                evaluation: { score: 1, passed: true, raw: {} },
                evidence,
                binding: {
                  implementationDigest: sha256Bytes(implementation.bytes),
                  taskOutcomeDigest:
                    mismatch === 'task'
                      ? sha256Bytes(Buffer.from('other task', 'utf8'))
                      : gradedOutcome.evidence.digest,
                  outputDigest:
                    mismatch === 'output'
                      ? sha256Bytes(Buffer.from('other output', 'utf8'))
                      : sha256Bytes(evidence),
                },
              }
            },
          },
          observingArtifacts,
          [],
        ),
      ).rejects.toThrow(/does not match/)
    }

    expect(persistedPurposes).toEqual([])
  })
})

async function preparedState(fixture: ReturnType<typeof createCandidateExecutionFixture>) {
  return assertPreparedCandidateIntegrity(
    await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    ),
  )
}

async function persistTaskOutcome(
  state: Parameters<typeof persistVerifiedAgentCandidateExecutorCapture>[0],
  taskOutcome: import('../src/candidate-execution/types').AgentCandidateExecutorTaskOutcomeCapture,
  outputArtifacts: Parameters<typeof persistVerifiedAgentCandidateExecutorCapture>[2],
  protectedValues: readonly string[],
) {
  const capture = sealAgentCandidateExecutorFinalCapture(
    { taskOutcome },
    state.executionPlan.value.material.task.outcome,
  )
  return (
    await persistVerifiedAgentCandidateExecutorCapture(
      state,
      capture,
      outputArtifacts,
      protectedValues,
    )
  ).taskOutcome
}
