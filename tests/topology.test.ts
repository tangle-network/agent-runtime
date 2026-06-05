import { describe, expect, it } from 'vitest'
import type { RuntimeHookEvent, RuntimeHookTarget } from '../src/runtime-hooks'
import { createTopologyView, renderTopologyTree } from '../src/topology/tree'

// The events here mirror EXACTLY what the keystone emits — `agent.spawn`/`agent.child` from
// `Scope` (proven real by tests/loops/supervise.test.ts §9) and `agent.turn` from the tool loop.
// The view is a pure projection of that contract, so folding the contract is the honest test.

let seq = 0
function ev(
  target: RuntimeHookTarget,
  phase: RuntimeHookEvent['phase'],
  over: Partial<RuntimeHookEvent> & { payload?: Record<string, unknown> },
): RuntimeHookEvent {
  seq += 1
  return { id: `e${seq}`, runId: 'run', target, phase, timestamp: seq, ...over }
}

/** A two-level tree: root `run` drives `planner` (itself a sub-driver) + `coder`; planner drives
 *  `subtask`. coder takes 2 turns then fails its tests; planner + subtask succeed. */
function buildSampleRun() {
  const view = createTopologyView()
  const e = (event: RuntimeHookEvent) => view.ingest(event)

  e(ev('agent.run', 'before', { runId: 'run', payload: { driver: 'supervisor' } }))
  e(
    ev('agent.spawn', 'after', {
      parentId: 'run',
      payload: { childId: 'run:s0', label: 'planner', runtime: 'router', depth: 1 },
    }),
  )
  e(
    ev('agent.spawn', 'after', {
      parentId: 'run',
      payload: { childId: 'run:s1', label: 'coder', runtime: 'sandbox', depth: 1 },
    }),
  )
  e(
    ev('agent.spawn', 'after', {
      parentId: 'run:s0',
      payload: { childId: 'run:s0:s0', label: 'subtask', runtime: 'router', depth: 2 },
    }),
  )
  // coder works two turns (tool-loop keys the agent by runId), then fails its deployable check.
  e(ev('agent.turn', 'after', { runId: 'run:s1', payload: {} }))
  e(ev('agent.turn', 'after', { runId: 'run:s1', payload: {} }))
  e(
    ev('agent.child', 'after', {
      parentId: 'run:s0',
      payload: { childId: 'run:s0:s0', status: 'done', score: 0.91, valid: true },
    }),
  )
  e(
    ev('agent.child', 'after', {
      parentId: 'run',
      payload: { childId: 'run:s0', status: 'done', score: 0.8, valid: true },
    }),
  )
  e(
    ev('agent.child', 'after', {
      parentId: 'run',
      payload: { childId: 'run:s1', status: 'down', reason: 'tests failed' },
    }),
  )
  e(ev('agent.run', 'after', { runId: 'run', payload: {} }))
  return view
}

describe('topology view — folds the lifecycle stream into the recursive agent tree', () => {
  it('builds the parent/child structure with status, score, and step counts', () => {
    const view = buildSampleRun()

    expect(view.roots().map((n) => n.id)).toEqual(['run'])
    expect(view.node('run')?.status).toBe('done')
    expect(view.node('run')?.childIds).toEqual(['run:s0', 'run:s1'])
    expect(view.node('run:s0')?.childIds).toEqual(['run:s0:s0'])

    // Depth flows from the spawn payload.
    expect(view.node('run:s0:s0')?.depth).toBe(2)

    // Terminal status + the deployable verdict the viewer colors by.
    expect(view.node('run:s0')).toMatchObject({ status: 'done', score: 0.8 })
    expect(view.node('run:s1')).toMatchObject({ status: 'down', reason: 'tests failed' })

    // Steps attribute to the agent that ran them (coder took 2 turns; nobody else stepped).
    expect(view.node('run:s1')?.steps).toBe(2)
    expect(view.node('run:s0')?.steps).toBe(0)
  })

  it('renders an aligned ASCII forest with glyphs + per-node detail', () => {
    const out = buildSampleRun().render()
    const lines = out.split('\n')

    // Root first, then its children indented under tree branches.
    expect(lines[0]).toBe('✓ supervisor  (2 children)')
    expect(out).toContain('├─ ✓ planner  (router · 1 children · score 0.80)')
    expect(out).toContain('│  └─ ✓ subtask  (router · score 0.91)')
    expect(out).toContain('└─ ✗ coder  (sandbox · 2 steps · down: tests failed)')
  })

  it('compact mode drops detail; maxDepth collapses deep subtrees', () => {
    const view = buildSampleRun()
    expect(view.render({ compact: true })).toContain('├─ ✓ planner')
    expect(view.render({ compact: true })).not.toContain('children')

    const capped = view.render({ maxDepth: 1 })
    expect(capped).toContain('└─ … 1 more') // subtask collapses under planner at depth 1
    expect(capped).not.toContain('subtask')
  })

  it('a step or settle for an unknown agent is dropped — no phantom node', () => {
    const view = createTopologyView()
    view.ingest(ev('agent.turn', 'after', { runId: 'ghost', payload: {} }))
    expect(view.nodes()).toHaveLength(0)
  })

  it('renderTopologyTree is pure over a folded tree (replay-friendly)', () => {
    const view = buildSampleRun()
    const a = renderTopologyTree({ roots: view.roots(), node: (id) => view.node(id) })
    const b = view.render()
    expect(a).toBe(b)
  })
})
