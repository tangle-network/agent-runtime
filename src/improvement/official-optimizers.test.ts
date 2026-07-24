import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DispatchContext, JudgeConfig, Scenario } from '@tangle-network/agent-eval/contract'
import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it } from 'vitest'
import { improve } from './improve'
import {
  OfficialOptimizerUnavailableError,
  officialGepa,
  officialSkillOpt,
} from './official-optimizers'
import type { ReadonlyAgentProfile } from './profile-types'

interface OptimizerScenario extends Scenario {
  kind: 'fixture'
  prompt: string
  privateNote: string
}

interface Artifact {
  text: string
  privateDetail?: string
}

const profile: AgentProfile = {
  name: 'optimizer-fixture',
  prompt: { systemPrompt: 'baseline' },
}

const judge: JudgeConfig<Artifact, OptimizerScenario> = {
  name: 'improvement',
  dimensions: [{ key: 'quality', description: 'candidate is improved' }],
  score: ({ artifact }) => {
    const quality = artifact.text === 'improved prompt' ? 1 : 0
    return { dimensions: { quality }, composite: quality, notes: '' }
  },
}

async function agent(
  candidate: ReadonlyAgentProfile,
  _scenario: OptimizerScenario,
  ctx: DispatchContext,
): Promise<Artifact> {
  const paid = await ctx.cost.runPaidCall({
    channel: 'agent',
    actor: 'official-optimizer-test',
    model: 'deterministic-test',
    maximumCharge: { externallyEnforcedMaximumUsd: 0.0001 },
    execute: async () => ({ text: candidate.prompt?.systemPrompt ?? '' }),
    receipt: () => ({
      model: 'deterministic-test',
      inputTokens: 1,
      outputTokens: 1,
      actualCostUsd: 0.0001,
    }),
  })
  if (!paid.succeeded) throw paid.error
  return paid.value
}

const train: OptimizerScenario[] = [
  { id: 'train', kind: 'fixture', prompt: 'visible train', privateNote: 'TRAIN_SECRET' },
]
const selection: OptimizerScenario[] = [
  {
    id: 'selection',
    kind: 'fixture',
    prompt: 'visible selection',
    privateNote: 'SELECTION_SECRET',
  },
]
const testCases: OptimizerScenario[] = [
  { id: 'test-a', kind: 'fixture', prompt: 'private test a', privateNote: 'TEST_SECRET_A' },
  { id: 'test-b', kind: 'fixture', prompt: 'private test b', privateNote: 'TEST_SECRET_B' },
]
const executionRef = canonicalCandidateDigest({ fixture: 'official-optimizer-method' })
const evaluationRef = canonicalCandidateDigest({
  executionRef,
  baselineProfileDigest: canonicalCandidateDigest(profile),
  surface: 'prompt',
})

const runDirs: string[] = []

afterEach(() => {
  for (const runDir of runDirs.splice(0)) {
    rmSync(runDir, { recursive: true, force: true })
  }
})

function runDir(): string {
  const value = mkdtempSync(join(tmpdir(), 'runtime-official-optimizer-'))
  runDirs.push(value)
  return value
}

