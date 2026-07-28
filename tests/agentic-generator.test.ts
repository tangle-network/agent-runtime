import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { CostLedger, makeProposalFinding, type ProposalFinding } from '@tangle-network/agent-eval'
import {
  gitWorktreeAdapter,
  inMemoryCampaignStorage,
  isProposedCandidate,
  type JudgeConfig,
  type ProposeContext,
  runOptimization,
  type Scenario,
} from '@tangle-network/agent-eval/campaign'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENTIC_PROFILE_RESOURCE_ROOT,
  type AgenticGeneratorShotDisposition,
  type AgenticGeneratorShotExecution,
  type AgenticGeneratorShotReceipt,
  agenticGenerator,
  commandVerifier,
} from '../src/improvement'
import { improvementDriver } from '../src/improvement/improvement-driver'
import type { LocalHarnessResult } from '../src/mcp/local-harness'

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

async function waitForPath(path: string, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`)
    await delay(10)
  }
}

let repoRoot: string
beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'agentic-repo-'))
  git(['init', '-q', '-b', 'main'], repoRoot)
  git(['config', 'user.email', 'test@test.dev'], repoRoot)
  git(['config', 'user.name', 'Test'], repoRoot)
  const emptyHooks = join(repoRoot, '.empty-hooks')
  mkdirSync(emptyHooks)
  git(['config', 'core.hooksPath', emptyHooks], repoRoot)
  writeFileSync(join(repoRoot, 'app.ts'), 'export const x = 1\n')
  git(['add', '-A'], repoRoot)
  git(['commit', '-q', '-m', 'init'], repoRoot)
})
afterEach(() => rmSync(repoRoot, { recursive: true, force: true }))

const FINDINGS = [
  makeProposalFinding({
    analyst_id: 'a1',
    proposal_origin: 'production',
    severity: 'high',
    area: 'correctness',
    claim: 'x should be 2',
    recommended_action: 'set x to 2',
    evidence_refs: [],
    confidence: 0.9,
    subject: 'app.ts',
    produced_at: '2026-01-01',
  }),
]

const TRACE_PATH = '/tmp/run/gen-0/candidate-0/task_0/spans.jsonl'
const RAW_TRACE_FINDINGS = [
  makeProposalFinding({
    analyst_id: 'raw-trace-distiller',
    proposal_origin: 'search',
    severity: 'high',
    area: 'raw-trace-context',
    claim: 'candidate failed after reading stale state',
    recommended_action: `grep/cat ${TRACE_PATH} before editing`,
    evidence_refs: [{ kind: 'artifact', uri: TRACE_PATH }],
    confidence: 1,
    subject: 'candidate-hash',
    produced_at: '2026-01-01',
  }),
]

const HARNESS_OK: LocalHarnessResult = {
  exitCode: 0,
  stdout: 'done',
  stderr: '',
  killedBySignal: null,
  durationMs: 10,
  timedOut: false,
}

const CODEX_USAGE = {
  inputTokens: 120,
  cachedInputTokens: 20,
  outputTokens: 30,
  reasoningOutputTokens: 10,
}

const CODEX_EVIDENCE = {
  cliVersion: 'codex-cli 1.0.0',
  executableSha256: 'a'.repeat(64),
  requestedPromptSha256: 'b'.repeat(64),
  effectivePromptSha256: 'b'.repeat(64),
  nonPromptArgsSha256: 'c'.repeat(64),
  controlledConfigSha256: 'd'.repeat(64),
  readDeniedPaths: ['/tmp/denied'],
  readDeniedPathsSha256: 'e'.repeat(64),
  readDeniedPathCount: 1,
  policy: {},
} as NonNullable<LocalHarnessResult['evidence']>

function ctx(
  findings: ReadonlyArray<ProposalFinding>,
  maxShots = 1,
): ProposeContext<ProposalFinding> {
  return {
    currentSurface: '',
    history: [],
    findings,
    populationSize: 1,
    generation: 0,
    signal: new AbortController().signal,
    maxImprovementShots: maxShots,
  }
}

describe('agenticGenerator — runs a harness in the worktree', () => {
  it('pins the author profile and emits exact usage for every reproducible Codex shot', async () => {
    const receipts: AgenticGeneratorShotReceipt[] = []
    const costLedger = new CostLedger()
    const resourcePath = `${AGENTIC_PROFILE_RESOURCE_ROOT}/trace-analysis.md`
    const profile = {
      name: 'structural-author',
      prompt: {
        systemPrompt: 'AUTHOR SYSTEM',
        instructions: ['Edit only the allowed implementation.'],
      },
      model: { default: 'gpt-5.4', reasoningEffort: 'xhigh' as const },
      resources: {
        files: [
          {
            path: resourcePath,
            resource: {
              kind: 'inline' as const,
              name: 'trace-analysis',
              content: 'Repeated state reads caused stale edits.\n',
            },
          },
        ],
      },
    }
    const runHarness = vi.fn(
      async (options: {
        cwd: string
        taskPrompt: string
        invocation?: { command?: string; args: ReadonlyArray<string> }
        codexReproducible?: boolean
        codexReadDeniedPaths?: ReadonlyArray<string>
      }) => {
        expect(options.codexReproducible).toBe(true)
        expect(options.invocation?.command).toBe('codex')
        expect(options.invocation?.args).toContain('gpt-5.4')
        expect(options.invocation?.args.join('\n')).toContain('AUTHOR SYSTEM')
        expect(options.taskPrompt).toContain(resourcePath)
        expect(readFileSync(join(options.cwd, resourcePath), 'utf8')).toContain('stale edits')
        expect(options.codexReadDeniedPaths).toEqual([`${options.cwd}/private-evidence`])
        writeFileSync(join(options.cwd, 'app.ts'), 'export const x = 2\n')
        const prompt = options.invocation?.args[1]
        if (!prompt) throw new Error('test invocation omitted the composed prompt')
        const promptSha256 = createHash('sha256').update(prompt).digest('hex')
        return {
          ...HARNESS_OK,
          usage: CODEX_USAGE,
          evidence: {
            ...CODEX_EVIDENCE,
            requestedPromptSha256: promptSha256,
            effectivePromptSha256: 'f'.repeat(64),
          },
        }
      },
    )
    const gen = agenticGenerator({
      harness: 'codex',
      profile,
      codexReproducible: true,
      codexReadDeniedPaths: (worktreePath) => [`${worktreePath}/private-evidence`],
      onShotCompleted: (receipt) => receipts.push(receipt),
      runHarness: runHarness as never,
    })

    const wt = await gitWorktreeAdapter({ repoRoot }).create({
      baseRef: 'main',
      label: 'reproducible-receipt',
    })
    const out = await gen.generate({
      worktreePath: wt.path,
      findings: FINDINGS,
      maxShots: 2,
      signal: new AbortController().signal,
      generation: 4,
      candidateIndex: 2,
      costLedger,
      costPhase: 'search.proposal',
    })

    const [costReceipt] = costLedger.list()
    expect(out.applied).toBe(true)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({
      generation: 4,
      candidateIndex: 2,
      shot: 1,
      maxShots: 2,
      harness: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
      usage: CODEX_USAGE,
      profileWorkspacePlanDigest: expect.any(String),
      profileWorkspaceFileCount: 1,
      costCallId: expect.any(String),
      costBasis: 'estimated-pricing',
      costUsdKnown: false,
      error: null,
    })
    expect(receipts[0]?.costCallId).toBe(costReceipt?.callId)
    expect(receipts[0]?.costUsd).toBeCloseTo(0.00045)
    expect(receipts[0]?.promptSha256).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(receipts[0]?.stdoutSha256).toBe(
      `sha256:${createHash('sha256').update(HARNESS_OK.stdout).digest('hex')}`,
    )
    expect(receipts[0]?.evidence?.readDeniedPathCount).toBe(1)
    expect(receipts[0]?.evidence?.effectivePromptSha256).not.toBe(
      receipts[0]?.evidence?.requestedPromptSha256,
    )
    expect(existsSync(join(wt.path, AGENTIC_PROFILE_RESOURCE_ROOT))).toBe(false)
    expect(git(['status', '--short'], wt.path)).toBe('M app.ts')
    expect(costLedger.list()).toEqual([
      expect.objectContaining({
        channel: 'driver',
        phase: 'search.proposal',
        actor: 'agentic-generator:codex',
        model: 'gpt-5.4',
        tags: { generation: '4', candidateIndex: '2', shot: '1' },
        inputTokens: 100,
        cachedTokens: 20,
        outputTokens: 30,
        costUsd: 0.00045,
        costUnknown: false,
      }),
    ])
  })

  it('exposes exact execution before a clean-tree shot is rejected', async () => {
    const events: string[] = []
    const executions: AgenticGeneratorShotExecution[] = []
    const dispositions: AgenticGeneratorShotDisposition[] = []
    const exactExecution: LocalHarnessResult = {
      exitCode: 0,
      stdout: 'exact stdout\nwith a second line\n',
      stderr: 'exact stderr\n',
      killedBySignal: null,
      durationMs: 4321,
      timedOut: false,
      usage: CODEX_USAGE,
      evidence: CODEX_EVIDENCE,
    }
    const isDirty = vi.fn(() => {
      events.push('dirty-check')
      expect(events).toEqual(['callback-complete', 'dirty-check'])
      return false
    })
    const gen = agenticGenerator({
      runHarness: (async () => exactExecution) as never,
      isDirty,
      onShotCompleted: async (receipt, execution) => {
        await Promise.resolve()
        expect(execution).not.toBeNull()
        if (!execution) throw new Error('expected a completed execution')
        executions.push(execution)
        expect(execution).toEqual(exactExecution)
        expect(Object.isFrozen(execution)).toBe(true)
        expect(Object.isFrozen(execution.usage)).toBe(true)
        expect(Object.isFrozen(execution.evidence)).toBe(true)
        expect(Object.isFrozen(execution.evidence?.readDeniedPaths)).toBe(true)
        expect(Object.isFrozen(execution.evidence?.policy)).toBe(true)
        expect(() => Object.assign(execution, { stdout: 'mutated' })).toThrow()
        expect(receipt.stdoutBytes).toBe(Buffer.byteLength(execution.stdout))
        expect(receipt.stderrBytes).toBe(Buffer.byteLength(execution.stderr))
        expect(receipt.stdoutSha256).toBe(
          `sha256:${createHash('sha256').update(execution.stdout).digest('hex')}`,
        )
        expect(receipt.stderrSha256).toBe(
          `sha256:${createHash('sha256').update(execution.stderr).digest('hex')}`,
        )
        events.push('callback-complete')
      },
      onShotDisposition: async (_receipt, disposition) => {
        await Promise.resolve()
        expect(disposition.kind).toBe('clean')
        expect(disposition.worktreePath).toContain('exact-clean-shot')
        dispositions.push(disposition)
        events.push('disposition-complete')
      },
    })
    const wt = await gitWorktreeAdapter({ repoRoot }).create({
      baseRef: 'main',
      label: 'exact-clean-shot',
    })

    const out = await gen.generate({
      worktreePath: wt.path,
      findings: FINDINGS,
      maxShots: 1,
      signal: new AbortController().signal,
    })

    expect(out.applied).toBe(false)
    expect(executions).toEqual([exactExecution])
    expect(dispositions).toEqual([
      expect.objectContaining({ kind: 'clean', worktreePath: wt.path }),
    ])
    expect(events).toEqual(['callback-complete', 'dirty-check', 'disposition-complete'])
    expect(isDirty).toHaveBeenCalledTimes(1)
  })

  it('awaits shot evidence before verification can return a candidate', async () => {
    let evidencePersisted = false
    let dispositionPersisted = false
    const runHarness = vi.fn(async ({ cwd }: { cwd: string }) => {
      writeFileSync(join(cwd, 'app.ts'), 'export const x = 2\n')
      return HARNESS_OK
    })
    const verify = vi.fn(() => {
      expect(evidencePersisted).toBe(true)
      return { ok: true }
    })
    const gen = agenticGenerator({
      runHarness: runHarness as never,
      onShotCompleted: async () => {
        await Promise.resolve()
        evidencePersisted = true
      },
      onShotDisposition: async (_receipt, disposition) => {
        await Promise.resolve()
        expect(disposition).toEqual({
          kind: 'accepted',
          worktreePath: expect.stringContaining('evidence-before-verify'),
          verified: true,
        })
        dispositionPersisted = true
      },
      verify,
    })
    const wt = await gitWorktreeAdapter({ repoRoot }).create({
      baseRef: 'main',
      label: 'evidence-before-verify',
    })

    const out = await gen.generate({
      worktreePath: wt.path,
      findings: FINDINGS,
      maxShots: 1,
      signal: new AbortController().signal,
    })

    expect(out.applied).toBe(true)
    expect(dispositionPersisted).toBe(true)
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('fails closed when shot evidence persistence throws', async () => {
    const isDirty = vi.fn(() => false)
    const gen = agenticGenerator({
      runHarness: (async () => HARNESS_OK) as never,
      isDirty,
      onShotCompleted: () => {
        throw new Error('shot evidence persistence failed')
      },
    })
    const wt = await gitWorktreeAdapter({ repoRoot }).create({
      baseRef: 'main',
      label: 'evidence-failure',
    })

    await expect(
      gen.generate({
        worktreePath: wt.path,
        findings: FINDINGS,
        maxShots: 1,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('shot evidence persistence failed')
    expect(isDirty).not.toHaveBeenCalled()
  })

  it('fails closed when worktree disposition persistence throws', async () => {
    const gen = agenticGenerator({
      runHarness: (async () => HARNESS_OK) as never,
      isDirty: () => false,
      onShotDisposition: () => {
        throw new Error('shot disposition persistence failed')
      },
    })
    const wt = await gitWorktreeAdapter({ repoRoot }).create({
      baseRef: 'main',
      label: 'disposition-failure',
    })

    await expect(
      gen.generate({
        worktreePath: wt.path,
        findings: FINDINGS,
        maxShots: 1,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('shot disposition persistence failed')
  })

  it('persists a setup-error disposition before rethrowing inspection failure', async () => {
    const dispositions: AgenticGeneratorShotDisposition[] = []
    const gen = agenticGenerator({
      runHarness: (async () => HARNESS_OK) as never,
      isDirty: () => {
        throw new Error('git status unavailable')
      },
      onShotDisposition: (_receipt, disposition) => {
        dispositions.push(disposition)
      },
    })
    const wt = await gitWorktreeAdapter({ repoRoot }).create({
      baseRef: 'main',
      label: 'inspection-error',
    })

    await expect(
      gen.generate({
        worktreePath: wt.path,
        findings: FINDINGS,
        maxShots: 1,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('git status unavailable')
    expect(dispositions).toEqual([
      {
        kind: 'setup-error',
        worktreePath: wt.path,
        stage: 'worktree-inspection',
        error: { name: 'Error', message: 'git status unavailable' },
      },
    ])
  })

  it('rejects profile files outside the dedicated ephemeral root before dispatch', () => {
    expect(() =>
      agenticGenerator({
        harness: 'codex',
        profile: {
          name: 'author',
          model: { default: 'gpt-5.4' },
          resources: {
            files: [
              {
                path: 'research.md',
                resource: { kind: 'inline', name: 'research', content: 'private evidence' },
              },
            ],
          },
        },
        codexReproducible: true,
      }),
    ).toThrow(new RegExp(`must be below ${AGENTIC_PROFILE_RESOURCE_ROOT}`))
  })

  it('emits a failed shot receipt before rethrowing a harness failure', async () => {
    const receipts: unknown[] = []
    const executions: Array<AgenticGeneratorShotExecution | null> = []
    const gen = agenticGenerator({
      runHarness: (async () => {
        throw new Error('author process failed')
      }) as never,
      onShotCompleted: (receipt, execution) => {
        receipts.push(receipt)
        executions.push(execution)
      },
    })
    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'failed' })

    await expect(
      gen.generate({
        worktreePath: wt.path,
        findings: FINDINGS,
        maxShots: 1,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('author process failed')
    expect(receipts).toHaveLength(1)
    expect(executions).toEqual([null])
    expect(receipts[0]).toMatchObject({
      usage: null,
      evidence: null,
      error: { name: 'Error', message: 'author process failed' },
    })
  })

  it('fails closed when reproducible Codex completes without token usage', async () => {
    const receipts: unknown[] = []
    const costLedger = new CostLedger()
    const gen = agenticGenerator({
      harness: 'codex',
      profile: {
        name: 'author',
        model: { default: 'gpt-5.4', reasoningEffort: 'xhigh' },
      },
      codexReproducible: true,
      runHarness: (async ({ cwd }: { cwd: string }) => {
        writeFileSync(join(cwd, 'app.ts'), 'export const x = 2\n')
        return { ...HARNESS_OK, evidence: CODEX_EVIDENCE }
      }) as never,
      onShotCompleted: (receipt) => receipts.push(receipt),
    })
    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'no-usage' })

    await expect(
      gen.generate({
        worktreePath: wt.path,
        findings: FINDINGS,
        maxShots: 1,
        signal: new AbortController().signal,
        costLedger,
      }),
    ).rejects.toThrow(/without usage or execution evidence/)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({
      usage: null,
      costCallId: expect.any(String),
      costBasis: 'unknown',
      costUsd: null,
      costUsdKnown: false,
      error: { message: expect.stringMatching(/without usage or execution evidence/) },
    })
    expect(costLedger.list()).toEqual([
      expect.objectContaining({
        callId: expect.any(String),
        usageUnknown: true,
        costUnknown: true,
      }),
    ])
  })

  it('refuses reproducible Codex before dispatch when the run-wide ledger is absent', async () => {
    const runHarness = vi.fn()
    const gen = agenticGenerator({
      harness: 'codex',
      profile: {
        name: 'author',
        model: { default: 'gpt-5.4', reasoningEffort: 'xhigh' },
      },
      codexReproducible: true,
      runHarness: runHarness as never,
    })
    const wt = await gitWorktreeAdapter({ repoRoot }).create({
      baseRef: 'main',
      label: 'no-ledger',
    })

    await expect(
      gen.generate({
        worktreePath: wt.path,
        findings: FINDINGS,
        maxShots: 1,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/requires the run-wide CostLedger/)
    expect(runHarness).not.toHaveBeenCalled()
  })

  it('lets a capped ledger reject an unbounded author shot before model dispatch', async () => {
    const receipts: AgenticGeneratorShotReceipt[] = []
    const costLedger = new CostLedger({ costCeilingUsd: 1 })
    const runHarness = vi.fn()
    const gen = agenticGenerator({
      harness: 'codex',
      profile: {
        name: 'author',
        model: { default: 'gpt-5.4', reasoningEffort: 'xhigh' },
      },
      codexReproducible: true,
      runHarness: runHarness as never,
      onShotCompleted: (receipt) => receipts.push(receipt),
    })
    const wt = await gitWorktreeAdapter({ repoRoot }).create({
      baseRef: 'main',
      label: 'capped-without-maximum',
    })

    await expect(
      gen.generate({
        worktreePath: wt.path,
        findings: FINDINGS,
        maxShots: 1,
        signal: new AbortController().signal,
        costLedger,
      }),
    ).rejects.toThrow(/hard maximumCharge before execution/)
    expect(runHarness).not.toHaveBeenCalled()
    expect(costLedger.list()).toHaveLength(0)
    expect(receipts).toEqual([
      expect.objectContaining({
        costCallId: expect.any(String),
        costBasis: 'unknown',
        costUsd: null,
        costUsdKnown: false,
        usage: null,
        error: expect.objectContaining({
          message: expect.stringMatching(/hard maximumCharge before execution/),
        }),
      }),
    ])
  })

  it('records terminal usage and rejects partial edits from a failed author process', async () => {
    const receipts: AgenticGeneratorShotReceipt[] = []
    const costLedger = new CostLedger()
    const runHarness = vi.fn(
      async (options: { cwd: string; invocation?: { args: ReadonlyArray<string> } }) => {
        expect(
          readFileSync(join(options.cwd, AGENTIC_PROFILE_RESOURCE_ROOT, 'failure.md'), 'utf8'),
        ).toBe('failure context\n')
        writeFileSync(join(options.cwd, 'app.ts'), 'export const partial = true\n')
        const prompt = options.invocation?.args[1]
        if (!prompt) throw new Error('test invocation omitted the composed prompt')
        return {
          ...HARNESS_OK,
          exitCode: 2,
          usage: CODEX_USAGE,
          evidence: {
            ...CODEX_EVIDENCE,
            requestedPromptSha256: createHash('sha256').update(prompt).digest('hex'),
          },
        }
      },
    )
    const gen = agenticGenerator({
      harness: 'codex',
      profile: {
        name: 'author',
        model: { default: 'gpt-5.4', reasoningEffort: 'xhigh' },
        resources: {
          files: [
            {
              path: `${AGENTIC_PROFILE_RESOURCE_ROOT}/failure.md`,
              resource: { kind: 'inline', name: 'failure', content: 'failure context\n' },
            },
          ],
        },
      },
      codexReproducible: true,
      runHarness: runHarness as never,
      onShotCompleted: (receipt) => receipts.push(receipt),
    })
    const wt = await gitWorktreeAdapter({ repoRoot }).create({
      baseRef: 'main',
      label: 'failed-partial-edit',
    })

    await expect(
      gen.generate({
        worktreePath: wt.path,
        findings: FINDINGS,
        maxShots: 1,
        signal: new AbortController().signal,
        generation: 1,
        candidateIndex: 0,
        costLedger,
      }),
    ).rejects.toThrow(/exited with code 2/)
    expect(existsSync(join(wt.path, AGENTIC_PROFILE_RESOURCE_ROOT))).toBe(false)
    expect(git(['status', '--short'], wt.path)).toBe('M app.ts')
    expect(costLedger.list()).toEqual([
      expect.objectContaining({
        callId: expect.any(String),
        inputTokens: 100,
        cachedTokens: 20,
        outputTokens: 30,
        costUnknown: false,
      }),
    ])
    expect(receipts).toEqual([
      expect.objectContaining({
        exitCode: 2,
        costCallId: expect.any(String),
        costBasis: 'estimated-pricing',
        costUsdKnown: false,
        usage: CODEX_USAGE,
        error: expect.objectContaining({
          message: 'agenticGenerator: author shot exited with code 2',
        }),
      }),
    ])
  })

  it('rejects partial edits when caller cancellation exits the author process zero', async () => {
    const receipts: AgenticGeneratorShotReceipt[] = []
    // Process boundary only; local-harness.test.ts proves this result with a real TERM-aware tree.
    const runHarness = vi.fn(async ({ cwd }: { cwd: string }) => {
      writeFileSync(join(cwd, 'app.ts'), 'export const cancelledPartial = true\n')
      return { ...HARNESS_OK, aborted: true }
    })
    const gen = agenticGenerator({
      runHarness: runHarness as never,
      onShotCompleted: (receipt) => receipts.push(receipt),
    })
    const wt = await gitWorktreeAdapter({ repoRoot }).create({
      baseRef: 'main',
      label: 'cancelled-partial-edit',
    })

    await expect(
      gen.generate({
        worktreePath: wt.path,
        findings: FINDINGS,
        maxShots: 1,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/cancelled by the caller/)
    expect(runHarness).toHaveBeenCalledTimes(1)
    expect(git(['status', '--short'], wt.path)).toBe('M app.ts')
    expect(receipts).toEqual([
      expect.objectContaining({
        exitCode: 0,
        timedOut: false,
        aborted: true,
        killedBySignal: null,
        error: expect.objectContaining({
          message: expect.stringMatching(/cancelled by the caller/),
        }),
      }),
    ])
  })

  it('rejects a partial edit when the caller aborts after a normal author result', async () => {
    const controller = new AbortController()
    const runHarness = vi.fn(async ({ cwd }: { cwd: string }) => {
      writeFileSync(join(cwd, 'app.ts'), 'export const cancelledAfterRun = true\n')
      controller.abort(new Error('cancelled after author settlement'))
      return HARNESS_OK
    })
    const gen = agenticGenerator({ runHarness: runHarness as never })
    const wt = await gitWorktreeAdapter({ repoRoot }).create({
      baseRef: 'main',
      label: 'cancelled-after-author-result',
    })

    await expect(
      gen.generate({
        worktreePath: wt.path,
        findings: FINDINGS,
        maxShots: 1,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled after author settlement/)
    expect(git(['status', '--short'], wt.path)).toBe('M app.ts')
  })

  it('rejects a candidate when cancellation arrives during verification', async () => {
    const controller = new AbortController()
    const runHarness = vi.fn(async ({ cwd }: { cwd: string }) => {
      writeFileSync(join(cwd, 'app.ts'), 'export const cancelledDuringVerify = true\n')
      return HARNESS_OK
    })
    const verify = vi.fn(async (_path: string, signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal)
      controller.abort(new Error('cancelled during verification'))
      return { ok: true }
    })
    const gen = agenticGenerator({ runHarness: runHarness as never, verify })
    const wt = await gitWorktreeAdapter({ repoRoot }).create({
      baseRef: 'main',
      label: 'cancelled-during-verification',
    })

    await expect(
      gen.generate({
        worktreePath: wt.path,
        findings: FINDINGS,
        maxShots: 1,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled during verification/)
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('returns applied when the harness changes the worktree', async () => {
    const dispositions: AgenticGeneratorShotDisposition[] = []
    // The harness "edits" by writing into its cwd (the worktree). We stub the
    // subprocess (the only process boundary) but use a REAL git dirty check.
    const runHarness = vi.fn(
      async ({
        cwd,
        taskPrompt,
        dangerouslySkipPermissions,
      }: {
        cwd: string
        taskPrompt: string
        dangerouslySkipPermissions?: boolean
      }) => {
        expect(taskPrompt).toContain('x should be 2')
        expect(taskPrompt).toContain('set x to 2')
        expect(dangerouslySkipPermissions).toBe(true)
        writeFileSync(join(cwd, 'app.ts'), 'export const x = 2\n')
        return HARNESS_OK
      },
    )
    const gen = agenticGenerator({
      runHarness: runHarness as never,
      onShotDisposition: (_receipt, disposition) => {
        dispositions.push(disposition)
      },
    })

    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'cand' })
    const out = await gen.generate({
      worktreePath: wt.path,
      findings: FINDINGS,
      maxShots: 1,
      signal: new AbortController().signal,
    })

    expect(runHarness).toHaveBeenCalledTimes(1)
    expect(out.applied).toBe(true)
    expect(out.summary).toContain('x should be 2')
    // The accepted shot carries its attribution pair for the driver's
    // `ProposedCandidate` wrapper.
    expect(out.label).toBe('agentic-x-should-be-2')
    expect(out.rationale).toBe('(high) x should be 2')
    expect(dispositions).toEqual([{ kind: 'accepted', worktreePath: wt.path, verified: false }])
  })

  it('retries up to maxShots when the harness produces no change, then gives up', async () => {
    const dispositions: AgenticGeneratorShotDisposition[] = []
    const runHarness = vi.fn(async () => HARNESS_OK) // never edits the worktree
    const gen = agenticGenerator({
      runHarness: runHarness as never,
      onShotDisposition: (_receipt, disposition) => {
        dispositions.push(disposition)
      },
    })

    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'noop' })
    const out = await gen.generate({
      worktreePath: wt.path,
      findings: FINDINGS,
      maxShots: 3,
      signal: new AbortController().signal,
    })

    expect(runHarness).toHaveBeenCalledTimes(3)
    expect(out.applied).toBe(false)
    expect(dispositions).toEqual([
      { kind: 'clean', worktreePath: wt.path },
      { kind: 'clean', worktreePath: wt.path },
      { kind: 'clean', worktreePath: wt.path },
    ])
  })

  it('stops retrying as soon as a shot produces a change', async () => {
    let calls = 0
    const runHarness = vi.fn(async ({ cwd }: { cwd: string }) => {
      calls++
      if (calls === 2) writeFileSync(join(cwd, 'app.ts'), 'export const x = 2\n')
      return HARNESS_OK
    })
    const gen = agenticGenerator({ runHarness: runHarness as never })

    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'second' })
    const out = await gen.generate({
      worktreePath: wt.path,
      findings: FINDINGS,
      maxShots: 5,
      signal: new AbortController().signal,
    })

    expect(calls).toBe(2) // stopped on the shot that changed the tree
    expect(out.applied).toBe(true)
  })

  it('end-to-end through improvementDriver: harness edit → committed CodeSurface', async () => {
    const runHarness = vi.fn(async ({ cwd }: { cwd: string }) => {
      writeFileSync(join(cwd, 'app.ts'), 'export const x = 2\n')
      return HARNESS_OK
    })
    const driver = improvementDriver({
      generator: agenticGenerator({ runHarness: runHarness as never }),
      worktree: gitWorktreeAdapter({ repoRoot }),
      baseRef: 'main',
    })

    const surfaces = await driver.propose(ctx(FINDINGS))

    expect(surfaces).toHaveLength(1)
    const proposed = surfaces[0]!
    // The agentic generator attributes its change, so the driver returns a
    // `ProposedCandidate` wrapper carrying {label, rationale} around the
    // committed CodeSurface.
    if (!isProposedCandidate(proposed)) throw new Error('expected ProposedCandidate')
    expect(proposed.label).toBe('agentic-x-should-be-2')
    expect(proposed.rationale).toBe('(high) x should be 2')
    const surface = proposed.surface
    if (typeof surface === 'string') throw new Error('expected CodeSurface')
    expect(surface.kind).toBe('code')
    // The harness's edit is committed on the candidate branch.
    expect(git(['show', 'HEAD:app.ts'], surface.worktreeRef)).toBe('export const x = 2')
    // main is untouched.
    expect(git(['show', 'main:app.ts'], repoRoot)).toBe('export const x = 1')
  })

  it('discards the worktree when the agentic generator produces nothing', async () => {
    const runHarness = vi.fn(async () => HARNESS_OK)
    const driver = improvementDriver({
      generator: agenticGenerator({ runHarness: runHarness as never }),
      worktree: gitWorktreeAdapter({ repoRoot }),
      baseRef: 'main',
    })

    const surfaces = await driver.propose(ctx(FINDINGS, 2))
    expect(surfaces).toEqual([])
    expect(git(['worktree', 'list'], repoRoot).split('\n').length).toBe(1)
  })
})

describe('agenticGenerator — verify-in-session loop', () => {
  const edits = (cwd: string, body: string) => writeFileSync(join(cwd, 'app.ts'), body)

  it('returns the candidate when a dirtying shot passes verification', async () => {
    const runHarness = vi.fn(async ({ cwd }: { cwd: string }) => {
      edits(cwd, 'export const x = 2\n')
      return HARNESS_OK
    })
    const verify = vi.fn(() => ({ ok: true }))
    const gen = agenticGenerator({ runHarness: runHarness as never, verify })

    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'vok' })
    const out = await gen.generate({
      worktreePath: wt.path,
      findings: FINDINGS,
      maxShots: 3,
      signal: new AbortController().signal,
    })

    expect(runHarness).toHaveBeenCalledTimes(1)
    expect(verify).toHaveBeenCalledTimes(1)
    expect(out.applied).toBe(true)
  })

  it('feeds the verifier failure into the next shot, then ships when it passes', async () => {
    let shot = 0
    const prompts: string[] = []
    const dispositions: AgenticGeneratorShotDisposition[] = []
    const runHarness = vi.fn(async ({ cwd, taskPrompt }: { cwd: string; taskPrompt: string }) => {
      prompts.push(taskPrompt)
      shot++
      edits(cwd, `export const x = ${100 + shot}\n`) // always differs from baseline (x=1)
      return HARNESS_OK
    })
    // Fail shot 1, pass shot 2.
    const verify = vi.fn(() =>
      shot === 1 ? { ok: false, feedback: 'TS2322: x must be 2' } : { ok: true },
    )
    const gen = agenticGenerator({
      runHarness: runHarness as never,
      verify,
      onShotDisposition: (_receipt, disposition) => {
        dispositions.push(disposition)
      },
    })

    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'vresume' })
    const out = await gen.generate({
      worktreePath: wt.path,
      findings: FINDINGS,
      maxShots: 4,
      signal: new AbortController().signal,
    })

    expect(runHarness).toHaveBeenCalledTimes(2)
    expect(out.applied).toBe(true)
    // The second shot's prompt carries the verifier's failure (resume-with-error).
    expect(prompts[1]).toContain('verification FAILED')
    expect(prompts[1]).toContain('TS2322: x must be 2')
    // The first shot's prompt is the clean base — no failure note yet.
    expect(prompts[0]).not.toContain('verification FAILED')
    expect(dispositions).toEqual([
      {
        kind: 'rejected',
        worktreePath: wt.path,
        stage: 'verification',
        feedback: 'TS2322: x must be 2',
      },
      { kind: 'accepted', worktreePath: wt.path, verified: true },
    ])
  })

  it('discards (applied:false) a candidate that never verifies within maxShots', async () => {
    const runHarness = vi.fn(async ({ cwd }: { cwd: string }) => {
      edits(cwd, 'export const x = 9\n') // dirties every shot
      return HARNESS_OK
    })
    const verify = vi.fn(() => ({ ok: false, feedback: 'still broken' }))
    const gen = agenticGenerator({ runHarness: runHarness as never, verify })

    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'vfail' })
    const out = await gen.generate({
      worktreePath: wt.path,
      findings: FINDINGS,
      maxShots: 3,
      signal: new AbortController().signal,
    })

    expect(runHarness).toHaveBeenCalledTimes(3)
    expect(verify).toHaveBeenCalledTimes(3)
    expect(out.applied).toBe(false) // an unverified tree is not a candidate
  })

  it('commandVerifier: exit 0 ⇒ ok, non-zero ⇒ feedback carries output', async () => {
    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'cmdv' })
    const pass = commandVerifier('true')
    expect(await pass(wt.path)).toEqual({ ok: true })

    const fail = commandVerifier('sh', ['-c', 'echo boom >&2; exit 1'])
    const res = await fail(wt.path)
    expect(res.ok).toBe(false)
    expect(res.feedback).toContain('boom')
  })

  it('commandVerifier: a missing binary throws (setup bug, not a failed candidate)', async () => {
    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'cmdmiss' })
    const v = commandVerifier('definitely-not-a-real-binary-xyz')
    await expect(v(wt.path)).rejects.toThrow(/not found in PATH/)
  })

  it('commandVerifier: rejects pre-abort before executing the command', async () => {
    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'cmdabort' })
    const marker = join(wt.path, 'must-not-exist')
    const controller = new AbortController()
    controller.abort(new Error('verifier pre-aborted'))
    const v = commandVerifier(process.execPath, [
      '-e',
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`,
    ])

    await expect(v(wt.path, controller.signal)).rejects.toThrow(/verifier pre-aborted/)
    expect(existsSync(marker)).toBe(false)
  })

  it('commandVerifier: settles a TERM-ignoring descendant before rejecting abort', async () => {
    if (process.platform === 'win32') return
    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'cmdtree' })
    const pidPath = join(wt.path, 'verifier-descendant.pid')
    const lateWrite = join(wt.path, 'verifier-late-write')
    const controller = new AbortController()
    const childScript = [
      "const fs=require('node:fs')",
      'fs.writeFileSync(process.argv[1],String(process.pid))',
      "process.on('SIGTERM',()=>{})",
      "setTimeout(()=>fs.writeFileSync(process.argv[2],'late'),700)",
      'setInterval(()=>{},1000)',
    ].join(';')
    const v = commandVerifier('sh', [
      '-c',
      `${JSON.stringify(process.execPath)} -e ${JSON.stringify(childScript)} ${JSON.stringify(pidPath)} ${JSON.stringify(lateWrite)} & wait`,
    ])
    const running = v(wt.path, controller.signal)
    await waitForPath(pidPath)
    const descendantPid = Number(readFileSync(pidPath, 'utf8'))
    controller.abort(new Error('cancel verifier tree'))

    await expect(running).rejects.toThrow(/cancel verifier tree/)
    await delay(500)
    expect(existsSync(lateWrite)).toBe(false)
    expect(existsSync(`/proc/${descendantPid}`)).toBe(false)
  })
})

