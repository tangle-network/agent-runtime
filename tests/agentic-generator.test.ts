import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CostLedger, makeProposalFinding, type ProposalFinding } from '@tangle-network/agent-eval'
import { gitWorktreeAdapter } from '@tangle-network/agent-eval/campaign'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type AgenticGeneratorExecutorForWorktree,
  type AgenticGeneratorShotDisposition,
  type AgenticGeneratorShotExecution,
  type AgenticGeneratorShotReceipt,
  agenticGenerator,
  commandVerifier,
} from '../src/improvement'
import type { LocalHarnessResult, RunLocalHarnessOptions } from '../src/mcp/local-harness'

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

let repoRoot: string

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'agentic-generator-'))
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

const PROFILE: AgentProfile = {
  name: 'code-author',
  harness: 'cli-base',
  model: {
    provider: 'offline-router',
    default: 'deterministic-author',
    reasoningEffort: 'high',
  },
  prompt: {
    systemPrompt: 'AUTHOR SYSTEM',
    instructions: ['Edit only the candidate worktree.'],
  },
}

const FINDINGS = [
  makeProposalFinding({
    analyst_id: 'test',
    proposal_origin: 'production',
    severity: 'high',
    area: 'correctness',
    claim: 'x should be 2',
    recommended_action: 'set x to 2',
    evidence_refs: [],
    confidence: 1,
    subject: 'app.ts',
  }),
]

const TRACE_PATH = '/tmp/discovery/run-1/spans.jsonl'
const RAW_TRACE_FINDINGS = [
  makeProposalFinding({
    analyst_id: 'raw-trace-distiller',
    proposal_origin: 'search',
    severity: 'high',
    area: 'raw-trace-context',
    claim: 'the candidate read stale state',
    recommended_action: 'inspect the cited trace',
    evidence_refs: [{ kind: 'artifact', uri: TRACE_PATH }],
    confidence: 1,
    subject: 'candidate',
  }),
]

interface RoutedShot {
  readonly worktreePath: string
  readonly body: Record<string, unknown>
  readonly request:
    | {
        readonly headers: Readonly<Record<string, string>>
        readonly signal?: AbortSignal
      }
    | undefined
  readonly call: number
}

type RoutedAction = (shot: RoutedShot) => unknown | Promise<unknown>

function successfulCompletion(body: Record<string, unknown>): Record<string, unknown> {
  return {
    model: body.model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'done' },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 12,
      completion_tokens: 3,
      cost_usd: 0.012,
      prompt_tokens_details: { cached_tokens: 8 },
    },
  }
}

function routedExecutor(action: RoutedAction): AgenticGeneratorExecutorForWorktree {
  let call = 0
  return (worktreePath) => ({
    backend: 'router',
    routerBaseUrl: 'https://offline.invalid/v1',
    routerKey: 'test-key',
    complete: async (body, request) => {
      call += 1
      const reply = await action({ worktreePath, body, request, call })
      return reply === undefined ? successfulCompletion(body) : reply
    },
  })
}

function buildPrompt(args: { findings: ReadonlyArray<ProposalFinding> }): string {
  return `Fix the candidate from these findings:\n${args.findings.map((f) => f.claim).join('\n')}`
}

async function candidateWorktree(label: string): Promise<string> {
  return (
    await gitWorktreeAdapter({ repoRoot }).create({
      baseRef: 'main',
      label,
    })
  ).path
}

function generateArgs(
  worktreePath: string,
  findings: ReadonlyArray<ProposalFinding> = FINDINGS,
  maxShots = 1,
) {
  return {
    worktreePath,
    findings,
    maxShots,
    signal: new AbortController().signal,
    generation: 2,
    candidateIndex: 1,
  }
}

function messages(body: Record<string, unknown>): Array<{ role?: string; content?: unknown }> {
  return (body.messages ?? []) as Array<{ role?: string; content?: unknown }>
}

