/**
 * An option key a run does not read must be REFUSED, never discarded.
 *
 * `supervise()` and `runGraph` both took a caller's options object and read the keys they knew.
 * A key no reader consults — a typo, or a seam whose name moved — reached nothing and reported
 * nothing: the call type-checked against a widened value, the run succeeded, and the capability
 * the caller asked for was simply not there. Nothing downstream could detect it, because nothing
 * downstream knew it was supposed to happen.
 */

import { describe, expect, it } from 'vitest'
import { ConfigError } from '../../src/errors'
import type { AgentGraph, RunGraphOptions } from '../../src/runtime/supervise/graph'
import { assertRunGraphAuthoring } from '../../src/runtime/supervise/graph'
import { supervise } from '../../src/runtime/supervise/supervise'
import type { SupervisorProfile } from '../../src/runtime/supervise/types'

const budget = { maxIterations: 4, maxTokens: 10_000 }

const rootProfile = (): SupervisorProfile =>
  ({ name: 'root', harness: 'cli-base', prompt: { systemPrompt: 'lead' } }) as SupervisorProfile

const graph = (): AgentGraph =>
  ({
    nodes: [
      {
        id: 'root',
        profile: {
          name: 'root',
          harness: 'cli-base',
          tools: { agent_runtime_coordination_spawn_worker: true },
        },
      },
      { id: 'worker', profile: { name: 'worker', harness: 'cli-base' } },
    ],
    edges: [
      {
        kind: 'delegates',
        from: 'root',
        to: 'worker',
        directive: { surface: 'delegates/worker-brief', version: 1 },
        maxTraversals: 2,
      },
    ],
    deliverable: { check: () => true },
    budget,
  }) as unknown as AgentGraph

const graphOptions = (over: Record<string, unknown> = {}): RunGraphOptions =>
  ({
    backend: { backend: 'router', complete: async () => ({ text: 'x' }) },
    ...over,
  }) as unknown as RunGraphOptions

describe('supervise() option keys', () => {
  it('refuses an unknown top-level key by name, before any compute', () => {
    expect(() =>
      supervise(rootProfile(), 'task', {
        budget,
        makeWorkerAgnet: () => ({ name: 'w', act: async () => 1 }),
      } as never),
    ).toThrow(ConfigError)
    expect(() => supervise(rootProfile(), 'task', { budget, makeWorkerAgnet: 1 } as never)).toThrow(
      /unknown option makeWorkerAgnet/,
    )
  })

  it('names every unknown key, sorted, in one refusal', () => {
    expect(() => supervise(rootProfile(), 'task', { budget, zeta: 1, alpha: 2 } as never)).toThrow(
      /unknown option alpha, zeta/,
    )
  })

  it('says WHY the key is refused, so the caller reads a discarded capability and not a typo rule', () => {
    expect(() => supervise(rootProfile(), 'task', { budget, alpha: 1 } as never)).toThrow(
      /would be discarded and the capability it asks for would silently be absent/,
    )
  })

  it('accepts a declared key it does not otherwise exercise here', () => {
    // `runDir` is a plain declared option; the refusal must not fire on it. The call still fails
    // for a different, later reason — what matters is that the reason is not the key check.
    expect(() =>
      supervise(rootProfile(), 'task', { budget, runDir: '/tmp/does-not-matter' } as never),
    ).not.toThrow(/unknown option/)
  })
})

describe('runGraph option keys', () => {
  it('refuses a graph-owned key by name instead of overwriting the caller value', () => {
    // The measured shape: the leaf seam was renamed `makeWorkerAgent` -> `makeLeafAgent`, the old
    // name stayed a valid SuperviseOptions key AND a graph-owned one, and a caller that kept
    // passing it got a run with no leaf override and no complaint.
    expect(() =>
      assertRunGraphAuthoring(
        graph(),
        graphOptions({ makeWorkerAgent: () => ({ name: 'w', act: async () => 1 }) }),
      ),
    ).toThrow(ConfigError)
    expect(() =>
      assertRunGraphAuthoring(
        graph(),
        graphOptions({ makeWorkerAgent: () => ({ name: 'w', act: async () => 1 }) }),
      ),
    ).toThrow(/makeWorkerAgent — the graph derives this from the AgentGraph itself/)
  })

  it('refuses every graph-owned key, not only the renamed seam', () => {
    for (const key of ['budget', 'deliverable', 'resolveSpawnProfile', 'analyzeOnSettle']) {
      expect(() => assertRunGraphAuthoring(graph(), graphOptions({ [key]: {} }))).toThrow(
        new RegExp(`runGraph: ${key} — the graph derives this`),
      )
    }
  })

  it('refuses an unknown key by name', () => {
    expect(() => assertRunGraphAuthoring(graph(), graphOptions({ makeLeafAgnet: 1 }))).toThrow(
      /unknown option makeLeafAgnet/,
    )
  })

  it('still accepts every key the graph forwards, transforms, or owns the name of', () => {
    expect(() =>
      assertRunGraphAuthoring(
        graph(),
        graphOptions({
          runDir: '/tmp/does-not-matter',
          maxDepth: 3,
          makeLeafAgent: () => ({ name: 'w', act: async () => 1 }),
          runId: 'run-1',
        }),
      ),
    ).not.toThrow()
  })
})
