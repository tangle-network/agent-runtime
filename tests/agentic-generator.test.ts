import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AnalystFinding } from '@tangle-network/agent-eval'
import { gitWorktreeAdapter, type ProposeContext } from '@tangle-network/agent-eval/campaign'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type AgenticGeneratorShotReceipt,
  agenticGenerator,
  commandVerifier,
} from '../src/improvement'
import {
  type CandidateCostLedger,
  type CandidateCostReceipt,
  type CandidateCostReceiptInput,
  improvementDriver,
} from '../src/improvement/improvement-driver'
import type { LocalHarnessResult } from '../src/mcp/local-harness'

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
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
  {
    schema_version: '1.0.0',
    finding_id: 'f1',
    analyst_id: 'a1',
    produced_at: '2026-01-01',
    severity: 'high',
    area: 'correctness',
    claim: 'x should be 2',
    recommended_action: 'set x to 2',
    evidence_refs: [],
    confidence: 0.9,
    subject: 'app.ts',
  },
] as unknown as AnalystFinding[]

const TRACE_PATH = '/tmp/run/gen-0/candidate-0/task_0/spans.jsonl'
const RAW_TRACE_FINDINGS = [
  {
    schema_version: '1.0.0',
    finding_id: 'rt1',
    analyst_id: 'raw-trace-distiller',
    produced_at: '2026-01-01',
    severity: 'high',
    area: 'raw-trace-context',
    claim: 'candidate failed after reading stale state',
    recommended_action: `grep/cat ${TRACE_PATH} before editing`,
    evidence_refs: [{ kind: 'artifact', uri: TRACE_PATH }],
    confidence: 1,
    subject: 'candidate-hash',
  },
] as unknown as AnalystFinding[]

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

interface RecordedPaidCall {
  channel: string
  phase: string
  actor: string
  model: string | undefined
  tags: Record<string, string> | undefined
  maximumCharge: unknown
}

function recordingCostLedger(options: { capped?: boolean } = {}): {
  ledger: CandidateCostLedger
  calls: RecordedPaidCall[]
  receipts: CandidateCostReceipt[]
} {
  const calls: RecordedPaidCall[] = []
  const receipts: CandidateCostReceipt[] = []
  let nextCall = 0
  const settle = (
    callId: string,
    observed: CandidateCostReceiptInput,
    error?: Error,
  ): CandidateCostReceipt => {
    const costUnknown = observed.costUnknown === true || observed.usageUnknown === true
    const receipt: CandidateCostReceipt = {
      ...observed,
      callId,
      costUsd: costUnknown
        ? 0
        : (observed.actualCostUsd ??
          observed.inputTokens * 0.000001 + observed.outputTokens * 0.00001),
      costUnknown,
      ...(error ? { error: error.message } : {}),
    } as CandidateCostReceipt
    receipts.push(receipt)
    return receipt
  }
  const ledger: CandidateCostLedger = {
    ...(options.capped ? { costCeilingUsd: 1 } : {}),
    async runPaidCall(input) {
      const callId = `author-call-${++nextCall}`
      calls.push({
        channel: input.channel,
        phase: input.phase,
        actor: input.actor,
        model: input.model,
        tags: input.tags,
        maximumCharge: input.maximumCharge,
      })
      if (options.capped && input.maximumCharge === undefined) {
        return {
          succeeded: false,
          callId,
          error: new Error('capped paid calls require a hard maximumCharge before execution'),
        }
      }
      try {
        const value = await input.execute(input.signal ?? new AbortController().signal, callId)
        const receipt = settle(callId, input.receipt(value))
        return { succeeded: true, callId, value, receipt }
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause))
        const observed = input.receiptFromError?.(error) ?? {
          model: input.model ?? 'unknown',
          inputTokens: 0,
          outputTokens: 0,
          costUnknown: true,
          usageUnknown: true,
        }
        return { succeeded: false, callId, error, receipt: settle(callId, observed, error) }
      }
    },
  }
  return { ledger, calls, receipts }
}