describe('agenticGenerator — raw-trace evidence discipline', () => {
  const writeDiagnosis = (cwd: string, body: string) => {
    mkdirSync(join(cwd, '.improve'), { recursive: true })
    writeFileSync(join(cwd, '.improve/raw-trace-diagnosis.md'), body)
  }

  it('retries and discards a raw-trace candidate that edits code without citing inspected traces', async () => {
    const prompts: string[] = []
    const dispositions: AgenticGeneratorShotDisposition[] = []
    const runHarness = vi.fn(async ({ cwd, taskPrompt }: { cwd: string; taskPrompt: string }) => {
      prompts.push(taskPrompt)
      writeFileSync(join(cwd, 'app.ts'), 'export const x = 2\n')
      return HARNESS_OK
    })
    const gen = agenticGenerator({
      runHarness: runHarness as never,
      onShotDisposition: (_receipt, disposition) => {
        dispositions.push(disposition)
      },
    })

    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'rt-miss' })
    const out = await gen.generate({
      worktreePath: wt.path,
      findings: RAW_TRACE_FINDINGS,
      maxShots: 2,
      signal: new AbortController().signal,
    })

    expect(out.applied).toBe(false)
    expect(runHarness).toHaveBeenCalledTimes(2)
    expect(prompts[0]).toContain('Raw trace evidence requirement')
    expect(prompts[0]).toContain('.improve/raw-trace-diagnosis.md')
    expect(prompts[1]).toContain('raw-trace mode requires .improve/raw-trace-diagnosis.md')
    expect(dispositions).toHaveLength(2)
    expect(dispositions).toEqual([
      expect.objectContaining({
        kind: 'rejected',
        worktreePath: wt.path,
        stage: 'raw-trace-evidence',
        feedback: expect.stringContaining('requires .improve/raw-trace-diagnosis.md'),
      }),
      expect.objectContaining({
        kind: 'rejected',
        worktreePath: wt.path,
        stage: 'raw-trace-evidence',
        feedback: expect.stringContaining('requires .improve/raw-trace-diagnosis.md'),
      }),
    ])
  })

  it('rejects a raw-trace candidate that only writes the diagnosis artifact', async () => {
    const runHarness = vi.fn(async ({ cwd }: { cwd: string }) => {
      writeDiagnosis(cwd, `inspected: ${TRACE_PATH}\nmechanism: stale state\nchange: none yet\n`)
      return HARNESS_OK
    })
    const gen = agenticGenerator({ runHarness: runHarness as never })

    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'rt-only' })
    const out = await gen.generate({
      worktreePath: wt.path,
      findings: RAW_TRACE_FINDINGS,
      maxShots: 1,
      signal: new AbortController().signal,
    })

    expect(out.applied).toBe(false)
    expect(runHarness).toHaveBeenCalledTimes(1)
  })

  it('accepts a raw-trace candidate with a substantive edit and diagnosis citing a real trace path', async () => {
    const runHarness = vi.fn(async ({ cwd }: { cwd: string }) => {
      writeFileSync(join(cwd, 'app.ts'), 'export const x = 2\n')
      writeDiagnosis(
        cwd,
        [
          `inspected: ${TRACE_PATH}`,
          'mechanism: stale state was reused after a failed candidate',
          'change: reset the state before reuse',
          '',
        ].join('\n'),
      )
      return HARNESS_OK
    })
    const gen = agenticGenerator({ runHarness: runHarness as never })

    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'rt-ok' })
    const out = await gen.generate({
      worktreePath: wt.path,
      findings: RAW_TRACE_FINDINGS,
      maxShots: 1,
      signal: new AbortController().signal,
    })

    expect(out.applied).toBe(true)
    expect(runHarness).toHaveBeenCalledTimes(1)
  })
})

