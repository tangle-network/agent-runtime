import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  type CoderReview,
  type CoderReviewer,
  type CoderWinnerSelection,
  createDefaultCoderDelegate,
} from '../../src/mcp/delegates'
import type { CoderOutput } from '../../src/profiles/coder'

function diff(path: string, plus: number, minus: number): string {
  const out = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`]
  for (let i = 0; i < plus; i += 1) out.push(`+line ${i}`)
  for (let i = 0; i < minus; i += 1) out.push(`-line ${i}`)
  return out.join('\n')
}

// Two distinct, mechanically-VALID candidates that DIVERGE on diff-size vs
// readiness, so the selection strategy is observable:
//   - candidate "small": tiny diff (2 lines), low reviewer readiness
//   - candidate "big":   larger diff (10 lines), high reviewer readiness
const CANDIDATES: CoderOutput[] = [
  {
    branch: 'small',
    patch: diff('src/small.ts', 1, 1),
    testResult: { passed: true, output: 'ok' },
    typecheckResult: { passed: true, output: 'ok' },
    diffStats: { filesChanged: 1, insertions: 1, deletions: 1 },
  },
  {
    branch: 'big',
    patch: diff('src/big.ts', 5, 5),
    testResult: { passed: true, output: 'ok' },
    typecheckResult: { passed: true, output: 'ok' },
    diffStats: { filesChanged: 1, insertions: 5, deletions: 5 },
  },
]

// Stub sandbox client: each create() serves the next candidate (by call order)
// as a parseable `result` event. Two harnesses → two branches → two candidates.
function candidateClient() {
  let i = 0
  return {
    async create(_opts?: CreateSandboxOptions): Promise<SandboxInstance> {
      const out = CANDIDATES[i++ % CANDIDATES.length]!
      return {
        async *streamPrompt() {
          yield { type: 'result', data: { result: out } } satisfies SandboxEvent
        },
      } as unknown as SandboxInstance
    },
  }
}

const ctx = { signal: new AbortController().signal, report() {} }
const args = { goal: 'fix it', repoRoot: '/repo', variants: 2 }

// Reviewer that approves both but rates the BIG candidate more ready.
const readinessReviewer: CoderReviewer = (output) => ({
  approved: true,
  recommendation: 'ship',
  readiness: output.branch === 'big' ? 0.9 : 0.4,
})

describe('createDefaultCoderDelegate — reviewer gate + winner selection', () => {
  it('smallest-diff selects the smaller valid patch', async () => {
    const delegate = createDefaultCoderDelegate({
      sandboxClient: candidateClient(),
      fanoutHarnesses: ['claude-code', 'codex'],
      winnerSelection: 'smallest-diff' satisfies CoderWinnerSelection,
    })
    const out = await delegate(args, ctx)
    expect(out.branch).toBe('small')
  })

  it('highest-readiness selects by the reviewer score, diverging from diff size', async () => {
    const delegate = createDefaultCoderDelegate({
      sandboxClient: candidateClient(),
      fanoutHarnesses: ['claude-code', 'codex'],
      reviewer: readinessReviewer,
      winnerSelection: 'highest-readiness',
    })
    const out = await delegate(args, ctx)
    expect(out.branch).toBe('big')
  })

  it('rejects when the reviewer approves nothing (fails loud, no winner)', async () => {
    const rejectAll: CoderReviewer = (): CoderReview => ({
      approved: false,
      recommendation: 'changes-requested',
      readiness: 0,
    })
    const delegate = createDefaultCoderDelegate({
      sandboxClient: candidateClient(),
      fanoutHarnesses: ['claude-code', 'codex'],
      reviewer: rejectAll,
    })
    await expect(delegate(args, ctx)).rejects.toThrow(/validation \+ review/)
  })

  it('default highest-score (no reviewer) still returns a valid winner', async () => {
    const delegate = createDefaultCoderDelegate({
      sandboxClient: candidateClient(),
      fanoutHarnesses: ['claude-code', 'codex'],
    })
    const out = await delegate(args, ctx)
    // smaller diff → higher diffSize score → highest-score favors it; either way a valid winner.
    expect(['small', 'big']).toContain(out.branch)
  })
})

import type { LoopTraceEmitter, LoopTraceEvent } from '../../src/runtime'

describe('createDefaultCoderDelegate — trace emitter wiring (MCP → OTEL sink)', () => {
  it('forwards the trace emitter into the delegated runLoop (loop.* spans emitted)', async () => {
    const events: LoopTraceEvent[] = []
    const traceEmitter: LoopTraceEmitter = { emit: (e) => void events.push(e) }
    const delegate = createDefaultCoderDelegate({
      sandboxClient: candidateClient(),
      fanoutHarnesses: ['claude-code', 'codex'],
      traceEmitter,
    })
    await delegate(args, ctx)
    const kinds = new Set(events.map((e) => e.kind))
    // the delegated loop's topology spans reach the emitter → the OTLP exporter
    expect(kinds.has('loop.started')).toBe(true)
    expect(kinds.has('loop.ended')).toBe(true)
    expect(kinds.has('loop.iteration.ended')).toBe(true)
  })
})
