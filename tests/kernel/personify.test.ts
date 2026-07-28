import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { ValidationError } from '../../src/errors'
import {
  fanout,
  flatWidenGate,
  loopUntil,
  panel,
  pipeline,
  verify,
  widen,
} from '../../src/runtime/personify/combinators'
import { definePersona, runPersonified } from '../../src/runtime/personify/persona'
import type {
  CombinatorShape,
  Outcome,
  PanelVerdict,
  Persona,
  ScopeWidenGate,
} from '../../src/runtime/personify/wave-types'
import { spendFromUsageEvents } from '../../src/runtime/supervise/budget'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import type {
  AgentSpec,
  Budget,
  DefaultVerdict,
  Executor,
  ExecutorResult,
  Settled,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import type { RuntimeHookEvent, RuntimeHooks } from '../../src/runtime-hooks'

// ── Offline mock leaf runtime ─────────────────────────────────────────────────────
//
// The whole personify layer runs offline against this. A registered `'router'` factory
// mints a fresh scripted leaf per spawn; the script is derived FROM the child task the
// combinator fed (the seam every shape uses to route a per-child role), so one persona
// can drive many children with distinct verdicts. No network, no sandbox, no subprocess.

interface MockScript {
  readonly out: unknown
  readonly events: UsageEvent[]
  readonly verdict?: DefaultVerdict
  /** When set, the stream throws — the scope types it into a `down` settlement. */
  readonly failWith?: string
}

function mintMockExecutor(scriptFor: (task: unknown) => MockScript): Executor<unknown> {
  let artifact: ExecutorResult<unknown> | undefined
  return {
    runtime: 'router',
    execute(task: unknown): AsyncIterable<UsageEvent> {
      const script = scriptFor(task)
      return (async function* () {
        if (script.failWith !== undefined) throw new ValidationError(script.failWith)
        artifact = {
          outRef: `mock:${stableKey(script.out)}`,
          out: script.out,
          ...(script.verdict ? { verdict: script.verdict } : {}),
          spent: spendFromUsageEvents(script.events),
        }
        for (const ev of script.events) yield ev
      })()
    },
    teardown(): Promise<{ destroyed: boolean }> {
      return Promise.resolve({ destroyed: true })
    },
    resultArtifact(): ExecutorResult<unknown> {
      if (!artifact) throw new ValidationError('mock: resultArtifact before stream drained')
      return artifact
    },
  }
}

function stableKey(value: unknown): string {
  return JSON.stringify(value) ?? String(value)
}

/** A registry whose `harness:null` specs resolve to a fresh per-spawn mock; everything else
 *  falls through to the real registry. The persona's root spec is `harness:null`, so every
 *  child the shapes spawn drives this — fully offline. */
function mockRegistry(scriptFor: (task: unknown) => MockScript) {
  const base = createExecutorRegistry()
  return {
    register: base.register.bind(base),
    resolve<Out>(spec: AgentSpec) {
      if (!spec.executor && spec.harness === null) {
        return {
          succeeded: true as const,
          value: (): Executor<Out> => mintMockExecutor(scriptFor) as Executor<Out>,
        }
      }
      return base.resolve<Out>(spec)
    },
  }
}

function makePersona<D>(
  name: string,
  role: string,
  scriptFor: (task: unknown) => MockScript,
): Persona<D> {
  return definePersona<D>({
    name,
    root: { profile: { name: role } as AgentProfile, harness: null },
    directive: `act as ${role}`,
    context: { role },
    executors: { registry: mockRegistry(scriptFor) },
  })
}

const ev = (input: number, output: number): UsageEvent[] => [
  { kind: 'iteration' },
  { kind: 'tokens', input, output },
]

const wideBudget: Budget = { maxIterations: 200, maxTokens: 1_000_000 }
const wideShapeBudget = { fanout: 4, perChild: { maxIterations: 10, maxTokens: 50_000 } }

/** Run a combinator factory verbatim (NOT via a registry name) through the real keystone.
 *  Passing the factory directly keeps the test independent of the shape-name registry. */
async function runShape<Task, D>(persona: Persona<D>, shape: CombinatorShape<Task, D>, task: Task) {
  return runPersonified<Task, D>({
    persona,
    shape,
    task,
    budget: wideBudget,
    shapeBudget: wideShapeBudget,
    runId: `${persona.name}:run`,
    journal: new InMemorySpawnJournal(),
    blobs: new InMemoryResultBlobStore(),
    now: () => 0,
  })
}

/** A combinator returns a `done`/`blocked` Outcome; that Outcome rides home on a supervisor
 *  `winner` (the root act resolved). The Outcome contract lives in `out.kind`, never in
 *  `SupervisedResult.kind`. */
function expectOutcome<D>(result: Awaited<ReturnType<typeof runShape<unknown, D>>>): Outcome<D> {
  expect(result.kind).toBe('winner')
  if (result.kind !== 'winner') throw new Error('expected a supervisor winner')
  return result.out
}

// ── 1. pipeline ────────────────────────────────────────────────────────────────────

describe('combinator · pipeline', () => {
  it('feeds each stage into the next and delivers the terminal stage on success', async () => {
    const persona = makePersona<string>('coder', 'engineer', (task) => ({
      out: `${stageOf(task)}-out`,
      events: ev(10, 10),
      verdict: { valid: true, score: 0.8 },
    }))
    const shape = pipeline<{ goal: string }, string>([
      { label: 'plan', feed: (prior) => ({ stage: 'plan', prior }), collect: collectStr },
      { label: 'implement', feed: (prior) => ({ stage: 'implement', prior }), collect: collectStr },
      { label: 'integrate', feed: (prior) => ({ stage: 'integrate', prior }), collect: collectStr },
    ])
    const out = expectOutcome(await runShape(persona, shape, { goal: 'ship' }))
    expect(out.kind).toBe('done')
    if (out.kind === 'done') expect(out.deliverable).toBe('integrate-out')
  })

  it('short-circuits to a blocked Outcome on the first failed stage (no coercion past it)', async () => {
    const persona = makePersona<string>('coder', 'engineer', (task) =>
      stageOf(task) === 'implement'
        ? { out: null, events: [], failWith: 'compiler crash' }
        : { out: `${stageOf(task)}-out`, events: ev(5, 5), verdict: { valid: true, score: 0.7 } },
    )
    const shape = pipeline<{ goal: string }, string>([
      { label: 'plan', feed: (prior) => ({ stage: 'plan', prior }), collect: collectStr },
      { label: 'implement', feed: (prior) => ({ stage: 'implement', prior }), collect: collectStr },
      { label: 'integrate', feed: (prior) => ({ stage: 'integrate', prior }), collect: collectStr },
    ])
    const out = expectOutcome(await runShape(persona, shape, { goal: 'ship' }))
    expect(out.kind).toBe('blocked')
    if (out.kind === 'blocked') {
      expect(out.blockers.length).toBeGreaterThan(0)
      expect(out.blockers.join(' ')).toMatch(/compiler crash/)
    }
  })
})

function stageOf(task: unknown): string {
  if (task && typeof task === 'object' && 'stage' in task)
    return String((task as { stage: unknown }).stage)
  return 'root'
}

const collectStr = (settled: Settled<Outcome<string>>): Outcome<string> =>
  settled.kind === 'done'
    ? { kind: 'done', deliverable: settled.out as unknown as string }
    : { kind: 'blocked', blockers: [`${settled.handle.label}: ${settled.reason}`] }

// ── 2. fanout (+ generality: one shape, two domains) ─────────────────────────────────

const angleFanout = <D>() =>
  fanout<{ topic: string }, string, D>(['bull', 'bear', 'base'], {
    itemTask: (item, index) => ({ angle: item, index }),
    label: (item, index) => `angle:${index}:${item}`,
  })

describe('combinator · fanout', () => {
  it('returns the best-valid child via the single-sourced selector on success', async () => {
    const persona = makePersona<string>('analyst', 'equity analyst', (task) => {
      const i = indexOf(task)
      return {
        out: `thesis-${i}`,
        events: ev(20, 20),
        verdict: { valid: true, score: 0.3 + i * 0.3 },
      }
    })
    const out = expectOutcome(await runShape(persona, angleFanout<string>(), { topic: 'ACME' }))
    expect(out.kind).toBe('done')
    if (out.kind === 'done') expect(out.deliverable).toBe('thesis-2')
  })

  it('blocks with concrete blockers when every item goes down (nothing to select)', async () => {
    // Every item is an infra `down` — `drained.done` is empty, so there is no output to
    // select and the combinator fails loud with the down reasons verbatim (no coercion).
    const persona = makePersona<string>('analyst', 'equity analyst', (task) => ({
      out: null,
      events: [],
      failWith: `router 500 (angle ${indexOf(task)})`,
    }))
    const out = expectOutcome(await runShape(persona, angleFanout<string>(), { topic: 'ACME' }))
    expect(out.kind).toBe('blocked')
    if (out.kind === 'blocked') {
      expect(out.blockers.length).toBeGreaterThan(0)
      expect(out.blockers.join(' ')).toMatch(/router 500/)
    }
  })

  // GENERALITY: the SAME fanout combinator, two DIFFERENT personas → two domains, zero
  // combinator change. The shape carries SHAPE; the persona carries the DOMAIN.
  it('the SAME fanout shape yields two different domains under two different personas', async () => {
    const shape = angleFanout<string>()

    const research = makePersona<string>('research', 'equity analyst', () => ({
      out: 'buy: margins expanding',
      events: ev(20, 20),
      verdict: { valid: true, score: 0.9 },
    }))
    const coder = makePersona<string>('coder', 'engineer', () => ({
      out: 'patch: guard the null path',
      events: ev(20, 20),
      verdict: { valid: true, score: 0.9 },
    }))

    const researchOut = expectOutcome(await runShape(research, shape, { topic: 'ACME' }))
    const coderOut = expectOutcome(await runShape(coder, shape, { topic: 'crash' }))

    expect(researchOut.kind).toBe('done')
    expect(coderOut.kind).toBe('done')
    if (researchOut.kind === 'done' && coderOut.kind === 'done') {
      expect(researchOut.deliverable).toBe('buy: margins expanding')
      expect(coderOut.deliverable).toBe('patch: guard the null path')
      // Same combinator instance drove both — the domain divergence is entirely the persona's.
      expect(researchOut.deliverable).not.toBe(coderOut.deliverable)
    }
  })

  // GENERIC SEAMS the role-delegate migration depends on: a per-item `selectWinner` re-sort and
  // a per-item `itemSpec` (distinct executor per item). Both are content-free fanout extensions.
  it('selectWinner re-sorts the gathered candidates (here: pick the LOWEST score, inverting default)', async () => {
    const persona = makePersona<string>('analyst', 'equity analyst', (task) => {
      const i = indexOf(task)
      return {
        out: `thesis-${i}`,
        events: ev(20, 20),
        verdict: { valid: true, score: 0.3 + i * 0.3 },
      }
    })
    const shape = fanout<{ topic: string }, string, string>(['a', 'b', 'c'], {
      itemTask: (item, index) => ({ angle: item, index }),
      // Pick the SMALLEST score (the default selector would pick the largest, thesis-2).
      selectWinner: (iterations) =>
        [...iterations]
          .filter((it) => it.output !== undefined && it.verdict?.valid === true)
          .sort((a, b) => (a.verdict?.score ?? 0) - (b.verdict?.score ?? 0))[0],
    })
    const out = expectOutcome(await runShape(persona, shape, { topic: 'ACME' }))
    expect(out.kind).toBe('done')
    if (out.kind === 'done') expect(out.deliverable).toBe('thesis-0')
  })

  it('rejects passing BOTH synthesize and selectWinner (a synthesis child IS the selection)', () => {
    expect(() =>
      fanout<{ topic: string }, string, string>(['a'], {
        itemTask: () => ({}),
        selectWinner: () => undefined,
        synthesize: {
          synthesisTask: () => ({}),
          collect: () => ({ kind: 'done', deliverable: 'x' }),
        },
      }),
    ).toThrow(/at most one of `synthesize` or `selectWinner`/)
  })

  it('itemSpec gives each item a DISTINCT BYO executor (one authored profile per item)', async () => {
    // Per-item BYO executors: each settles its own artifact, proving the fanout spawned the
    // item-specific spec rather than the shared persona.root. The persona's mock registry only
    // mints when harness===null && no executor — a BYO executor routes to the real resolver.
    const built = ['x', 'y', 'z']
    const persona = makePersona<string>('coder', 'engineer', () => ({
      out: 'unused',
      events: ev(1, 1),
      verdict: { valid: true, score: 0 },
    }))
    const shape = fanout<{ goal: string }, string, string>(built, {
      itemTask: (item) => ({ item }),
      label: (item) => `leaf:${item}`,
      itemSpec: (item, i): AgentSpec => ({
        profile: { name: `authored-${item}` } as AgentProfile,
        harness: null,
        executor: byoExecutor(`out-${item}`, 0.2 + i * 0.3),
      }),
    })
    const out = expectOutcome(await runShape(persona, shape, { goal: 'build' }))
    expect(out.kind).toBe('done')
    // Highest score wins by default → the last item's executor (score 0.8).
    if (out.kind === 'done') expect(out.deliverable).toBe('out-z')
  })
})

/** A trivial bring-your-own one-shot executor settling a fixed artifact + verdict. */
function byoExecutor(out: string, score: number): Executor<unknown> {
  let artifact: ExecutorResult<unknown> | undefined
  return {
    runtime: 'router',
    async execute() {
      artifact = {
        outRef: `byo:${out}`,
        out,
        verdict: { valid: true, score },
        spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 0 },
      }
      return artifact
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: () => {
      if (!artifact) throw new ValidationError('byo: resultArtifact before execute')
      return artifact
    },
  }
}

function indexOf(task: unknown): number {
  if (task && typeof task === 'object' && typeof (task as { index?: unknown }).index === 'number') {
    return (task as { index: number }).index
  }
  return 0
}

// ── 3. loopUntil ──────────────────────────────────────────────────────────────────

describe('combinator · loopUntil', () => {
  it('stops at the satisfiability gate and delivers the terminal state', async () => {
    // Each step bumps a counter; `until` (reading findings, never a raw verdict) fires at 3.
    const persona = makePersona<number>('refiner', 'engineer', () => ({
      out: 'step',
      events: ev(5, 5),
      verdict: { valid: true, score: 0.6 },
    }))
    const shape = loopUntil<{ goal: string }, number, number>(0, {
      step: (_root, state) => ({ round: state.round }),
      fold: (prior) => ({ round: prior.round, value: prior.value + 1 }),
      until: (state) => (state.value >= 3 ? { kind: 'done', deliverable: state.value } : null),
    })
    const out = expectOutcome(await runShape(persona, shape, { goal: 'converge' }))
    expect(out.kind).toBe('done')
    if (out.kind === 'done') expect(out.deliverable).toBe(3)
  })

  it('blocks when the conserved pool is exhausted before the gate is reached', async () => {
    const persona = makePersona<number>('refiner', 'engineer', () => ({
      out: 'step',
      events: ev(100, 100),
      verdict: { valid: true, score: 0.6 },
    }))
    // perChild small + a never-satisfied gate: the pool admits a couple of steps then fails closed.
    const shape = loopUntil<{ goal: string }, number, number>(0, {
      step: (_root, state) => ({ round: state.round }),
      fold: (prior) => ({ round: prior.round, value: prior.value + 1 }),
      until: () => null,
    })
    const result = await runPersonified<{ goal: string }, number>({
      persona,
      shape,
      task: { goal: 'never' },
      budget: { maxIterations: 6, maxTokens: 600 },
      shapeBudget: { fanout: 1, perChild: { maxIterations: 1, maxTokens: 200 } },
      now: () => 0,
    })
    const out = expectOutcome(result)
    expect(out.kind).toBe('blocked')
    if (out.kind === 'blocked') {
      expect(out.blockers.length).toBeGreaterThan(0)
      expect(out.blockers.join(' ')).toMatch(/budget exhausted|not admitted/)
    }
  })
})

// ── 4. panel (M judges, write-only merge) ────────────────────────────────────────────

const quorumPanel = <D>(merge: (v: ReadonlyArray<PanelVerdict>) => Outcome<D>) =>
  panel<string, string, D>({
    judges: [{ label: 'correctness' }, { label: 'clarity' }, { label: 'safety' }],
    judgeTask: (artifact, judge) => ({ artifact, dimension: judge.label }),
    merge: (verdicts) => merge(verdicts),
  })

describe('combinator · panel', () => {
  it('merges M judge verdicts write-only into a done Outcome on quorum', async () => {
    const persona = makePersona<string>('reviewer', 'senior reviewer', (task) => ({
      out: `vote:${dimensionOf(task)}`,
      events: ev(5, 5),
      verdict: { valid: true, score: 0.8 },
    }))
    const shape = quorumPanel<string>((verdicts) => {
      const passed = verdicts.filter((v) => !v.down && v.verdict?.valid === true).length
      return passed >= 2
        ? { kind: 'done', deliverable: `panel passed ${passed}/${verdicts.length}` }
        : { kind: 'blocked', blockers: [`panel quorum not reached (${passed}/${verdicts.length})`] }
    })
    const out = expectOutcome(await runShape(persona, shape, 'the artifact under review'))
    expect(out.kind).toBe('done')
    if (out.kind === 'done') expect(out.deliverable).toBe('panel passed 3/3')
  })

  it('blocks with a concrete reason when the panel reaches no quorum', async () => {
    const persona = makePersona<string>('reviewer', 'senior reviewer', (task) =>
      dimensionOf(task) === 'safety'
        ? { out: 'vote:safety', events: ev(5, 5), verdict: { valid: true, score: 0.8 } }
        : { out: 'vote', events: ev(5, 5), verdict: { valid: false, score: 0.2 } },
    )
    const shape = quorumPanel<string>((verdicts) => {
      const passed = verdicts.filter((v) => !v.down && v.verdict?.valid === true).length
      return passed >= 2
        ? { kind: 'done', deliverable: 'passed' }
        : { kind: 'blocked', blockers: [`panel quorum not reached (${passed}/${verdicts.length})`] }
    })
    const out = expectOutcome(await runShape(persona, shape, 'the artifact under review'))
    expect(out.kind).toBe('blocked')
    if (out.kind === 'blocked') expect(out.blockers.join(' ')).toMatch(/quorum not reached/)
  })
})

function dimensionOf(task: unknown): string {
  if (task && typeof task === 'object' && 'dimension' in task) {
    return String((task as { dimension: unknown }).dimension)
  }
  return ''
}

// ── 5. verify (implement → separate verifier gate) ───────────────────────────────────

const verifyShape = <D>() =>
  verify<{ spec: string }, string, D>({
    implement: (root) => ({ role: 'implement', spec: root.spec }),
    verifier: (candidate) => ({
      role: 'verify',
      candidate: candidate.kind === 'done' ? candidate.out : null,
    }),
    collect: (candidate) =>
      candidate.kind === 'done'
        ? { kind: 'done', deliverable: candidate.out as unknown as D }
        : { kind: 'blocked', blockers: ['verify: candidate vanished post-gate'] },
  })

describe('combinator · verify', () => {
  it('ships the implement deliverable when the separate verifier gate is valid', async () => {
    const persona = makePersona<string>('builder', 'engineer', (task) =>
      roleOf(task) === 'verify'
        ? { out: 'gate', events: ev(5, 5), verdict: { valid: true, score: 0.95 } }
        : { out: 'the candidate', events: ev(10, 10) },
    )
    const out = expectOutcome(await runShape(persona, verifyShape<string>(), { spec: 'build X' }))
    expect(out.kind).toBe('done')
    if (out.kind === 'done') expect(out.deliverable).toBe('the candidate')
  })

  it('blocks when the verifier gate rejects the candidate (selector≠judge: it cannot self-pass)', async () => {
    const persona = makePersona<string>('builder', 'engineer', (task) =>
      roleOf(task) === 'verify'
        ? {
            out: 'gate',
            events: ev(5, 5),
            verdict: { valid: false, score: 0.2, notes: 'test failed' },
          }
        : { out: 'the candidate', events: ev(10, 10), verdict: { valid: true, score: 0.99 } },
    )
    const out = expectOutcome(await runShape(persona, verifyShape<string>(), { spec: 'build X' }))
    expect(out.kind).toBe('blocked')
    if (out.kind === 'blocked') expect(out.blockers.join(' ')).toMatch(/gate rejected|test failed/)
  })
})

function roleOf(task: unknown): string {
  if (task && typeof task === 'object' && 'role' in task)
    return String((task as { role: unknown }).role)
  return ''
}

// ── 6. widen (streaming, FLAT by default — the R2 firewall stays dormant) ─────────────

describe('combinator · widen', () => {
  it('runs flat (never widens) and synthesizes the best seed lineage on success', async () => {
    const persona = makePersona<string>('searcher', 'engineer', (task) => {
      const i = seedOf(task)
      return {
        out: `lineage-${i}`,
        events: ev(10, 10),
        verdict: { valid: true, score: 0.2 + i * 0.3 },
      }
    })
    const shape = widen<{ goal: string }, number, string>({
      seeds: [0, 1, 2],
      seedTask: (seed) => ({ seed }),
      gate: flatWidenGate<string>(),
      widenTask: () => ({ seed: 99 }),
      synthesize: (gathered) => {
        const best = [...gathered].sort(
          (a, b) => (b.verdict?.score ?? 0) - (a.verdict?.score ?? 0),
        )[0]
        return best
          ? { kind: 'done', deliverable: best.out as unknown as string }
          : { kind: 'blocked', blockers: ['widen: nothing gathered'] }
      },
    })
    const out = expectOutcome(await runShape(persona, shape, { goal: 'search' }))
    // Flat gate never widens; only the three seeds settle, best score = lineage-2.
    expect(out.kind).toBe('done')
    if (out.kind === 'done') expect(out.deliverable).toBe('lineage-2')
  })

  it('a flat default gate decides `stop` for every settlement (firewall dormant)', () => {
    const gate: ScopeWidenGate<string> = flatWidenGate<string>()
    expect(gate.judgeExempt).toBeUndefined()
    const done = {
      kind: 'done' as const,
      handle: { id: 'r:s0', label: 'seed:0', status: 'done' as const, abort() {} },
      out: 'x',
      outRef: 'mock:"x"',
      verdict: { valid: true, score: 0.99 },
      spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 0 },
      seq: 0,
    }
    const budget = { tokensLeft: 1000, usdLeft: 0, deadlineMs: 0, reservedTokens: 0 }
    expect(gate.decide(done, [], budget)).toEqual({ kind: 'stop' })
  })
})