describe('agenticGenerator — candidate attribution through the improvement loop', () => {
  it('threads label + rationale into GenerationRecord and the loop winner', async () => {
    const runHarness = vi.fn(async ({ cwd }: { cwd: string }) => {
      writeFileSync(join(cwd, 'app.ts'), 'export const x = 2\n')
      return HARNESS_OK
    })
    const driver = improvementDriver({
      generator: agenticGenerator({ runHarness: runHarness as never }),
      worktree: gitWorktreeAdapter({ repoRoot }),
      baseRef: 'main',
    })
    const scenarios: Scenario[] = [{ id: 'task', kind: 'fixture' }]
    // Rewards the agentic CodeSurface candidate over the string baseline so
    // the candidate promotes and its attribution reaches the winner fields.
    const judge: JudgeConfig<{ fromCode: boolean }, Scenario> = {
      name: 'code-wins',
      dimensions: [{ key: 'q', description: 'candidate quality' }],
      score: ({ artifact }) => {
        const composite = artifact.fromCode ? 1 : 0
        return { composite, dimensions: { q: composite }, notes: '' }
      },
    }

    const result = await runOptimization<Scenario, { fromCode: boolean }>({
      baselineSurface: 'BASELINE',
      scenarios,
      dispatchWithSurface: async (surface) => ({ fromCode: typeof surface !== 'string' }),
      dispatchRef: 'test:agentic-attribution',
      judges: [judge],
      proposer: driver,
      findings: FINDINGS,
      populationSize: 1,
      maxGenerations: 1,
      seed: 7,
      reps: 1,
      resumable: false,
      runDir: '/agentic-attribution',
      storage: inMemoryCampaignStorage(),
      tracing: 'off',
      expectUsage: 'off',
    })

    const candidate = result.generations[0]!.record.candidates[0]!
    expect(candidate.label).toBe('agentic-x-should-be-2')
    expect(candidate.rationale).toBe('(high) x should be 2')
    expect(result.winnerLabel).toBe('agentic-x-should-be-2')
    expect(result.winnerRationale).toBe('(high) x should be 2')

    await driver.cleanup()
  })
})
