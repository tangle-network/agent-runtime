import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { ValidationError } from '../errors'
import { applyArtifact, applyArtifacts } from './apply'
import { type EvalResult, type EvalRunner, measureMarginalLift } from './marginal-lift'
import { ArtifactRegistry, createArtifactRegistry } from './registry'
import type { ArtifactInput } from './types'

const baseProfile = (): AgentProfile => ({
  name: 'agent',
  prompt: { systemPrompt: 'be helpful', instructions: ['existing line'] },
  tools: { read: true },
})

const promptArtifact = (): ArtifactInput<'prompt'> => ({
  kind: 'prompt',
  name: 'check-state-first',
  payload: { instruction: 'check state before acting' },
})

describe('applyArtifact', () => {
  it('appends a prompt instruction without mutating the base', () => {
    const base = baseProfile()
    const out = applyArtifact(base, { ...promptArtifact(), id: 'p1', status: 'candidate' })
    expect(out.prompt?.instructions).toEqual(['existing line', 'check state before acting'])
    // base untouched
    expect(base.prompt?.instructions).toEqual(['existing line'])
    expect(out).not.toBe(base)
  })

  it('appends a skill resource ref', () => {
    const out = applyArtifact(baseProfile(), {
      id: 's1',
      kind: 'skill',
      name: 'web-search',
      status: 'candidate',
      payload: { resource: { kind: 'inline', name: 'web-search', content: '# how to search' } },
    })
    expect(out.resources?.skills).toHaveLength(1)
    expect(out.resources?.skills?.[0]).toMatchObject({ kind: 'inline', name: 'web-search' })
  })

  it('grants a tool under its key, preserving existing grants', () => {
    const out = applyArtifact(baseProfile(), {
      id: 't1',
      kind: 'tool',
      key: 'web_search',
      name: 'web search',
      status: 'candidate',
      payload: { enabled: true },
    })
    expect(out.tools).toEqual({ read: true, web_search: true })
  })

  it('uses the artifact id as the key when no explicit key is given', () => {
    const out = applyArtifact(baseProfile(), {
      id: 'edit',
      kind: 'tool',
      name: 'edit',
      status: 'candidate',
      payload: { enabled: true },
    })
    expect(out.tools).toEqual({ read: true, edit: true })
  })

  it('adds an mcp server under its key', () => {
    const out = applyArtifact(baseProfile(), {
      id: 'm1',
      kind: 'mcp',
      key: 'docs',
      name: 'docs server',
      status: 'candidate',
      payload: { server: { transport: 'http', url: 'https://example.com/mcp' } },
    })
    expect(out.mcp?.docs).toEqual({ transport: 'http', url: 'https://example.com/mcp' })
  })

  it('appends hook commands to the named event', () => {
    const withOne = applyArtifact(baseProfile(), {
      id: 'h1',
      kind: 'hook',
      name: 'verify-after-edit',
      status: 'candidate',
      payload: { event: 'PostToolUse', commands: [{ command: 'pnpm test' }] },
    })
    const withTwo = applyArtifact(withOne, {
      id: 'h2',
      kind: 'hook',
      name: 'lint-after-edit',
      status: 'candidate',
      payload: { event: 'PostToolUse', commands: [{ command: 'pnpm lint' }] },
    })
    expect(withTwo.hooks?.PostToolUse).toEqual([{ command: 'pnpm test' }, { command: 'pnpm lint' }])
  })

  it('adds a subagent under its key', () => {
    const out = applyArtifact(baseProfile(), {
      id: 'sa1',
      kind: 'subagent',
      key: 'reviewer',
      name: 'reviewer',
      status: 'candidate',
      payload: { profile: { description: 'reviews diffs', prompt: 'review the diff' } },
    })
    expect(out.subagents?.reviewer).toEqual({
      description: 'reviews diffs',
      prompt: 'review the diff',
    })
  })

  it('applies many artifacts left-to-right (later wins on key conflict)', () => {
    const out = applyArtifacts(baseProfile(), [
      {
        id: 't',
        kind: 'tool',
        key: 'edit',
        name: 'edit',
        status: 'candidate',
        payload: { enabled: true },
      },
      {
        id: 't2',
        kind: 'tool',
        key: 'edit',
        name: 'edit-off',
        status: 'candidate',
        payload: { enabled: false },
      },
    ])
    expect(out.tools?.edit).toBe(false)
  })
})

