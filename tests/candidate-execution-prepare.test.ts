import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { type AgentCandidateBundle, sha256DigestSchema } from '@tangle-network/agent-interface'
import { hashKnowledgeBase } from '@tangle-network/agent-knowledge'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_CANDIDATE_TIMER_INTERVAL_MS } from '../src/candidate-execution/cleanup'
import {
  canonicalCandidateDigest,
  canonicalCandidateDocument,
  embeddedCandidateArtifact,
} from '../src/candidate-execution/digest'
import {
  CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG_ENV,
  CANDIDATE_KNOWLEDGE_ROOT_ENV,
} from '../src/candidate-execution/knowledge'
import { prepareAgentCandidateExecution } from '../src/candidate-execution/prepare'
import { parseAgentCandidateProfileActivation } from '../src/candidate-execution/profile'
import type { AgentCandidateExecutionPorts } from '../src/candidate-execution/types'
import { verifyAgentCandidateBundle } from '../src/candidate-execution/verify'
import {
  bindCandidateFixtureBundle,
  candidateBundle as bundle,
  cleanupCandidateFixtures,
  emptyCandidateSnapshot as emptySnapshot,
  createCandidateExecutionFixture as fixture,
  redigestCandidateBundle as redigestBundle,
  replaceCandidateFixtureTask,
  candidateSha as sha,
} from './helpers/candidate-execution-fixture'

afterEach(() => {
  cleanupCandidateFixtures()
})

