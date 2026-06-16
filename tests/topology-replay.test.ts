import { describe, expect, it } from 'vitest'
import type { RuntimeHookEvent } from '../src/runtime-hooks'
import { createReplayRecorder, renderReplayHtml } from '../src/topology/replay'

function ev(
  p: Partial<RuntimeHookEvent> & { target: string; timestamp: number },
): RuntimeHookEvent {
  return {
    id: p.id ?? `${p.target}:${p.timestamp}`,
    runId: p.runId ?? 'run',
    phase: p.phase ?? 'after',
    ...p,
  } as RuntimeHookEvent
}

describe('createReplayRecorder — folds the hook stream into a timestamped timeline', () => {
  it('captures spawn + settle, carrying the completion-oracle `valid` signal', () => {
    const r = createReplayRecorder()
    r.hooks.onEvent?.(
      ev({
        target: 'agent.spawn',
        timestamp: 100,
        parentId: 'run',
        payload: { childId: 'run:s0', label: 'worker', runtime: 'router', depth: 0 },
      }),
      {},
    )
    r.hooks.onEvent?.(
      ev({
        target: 'agent.child',
        timestamp: 250,
        parentId: 'run',
        payload: {
          childId: 'run:s0',
          status: 'done',
          valid: true,
          score: 1,
          spent: { tokens: { input: 10, output: 20 }, usd: 0.001 },
        },
      }),
      {},
    )
    const tl = r.timeline('run')
    const spawn = tl.events.find((e) => e.kind === 'spawn' && e.id === 'run:s0')
    const settle = tl.events.find((e) => e.kind === 'settle' && e.id === 'run:s0')
    expect(spawn?.label).toBe('worker')
    expect(spawn?.runtime).toBe('router')
    expect(settle?.status).toBe('done')
    expect(settle?.valid).toBe(true) // delivered — the oracle signal survives into the timeline
    expect(settle?.score).toBe(1)
    expect(settle?.tokens).toBe(30)
    expect(tl.t0).toBe(100)
    expect(tl.t1).toBe(250)
  })

  it('synthesizes the unspawned root driver so the whole recursion renders', () => {
    const r = createReplayRecorder()
    // A worker whose parent (`run`, the root driver run via act) never emitted a spawn event.
    r.hooks.onEvent?.(
      ev({
        target: 'agent.spawn',
        timestamp: 10,
        parentId: 'run',
        payload: { childId: 'run:s0', label: 'w' },
      }),
      {},
    )
    const tl = r.timeline('run')
    const root = tl.events.find((e) => e.kind === 'root' && e.id === 'run')
    expect(root).toBeDefined() // a synthetic root node, so the worker isn't an orphan
    expect(tl.events.indexOf(root!)).toBe(0) // prepended before the events that reference it
  })

  it('marks a ran-but-not-delivered child distinctly from a delivered one', () => {
    const r = createReplayRecorder()
    r.hooks.onEvent?.(
      ev({
        target: 'agent.spawn',
        timestamp: 1,
        parentId: 'run',
        payload: { childId: 'run:s0', label: 'a' },
      }),
      {},
    )
    r.hooks.onEvent?.(
      ev({
        target: 'agent.child',
        timestamp: 2,
        parentId: 'run',
        payload: { childId: 'run:s0', status: 'done', valid: false, score: 0 },
      }),
      {},
    )
    const settle = r.timeline('run').events.find((e) => e.kind === 'settle')
    expect(settle?.status).toBe('done')
    expect(settle?.valid).toBe(false) // ran, produced output, but did NOT deliver
  })
})

describe('renderReplayHtml — a self-contained animated player', () => {
  it('emits standalone HTML embedding the timeline + the player scaffold', () => {
    const r = createReplayRecorder()
    r.hooks.onEvent?.(
      ev({
        target: 'agent.spawn',
        timestamp: 0,
        parentId: 'run',
        payload: { childId: 'run:s0', label: 'worker' },
      }),
      {},
    )
    r.hooks.onEvent?.(
      ev({
        target: 'agent.child',
        timestamp: 5,
        parentId: 'run',
        payload: { childId: 'run:s0', status: 'done', valid: true },
      }),
      {},
    )
    const html = renderReplayHtml(r.timeline('run'), { title: 'unit' })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('const TL = {')
    expect(html).toContain('"id":"run:s0"')
    expect(html).toContain('id="scrub"') // the timeline scrubber
    expect(html).toContain('<svg id="svg">') // the tree stage
    expect(html).not.toContain('</script></script>') // no injection from the data
  })
})