describe('ArtifactRegistry', () => {
  it('mints stable ids namespaced by kind', () => {
    const reg = new ArtifactRegistry()
    const a = reg.register(promptArtifact())
    const b = reg.register({ kind: 'tool', name: 'edit', payload: { enabled: true } })
    expect(a.id).toBe('prompt-1')
    expect(b.id).toBe('tool-2')
    expect(reg.size).toBe(2)
  })

  it('honors an explicit id and re-registration replaces under the same id', () => {
    const reg = new ArtifactRegistry()
    reg.register({ id: 'x', kind: 'prompt', name: 'v1', payload: { instruction: 'a' } })
    reg.register({ id: 'x', kind: 'prompt', name: 'v2', payload: { instruction: 'b' } })
    expect(reg.size).toBe(1)
    expect(reg.get('x')?.name).toBe('v2')
    expect((reg.get('x')?.payload as { instruction: string }).instruction).toBe('b')
  })

  it('rejects a malformed explicit id (fail loud, no silent mint)', () => {
    const reg = new ArtifactRegistry()
    expect(() =>
      reg.register({ id: '  ', kind: 'prompt', name: 'x', payload: { instruction: 'a' } }),
    ).toThrow(ValidationError)
    expect(() =>
      reg.register({ id: '', kind: 'prompt', name: 'x', payload: { instruction: 'a' } }),
    ).toThrow(ValidationError)
  })

  it('defaults status to candidate and lists/filters by kind + status', () => {
    const reg = createArtifactRegistry()
    const p = reg.register(promptArtifact())
    reg.register({ kind: 'tool', name: 'edit', payload: { enabled: true } })
    expect(reg.list().every((a) => a.status === 'candidate')).toBe(true)
    reg.promote(p.id)
    expect(reg.list({ status: 'active' })).toHaveLength(1)
    expect(reg.list({ kind: 'tool' })).toHaveLength(1)
    expect(reg.list({ kind: 'tool', status: 'active' })).toHaveLength(0)
  })

  it('promote is idempotent and fails loud on an unknown id', () => {
    const reg = new ArtifactRegistry()
    const p = reg.register(promptArtifact())
    expect(reg.promote(p.id).status).toBe('active')
    expect(reg.promote(p.id).status).toBe('active') // idempotent, no throw
    expect(() => reg.promote('nope')).toThrow(ValidationError)
  })

  it('compose with no ids applies only promoted artifacts', () => {
    const reg = new ArtifactRegistry()
    const p = reg.register(promptArtifact())
    reg.register({ kind: 'tool', name: 'edit', payload: { enabled: true } }) // stays candidate
    reg.promote(p.id)
    const out = reg.compose(baseProfile())
    expect(out.prompt?.instructions).toContain('check state before acting')
    // the un-promoted tool is NOT applied
    expect(out.tools).toEqual({ read: true })
  })

  it('compose with explicit ids applies exactly those, in order, failing loud on unknown', () => {
    const reg = new ArtifactRegistry()
    const a = reg.register({
      kind: 'tool',
      key: 'edit',
      name: 'edit-on',
      payload: { enabled: true },
    })
    const b = reg.register({
      kind: 'tool',
      key: 'edit',
      name: 'edit-off',
      payload: { enabled: false },
    })
    expect(reg.compose(baseProfile(), [a.id, b.id]).tools?.edit).toBe(false)
    expect(reg.compose(baseProfile(), [b.id, a.id]).tools?.edit).toBe(true)
    expect(() => reg.compose(baseProfile(), ['ghost'])).toThrow(ValidationError)
  })
})