describe('agenticGenerator exact Runtime execution', () => {
  it('rejects an incomplete author profile before allocating an executor', () => {
    const executorForWorktree = vi.fn()

    expect(() =>
      agenticGenerator({
        profile: { name: 'incomplete' },
        executorForWorktree,
        buildPrompt,
      }),
    ).toThrow(/executable|harness|model/i)
    expect(executorForWorktree).not.toHaveBeenCalled()
  })

  it('runs the exact profile through Runtime and records provider usage', async () => {
    const receipts: AgenticGeneratorShotReceipt[] = []
    const executions: Array<AgenticGeneratorShotExecution | null> = []
    let observedBody: Record<string, unknown> | undefined
    const executorForWorktree = routedExecutor(({ worktreePath, body }) => {
      observedBody = body
      writeFileSync(join(worktreePath, 'app.ts'), 'export const x = 2\n')
    })
    const generator = agenticGenerator({
      profile: PROFILE,
      executorForWorktree,
      buildPrompt,
      onShotCompleted(receipt, execution) {
        receipts.push(receipt)
        executions.push(execution)
      },
    })
    const worktreePath = await candidateWorktree('exact-profile')

    const result = await generator.generate(generateArgs(worktreePath))

    expect(result.applied).toBe(true)
    expect(observedBody?.model).toBe('deterministic-author')
    expect(
      messages(observedBody ?? {}).find((message) => message.role === 'system')?.content,
    ).toContain('AUTHOR SYSTEM')
    expect(
      messages(observedBody ?? {}).find((message) => message.role === 'user')?.content,
    ).toContain('x should be 2')
    expect(readFileSync(join(worktreePath, 'app.ts'), 'utf8')).toBe('export const x = 2\n')
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({
      generation: 2,
      candidateIndex: 1,
      shot: 1,
      maxShots: 1,
      harness: 'cli-base',
      provider: 'offline-router',
      model: 'deterministic-author',
      reasoningEffort: 'high',
      status: 'completed',
      usage: {
        input: 12,
        output: 3,
        costUsd: 0.012,
      },
      costBasis: 'provider-reported',
      costUsd: 0.012,
      costUsdKnown: true,
    })
    expect(receipts[0]?.usage?.promptCache).toEqual({ readTokens: 8 })
    expect(executions[0]?.status).toBe('completed')
    expect(executions[0]?.events.at(-1)?.type).toBe('final')
  })

  it('forwards the shared ledger identity and records one paid shot', async () => {
    const ledger = new CostLedger()
    const receipts: AgenticGeneratorShotReceipt[] = []
    let idempotencyKey: string | undefined
    const generator = agenticGenerator({
      profile: PROFILE,
      executorForWorktree: routedExecutor(({ worktreePath, request }) => {
        idempotencyKey =
          request?.headers['idempotency-key'] ??
          request?.headers['Idempotency-Key'] ??
          request?.headers['x-idempotency-key']
        writeFileSync(join(worktreePath, 'app.ts'), 'export const x = 2\n')
      }),
      buildPrompt,
      onShotCompleted: (receipt) => receipts.push(receipt),
    })
    const worktreePath = await candidateWorktree('ledger')

    const result = await generator.generate({
      ...generateArgs(worktreePath),
      costLedger: ledger,
      costPhase: 'search.proposal',
    })

    const settled = ledger.list()
    expect(result.applied).toBe(true)
    expect(settled).toHaveLength(1)
    expect(settled[0]).toMatchObject({ inputTokens: 4, cachedTokens: 8, outputTokens: 3 })
    expect(receipts[0]?.costCallId).toBe(settled[0]?.callId)
    expect(receipts[0]?.costCallId).toEqual(expect.any(String))
    if (idempotencyKey !== undefined) expect(idempotencyKey).toBe(receipts[0]?.costCallId)
  })

  it('keeps missing token and dollar measurements explicitly unknown', async () => {
    const ledger = new CostLedger()
    const receipts: AgenticGeneratorShotReceipt[] = []
    const generator = agenticGenerator({
      profile: PROFILE,
      executorForWorktree: routedExecutor(({ worktreePath, body }) => {
        writeFileSync(join(worktreePath, 'app.ts'), 'export const x = 2\n')
        return {
          model: body.model,
          choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
        }
      }),
      buildPrompt,
      onShotCompleted: (receipt) => receipts.push(receipt),
    })
    const worktreePath = await candidateWorktree('unknown-usage')

    const result = await generator.generate({
      ...generateArgs(worktreePath),
      costLedger: ledger,
    })

    expect(result.applied).toBe(true)
    expect(receipts[0]).toMatchObject({
      usage: { input: 0, output: 0, tokensKnown: false, usdKnown: false },
      costBasis: 'unknown',
      costUsd: null,
      costUsdKnown: false,
    })
    expect(ledger.list()[0]).toMatchObject({ usageUnknown: true, costUnknown: true })
  })

  it('requires a shared ledger before admitting a maximum charge', async () => {
    const execute = vi.fn()
    const generator = agenticGenerator({
      profile: PROFILE,
      executorForWorktree: routedExecutor(execute),
      buildPrompt,
      maximumCharge: { externallyEnforcedMaximumUsd: 1 },
    })
    const worktreePath = await candidateWorktree('maximum-charge')

    await expect(generator.generate(generateArgs(worktreePath))).rejects.toThrow(
      /requires the run-wide CostLedger/,
    )
    expect(execute).not.toHaveBeenCalled()
  })

  it('refuses a bridge placement that is not bound to the candidate worktree', async () => {
    const generator = agenticGenerator({
      profile: {
        ...PROFILE,
        harness: 'pi',
      },
      executorForWorktree: () => ({
        backend: 'bridge',
        bridgeUrl: 'https://bridge.invalid',
        bridgeBearer: 'test',
        cwd: '/tmp/not-the-candidate',
      }),
      buildPrompt,
    })
    const worktreePath = await candidateWorktree('wrong-cwd')

    await expect(generator.generate(generateArgs(worktreePath))).rejects.toThrow(
      /cwd must equal the candidate worktree/,
    )
  })

  it('rejects an empty caller-authored prompt before model dispatch', async () => {
    const execute = vi.fn()
    const generator = agenticGenerator({
      profile: PROFILE,
      executorForWorktree: routedExecutor(execute),
      buildPrompt: () => '   ',
    })
    const worktreePath = await candidateWorktree('empty-prompt')

    await expect(generator.generate(generateArgs(worktreePath))).rejects.toThrow(
      /buildPrompt must return a non-empty string/,
    )
    expect(execute).not.toHaveBeenCalled()
  })

  it('retries a clean shot with explicit feedback and accepts the first edit', async () => {
    const prompts: string[] = []
    const generator = agenticGenerator({
      profile: PROFILE,
      executorForWorktree: routedExecutor(({ worktreePath, body, call }) => {
        const user = messages(body).findLast((message) => message.role === 'user')
        prompts.push(String(user?.content ?? ''))
        if (call === 2) writeFileSync(join(worktreePath, 'app.ts'), 'export const x = 2\n')
      }),
      buildPrompt,
    })
    const worktreePath = await candidateWorktree('clean-retry')

    const result = await generator.generate(generateArgs(worktreePath, FINDINGS, 3))

    expect(result.applied).toBe(true)
    expect(prompts).toHaveLength(2)
    expect(prompts[0]).not.toContain('left the working tree unchanged')
    expect(prompts[1]).toContain('left the working tree unchanged')
  })

  it('feeds verifier failure into the next shot and accepts only a passing tree', async () => {
    const prompts: string[] = []
    let verifies = 0
    const generator = agenticGenerator({
      profile: PROFILE,
      executorForWorktree: routedExecutor(({ worktreePath, body, call }) => {
        const user = messages(body).findLast((message) => message.role === 'user')
        prompts.push(String(user?.content ?? ''))
        writeFileSync(
          join(worktreePath, 'app.ts'),
          call === 1 ? 'export const x = broken\n' : 'export const x = 2\n',
        )
      }),
      buildPrompt,
      verify() {
        verifies += 1
        return verifies === 1
          ? { ok: false, feedback: 'TypeScript: cannot find name broken' }
          : { ok: true }
      },
    })
    const worktreePath = await candidateWorktree('verify-retry')

    const result = await generator.generate(generateArgs(worktreePath, FINDINGS, 2))

    expect(result.applied).toBe(true)
    expect(verifies).toBe(2)
    expect(prompts[1]).toContain('cannot find name broken')
    expect(readFileSync(join(worktreePath, 'app.ts'), 'utf8')).toBe('export const x = 2\n')
  })

  it('discards a dirty candidate that never verifies', async () => {
    const dispositions: AgenticGeneratorShotDisposition[] = []
    const generator = agenticGenerator({
      profile: PROFILE,
      executorForWorktree: routedExecutor(({ worktreePath, call }) => {
        writeFileSync(join(worktreePath, 'app.ts'), `export const x = ${call + 1}\n`)
      }),
      buildPrompt,
      verify: () => ({ ok: false, feedback: 'still failing' }),
      onShotDisposition: (_receipt, disposition) => dispositions.push(disposition),
    })
    const worktreePath = await candidateWorktree('never-verifies')

    const result = await generator.generate(generateArgs(worktreePath, FINDINGS, 2))

    expect(result.applied).toBe(false)
    expect(dispositions.map((disposition) => disposition.kind)).toEqual(['rejected', 'rejected'])
  })

  it('emits the failed Runtime turn and rejects partial edits', async () => {
    const receipts: AgenticGeneratorShotReceipt[] = []
    const executions: Array<AgenticGeneratorShotExecution | null> = []
    const generator = agenticGenerator({
      profile: PROFILE,
      executorForWorktree: routedExecutor(({ worktreePath }) => {
        writeFileSync(join(worktreePath, 'app.ts'), 'export const partial = true\n')
        throw new Error('provider unavailable')
      }),
      buildPrompt,
      onShotCompleted(receipt, execution) {
        receipts.push(receipt)
        executions.push(execution)
      },
    })
    const worktreePath = await candidateWorktree('failed-turn')

    await expect(generator.generate(generateArgs(worktreePath))).rejects.toThrow(
      /author shot failed:.*provider unavailable/,
    )
    expect(receipts[0]).toMatchObject({
      status: 'failed',
      error: { message: expect.stringContaining('author shot failed') },
    })
    expect(executions[0]?.status).toBe('failed')
    expect(readFileSync(join(worktreePath, 'app.ts'), 'utf8')).toBe('export const partial = true\n')
  })

  it('fails closed when shot evidence persistence throws', async () => {
    const generator = agenticGenerator({
      profile: PROFILE,
      executorForWorktree: routedExecutor(({ worktreePath }) => {
        writeFileSync(join(worktreePath, 'app.ts'), 'export const x = 2\n')
      }),
      buildPrompt,
      onShotCompleted() {
        throw new Error('receipt store unavailable')
      },
    })
    const worktreePath = await candidateWorktree('receipt-failure')

    await expect(generator.generate(generateArgs(worktreePath))).rejects.toThrow(
      /receipt store unavailable/,
    )
  })

  it('fails closed when worktree disposition persistence throws', async () => {
    const generator = agenticGenerator({
      profile: PROFILE,
      executorForWorktree: routedExecutor(({ worktreePath }) => {
        writeFileSync(join(worktreePath, 'app.ts'), 'export const x = 2\n')
      }),
      buildPrompt,
      onShotDisposition() {
        throw new Error('disposition store unavailable')
      },
    })
    const worktreePath = await candidateWorktree('disposition-failure')

    await expect(generator.generate(generateArgs(worktreePath))).rejects.toThrow(
      /disposition store unavailable/,
    )
  })

  it.each(['unstaged', 'staged'])('rejects %s edits to only a tracked diagnosis', async (state) => {
    const diagnosisPath = '.improve/raw-trace-diagnosis.md'
    mkdirSync(join(repoRoot, '.improve'))
    writeFileSync(join(repoRoot, diagnosisPath), 'Previous diagnosis.\n')
    git(['add', diagnosisPath], repoRoot)
    git(['commit', '-q', '-m', 'test: track diagnosis'], repoRoot)
    const dispositions: AgenticGeneratorShotDisposition[] = []
    const generator = agenticGenerator({
      profile: PROFILE,
      executorForWorktree: routedExecutor(({ worktreePath }) => {
        writeFileSync(join(worktreePath, diagnosisPath), `${TRACE_PATH}\nA revised diagnosis.\n`)
        if (state === 'staged') git(['add', diagnosisPath], worktreePath)
      }),
      buildPrompt,
      onShotDisposition: (_receipt, disposition) => dispositions.push(disposition),
    })
    const worktreePath = await candidateWorktree(`diagnosis-only-${state}`)

    const result = await generator.generate(generateArgs(worktreePath, RAW_TRACE_FINDINGS))

    expect(result.applied).toBe(false)
    expect(dispositions.map((disposition) => disposition.kind)).toEqual(['rejected'])
    expect(readFileSync(join(worktreePath, 'app.ts'), 'utf8')).toBe('export const x = 1\n')
  })

  it('accepts a renamed source file alongside a tracked diagnosis edit', async () => {
    const diagnosisPath = '.improve/raw-trace-diagnosis.md'
    mkdirSync(join(repoRoot, '.improve'))
    writeFileSync(join(repoRoot, diagnosisPath), 'Previous diagnosis.\n')
    git(['add', diagnosisPath], repoRoot)
    git(['commit', '-q', '-m', 'test: track diagnosis'], repoRoot)
    const renamedPath = ' renamed\napp.ts '
    const generator = agenticGenerator({
      profile: PROFILE,
      executorForWorktree: routedExecutor(({ worktreePath }) => {
        git(['mv', 'app.ts', renamedPath], worktreePath)
        writeFileSync(
          join(worktreePath, diagnosisPath),
          `${TRACE_PATH}\nRenamed the source file.\n`,
        )
      }),
      buildPrompt,
    })
    const worktreePath = await candidateWorktree('renamed-source')

    const result = await generator.generate(generateArgs(worktreePath, RAW_TRACE_FINDINGS))

    expect(result.applied).toBe(true)
    expect(readFileSync(join(worktreePath, renamedPath), 'utf8')).toBe('export const x = 1\n')
  })

  it('requires a substantive edit and exact trace citation in raw-trace mode', async () => {
    const prompts: string[] = []
    const generator = agenticGenerator({
      profile: PROFILE,
      executorForWorktree: routedExecutor(({ worktreePath, body, call }) => {
        const user = messages(body).findLast((message) => message.role === 'user')
        prompts.push(String(user?.content ?? ''))
        writeFileSync(join(worktreePath, 'app.ts'), 'export const x = 2\n')
        if (call === 2) {
          mkdirSync(join(worktreePath, '.improve'), { recursive: true })
          writeFileSync(
            join(worktreePath, '.improve', 'raw-trace-diagnosis.md'),
            `${TRACE_PATH}\nStale state caused the bad edit; app.ts now reads the current value.\n`,
          )
        }
      }),
      buildPrompt,
    })
    const worktreePath = await candidateWorktree('raw-trace')

    const result = await generator.generate(generateArgs(worktreePath, RAW_TRACE_FINDINGS, 2))

    expect(result.applied).toBe(true)
    expect(prompts[1]).toContain('raw-trace-diagnosis.md')
    expect(
      readFileSync(join(worktreePath, '.improve', 'raw-trace-diagnosis.md'), 'utf8'),
    ).toContain(TRACE_PATH)
  })
})