describe('candidate execution preparation', () => {
  it.each([
    {
      harness: 'codex',
      executable: '/usr/local/bin/codex',
      flags: ['-c', 'developer_instructions="Native \\"prompt\\"\\nsecond line\\tend"'],
    },
    {
      harness: 'claude-code',
      executable: 'claude',
      flags: ['--system-prompt-file', '/workspace/task/.tangle/system-prompt.md'],
    },
    {
      harness: 'opencode',
      executable: 'opencode',
      flags: [],
    },
    {
      harness: 'pi',
      executable: 'pi',
      flags: ['--system-prompt', '/workspace/task/.tangle/system-prompt.md'],
    },
  ] as const)(
    'projects the replacement system prompt onto the native $harness process',
    async ({ harness, executable, flags }) => {
      const value = fixture()
      const systemPrompt = 'Native "prompt"\nsecond line\tend'
      value.bundle = redigestBundle(value.bundle, {
        profile: {
          ...value.bundle.profile,
          harness,
          prompt: { ...value.bundle.profile.prompt, systemPrompt },
        },
        execution: {
          ...value.bundle.execution,
          harness,
          launch: { kind: 'container-command', executable },
        },
      })
      bindCandidateFixtureBundle(value)

      const prepared = await prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(value.bundle, value.ports),
        value.task,
        value.ports,
      )

      expect(prepared.profilePlan.value.material.systemPrompt).toBeUndefined()
      expect(prepared.profilePlan.value.material.sourceProfileDigest).toBe(
        canonicalCandidateDigest(value.bundle.profile),
      )
      expect(prepared.launch.flags).toEqual(flags)
      expect(prepared.launch.args).toEqual(flags)
      expect(prepared.executionPlan.value.material.launch.args.map((arg) => arg.value)).toEqual(
        flags,
      )
      expect(Buffer.from(prepared.instruction.bytes)).toEqual(
        Buffer.from(value.task.task.instruction),
      )
      expect(prepared.launch.args).not.toContain(value.task.task.instruction)

      const openCodeConfig = prepared.profileActivation.files.find(
        (file) => file.path === 'opencode.json',
      )
      const systemPromptFile = prepared.profileActivation.files.find(
        (file) => file.path === '.tangle/system-prompt.md',
      )
      if (harness === 'opencode') {
        expect(JSON.parse(openCodeConfig?.content ?? '')).toMatchObject({
          instructions: ['.opencode/profile-instructions.md'],
          agent: {
            build: { prompt: systemPrompt },
            plan: { prompt: systemPrompt },
          },
        })
        expect(systemPromptFile).toBeUndefined()
      } else if (harness === 'claude-code' || harness === 'pi') {
        expect(openCodeConfig).toBeUndefined()
        expect(systemPromptFile?.content).toBe(systemPrompt)
      } else {
        expect(openCodeConfig).toBeUndefined()
        expect(systemPromptFile).toBeUndefined()
      }
    },
  )

  it.each([
    {
      harness: 'codex',
      executable: 'codex',
      args: ['-c', 'developer_instructions="already set"'],
    },
    { harness: 'claude-code', executable: 'claude', args: ['--system-prompt-file', '/elsewhere'] },
    { harness: 'claude-code', executable: 'claude', args: ['--system-prompt=inline'] },
    { harness: 'pi', executable: 'pi', args: ['--system-prompt', '/elsewhere'] },
  ] as const)(
    'refuses $harness launch args that would shadow the profile system prompt',
    async ({ harness, executable, args }) => {
      const value = fixture()
      value.bundle = redigestBundle(value.bundle, {
        profile: {
          ...value.bundle.profile,
          harness,
          prompt: { ...value.bundle.profile.prompt, systemPrompt: 'Must be active.' },
        },
        execution: {
          ...value.bundle.execution,
          harness,
          launch: {
            kind: 'container-command',
            executable,
            args: args.map((value) => ({ kind: 'public', value })),
          },
        },
      })
      bindCandidateFixtureBundle(value)

      await expect(
        prepareAgentCandidateExecution(
          await verifyAgentCandidateBundle(value.bundle, value.ports),
          value.task,
          value.ports,
        ),
      ).rejects.toThrow(
        new RegExp(`${harness} launch arguments conflict with the candidate profile system prompt`),
      )
    },
  )

  it('rejects a system prompt when an arbitrary candidate entrypoint cannot apply it', async () => {
    const value = fixture(true)
    value.bundle = redigestBundle(value.bundle, {
      profile: {
        ...value.bundle.profile,
        prompt: {
          ...value.bundle.profile.prompt,
          systemPrompt: 'This replacement must be active.',
        },
      },
    })
    bindCandidateFixtureBundle(value)
    let reservationCalls = 0
    value.ports.models.reserveGrant = async () => {
      reservationCalls++
      throw new Error('candidate must fail before reserving protected access')
    }

    await expect(
      prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(value.bundle, value.ports),
        value.task,
        value.ports,
      ),
    ).rejects.toThrow(/candidate-entrypoint launch cannot prove codex system-prompt replacement/)
    expect(reservationCalls).toBe(0)
  })

  it('rejects a system prompt when the declared harness does not launch its native CLI', async () => {
    const value = fixture()
    value.bundle = redigestBundle(value.bundle, {
      profile: {
        ...value.bundle.profile,
        prompt: {
          ...value.bundle.profile.prompt,
          systemPrompt: 'This replacement must be active.',
        },
      },
      execution: {
        ...value.bundle.execution,
        launch: { kind: 'container-command', executable: 'tools/codex' },
      },
    })
    bindCandidateFixtureBundle(value)

    await expect(
      prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(value.bundle, value.ports),
        value.task,
        value.ports,
      ),
    ).rejects.toThrow(/requires the native codex executable/)
  })

  it('binds exact instruction, repository, profile, model, image, roots, and limits', async () => {
    const value = fixture()
    value.bundle = bundle({
      instructionDelivery: {
        kind: 'utf8-file',
        env: 'TANGLE_CANDIDATE_TASK_PATH',
        path: '/tangle/input/task.txt',
      },
    })
    bindCandidateFixtureBundle(value)
    const verified = await verifyAgentCandidateBundle(value.bundle, value.ports)
    const prepared = await prepareAgentCandidateExecution(verified, value.task, value.ports)
    const plan = prepared.executionPlan.value.material
    expect(plan.instructionDelivery).toEqual(value.bundle.execution.instructionDelivery)
    expect(prepared.benchmark.task.outcome).toEqual(value.task.task.outcome)
    expect(prepared.benchmark.task.repository).toEqual(value.task.task.repository)
    expect(prepared.benchmark.task.outcome).toEqual({ kind: 'workspace' })
    expect(plan.profile).toEqual({
      planDigest: prepared.profilePlan.value.digest,
      targetWorkspace: 'task',
      mountPaths: ['AGENTS.md'],
    })
    expect(plan.launch.env.TANGLE_CANDIDATE_TASK_PATH?.value).toBe('/tangle/input/task.txt')
    expect(Buffer.from(prepared.instruction.bytes)).toEqual(
      Buffer.from(value.task.task.instruction),
    )
    expect(Buffer.from(prepared.executionPlan.bytes)).toEqual(
      Buffer.from(prepared.executionPlan.value.artifact.content, 'base64'),
    )
    expect(prepared.materializationReceipt.bytes.byteLength).toBeGreaterThan(0)
    expect(JSON.stringify(plan)).not.toContain(value.task.task.instruction)
    expect(JSON.stringify(prepared)).not.toContain('MODEL_GATEWAY_TOKEN')
    expect(JSON.stringify(prepared)).not.toContain('protected')
    expect(plan.model.access.network).toEqual({
      mode: 'gateway-only',
      domains: ['router.tangle.tools'],
    })
  })

  it('rejects a self-rehashed profile activation whose native file differs from its plan', async () => {
    const value = fixture()
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(value.bundle, value.ports),
      value.task,
      value.ports,
    )
    const { digest: _digest, ...activation } = prepared.profileActivation
    const [first, ...rest] = activation.files
    if (!first) throw new Error('fixture profile activation has no native files')
    const forged = canonicalCandidateDocument({
      ...activation,
      files: [{ ...first, content: `${first.content}\nforged` }, ...rest],
    }).value

    expect(() =>
      parseAgentCandidateProfileActivation(forged, prepared.profilePlan.value.digest),
    ).toThrow(/must match the canonical plan/)
  })

  it('keeps argv task bytes out of fixed args and exposes deterministic delivery separately', async () => {
    const value = fixture()
    value.bundle = bundle({ instructionDelivery: { kind: 'argv-append' } })
    bindCandidateFixtureBundle(value)
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(value.bundle, value.ports),
      value.task,
      value.ports,
    )
    expect(prepared.launch.args).not.toContain(value.task.task.instruction)
    expect(prepared.instruction).toMatchObject({ delivery: { kind: 'argv-append' } })
  })

  it('materializes and binds an active candidate entrypoint without task-root overlap', async () => {
    const value = fixture(true)
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(value.bundle, value.ports),
      value.task,
      value.ports,
    )
    expect(prepared.launch).toMatchObject({
      executable: 'node',
      args: ['/opt/candidate/run.js'],
      cwd: '/workspace/task',
    })
    expect(prepared.materializationReceipt.value.entrypoint).toMatchObject({ path: 'run.js' })
    expect(prepared.executionPlan.value.material.candidateWorkspace?.digest).toBe(
      value.bundle.execution.workspace?.digest,
    )
  })

  it.each([
    { field: 'tools', profileValue: { shell: false } },
    { field: 'permissions', profileValue: { shell: 'deny' } },
    { field: 'modes', profileValue: { review: { model: 'provider/model' } } },
    { field: 'confidential', profileValue: { tee: 'tdx', sealed: true } },
  ] as const)(
    'rejects non-empty $field before staging or reserving protected access',
    async ({ field, profileValue }) => {
      const value = fixture()
      value.bundle = redigestBundle(value.bundle, {
        profile: {
          ...value.bundle.profile,
          [field]: profileValue,
        } as AgentCandidateBundle['profile'],
      })
      bindCandidateFixtureBundle(value)
      let stagingCalls = 0
      let reservationCalls = 0
      value.ports.workspaces.materialize = async () => {
        stagingCalls++
      }
      value.ports.models.reserveGrant = async () => {
        reservationCalls++
        throw new Error('candidate must fail before reserving protected access')
      }

      await expect(verifyAgentCandidateBundle(value.bundle, value.ports)).rejects.toThrow(
        new RegExp(`non-empty AgentProfile fields: ${field}`),
      )
      expect(stagingCalls).toBe(0)
      expect(reservationCalls).toBe(0)
    },
  )

  it('accepts explicit empty unsupported fields', async () => {
    const value = fixture()
    value.bundle = redigestBundle(value.bundle, {
      profile: {
        ...value.bundle.profile,
        tools: {},
        permissions: {},
        modes: {},
      },
    })
    bindCandidateFixtureBundle(value)

    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(value.bundle, value.ports),
      value.task,
      value.ports,
    )
    expect(prepared.bundle.digest).toBe(value.bundle.digest)
  })

  it('rejects task Git drift, dirty profile staging, and unenforced model limits', async () => {
    const gitDrift = fixture()
    if (!gitDrift.task.task.repository) throw new Error('expected repository identity')
    replaceCandidateFixtureTask(gitDrift, {
      repository: { ...gitDrift.task.task.repository, baseTree: '0'.repeat(40) },
    })
    await expect(
      prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(gitDrift.bundle, gitDrift.ports),
        gitDrift.task,
        gitDrift.ports,
      ),
    ).rejects.toThrow(/base tree/)

    const outputGitDrift = fixture()
    if (!outputGitDrift.task.task.repository) throw new Error('expected repository identity')
    replaceCandidateFixtureTask(outputGitDrift, {
      outcome: { kind: 'output', mediaType: 'application/json', maxBytes: 1_024 },
      repository: { ...outputGitDrift.task.task.repository, baseTree: '0'.repeat(40) },
    })
    await expect(
      prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(outputGitDrift.bundle, outputGitDrift.ports),
        outputGitDrift.task,
        outputGitDrift.ports,
      ),
    ).rejects.toThrow(/base tree/)

    const profileDrift = fixture()
    writeFileSync(join(profileDrift.task.stagingRoots.profileRoot, 'stale'), 'stale')
    await expect(
      prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(profileDrift.bundle, profileDrift.ports),
        profileDrift.task,
        profileDrift.ports,
      ),
    ).rejects.toThrow(/must be empty/)

    const unenforced = fixture()
    let settledReservations = 0
    unenforced.ports.models.reserveGrant = async ({ preparationId, expiresAtMs, limits }) => ({
      preparationId,
      digest: sha('c'),
      expiresAtMs,
      enforcedLimits: { ...limits, maxCostUsd: limits.maxCostUsd + 1 },
      network: { mode: 'gateway-only', domains: ['router.tangle.tools'] },
    })
    unenforced.ports.models.settleGrant = async ({ preparationId }) => {
      settledReservations++
      return { preparationId, grantDigest: sha('c'), closed: true, calls: [] }
    }
    await expect(
      prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(unenforced.bundle, unenforced.ports),
        unenforced.task,
        unenforced.ports,
      ),
    ).rejects.toThrow(/does not enforce/)
    expect(settledReservations).toBe(1)
  })

  it('requires a frozen model gateway only when model calls are allowed', async () => {
    const invalid = fixture()
    let settledReservations = 0
    invalid.ports.models.reserveGrant = async ({ preparationId, expiresAtMs, limits }) => ({
      preparationId,
      digest: sha('c'),
      expiresAtMs,
      enforcedLimits: limits,
      network: { mode: 'disabled' },
    })
    invalid.ports.models.settleGrant = async ({ preparationId }) => {
      settledReservations++
      return { preparationId, grantDigest: sha('c'), closed: true, calls: [] }
    }
    await expect(
      prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(invalid.bundle, invalid.ports),
        invalid.task,
        invalid.ports,
      ),
    ).rejects.toThrow(/wrong network policy/)
    expect(settledReservations).toBe(1)

    const zeroCall = fixture()
    replaceCandidateFixtureTask(zeroCall, {
      limits: {
        ...zeroCall.task.task.limits,
        maxModelCalls: 0,
        maxInputTokens: 0,
        maxOutputTokens: 0,
        maxCostUsd: 0,
      },
    })
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(zeroCall.bundle, zeroCall.ports),
      zeroCall.task,
      zeroCall.ports,
    )
    expect(prepared.executionPlan.value.material.model.access.network).toEqual({
      mode: 'disabled',
    })
  })

  it('bounds failed-preparation cleanup and rejects another preparation settlement', async () => {
    const hanging = fixture()
    hanging.ports.models.reserveGrant = async ({ preparationId, expiresAtMs, limits }) => ({
      preparationId,
      digest: sha('c'),
      expiresAtMs,
      enforcedLimits: { ...limits, maxModelCalls: limits.maxModelCalls + 1 },
      network: { mode: 'gateway-only', domains: ['router.tangle.tools'] },
    })
    hanging.ports.models.settleGrant = async () => await new Promise<never>(() => undefined)
    const startedAt = Date.now()
    await expect(
      prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(hanging.bundle, hanging.ports),
        hanging.task,
        hanging.ports,
        { cleanupTimeoutMs: 20 },
      ),
    ).rejects.toThrow(/cleanup failed/)
    expect(Date.now() - startedAt).toBeLessThan(250)

    const mismatched = fixture()
    mismatched.ports.models.reserveGrant = async ({ preparationId, expiresAtMs, limits }) => ({
      preparationId,
      digest: sha('c'),
      expiresAtMs,
      enforcedLimits: { ...limits, maxModelCalls: limits.maxModelCalls + 1 },
      network: { mode: 'gateway-only', domains: ['router.tangle.tools'] },
    })
    mismatched.ports.models.settleGrant = async () => ({
      preparationId: `candidate-preparation.${'A'.repeat(43)}`,
      grantDigest: sha('c'),
      closed: true,
      calls: [],
    })
    await expect(
      prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(mismatched.bundle, mismatched.ports),
        mismatched.task,
        mismatched.ports,
      ),
    ).rejects.toThrow(/cleanup failed/)
  })

  it('rejects a cost limit that cannot be represented by the protected integer ledger', async () => {
    const value = fixture()
    replaceCandidateFixtureTask(value, {
      limits: { ...value.task.task.limits, maxCostUsd: 10 ** 20 },
    })
    let reservations = 0
    value.ports.models.reserveGrant = async () => {
      reservations++
      throw new Error('must not reserve')
    }
    await expect(
      prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(value.bundle, value.ports),
        value.task,
        value.ports,
      ),
    ).rejects.toThrow(/fixed-point range/)
    expect(reservations).toBe(0)
  })

  it('rejects a wall-time limit that Node would clamp to an immediate timer', async () => {
    const value = fixture()
    replaceCandidateFixtureTask(value, {
      limits: {
        ...value.task.task.limits,
        timeoutMs: MAX_CANDIDATE_TIMER_INTERVAL_MS + 1,
      },
    })
    let reservations = 0
    value.ports.models.reserveGrant = async () => {
      reservations++
      throw new Error('must not reserve')
    }
    await expect(
      prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(value.bundle, value.ports),
        value.task,
        value.ports,
      ),
    ).rejects.toThrow(/limits are invalid/)
    expect(reservations).toBe(0)
  })

  it('rejects unsigned hidden bytes in an active candidate workspace', async () => {
    const value = fixture(true)
    if (!value.candidateRoot) throw new Error('fixture missing candidate root')
    mkdirSync(join(value.candidateRoot, '.sidecar'))
    writeFileSync(join(value.candidateRoot, '.sidecar', 'hidden.js'), 'malicious')
    await expect(
      prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(value.bundle, value.ports),
        value.task,
        value.ports,
      ),
    ).rejects.toThrow(/do not match|unsupported mode/)
  })

  it('resets task memory into an execution-scoped namespace', async () => {
    const value = fixture()
    value.task.executionId = '..'
    const seedBytes = Buffer.from('seed-memory')
    const knowledgeBytes = Buffer.from('{"documents":[]}')
    const seed = {
      locator: { kind: 's3' as const, bucket: 'test-artifacts', key: 'memory/seed.bin' },
      sha256: embeddedCandidateArtifact(seedBytes).sha256,
      byteLength: seedBytes.byteLength,
    }
    const knowledgeSnapshot = emptySnapshot('knowledge')
    const retrievalConfig = embeddedCandidateArtifact(knowledgeBytes)
    const evaluation = embeddedCandidateArtifact(Buffer.from('{"score":1}'))
    const emptyKnowledgeHash = sha256DigestSchema.parse(
      `sha256:${await hashKnowledgeBase(value.task.stagingRoots.profileRoot)}`,
    )
    value.bundle = redigestBundle(value.bundle, {
      memory: { mode: 'isolated', scope: 'task', seed },
      knowledge: {
        candidate: {
          kind: 'knowledge-improvement-candidate',
          runId: 'knowledge-run-1',
          candidateId: 'knowledge-1',
          goalHash: sha('1'),
          baseHash: sha('2'),
          candidateHash: emptyKnowledgeHash,
          evidenceHash: sha('4'),
          promotionPlanHash: sha('5'),
        },
        snapshot: knowledgeSnapshot,
        retrievalConfig,
        evaluation,
      },
    })
    bindCandidateFixtureBundle(value)
    value.ports.artifacts.read = async (ref) => {
      if (ref.sha256 === seed.sha256) return seedBytes
      throw new Error(`unexpected artifact ${ref.sha256}`)
    }
    let resetInput: Parameters<AgentCandidateExecutionPorts['memory']['reset']>[0] | undefined
    value.ports.memory.reset = async (input) => {
      resetInput = input
      return {
        preparationId: input.preparationId,
        accessDigest: sha('8'),
        expiresAtMs: input.expiresAtMs,
        evidence: embeddedCandidateArtifact(Buffer.from('fresh-reset')),
        emptyStateDigest: sha('7'),
        beforeState: emptySnapshot('before'),
      }
    }
    value.ports.memory.close = async () => ({ closed: true })
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(value.bundle, value.ports),
      value.task,
      value.ports,
    )
    expect(Buffer.from(resetInput?.seed ?? [])).toEqual(seedBytes)
    expect(resetInput?.effectiveNamespace).not.toContain('..')
    expect(resetInput?.effectiveNamespace.split('/')).toHaveLength(5)
    expect(prepared.memory).toMatchObject({
      mode: 'isolated',
      seedDigest: seed.sha256,
    })
    expect(JSON.stringify(prepared)).not.toContain('TANGLE_MEMORY_NAMESPACE')
    expect(prepared.knowledge).toMatchObject({
      candidate: { candidateId: 'knowledge-1' },
      snapshot: { digest: knowledgeSnapshot.digest },
      files: [],
    })
    expect(Buffer.from(prepared.knowledge?.retrievalConfig ?? [])).toEqual(knowledgeBytes)
    expect(prepared.launch.env).toMatchObject({
      [CANDIDATE_KNOWLEDGE_ROOT_ENV]: '/workspace/task/.tangle/knowledge',
      [CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG_ENV]:
        '/workspace/task/.tangle/knowledge-retrieval-config.json',
    })
    expect(prepared.executionPlan.value.material.launch.env).toMatchObject({
      [CANDIDATE_KNOWLEDGE_ROOT_ENV]: {
        kind: 'public',
        value: '/workspace/task/.tangle/knowledge',
      },
      [CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG_ENV]: {
        kind: 'public',
        value: '/workspace/task/.tangle/knowledge-retrieval-config.json',
      },
    })
  })

  it('rejects materialized knowledge that does not match the measured candidate', async () => {
    const value = fixture()
    const knowledgeSnapshot = emptySnapshot('mismatched-knowledge')
    value.bundle = redigestBundle(value.bundle, {
      knowledge: {
        candidate: {
          kind: 'knowledge-improvement-candidate',
          runId: 'knowledge-run-mismatch',
          candidateId: 'knowledge-mismatch',
          goalHash: sha('1'),
          baseHash: sha('2'),
          candidateHash: sha('3'),
          evidenceHash: sha('4'),
          promotionPlanHash: sha('5'),
        },
        snapshot: knowledgeSnapshot,
        evaluation: embeddedCandidateArtifact(Buffer.from('{"score":1}')),
      },
    })
    bindCandidateFixtureBundle(value)
    let settledReservations = 0
    const settleGrant = value.ports.models.settleGrant
    value.ports.models.settleGrant = async (input) => {
      settledReservations += 1
      return await settleGrant(input)
    }

    await expect(
      prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(value.bundle, value.ports),
        value.task,
        value.ports,
      ),
    ).rejects.toThrow(/materialized candidate knowledge does not match its measured content/)
    expect(settledReservations).toBe(1)
  })

  it('rejects snapshot-only knowledge before artifact access', async () => {
    const value = fixture()
    const bytes = Buffer.from('{"documents":[]}')
    const manifest = {
      locator: { kind: 's3' as const, bucket: 'test-artifacts', key: 'knowledge/manifest.json' },
      sha256: embeddedCandidateArtifact(bytes).sha256,
      byteLength: bytes.byteLength,
    }
    value.bundle = redigestBundle(value.bundle, {
      knowledge: { snapshotId: 'knowledge-1', manifest },
    })
    bindCandidateFixtureBundle(value)
    let reads = 0
    value.ports.artifacts.read = async () => {
      reads++
      return bytes
    }

    await expect(verifyAgentCandidateBundle(value.bundle, value.ports)).rejects.toThrow(
      /"knowledge"[\s\S]*"candidate"/,
    )
    expect(reads).toBe(0)
  })

  it('closes memory immediately when reset evidence fails before preparation can retain it', async () => {
    const value = fixture()
    value.bundle = redigestBundle(value.bundle, {
      memory: { mode: 'isolated', scope: 'task' },
    })
    bindCandidateFixtureBundle(value)
    const before = emptySnapshot('malformed-reset')
    const closed: string[] = []
    value.ports.memory.reset = async ({ preparationId, expiresAtMs }) => ({
      preparationId,
      accessDigest: 'sha256:not-a-digest' as `sha256:${string}`,
      expiresAtMs,
      evidence: before.manifest,
      emptyStateDigest: before.digest,
      beforeState: before,
    })
    value.ports.memory.close = async ({ preparationId, reason }) => {
      closed.push(`${preparationId}:${reason}`)
      return { closed: true }
    }
    await expect(
      prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(value.bundle, value.ports),
        value.task,
        value.ports,
      ),
    ).rejects.toThrow(/not scoped/)
    expect(closed).toHaveLength(1)
    expect(closed[0]).toMatch(/candidate-preparation\..+:preparation-failed/)
  })
})