function ctx(findings: AnalystFinding[], maxShots = 1): ProposeContext<AnalystFinding> {
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
    const cost = recordingCostLedger()
    const profile = {
      name: 'structural-author',
      prompt: {
        systemPrompt: 'AUTHOR SYSTEM',
        instructions: ['Edit only the allowed implementation.'],
      },
      model: { default: 'gpt-5.4', reasoningEffort: 'xhigh' as const },
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
      report: undefined,
      findings: FINDINGS,
      maxShots: 2,
      signal: new AbortController().signal,
      generation: 4,
      candidateIndex: 2,
      costLedger: cost.ledger,
      costPhase: 'search.proposal',
    })

    expect(out.applied).toBe(true)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({
      schemaVersion: 1,
      generation: 4,
      candidateIndex: 2,
      shot: 1,
      maxShots: 2,
      harness: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
      usage: CODEX_USAGE,
      costCallId: 'author-call-1',
      costUsdKnown: true,
      error: null,
    })
    expect(receipts[0]?.costUsd).toBeCloseTo(0.0004)
    expect(receipts[0]?.promptSha256).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(receipts[0]?.stdoutSha256).toBe(
      `sha256:${createHash('sha256').update(HARNESS_OK.stdout).digest('hex')}`,
    )
    expect(receipts[0]?.evidence?.readDeniedPathCount).toBe(1)
    expect(receipts[0]?.evidence?.effectivePromptSha256).not.toBe(
      receipts[0]?.evidence?.requestedPromptSha256,
    )
    expect(cost.calls).toEqual([
      {
        channel: 'driver',
        phase: 'search.proposal',
        actor: 'agentic-generator:codex',
        model: 'gpt-5.4',
        tags: { generation: '4', candidateIndex: '2', shot: '1' },
        maximumCharge: undefined,
      },
    ])
    expect(cost.receipts[0]).toMatchObject({
      inputTokens: 100,
      cachedTokens: 20,
      outputTokens: 30,
      model: 'gpt-5.4',
      costUnknown: false,
    })
  })

  it('emits a failed shot receipt before rethrowing a harness failure', async () => {
    const receipts: unknown[] = []
    const gen = agenticGenerator({
      runHarness: (async () => {
        throw new Error('author process failed')
      }) as never,
      onShotCompleted: (receipt) => receipts.push(receipt),
    })
    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'failed' })

    await expect(
      gen.generate({
        worktreePath: wt.path,
        report: undefined,
        findings: FINDINGS,
        maxShots: 1,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('author process failed')
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({
      usage: null,
      evidence: null,
      error: { name: 'Error', message: 'author process failed' },
    })
  })

  it('fails closed when reproducible Codex completes without token usage', async () => {
    const receipts: unknown[] = []
    const cost = recordingCostLedger()
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
        report: undefined,
        findings: FINDINGS,
        maxShots: 1,
        signal: new AbortController().signal,
        costLedger: cost.ledger,
      }),
    ).rejects.toThrow(/without usage or execution evidence/)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({
      usage: null,
      costCallId: 'author-call-1',
      costUsd: 0,
      costUsdKnown: false,
      error: { message: expect.stringMatching(/without usage or execution evidence/) },
    })
    expect(cost.receipts).toEqual([
      expect.objectContaining({
        callId: 'author-call-1',
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
        report: undefined,
        findings: FINDINGS,
        maxShots: 1,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/requires the run-wide CostLedger/)
    expect(runHarness).not.toHaveBeenCalled()
  })

  it('lets a capped ledger reject an unbounded author shot before model dispatch', async () => {
    const receipts: AgenticGeneratorShotReceipt[] = []
    const cost = recordingCostLedger({ capped: true })
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
        report: undefined,
        findings: FINDINGS,
        maxShots: 1,
        signal: new AbortController().signal,
        costLedger: cost.ledger,
      }),
    ).rejects.toThrow(/hard maximumCharge before execution/)
    expect(runHarness).not.toHaveBeenCalled()
    expect(cost.receipts).toHaveLength(0)
    expect(receipts).toEqual([
      expect.objectContaining({
        costCallId: 'author-call-1',
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
    const cost = recordingCostLedger()
    const runHarness = vi.fn(
      async (options: { cwd: string; invocation?: { args: ReadonlyArray<string> } }) => {
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
        report: undefined,
        findings: FINDINGS,
        maxShots: 1,
        signal: new AbortController().signal,
        generation: 1,
        candidateIndex: 0,
        costLedger: cost.ledger,
      }),
    ).rejects.toThrow(/exited with code 2/)
    expect(cost.receipts).toEqual([
      expect.objectContaining({
        callId: 'author-call-1',
        inputTokens: 100,
        cachedTokens: 20,
        outputTokens: 30,
        costUnknown: false,
      }),
    ])
    expect(receipts).toEqual([
      expect.objectContaining({
        exitCode: 2,
        costCallId: 'author-call-1',
        costUsdKnown: true,
        usage: CODEX_USAGE,
        error: expect.objectContaining({
          message: 'agenticGenerator: author shot exited with code 2',
        }),
      }),
    ])
  })

  it('returns applied when the harness changes the worktree', async () => {
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
    const gen = agenticGenerator({ runHarness: runHarness as never })

    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'cand' })
    const out = await gen.generate({
      worktreePath: wt.path,
      report: undefined,
      findings: FINDINGS,
      maxShots: 1,
      signal: new AbortController().signal,
    })

    expect(runHarness).toHaveBeenCalledTimes(1)
    expect(out.applied).toBe(true)
    expect(out.summary).toContain('x should be 2')
  })

  it('retries up to maxShots when the harness produces no change, then gives up', async () => {
    const runHarness = vi.fn(async () => HARNESS_OK) // never edits the worktree
    const gen = agenticGenerator({ runHarness: runHarness as never })

    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'noop' })
    const out = await gen.generate({
      worktreePath: wt.path,
      report: undefined,
      findings: FINDINGS,
      maxShots: 3,
      signal: new AbortController().signal,
    })

    expect(runHarness).toHaveBeenCalledTimes(3)
    expect(out.applied).toBe(false)
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
      report: undefined,
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
    const surface = surfaces[0]!
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
      report: undefined,
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
    const gen = agenticGenerator({ runHarness: runHarness as never, verify })

    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'vresume' })
    const out = await gen.generate({
      worktreePath: wt.path,
      report: undefined,
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
      report: undefined,
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
    expect(() => v(wt.path)).toThrow(/not found in PATH/)
  })
})

