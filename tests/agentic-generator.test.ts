import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
