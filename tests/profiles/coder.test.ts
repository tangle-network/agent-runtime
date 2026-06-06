import type { SandboxEvent } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  type CoderOutput,
  type CoderTask,
  coderProfile,
  createCoderValidator,
  multiHarnessCoderFanout,
} from '../../src/profiles'

const ctx = { iteration: 0, signal: new AbortController().signal }

function diff(filesTouched: string[], plusLines: number, minusLines: number): string {
  const out: string[] = []
  for (const path of filesTouched) {
    out.push(`diff --git a/${path} b/${path}`)
    out.push(`--- a/${path}`)
    out.push(`+++ b/${path}`)
    for (let i = 0; i < plusLines; i += 1) out.push(`+line ${i}`)
    for (let i = 0; i < minusLines; i += 1) out.push(`-line ${i}`)
  }
  return out.join('\n')
}

const baseTask: CoderTask = {
  goal: 'minor fix',
  repoRoot: '/repo',
  forbiddenPaths: ['secrets/', 'dist/'],
  maxDiffLines: 100,
}

describe('createCoderValidator — task-bound validator', () => {
  it('passes when tests + typecheck + diff size + forbidden-path all clean', async () => {
    const validator = createCoderValidator(baseTask)
    const output: CoderOutput = {
      branch: 'feat/x',
      patch: diff(['src/foo.ts'], 10, 5),
      testResult: { passed: true, output: 'ok' },
      typecheckResult: { passed: true, output: 'ok' },
      diffStats: { filesChanged: 1, insertions: 10, deletions: 5 },
    }
    const verdict = await validator.validate(output, ctx)
    expect(verdict.valid).toBe(true)
    // score = 0.5 + 0.3 + 0.2*(1 - 15/100) = 0.5 + 0.3 + 0.17 = 0.97
    expect(verdict.score).toBeCloseTo(0.97, 6)
    expect(verdict.scores?.forbiddenPath).toBe(1)
    expect(verdict.scores?.diffSize).toBeCloseTo(0.85, 6)
  })

  it('fails hard when a forbidden path is touched', async () => {
    const validator = createCoderValidator(baseTask)
    const output: CoderOutput = {
      branch: 'feat/x',
      patch: diff(['secrets/keys.ts'], 1, 0),
      testResult: { passed: true, output: 'ok' },
      typecheckResult: { passed: true, output: 'ok' },
      diffStats: { filesChanged: 1, insertions: 1, deletions: 0 },
    }
    const verdict = await validator.validate(output, ctx)
    expect(verdict.valid).toBe(false)
    expect(verdict.scores?.forbiddenPath).toBe(0)
    expect(verdict.notes).toMatch(/forbidden/)
  })

  it('fails hard when diff exceeds maxDiffLines', async () => {
    const validator = createCoderValidator({ ...baseTask, maxDiffLines: 5 })
    const output: CoderOutput = {
      branch: 'feat/x',
      patch: diff(['src/foo.ts'], 10, 0),
      testResult: { passed: true, output: 'ok' },
      typecheckResult: { passed: true, output: 'ok' },
      diffStats: { filesChanged: 1, insertions: 10, deletions: 0 },
    }
    const verdict = await validator.validate(output, ctx)
    expect(verdict.valid).toBe(false)
    expect(verdict.scores?.diffSize).toBe(0)
    expect(verdict.notes).toMatch(/exceeds cap 5/)
  })

  it('fails when tests fail; score still reflects partial credit elsewhere', async () => {
    const validator = createCoderValidator(baseTask)
    const output: CoderOutput = {
      branch: 'feat/x',
      patch: diff(['src/foo.ts'], 4, 1),
      testResult: { passed: false, output: 'red' },
      typecheckResult: { passed: true, output: 'ok' },
      diffStats: { filesChanged: 1, insertions: 4, deletions: 1 },
    }
    const verdict = await validator.validate(output, ctx)
    expect(verdict.valid).toBe(false)
    expect(verdict.scores?.tests).toBe(0)
    expect(verdict.scores?.typecheck).toBe(1)
    // score = 0 + 0.3 + 0.2*(1 - 5/100) = 0.3 + 0.19 = 0.49
    expect(verdict.score).toBeCloseTo(0.49, 6)
  })

  it('fails when typecheck fails', async () => {
    const validator = createCoderValidator(baseTask)
    const output: CoderOutput = {
      branch: 'feat/x',
      patch: diff(['src/foo.ts'], 2, 0),
      testResult: { passed: true, output: 'ok' },
      typecheckResult: { passed: false, output: 'TS2304' },
      diffStats: { filesChanged: 1, insertions: 2, deletions: 0 },
    }
    const verdict = await validator.validate(output, ctx)
    expect(verdict.valid).toBe(false)
    expect(verdict.scores?.typecheck).toBe(0)
  })

  it('treats subdirectory matches under a forbidden prefix as forbidden', async () => {
    const validator = createCoderValidator({ ...baseTask, forbiddenPaths: ['vendor'] })
    const output: CoderOutput = {
      branch: 'feat/x',
      patch: diff(['vendor/lib/file.ts'], 1, 0),
      testResult: { passed: true, output: '' },
      typecheckResult: { passed: true, output: '' },
      diffStats: { filesChanged: 1, insertions: 1, deletions: 0 },
    }
    const verdict = await validator.validate(output, ctx)
    expect(verdict.valid).toBe(false)
    expect(verdict.notes).toMatch(/vendor/)
  })
})