describe('agenticGenerator — raw-trace evidence discipline', () => {
  const writeDiagnosis = (cwd: string, body: string) => {
    mkdirSync(join(cwd, '.improve'), { recursive: true })
    writeFileSync(join(cwd, '.improve/raw-trace-diagnosis.md'), body)
  }

  it('retries and discards a raw-trace candidate that edits code without citing inspected traces', async () => {
    const prompts: string[] = []
    const runHarness = vi.fn(async ({ cwd, taskPrompt }: { cwd: string; taskPrompt: string }) => {
      prompts.push(taskPrompt)
      writeFileSync(join(cwd, 'app.ts'), 'export const x = 2\n')
      return HARNESS_OK
    })
    const gen = agenticGenerator({ runHarness: runHarness as never })

    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'rt-miss' })
    const out = await gen.generate({
      worktreePath: wt.path,
      report: undefined,
      findings: RAW_TRACE_FINDINGS,
      maxShots: 2,
      signal: new AbortController().signal,
    })

    expect(out.applied).toBe(false)
    expect(runHarness).toHaveBeenCalledTimes(2)
    expect(prompts[0]).toContain('Raw trace evidence requirement')
    expect(prompts[0]).toContain('.improve/raw-trace-diagnosis.md')
    expect(prompts[1]).toContain('raw-trace mode requires .improve/raw-trace-diagnosis.md')
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
      report: undefined,
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
      report: undefined,
      findings: RAW_TRACE_FINDINGS,
      maxShots: 1,
      signal: new AbortController().signal,
    })

    expect(out.applied).toBe(true)
    expect(runHarness).toHaveBeenCalledTimes(1)
  })
})
