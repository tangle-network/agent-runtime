import {
  type CompiledSearchSpec,
  compileSearchSpec,
  type GateDecision,
  promptHandle,
  runGraph,
  type SearchSpec,
  type SearchSpecInputs,
  searchPresets,
} from '@tangle-network/agent-runtime/kernel'
import { describe, expect, it } from 'vitest'
import { testContinuationProfile } from '../helpers/continuation'

// Only authoring and synchronous refusal run here. No executor or model is created.
const spec: SearchSpec = {
  ...searchPresets.tree(1),
  select: 'fixed',
}
const directive = promptHandle('delegates/worker-brief/v1')
const graph: NonNullable<SearchSpecInputs['graph']> = {
  triggerBindings: [],
  nodes: [{ id: 'critic', profile: { name: 'critic', harness: 'codex' } }],
  entry: [{ node: 'critic', task: { question: 'Review the retained evidence.' } }],
  gates: [{ id: 'approval', question: 'Accept?', choices: ['accept', 'reject'] }],
  edges: [
    { kind: 'routes', from: 'critic', to: 'approval', directive },
    {
      kind: 'routes',
      from: 'approval',
      to: { finish: 'accepted' },
      when: { pointer: '/choice', equals: 'accept' },
      directive,
    },
    {
      kind: 'routes',
      from: 'approval',
      to: { stop: 'declined' },
      when: { pointer: '/choice', equals: 'reject' },
      directive,
    },
  ],
}
let calls = 0
const forbidden = async (): Promise<never> => {
  calls += 1
  throw new Error('No execution is authorized by this authoring check')
}
const decideGate = async (): Promise<GateDecision> => forbidden()
const inputs: SearchSpecInputs = {
  graph,
  budget: { maxIterations: 2, maxTokens: 100 },
  deliverable: { describe: 'Retained accepted evidence', check: forbidden, checkRef: 'retained' },
  continuation: { profile: testContinuationProfile },
  options: { backend: { backend: 'provider', provider: 'tangle' }, decideGate },
}
function compiled(): Extract<CompiledSearchSpec, { call: 'runGraph' }> {
  const result = compileSearchSpec(spec, inputs)
  if (result.call !== 'runGraph') throw new Error('Fixed flow must compile to runGraph')
  return result
}

describe('public SearchSpec flow authoring', () => {
  it('preserves canonical graph metadata and its environment gate binding', () => {
    const result = compiled()
    expect(result.graph).toEqual({
      ...graph,
      budget: inputs.budget,
      deliverable: inputs.deliverable,
    })
    expect(result.graph.entry).toBe(graph.entry)
    expect(result.graph.gates).toBe(graph.gates)
    expect(result.graph.triggerBindings).toBe(graph.triggerBindings)
    expect(result.options.decideGate).toBe(decideGate)
    expect(Object.isFrozen(result.graph)).toBe(true)
    expect(calls).toBe(0)
  })

  it('reaches canonical flow admission and refuses missing gate authority before execution', () => {
    const result = compiled()
    const { decideGate: omitted, ...options } = result.options
    expect(omitted).toBe(decideGate)
    expect(() => runGraph(result.graph, options)).toThrow('graph.gates needs opts.decideGate')
    expect(() => runGraph({ ...result.graph, entry: undefined }, result.options)).toThrow(
      'graph.gates needs graph.entry',
    )
    expect(calls).toBe(0)
  })

  it('refuses a root driver or caller brain on the preserved flow before execution', () => {
    const result = compiled()
    expect(() =>
      runGraph(result.graph, { ...result.options, driverBackend: inputs.options?.backend }),
    ).toThrow('driverBackend with graph.entry')
    const code = compileSearchSpec({ ...spec, select: 'code' }, { ...inputs, brain: forbidden })
    if (code.call !== 'runGraph') throw new Error('Code compiles to runGraph')
    expect(() => runGraph(code.graph, code.options)).toThrow('brain with graph.entry')
    expect(calls).toBe(0)
  })

  it('refuses a separate root profile for a fixed graph', () => {
    expect(() => compileSearchSpec(spec, { ...inputs, profile: { name: 'root' } })).toThrow(
      'drop inputs.profile and inputs.task',
    )
    expect(calls).toBe(0)
  })
})