describe('coderProfile output adapter', () => {
  const preset = coderProfile({ task: baseTask })

  it('parses a final result event with embedded coder output', () => {
    const events: SandboxEvent[] = [
      { type: 'text_delta', data: { text: 'working...' } },
      {
        type: 'result',
        data: {
          result: {
            branch: 'feat/y',
            patch: diff(['src/foo.ts'], 2, 0),
            testResult: { passed: true, output: 'ok' },
            typecheckResult: { passed: true, output: 'ok' },
            diffStats: { filesChanged: 1, insertions: 2, deletions: 0 },
            reviewerNotes: 'lgtm',
          },
        },
      },
    ]
    const out = preset.output.parse(events)
    expect(out.branch).toBe('feat/y')
    expect(out.testResult.passed).toBe(true)
    expect(out.diffStats.insertions).toBe(2)
    expect(out.reviewerNotes).toBe('lgtm')
  })

  it('falls back to parsing a fenced JSON block out of a text delta', () => {
    const fenced =
      'Done. Here is the patch summary:\n```json\n' +
      JSON.stringify({
        branch: 'feat/z',
        patch: '',
        testResult: { passed: false, output: 'fail' },
        typecheckResult: { passed: true, output: '' },
        diffStats: { filesChanged: 0, insertions: 0, deletions: 0 },
      }) +
      '\n```'
    const events: SandboxEvent[] = [{ type: 'text_delta', data: { text: fenced } }]
    const out = preset.output.parse(events)
    expect(out.branch).toBe('feat/z')
    expect(out.testResult.passed).toBe(false)
  })

  it('reassembles the result JSON from opencode message.part.updated fragments', () => {
    // opencode streams assistant text as incremental `message.part.updated`
    // deltas; the result block is split across many of them and never whole
    // in a single event. The adapter must accumulate then scan.
    const fenced =
      'All set.\n```json\n' +
      JSON.stringify({
        branch: 'feat/opencode',
        patch: diff(['src/bar.ts'], 3, 0),
        testResult: { passed: true, output: 'ok' },
        typecheckResult: { passed: true, output: 'ok' },
        diffStats: { filesChanged: 1, insertions: 3, deletions: 0 },
      }) +
      '\n```'
    const events: SandboxEvent[] = []
    for (let i = 0; i < fenced.length; i += 7) {
      events.push({
        type: 'message.part.updated',
        data: { part: { type: 'text' }, delta: fenced.slice(i, i + 7) },
      } as SandboxEvent)
    }
    const out = preset.output.parse(events)
    expect(out.branch).toBe('feat/opencode')
    expect(out.testResult.passed).toBe(true)
    expect(out.diffStats.insertions).toBe(3)
  })

  it('ignores reasoning parts and picks the last valid fenced block', () => {
    const decoy = JSON.stringify({
      branch: 'decoy',
      patch: '',
      testResult: { passed: false, output: '' },
      typecheckResult: { passed: false, output: '' },
      diffStats: { filesChanged: 0, insertions: 0, deletions: 0 },
    })
    const real = JSON.stringify({
      branch: 'feat/final',
      patch: diff(['a.ts'], 1, 0),
      testResult: { passed: true, output: '' },
      typecheckResult: { passed: true, output: '' },
      diffStats: { filesChanged: 1, insertions: 1, deletions: 0 },
    })
    const events: SandboxEvent[] = [
      {
        type: 'message.part.updated',
        data: { part: { type: 'reasoning' }, delta: '```json\n' + decoy + '\n``` thinking...' },
      },
      {
        type: 'message.part.updated',
        data: { part: { type: 'text' }, delta: 'earlier ```json\n' + decoy + '\n``` then ' },
      },
      {
        type: 'message.part.updated',
        data: { part: { type: 'text' }, delta: 'final ```json\n' + real + '\n```' },
      },
    ] as SandboxEvent[]
    const out = preset.output.parse(events)
    expect(out.branch).toBe('feat/final')
  })

  it('returns an empty CoderOutput when no structured result is present', () => {
    const events: SandboxEvent[] = [{ type: 'text_delta', data: { text: 'hello' } }]
    const out = preset.output.parse(events)
    expect(out.branch).toBe('')
    expect(out.testResult.passed).toBe(false)
    expect(out.diffStats.filesChanged).toBe(0)
  })
})