/**
 * The placement a local coding CLI actually uses. `cli-worktree` cuts a worktree of its own, so
 * the candidate directory stays clean and every shot reads as "you changed nothing";
 * `cli-in-place` runs the harness in the candidate directory itself, which is what makes the
 * multi-shot loop work at all — a failing shot's edits are still there for the next one.
 */
describe('agenticGenerator on a cli-in-place placement', () => {
  const inPlaceProfile: AgentProfile = {
    name: 'in-place-code-author',
    harness: 'claude-code',
    model: { provider: 'anthropic', default: 'test/author-model' },
    prompt: { systemPrompt: 'AUTHOR SYSTEM' },
  }

  function inPlaceExecutor(
    runHarness: (options: RunLocalHarnessOptions) => Promise<LocalHarnessResult>,
  ): AgenticGeneratorExecutorForWorktree {
    return (worktreePath) => ({
      backend: 'cli-in-place' as const,
      workspacePath: worktreePath,
      runHarness,
    })
  }

  function harnessOk(): LocalHarnessResult {
    return {
      exitCode: 0,
      stdout: 'done',
      stderr: '',
      killedBySignal: null,
      durationMs: 1,
      timedOut: false,
    } as LocalHarnessResult
  }

  it("resumes each shot atop the last shot's edits until the tree verifies", async () => {
    const prompts: string[] = []
    const treeSeenByHarness: string[] = []
    let shot = 0
    const generator = agenticGenerator({
      profile: inPlaceProfile,
      executorForWorktree: inPlaceExecutor(async (options) => {
        shot += 1
        prompts.push(options.taskPrompt)
        const target = join(options.cwd, 'app.ts')
        treeSeenByHarness.push(readFileSync(target, 'utf8'))
        // Shot 1 changes nothing, shot 2 writes a tree the verifier rejects, shot 3 edits the
        // broken file it can only see because the worktree persisted.
        if (shot === 2) writeFileSync(target, 'export const x = broken\n')
        if (shot === 3) {
          const broken = readFileSync(target, 'utf8')
          writeFileSync(target, broken.replace('broken', '2'))
        }
        return harnessOk()
      }),
      buildPrompt,
      verify: (worktreePath) =>
        readFileSync(join(worktreePath, 'app.ts'), 'utf8').includes('broken')
          ? { ok: false, feedback: 'TypeScript: cannot find name broken' }
          : { ok: true },
    })
    const worktreePath = await candidateWorktree('in-place-resume')

    const result = await generator.generate(generateArgs(worktreePath, FINDINGS, 3))

    expect(result.applied).toBe(true)
    expect(shot).toBe(3)
    // The dirty check saw a real tree, so shot 2 was NOT retried as an empty one.
    expect(prompts[1]).toContain('left the working tree unchanged')
    expect(prompts[2]).not.toContain('left the working tree unchanged')
    expect(prompts[2]).toContain('cannot find name broken')
    // The persistence property: shot 3 opened the file shot 2 broke.
    expect(treeSeenByHarness).toEqual([
      'export const x = 1\n',
      'export const x = 1\n',
      'export const x = broken\n',
    ])
    // The edits are in the candidate directory the driver commits, not in a returned patch.
    expect(readFileSync(join(worktreePath, 'app.ts'), 'utf8')).toBe('export const x = 2\n')
  })

  it('records the harness, model and profile that ran on every shot', async () => {
    const receipts: AgenticGeneratorShotReceipt[] = []
    const generator = agenticGenerator({
      profile: inPlaceProfile,
      executorForWorktree: inPlaceExecutor(async (options) => {
        writeFileSync(join(options.cwd, 'app.ts'), 'export const x = 2\n')
        return harnessOk()
      }),
      buildPrompt,
      onShotCompleted: (receipt) => receipts.push(receipt),
    })
    const worktreePath = await candidateWorktree('in-place-receipt')

    const result = await generator.generate(generateArgs(worktreePath))

    // Admission is what a raw `cli` placement fails: it declares no model identity, so it never
    // gets to spend. This placement declares one, so the shot runs and the receipt names it.
    expect(result.applied).toBe(true)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({
      harness: 'claude-code',
      provider: 'anthropic',
      model: 'test/author-model',
      status: 'completed',
      error: null,
    })
    // An unmetered CLI run reports its tokens as unknown rather than as a measured zero.
    expect(receipts[0]?.usage?.tokensKnown).toBe(false)
  })

  it('refuses a placement bound to a directory other than the candidate worktree', async () => {
    let harnessRan = false
    const generator = agenticGenerator({
      profile: inPlaceProfile,
      executorForWorktree: () => ({
        backend: 'cli-in-place' as const,
        workspacePath: repoRoot,
        runHarness: async () => {
          harnessRan = true
          return harnessOk()
        },
      }),
      buildPrompt,
    })
    const worktreePath = await candidateWorktree('in-place-wrong-directory')

    await expect(generator.generate(generateArgs(worktreePath))).rejects.toThrow(
      /workspacePath must equal the candidate worktree/,
    )
    expect(harnessRan).toBe(false)
  })

  it('accepts a placement whose path resolves to the candidate worktree through a symlink', async () => {
    const generator = agenticGenerator({
      profile: inPlaceProfile,
      executorForWorktree: (worktreePath) => ({
        backend: 'cli-in-place' as const,
        // macOS reports the system temporary directory as `/var/...` and resolves it to
        // `/private/var/...`. Both name the same directory, and the guard compares directories.
        workspacePath: realpathSync(worktreePath),
        runHarness: async (options) => {
          writeFileSync(join(options.cwd, 'app.ts'), 'export const x = 2\n')
          return harnessOk()
        },
      }),
      buildPrompt,
    })
    const worktreePath = await candidateWorktree('in-place-symlinked')

    const result = await generator.generate(generateArgs(worktreePath))

    expect(result.applied).toBe(true)
    expect(readFileSync(join(worktreePath, 'app.ts'), 'utf8')).toBe('export const x = 2\n')
  })
})

