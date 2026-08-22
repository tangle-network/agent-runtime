/**
 * Intake of an `AgentSpec` at `scope.spawn`: which specs must carry an executable identity.
 *
 * The kernel resolves an executor for a spec with a factory, a harness, or the router, and every
 * one of those reads the profile, so those specs must select a harness and a concrete model. A
 * verbatim `executor` runs as given and never sees the profile; its profile still parses and
 * digests but is not forced to claim a model nothing runs.
 */
import { describe, expect, it } from 'vitest'
import { executableAgentSpecSnapshot } from './executable-spec'
import type { Executor } from './types'

const verbatim: Executor<unknown> = {
  runtime: 'inline',
  execute: async () => ({
    outRef: 'x',
    out: 'x',
    spent: { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
  }),
  teardown: async () => ({ destroyed: true }),
  resultArtifact: () => ({
    outRef: 'x',
    out: 'x',
    spent: { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
  }),
}

describe('executableAgentSpecSnapshot', () => {
  it('admits a verbatim executor whose profile names no harness or model, frozen', () => {
    const spec = executableAgentSpecSnapshot(
      { profile: { name: 'double' }, harness: null, executor: verbatim },
      'scope.spawn',
    )
    expect(spec.profile).toEqual({ name: 'double' })
    expect(Object.isFrozen(spec)).toBe(true)
    expect(Object.isFrozen(spec.profile)).toBe(true)
    expect(spec.executor).toBe(verbatim)
  })

  it('still refuses the same profile when the kernel must resolve the executor (router)', () => {
    expect(() =>
      executableAgentSpecSnapshot({ profile: { name: 'double' }, harness: null }, 'scope.spawn'),
    ).toThrow(/scope\.spawn: AgentProfile\.harness must be explicit before execution/)
  })

  it('still refuses the same profile behind a factory, which reads the profile at build time', () => {
    expect(() =>
      executableAgentSpecSnapshot(
        { profile: { name: 'double' }, harness: null, executorFactory: () => verbatim },
        'scope.spawn',
      ),
    ).toThrow(/harness must be explicit/)
  })

  it('a verbatim executor still requires a schema-valid profile', () => {
    expect(() =>
      executableAgentSpecSnapshot(
        { profile: { name: 42 } as never, harness: null, executor: verbatim },
        'scope.spawn',
      ),
    ).toThrow()
  })
})