function fakeRunner(
  optimizer: 'gepa' | 'skillopt',
  observedInputPath: string,
  callback?: {
    exampleId: string
    responsePath: string
  },
) {
  const optimizerSource = {
    package: optimizer,
    version: optimizer === 'gepa' ? 'test' : '0.2.0',
    ...(optimizer === 'gepa' ? { revision: 'test-revision' } : {}),
    sourceSha256: optimizer === 'gepa' ? 'b'.repeat(64) : 'c'.repeat(64),
  }
  const output =
    optimizer === 'gepa'
      ? [
          '  bestCandidate: "improved prompt",',
          '  bestScore: 1,',
          `  totalEvaluations: ${callback ? 1 : 0},`,
          '  recipeKind: input.recipe.kind,',
          '  tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0 },',
          '  proposerCostAccounting: "unavailable",',
          '  upstream: optimizerSource,',
        ]
      : [
          '  bestCandidate: "improved prompt",',
          '  bestScore: 1,',
          `  totalEvaluations: ${callback ? 1 : 0},`,
          '  totalSteps: 0,',
          '  tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0 },',
          '  upstream: optimizerSource,',
        ]
  const source = [
    "const fs = require('node:fs')",
    ';(async () => {',
    "const inputPath = process.argv[process.argv.indexOf('--input') + 1]",
    "const outputPath = process.argv[process.argv.indexOf('--output') + 1]",
    'const input = JSON.parse(fs.readFileSync(inputPath, "utf8"))',
    `const optimizerSource = ${JSON.stringify(optimizerSource)}`,
    'if (input.operation === "inspect") {',
    '  fs.writeFileSync(outputPath, JSON.stringify({ runtime: {',
    '    python: { implementation: "CPython", version: "3.12.0" },',
    '    bridge: { package: "agent-eval-rpc", version: "0.126.1", sourceSha256: "a".repeat(64) },',
    '    optimizer: optimizerSource,',
    '    engineModules: [],',
    '  } }))',
    '  process.exit(0)',
    '}',
    `fs.writeFileSync(${JSON.stringify(observedInputPath)}, JSON.stringify(input))`,
    ...(callback
      ? [
          'const callbackResponse = await fetch(input.callbackUrl, {',
          '  method: "POST",',
          '  headers: {',
          '    authorization: "Bearer " + input.callbackToken,',
          '    "content-type": "application/json",',
          '  },',
          `  body: JSON.stringify({ candidate: "improved prompt", exampleId: ${JSON.stringify(callback.exampleId)} }),`,
          '})',
          'if (!callbackResponse.ok) throw new Error("callback failed: " + callbackResponse.status)',
          'const callbackBody = await callbackResponse.json()',
          `fs.writeFileSync(${JSON.stringify(callback.responsePath)}, JSON.stringify(callbackBody))`,
        ]
      : []),
    'fs.writeFileSync(outputPath, JSON.stringify({',
    ...output,
    '  runId: input.runId,',
    '  resumed: false,',
    '}))',
    '})().catch((error) => { process.stderr.write(String(error?.stack ?? error)); process.exit(1) })',
  ].join('\n')
  return {
    command: process.execPath,
    args: ['-e', source, '--'],
  }
}

function failingRunner(message: string) {
  return {
    command: process.execPath,
    args: ['-e', `process.stderr.write(${JSON.stringify(message)}); process.exit(1)`, '--'],
  }
}

const testOptimizer = {
  model: 'optimizer-model',
  baseUrl: 'http://127.0.0.1:1/v1',
  apiKey: 'test-api-key',
  budget: {
    maxCostUsd: 1,
    maxRequests: 10,
    maxRequestBytes: 100_000,
    maxResponseBytes: 100_000,
    maxOutputTokensPerRequest: 1_000,
    pricing: {
      inputUsdPerMillion: 1,
      outputUsdPerMillion: 1,
    },
  },
}

function commonOptions(method: ReturnType<typeof officialGepa<OptimizerScenario, Artifact>>) {
  return {
    surface: 'prompt' as const,
    executionRef,
    method,
    findings: [{ claim: 'answers omit citations' }],
    trainScenarios: train,
    selectionScenarios: selection,
    testScenarios: testCases,
    judges: [judge],
    agent,
    runDir: runDir(),
    resamples: 40,
    confidence: 0.95,
  }
}