describe('multiHarnessCoderFanout — heterogeneous fanout bundle', () => {
  it('produces one AgentRunSpec per harness and a fanout driver of matching n', () => {
    const bundle = multiHarnessCoderFanout({ harnesses: ['claude-code', 'codex'] })
    expect(bundle.agentRuns).toHaveLength(2)
    expect(bundle.agentRuns.map((s) => s.name)).toEqual(['coder-claude-code', 'coder-codex'])
    expect(bundle.agentRuns.every((s) => s.profile.tools?.git === true)).toBe(true)
  })
})

describe('createCoderValidator — default-on safety floor (no-op + secrets)', () => {
  it('rejects an empty patch (no-op) even when tests + typecheck pass', async () => {
    const validator = createCoderValidator(baseTask)
    const output: CoderOutput = {
      branch: 'feat/x',
      patch: '',
      testResult: { passed: true, output: 'ok' },
      typecheckResult: { passed: true, output: 'ok' },
      diffStats: { filesChanged: 0, insertions: 0, deletions: 0 },
    }
    const verdict = await validator.validate(output, ctx)
    expect(verdict.valid).toBe(false)
    expect(verdict.scores?.nonEmpty).toBe(0)
    expect(verdict.notes).toMatch(/empty patch/i)
  })

  it('rejects a patch touching a secret-shaped path regardless of forbiddenPaths', async () => {
    // `.env` is NOT in baseTask.forbiddenPaths — the secret floor is always-on.
    const validator = createCoderValidator(baseTask)
    const output: CoderOutput = {
      branch: 'feat/x',
      patch: diff(['config/.env', 'src/ok.ts'], 2, 0),
      testResult: { passed: true, output: 'ok' },
      typecheckResult: { passed: true, output: 'ok' },
      diffStats: { filesChanged: 2, insertions: 2, deletions: 0 },
    }
    const verdict = await validator.validate(output, ctx)
    expect(verdict.valid).toBe(false)
    expect(verdict.scores?.noSecrets).toBe(0)
    expect(verdict.notes).toMatch(/secret-shaped/i)
  })

  it('passes a normal non-empty, non-secret patch (floor does not regress clean work)', async () => {
    const validator = createCoderValidator(baseTask)
    const output: CoderOutput = {
      branch: 'feat/x',
      patch: diff(['src/foo.ts'], 3, 1),
      testResult: { passed: true, output: 'ok' },
      typecheckResult: { passed: true, output: 'ok' },
      diffStats: { filesChanged: 1, insertions: 3, deletions: 1 },
    }
    const verdict = await validator.validate(output, ctx)
    expect(verdict.valid).toBe(true)
    expect(verdict.scores?.nonEmpty).toBe(1)
    expect(verdict.scores?.noSecrets).toBe(1)
  })
})