/**
 * Spending the whole shot budget and shipping the best tree.
 *
 * `ok` used to answer two questions at once — "this tree is shippable" and
 * "stop now" — so a caller who wanted best-of-n had to reject every shot but
 * the last and write the winning tree back into the worktree itself.
 * `keepGoing` and `score` separate the two, and the loop owns the restore.
 */
describe('agenticGenerator best-of-n over the shot budget', () => {
  /** Write a distinct tree per shot, and record the prompt each shot was given. */
  function authorPerShot(
    prompts: string[],
    write: (worktreePath: string, shot: number) => void,
  ): AgenticGeneratorExecutorForWorktree {
    return routedExecutor(({ worktreePath, body, call }) => {
      prompts.push(
        String(messages(body).findLast((message) => message.role === 'user')?.content ?? ''),
      )
      write(worktreePath, call)
    })
  }

  it('COMPATIBILITY: a verifier returning todays shape still stops at the first passing tree', async () => {
    const prompts: string[] = []
    const dispositions: AgenticGeneratorShotDisposition[] = []
    const generator = agenticGenerator({
      profile: PROFILE,
      executorForWorktree: authorPerShot(prompts, (worktreePath, shot) => {
        writeFileSync(join(worktreePath, 'app.ts'), `export const x = ${shot + 1}\n`)
      }),
      buildPrompt,
      // Today's shape byte for byte: one boolean, and an optional string on failure.
      verify: () => ({ ok: true }),
      onShotDisposition: (_receipt, disposition) => dispositions.push(disposition),
    })
    const worktreePath = await candidateWorktree('compatibility-first-acceptance')

    const result = await generator.generate(generateArgs(worktreePath, FINDINGS, 3))

    expect(result.applied).toBe(true)
    // One of three shots fired: the first passing tree still ends the candidate.
    expect(prompts).toHaveLength(1)
    expect(dispositions).toEqual([
      { kind: 'accepted', worktreePath, verified: true, restoredFromShot: null },
    ])
    // The tree the accepted shot left is the tree that ships. Nothing was restored.
    expect(readFileSync(join(worktreePath, 'app.ts'), 'utf8')).toBe('export const x = 2\n')
  })

  it('COMPATIBILITY: a failing verifier still feeds the next shot and never ships', async () => {
    const prompts: string[] = []
    const dispositions: AgenticGeneratorShotDisposition[] = []
    const generator = agenticGenerator({
      profile: PROFILE,
      executorForWorktree: authorPerShot(prompts, (worktreePath, shot) => {
        writeFileSync(join(worktreePath, 'app.ts'), `export const x = broken${shot}\n`)
      }),
      buildPrompt,
      verify: () => ({ ok: false, feedback: 'cannot find name broken' }),
      onShotDisposition: (_receipt, disposition) => dispositions.push(disposition),
    })
    const worktreePath = await candidateWorktree('compatibility-never-verifies')

    const result = await generator.generate(generateArgs(worktreePath, FINDINGS, 3))

    expect(result.applied).toBe(false)
    expect(prompts).toHaveLength(3)
    expect(prompts[1]).toContain('verification FAILED')
    expect(prompts[1]).toContain('cannot find name broken')
    expect(dispositions.map((disposition) => disposition.kind)).toEqual([
      'rejected',
      'rejected',
      'rejected',
    ])
  })

  it('spends every shot when a passing verifier asks to keep going', async () => {
    const prompts: string[] = []
    const dispositions: AgenticGeneratorShotDisposition[] = []
    const generator = agenticGenerator({
      profile: PROFILE,
      executorForWorktree: authorPerShot(prompts, (worktreePath, shot) => {
        writeFileSync(join(worktreePath, 'app.ts'), `export const x = ${shot + 1}\n`)
      }),
      buildPrompt,
      verify: () => ({ ok: true, keepGoing: true, score: 1, feedback: 'it played 300 turns' }),
      onShotDisposition: (_receipt, disposition) => dispositions.push(disposition),
    })
    const worktreePath = await candidateWorktree('spends-every-shot')

    const result = await generator.generate(generateArgs(worktreePath, FINDINGS, 3))

    expect(result.applied).toBe(true)
    // Three of three shots fired, each one reading the passing note.
    expect(prompts).toHaveLength(3)
    expect(prompts[0]).not.toContain('verification PASSED')
    expect(prompts[1]).toContain('verification PASSED')
    expect(prompts[1]).toContain('it played 300 turns')
    expect(prompts[2]).toContain('verification PASSED')
    expect(dispositions.map((disposition) => disposition.kind)).toEqual([
      'kept',
      'kept',
      'kept',
      'accepted',
    ])
    expect(dispositions[0]).toMatchObject({ kind: 'kept', score: 1, best: true })
    // Every tree tied, so the LAST one wins and nothing had to be put back.
    expect(dispositions.at(-1)).toEqual({
      kind: 'accepted',
      worktreePath,
      verified: true,
      restoredFromShot: null,
    })
    expect(readFileSync(join(worktreePath, 'app.ts'), 'utf8')).toBe('export const x = 4\n')
  })

  it('restores the best tree when the best shot is not the last', async () => {
    const prompts: string[] = []
    const dispositions: AgenticGeneratorShotDisposition[] = []
    const scores = [1, 5, 2]
    let shot = 0
    const generator = agenticGenerator({
      profile: PROFILE,
      executorForWorktree: authorPerShot(prompts, (worktreePath, call) => {
        writeFileSync(join(worktreePath, 'app.ts'), `export const x = ${call + 1}\n`)
        // Shot 2's tree also adds a file; shot 3's adds a different one. Only
        // the winner's extra file may survive the restore.
        if (call === 2) writeFileSync(join(worktreePath, 'best.ts'), 'export const best = true\n')
        if (call === 3) writeFileSync(join(worktreePath, 'worse.ts'), 'export const worse = true\n')
      }),
      buildPrompt,
      verify: () => {
        const score = scores[shot]
        shot += 1
        return { ok: true, keepGoing: true, score }
      },
      onShotDisposition: (_receipt, disposition) => dispositions.push(disposition),
    })
    const worktreePath = await candidateWorktree('restores-the-best-tree')

    const result = await generator.generate(generateArgs(worktreePath, FINDINGS, 3))

    expect(result.applied).toBe(true)
    expect(prompts).toHaveLength(3)
    expect(dispositions.map((disposition) => disposition.kind)).toEqual([
      'kept',
      'kept',
      'kept',
      'accepted',
    ])
    expect(dispositions[1]).toMatchObject({ kind: 'kept', score: 5, best: true })
    expect(dispositions[2]).toMatchObject({ kind: 'kept', score: 2, best: false })
    expect(dispositions.at(-1)).toEqual({
      kind: 'accepted',
      worktreePath,
      verified: true,
      restoredFromShot: 2,
    })
    // Shot 2's exact tree ships: its content, its file, and none of shot 3's.
    expect(readFileSync(join(worktreePath, 'app.ts'), 'utf8')).toBe('export const x = 3\n')
    expect(readFileSync(join(worktreePath, 'best.ts'), 'utf8')).toBe('export const best = true\n')
    expect(existsSync(join(worktreePath, 'worse.ts'))).toBe(false)
  })

  it('ships the banked tree when the last shot breaks the change', async () => {
    const dispositions: AgenticGeneratorShotDisposition[] = []
    const prompts: string[] = []
    const generator = agenticGenerator({
      profile: PROFILE,
      executorForWorktree: authorPerShot(prompts, (worktreePath, call) => {
        writeFileSync(
          join(worktreePath, 'app.ts'),
          call === 1 ? 'export const x = 2\n' : 'export const x = broken\n',
        )
      }),
      buildPrompt,
      verify: (candidatePath) =>
        readFileSync(join(candidatePath, 'app.ts'), 'utf8').includes('broken')
          ? { ok: false, feedback: 'cannot find name broken' }
          : { ok: true, keepGoing: true, score: 3 },
      onShotDisposition: (_receipt, disposition) => dispositions.push(disposition),
    })
    const worktreePath = await candidateWorktree('last-shot-regresses')

    const result = await generator.generate(generateArgs(worktreePath, FINDINGS, 2))

    expect(result.applied).toBe(true)
    expect(dispositions.map((disposition) => disposition.kind)).toEqual([
      'kept',
      'rejected',
      'accepted',
    ])
    // The rejection's own evidence survives; the verified tree still ships.
    expect(dispositions[1]).toMatchObject({
      kind: 'rejected',
      stage: 'verification',
      feedback: 'cannot find name broken',
    })
    expect(dispositions.at(-1)).toMatchObject({ kind: 'accepted', restoredFromShot: 1 })
    expect(readFileSync(join(worktreePath, 'app.ts'), 'utf8')).toBe('export const x = 2\n')
  })

  it('ships nothing when no shot of the budget ever verifies', async () => {
    const dispositions: AgenticGeneratorShotDisposition[] = []
    const prompts: string[] = []
    const generator = agenticGenerator({
      profile: PROFILE,
      executorForWorktree: authorPerShot(prompts, (worktreePath, call) => {
        writeFileSync(join(worktreePath, 'app.ts'), `export const x = broken${call}\n`)
      }),
      buildPrompt,
      // The floor: a tree that never played is refused at every shot, last included.
      verify: () => ({ ok: false, feedback: 'the program never played' }),
      onShotDisposition: (_receipt, disposition) => dispositions.push(disposition),
    })
    const worktreePath = await candidateWorktree('nothing-ever-verifies')

    const result = await generator.generate(generateArgs(worktreePath, FINDINGS, 3))

    expect(result.applied).toBe(false)
    expect(result.summary).toBe('')
    expect(prompts).toHaveLength(3)
    expect(dispositions.map((disposition) => disposition.kind)).toEqual([
      'rejected',
      'rejected',
      'rejected',
    ])
  })

  it('refuses a budget whose passing trees cannot be ordered', async () => {
    const prompts: string[] = []
    let shot = 0
    const generator = agenticGenerator({
      profile: PROFILE,
      executorForWorktree: authorPerShot(prompts, (worktreePath, call) => {
        writeFileSync(join(worktreePath, 'app.ts'), `export const x = ${call + 1}\n`)
      }),
      buildPrompt,
      verify: () => {
        shot += 1
        return shot === 1 ? { ok: true, keepGoing: true, score: 4 } : { ok: true, keepGoing: true }
      },
    })
    const worktreePath = await candidateWorktree('unorderable-scores')

    await expect(generator.generate(generateArgs(worktreePath, FINDINGS, 2))).rejects.toThrow(
      /cannot be ranked against an unscored one/,
    )
  })

  it('refuses a non-finite score', async () => {
    const prompts: string[] = []
    const generator = agenticGenerator({
      profile: PROFILE,
      executorForWorktree: authorPerShot(prompts, (worktreePath) => {
        writeFileSync(join(worktreePath, 'app.ts'), 'export const x = 2\n')
      }),
      buildPrompt,
      verify: () => ({ ok: true, keepGoing: true, score: Number.NaN }),
    })
    const worktreePath = await candidateWorktree('non-finite-score')

    await expect(generator.generate(generateArgs(worktreePath, FINDINGS, 2))).rejects.toThrow(
      /non-finite score/,
    )
  })

  it('ships the banked tree when the last shot reverts every edit', async () => {
    const dispositions: AgenticGeneratorShotDisposition[] = []
    const prompts: string[] = []
    const generator = agenticGenerator({
      profile: PROFILE,
      executorForWorktree: authorPerShot(prompts, (worktreePath, call) => {
        // Shot 2 puts the worktree back to its base state, so the dirty check
        // reads it as an empty tree.
        writeFileSync(
          join(worktreePath, 'app.ts'),
          call === 1 ? 'export const x = 2\n' : 'export const x = 1\n',
        )
      }),
      buildPrompt,
      verify: () => ({ ok: true, keepGoing: true, score: 7 }),
      onShotDisposition: (_receipt, disposition) => dispositions.push(disposition),
    })
    const worktreePath = await candidateWorktree('last-shot-reverts')

    const result = await generator.generate(generateArgs(worktreePath, FINDINGS, 2))

    expect(result.applied).toBe(true)
    expect(dispositions.map((disposition) => disposition.kind)).toEqual([
      'kept',
      'clean',
      'accepted',
    ])
    expect(dispositions.at(-1)).toMatchObject({ kind: 'accepted', restoredFromShot: 1 })
    expect(readFileSync(join(worktreePath, 'app.ts'), 'utf8')).toBe('export const x = 2\n')
  })
})

describe('commandVerifier', () => {
  it('reports command failure output and accepts exit zero', async () => {
    const pass = commandVerifier(process.execPath, ['-e', 'process.exit(0)'])
    const fail = commandVerifier(process.execPath, [
      '-e',
      'process.stderr.write("compile failed"); process.exit(1)',
    ])

    await expect(pass(repoRoot)).resolves.toEqual({ ok: true })
    await expect(fail(repoRoot)).resolves.toEqual({
      ok: false,
      feedback: 'compile failed',
    })
  })

  it('throws when the verifier binary does not exist', async () => {
    const verify = commandVerifier('definitely-not-a-real-verifier-binary')

    await expect(verify(repoRoot)).rejects.toThrow(/not found in PATH/)
  })
})