describe('measureMarginalLift', () => {
  // An eval runner whose score depends on whether a given instruction is present,
  // so the ablation produces a real, predictable delta.
  const runnerThatLikesArtifact = (target: string): EvalRunner => {
    return async (profile): Promise<EvalResult> => {
      const has = (profile.prompt?.instructions ?? []).includes(target)
      return { composite: has ? 0.8 : 0.5, costUsd: has ? 0.02 : 0.01 }
    }
  }

  it('returns the with/without score and cost deltas', async () => {
    const candidate = { ...promptArtifact(), id: 'p1', status: 'candidate' as const }
    const lift = await measureMarginalLift({
      baseline: baseProfile(),
      candidate,
      evalRunner: runnerThatLikesArtifact('check state before acting'),
    })
    expect(lift.artifactId).toBe('p1')
    expect(lift.withoutArtifact.composite).toBe(0.5)
    expect(lift.withArtifact.composite).toBe(0.8)
    expect(lift.scoreDelta).toBeCloseTo(0.3, 10)
    expect(lift.costDelta).toBeCloseTo(0.01, 10)
  })

  it('runs the eval exactly twice (one per arm) by default', async () => {
    let calls = 0
    const runner: EvalRunner = async () => {
      calls += 1
      return { composite: 0.5, costUsd: 0 }
    }
    await measureMarginalLift({
      baseline: baseProfile(),
      candidate: { ...promptArtifact(), id: 'p1', status: 'candidate' },
      evalRunner: runner,
    })
    expect(calls).toBe(2)
  })

  it('skips the baseline arm when a baselineResult is supplied', async () => {
    let calls = 0
    const runner: EvalRunner = async () => {
      calls += 1
      return { composite: 0.9, costUsd: 0.05 }
    }
    const lift = await measureMarginalLift({
      baseline: baseProfile(),
      candidate: { ...promptArtifact(), id: 'p1', status: 'candidate' },
      evalRunner: runner,
      baselineResult: { composite: 0.5, costUsd: 0.01 },
    })
    expect(calls).toBe(1) // only the "with" arm runs
    expect(lift.withoutArtifact.composite).toBe(0.5)
    expect(lift.scoreDelta).toBeCloseTo(0.4, 10)
  })

  it('reports a negative scoreDelta for a harmful artifact (the drop signal)', async () => {
    const runner: EvalRunner = async (profile): Promise<EvalResult> => {
      const harmed = profile.tools?.edit === true
      return { composite: harmed ? 0.2 : 0.7, costUsd: 0 }
    }
    const lift = await measureMarginalLift({
      baseline: baseProfile(),
      candidate: {
        id: 'edit',
        kind: 'tool',
        name: 'edit',
        status: 'candidate',
        payload: { enabled: true },
      },
      evalRunner: runner,
    })
    expect(lift.scoreDelta).toBeLessThan(0)
  })

  it('forwards the abort signal to the runner', async () => {
    const seen: (AbortSignal | undefined)[] = []
    const runner: EvalRunner = async (_profile, signal): Promise<EvalResult> => {
      seen.push(signal)
      return { composite: 0.5, costUsd: 0 }
    }
    const controller = new AbortController()
    await measureMarginalLift({
      baseline: baseProfile(),
      candidate: { ...promptArtifact(), id: 'p1', status: 'candidate' },
      evalRunner: runner,
      signal: controller.signal,
    })
    expect(seen).toEqual([controller.signal, controller.signal])
  })

  it('end-to-end: rank candidates by marginal lift then promote the winners', async () => {
    const reg = new ArtifactRegistry()
    const good = reg.register(promptArtifact())
    const noop = reg.register({ kind: 'tool', name: 'unused', payload: { enabled: true } })

    const runner = runnerThatLikesArtifact('check state before acting')
    const baselineResult: EvalResult = await runner(baseProfile())

    for (const a of reg.list()) {
      const lift = await measureMarginalLift({
        baseline: baseProfile(),
        candidate: a,
        evalRunner: runner,
        baselineResult,
      })
      if (lift.scoreDelta > 0) reg.promote(a.id)
    }

    expect(reg.get(good.id)?.status).toBe('active')
    expect(reg.get(noop.id)?.status).toBe('candidate')
    // composing the active set yields exactly the winning artifact applied
    expect(reg.compose(baseProfile()).prompt?.instructions).toContain('check state before acting')
  })
})