function seedOf(task: unknown): number {
  if (task && typeof task === 'object' && typeof (task as { seed?: unknown }).seed === 'number') {
    return (task as { seed: number }).seed
  }
  return 0
}

// ── 7. The meta-orchestrator: a driver loop that spawns sub-driver LOOPS (depth-2) ────
//
// The keystone scope resolves every spawned child through a `Executor` — it does NOT
// re-enter `act` on a spawned driver. So a depth-2 sub-driver loop is built the keystone
// way: a BYO leaf whose `execute` runs its OWN nested `createSupervisor().run(subDriver)`,
// where the inner driver fans out over its own leaves. The outer `fanout` spawns two such
// sub-loops; the inner loop's rolled-up cost is reported up as `UsageEvent`s, so the outer
// conserved pool meters the whole depth-2 tree. This is the recursion the architecture
// actually ships — a loop nested inside a leaf of an outer loop, bounded by budget.

/** A BYO leaf whose `execute` runs a nested supervised sub-loop (a `fanout` over `width`
 *  leaves), then streams the inner loop's conserved spend back up so the OUTER pool is
 *  charged for the sub-loop's whole fanout. The deliverable is the inner winner. */
let subLoopOrdinal = 0
function subLoopLeaf(width: number): Executor<unknown> {
  const branch = subLoopOrdinal++
  let artifact: ExecutorResult<unknown> | undefined
  return {
    runtime: 'router',
    execute(): AsyncIterable<UsageEvent> {
      return (async function* () {
        const innerPersona = makePersona<string>(`sub-${branch}`, 'engineer', (task) => {
          const i = indexOf(task)
          return {
            out: `b${branch}-leaf${i}`,
            events: ev(10, 10),
            verdict: { valid: true, score: 0.3 + i * 0.2 },
          }
        })
        const innerShape = fanout<{ branch: number }, number, string>([0, 1, 2].slice(0, width), {
          itemTask: (item, index) => ({ index, item }),
        })
        const inner = await runPersonified<{ branch: number }, string>({
          persona: innerPersona,
          shape: innerShape,
          task: { branch },
          budget: { maxIterations: 50, maxTokens: 200_000 },
          shapeBudget: { fanout: width, perChild: { maxIterations: 4, maxTokens: 20_000 } },
          runId: `sub-${branch}`,
          journal: new InMemorySpawnJournal(),
          blobs: new InMemoryResultBlobStore(),
          now: () => 0,
        })
        const innerSpend =
          inner.kind === 'winner'
            ? inner.spentTotal
            : { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 }
        const out =
          inner.kind === 'winner' && inner.out.kind === 'done'
            ? inner.out.deliverable
            : `sub-${branch}:blocked`
        artifact = {
          outRef: `sub:${branch}`,
          out,
          verdict: { valid: inner.kind === 'winner', score: 0.9 },
          spent: innerSpend,
        }
        // Surface the inner loop's rolled-up cost to the OUTER pool, event by event.
        for (let i = 0; i < innerSpend.iterations; i += 1) yield { kind: 'iteration' }
        yield { kind: 'tokens', input: innerSpend.tokens.input, output: innerSpend.tokens.output }
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact(): ExecutorResult<unknown> {
      if (!artifact) throw new ValidationError('sub-loop: resultArtifact before stream drained')
      return artifact
    },
  }
}

describe('meta-orchestrator (depth-2 sub-driver loops)', () => {
  it('a meta fanout spawns sub-loops that each fan out, all metered by one outer pool', async () => {
    // The meta persona's children are BYO sub-loop leaves — each runs its own nested loop.
    const metaPersona = definePersona<string>({
      name: 'meta',
      root: { profile: { name: 'orchestrator' } as AgentProfile, harness: null },
      directive: 'orchestrate sub-loops',
      context: { role: 'orchestrator' },
      executors: {
        registry: {
          register: createExecutorRegistry().register,
          // Every meta child resolves to a sub-loop leaf running its own 3-leaf fanout.
          resolve<Out>(_spec: AgentSpec) {
            return {
              succeeded: true as const,
              value: (): Executor<Out> => subLoopLeaf(3) as Executor<Out>,
            }
          },
        },
      },
    })

    const metaShape = fanout<{ goal: string }, number, string>([0, 1], {
      itemTask: (item) => ({ branch: item }),
      label: (item) => `sub-loop:${item}`,
      synthesize: {
        synthesisTask: (gathered) => ({ synthesizeOf: gathered.length }),
        collect: (settled) =>
          settled.kind === 'done'
            ? { kind: 'done', deliverable: 'meta merged sub-loops' }
            : { kind: 'blocked', blockers: ['meta: synthesis went down'] },
      },
    })

    const journal = new InMemorySpawnJournal()
    const result = await runPersonified<{ goal: string }, string>({
      persona: metaPersona,
      shape: metaShape,
      task: { goal: 'orchestrate' },
      budget: { maxIterations: 500, maxTokens: 5_000_000 },
      shapeBudget: { fanout: 3, perChild: { maxIterations: 100, maxTokens: 500_000 } },
      runId: 'meta-run',
      journal,
      blobs: new InMemoryResultBlobStore(),
      now: () => 0,
    })

    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') {
      expect(result.out.kind).toBe('done')
      if (result.out.kind === 'done') expect(result.out.deliverable).toBe('meta merged sub-loops')
      // The outer pool is charged for BOTH sub-loops' inner fanouts (depth-2 cost rolls up):
      // 2 branches × 3 inner leaves × 1 iteration = 6, plus the synthesis child's iteration.
      expect(result.spentTotal.iterations).toBeGreaterThanOrEqual(6)
      expect(result.spentTotal.tokens.input).toBeGreaterThanOrEqual(60)
    }
    // The outer journal records the two sub-loop children + the synthesis child as leaves;
    // the depth-2 structure lives inside each sub-loop's own (separately journaled) run.
    const tree = await journal.loadTree('meta-run')
    const spawned = (tree ?? []).filter((e) => e.kind === 'spawned')
    expect(spawned.length).toBeGreaterThanOrEqual(3)
  })
})

// ── 8. runPersonified forwards the RuntimeHooks stream (gap 1) ────────────────────────
//
// The supervisor threads `SupervisorOpts.hooks` into the root Scope, which emits
// `agent.spawn`/`agent.child` per child lifecycle. `runPersonified` only had to forward
// `options.hooks` into `supervisorOpts.hooks` for those events to reach an observer — the
// load-bearing one-liner that lets the Intelligence SDK subscribe to a personified run.

describe('runPersonified · hooks forwarding', () => {
  it('forwards agent.spawn/agent.child events to the supplied RuntimeHooks', async () => {
    const persona = makePersona<string>('analyst', 'equity analyst', (task) => {
      const i = indexOf(task)
      return {
        out: `thesis-${i}`,
        events: ev(10, 10),
        verdict: { valid: true, score: 0.4 + i * 0.2 },
      }
    })

    const events: RuntimeHookEvent[] = []
    const hooks: RuntimeHooks = {
      onEvent: (event) => {
        events.push(event)
      },
    }

    const result = await runPersonified<{ topic: string }, string>({
      persona,
      shape: angleFanout<string>(),
      task: { topic: 'ACME' },
      budget: wideBudget,
      shapeBudget: wideShapeBudget,
      runId: 'analyst:hooks-run',
      journal: new InMemorySpawnJournal(),
      blobs: new InMemoryResultBlobStore(),
      now: () => 0,
      hooks,
    })

    expect(result.kind).toBe('winner')
    const targets = events.map((e) => e.target)
    // Three fanout angles spawn → three agent.spawn events; each settled child emits agent.child.
    expect(targets).toContain('agent.spawn')
    expect(targets).toContain('agent.child')
    expect(targets.filter((t) => t === 'agent.spawn').length).toBeGreaterThanOrEqual(3)
    // The spawn payload carries the child label the shape assigned — a real topology stream,
    // not a placeholder ping.
    const spawn = events.find((e) => e.target === 'agent.spawn')
    expect((spawn?.payload as { label?: string } | undefined)?.label).toMatch(/angle:/)
  })

  it('runs silently (no events) when no hooks are supplied — unchanged default', async () => {
    const persona = makePersona<string>('analyst', 'equity analyst', () => ({
      out: 'thesis',
      events: ev(10, 10),
      verdict: { valid: true, score: 0.9 },
    }))
    // No hooks field — the supervisorOpts omits hooks entirely (the conditional spread),
    // so the Scope's notify is a no-op. This is the today-default the change preserves.
    const result = await runShape(persona, angleFanout<string>(), { topic: 'ACME' })
    expect(result.kind).toBe('winner')
  })
})