describe('official optimizer methods', () => {
  it('runs the explicit GEPA engine recipe without exposing final-test data', async () => {
    const root = runDir()
    const observedInputPath = join(root, 'observed-input.json')
    const result = await improve(profile, {
      ...commonOptions(
        officialGepa<OptimizerScenario, Artifact>({
          objective: 'Improve the agent prompt.',
          recipe: {
            kind: 'engine',
            run: {
              engine: 'gepa',
              maxEvaluations: 3,
              maxProposerCostUsd: 1,
            },
          },
          optimizer: testOptimizer,
          resume: 'if-compatible',
          trustResumeState: true,
          describeScenario: (scenario: OptimizerScenario) => ({ prompt: scenario.prompt }),
          runner: fakeRunner('gepa', observedInputPath),
        }),
      ),
      runDir: join(root, 'run'),
    })

    const observed = JSON.parse(readFileSync(observedInputPath, 'utf8')) as Record<string, unknown>
    expect(observed).toMatchObject({
      evaluationId: evaluationRef,
      resume: 'if-compatible',
      trustedResumeState: true,
      recipe: {
        kind: 'engine',
        run: {
          engine: 'gepa',
          maxEvaluations: 3,
          maxProposerCostUsd: 1,
        },
      },
      trainSet: [{ id: 'train', data: { prompt: 'visible train' } }],
      selectionSet: [{ id: 'selection', data: { prompt: 'visible selection' } }],
    })
    expect(observed).not.toHaveProperty('version')
    expect(String(observed.background)).toContain('answers omit citations')
    expect(JSON.stringify(observed)).not.toContain('SECRET')
    expect(observed).not.toHaveProperty('testSet')
    expect(result.method).toBe('gepa:gepa')
    expect(result.provenance).toMatchObject({
      source: { package: 'gepa', version: 'test' },
      runId: observed.runId,
      resumed: false,
      evaluationCount: 0,
    })
    expect(result.decision).toBe('ship')
    expect(result.candidate.profile?.prompt?.systemPrompt).toBe('improved prompt')
  })

  it('passes the official Omni recipe through unchanged', async () => {
    const root = runDir()
    const observedInputPath = join(root, 'observed-omni.json')
    const recipe = {
      kind: 'omni' as const,
      explore: [
        { engine: 'gepa', maxEvaluations: 2, maxProposerCostUsd: 1 },
        { engine: 'autoresearch', maxEvaluations: 3, maxProposerCostUsd: 2 },
        { engine: 'meta_harness', maxEvaluations: 4, maxProposerCostUsd: 3 },
      ],
      continueWith: {
        engine: 'gepa',
        maxEvaluations: 5,
        maxProposerCostUsd: 4,
      },
      maxWorkers: 3,
    }
    const result = await improve(profile, {
      ...commonOptions(
        officialGepa<OptimizerScenario, Artifact>({
          objective: 'Improve the agent prompt.',
          recipe,
          describeScenario: (scenario: OptimizerScenario) => ({ prompt: scenario.prompt }),
          runner: fakeRunner('gepa', observedInputPath),
        }),
      ),
      runDir: join(root, 'run'),
    })

    const observed = JSON.parse(readFileSync(observedInputPath, 'utf8')) as {
      recipe: unknown
    }
    expect(observed.recipe).toEqual(recipe)
    expect(result.method).toBe('gepa:omni:gepa')
  })

  it('runs official Microsoft SkillOpt with the same findings and data boundary', async () => {
    const root = runDir()
    const observedInputPath = join(root, 'observed-skillopt.json')
    const result = await improve(profile, {
      ...commonOptions(
        officialSkillOpt<OptimizerScenario, Artifact>({
          objective: 'Improve the agent prompt.',
          trainer: {
            epochs: 1,
            batchSize: 1,
          },
          optimizer: testOptimizer,
          maxEvaluations: 3,
          resume: 'if-compatible',
          describeScenario: (scenario: OptimizerScenario) => ({ prompt: scenario.prompt }),
          runner: fakeRunner('skillopt', observedInputPath),
        }),
      ),
      runDir: join(root, 'run'),
    })

    const observed = JSON.parse(readFileSync(observedInputPath, 'utf8')) as Record<string, unknown>
    expect(observed).toMatchObject({
      evaluationId: evaluationRef,
      resume: 'if-compatible',
      trainer: {
        epochs: 1,
        batchSize: 1,
      },
      trainSet: [{ id: 'train', data: { prompt: 'visible train' } }],
      selectionSet: [{ id: 'selection', data: { prompt: 'visible selection' } }],
    })
    expect(observed).not.toHaveProperty('version')
    expect(observed.trainer).toEqual({ epochs: 1, batchSize: 1 })
    expect(String(observed.background)).toContain('answers omit citations')
    expect(JSON.stringify(observed)).not.toContain('SECRET')
    expect(JSON.stringify(observed)).not.toContain('test-api-key')
    expect(observed).not.toHaveProperty('testSet')
    expect(result.method).toBe('skillopt')
    expect(result.provenance).toMatchObject({
      source: { package: 'skillopt', version: '0.2.0' },
      runId: observed.runId,
      resumed: false,
      evaluationCount: 0,
    })
    expect(result.decision).toBe('ship')
  })

  it.each([
    [
      'gepa',
      'gepa-ai/gepa.git@f919db0a622e2e9f9204779b81fe00cc1b2d808f',
      () =>
        officialGepa<OptimizerScenario, Artifact>({
          objective: 'Improve the agent prompt.',
          recipe: {
            kind: 'engine',
            run: { engine: 'gepa', maxEvaluations: 1, maxProposerCostUsd: 1 },
          },
          runner: { command: '/definitely/missing/python' },
        }),
    ],
    [
      'skillopt',
      'microsoft/SkillOpt.git@61735e3922efc2b90c6d6cab561e62e98452ca90',
      () =>
        officialSkillOpt<OptimizerScenario, Artifact>({
          objective: 'Improve the agent prompt.',
          trainer: {
            epochs: 1,
            batchSize: 1,
          },
          optimizer: testOptimizer,
          maxEvaluations: 3,
          runner: {
            command: '/definitely/missing/python',
          },
        }),
    ],
  ] as const)('fails clearly instead of falling back when %s is unavailable', async (optimizer, installFragment, method) => {
    await expect(
      improve(profile, {
        ...commonOptions(method()),
      }),
    ).rejects.toMatchObject({
      name: 'OfficialOptimizerUnavailableError',
      optimizer,
      message: expect.stringMatching(
        new RegExp(
          `Runtime did not use a local fallback[\\s\\S]*${installFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        ),
      ),
    } satisfies Partial<OfficialOptimizerUnavailableError>)
  })

  it('does not relabel an unrelated optimizer process failure as a missing dependency', async () => {
    const method = officialGepa<OptimizerScenario, Artifact>({
      objective: 'Improve the agent prompt.',
      recipe: {
        kind: 'engine',
        run: { engine: 'gepa', maxEvaluations: 1, maxProposerCostUsd: 1 },
      },
      runner: failingRunner(
        'RuntimeError in agent_eval_rpc.gepa_bridge: application-owned callback failed',
      ),
    })

    let failure: unknown
    try {
      await improve(profile, { ...commonOptions(method) })
    } catch (cause) {
      failure = cause
    }
    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toBeInstanceOf(OfficialOptimizerUnavailableError)
    expect((failure as Error).message).toContain('application-owned callback failed')
  })

  it('redacts common private values from findings before starting the optimizer', async () => {
    const root = runDir()
    const observedInputPath = join(root, 'observed-redacted-findings.json')
    const privateValue = 'sk-private-finding-value-123456789'
    const result = await improve(profile, {
      ...commonOptions(
        officialGepa<OptimizerScenario, Artifact>({
          objective: 'Improve the agent prompt.',
          recipe: {
            kind: 'engine',
            run: { engine: 'gepa', maxEvaluations: 1, maxProposerCostUsd: 1 },
          },
          optimizer: testOptimizer,
          runner: fakeRunner('gepa', observedInputPath),
        }),
      ),
      findings: [{ claim: 'answers omit citations', apiKey: privateValue }],
      runDir: join(root, 'run'),
    })

    const observed = readFileSync(observedInputPath, 'utf8')
    expect(observed).not.toContain(privateValue)
    expect(observed).toContain('[redacted]')
    expect(result.decision).toBe('ship')
  })

  it('redacts artifact details and judge notes at the optimizer callback boundary', async () => {
    const root = runDir()
    const observedInputPath = join(root, 'observed-redacted-evidence-input.json')
    const observedResponsePath = join(root, 'observed-redacted-evidence-response.json')
    const privateArtifact = 'sk-private-artifact-value-123456789'
    const privateNote = 'sk-private-judge-note-123456789'
    const evidenceJudge: JudgeConfig<Artifact, OptimizerScenario> = {
      ...judge,
      score: ({ artifact }) => ({
        dimensions: { quality: artifact.text === 'improved prompt' ? 1 : 0 },
        composite: artifact.text === 'improved prompt' ? 1 : 0,
        notes: `Internal judge detail: ${privateNote}`,
      }),
    }
    const result = await improve(profile, {
      ...commonOptions(
        officialGepa<OptimizerScenario, Artifact>({
          objective: 'Improve the agent prompt.',
          recipe: {
            kind: 'engine',
            run: { engine: 'gepa', maxEvaluations: 1, maxProposerCostUsd: 1 },
          },
          optimizer: testOptimizer,
          describeArtifact: (artifact) => artifact,
          runner: fakeRunner('gepa', observedInputPath, {
            exampleId: 'train',
            responsePath: observedResponsePath,
          }),
        }),
      ),
      judges: [evidenceJudge],
      agent: async (candidate, scenario, ctx) => ({
        ...(await agent(candidate, scenario, ctx)),
        privateDetail: privateArtifact,
      }),
      runDir: join(root, 'run'),
    })

    const observed = readFileSync(observedResponsePath, 'utf8')
    expect(observed).not.toContain(privateArtifact)
    expect(observed).not.toContain(privateNote)
    expect(observed).toContain('[redacted]')
    expect(result.provenance?.evaluationCount).toBe(1)
    expect(result.decision).toBe('ship')
  })

  it('rejects a private profile surface before starting an external optimizer', async () => {
    const privateValue = 'sk-private-profile-value-123456789'
    await expect(
      improve(
        {
          name: 'optimizer-fixture',
          prompt: { systemPrompt: `Use ${privateValue}` },
        },
        {
          ...commonOptions(
            officialGepa<OptimizerScenario, Artifact>({
              objective: 'Improve the agent prompt.',
              recipe: {
                kind: 'engine',
                run: { engine: 'gepa', maxEvaluations: 1, maxProposerCostUsd: 1 },
              },
              optimizer: testOptimizer,
              runner: failingRunner('runner must not start'),
            }),
          ),
        },
      ),
    ).rejects.toThrow(/selected profile surface contains a common credential or private value/)
  })
})
