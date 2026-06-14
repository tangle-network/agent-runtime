import type { AnalystFinding } from '@tangle-network/agent-eval'
import type { AgentProfile } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import type { AnalystRegistryLike } from '../../src/analyst-loop/types'
import {
  contentAddress,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
} from '../../src/durable/spawn-journal'
import { AnalystError, PlannerError, ValidationError } from '../../src/errors'
import {
  buildSteerContext,
  createScopeAnalyst,
  registryScopeAnalyst,
} from '../../src/runtime/personify/analyst'
import { flatWidenGate, loopUntil, widen } from '../../src/runtime/personify/combinators'
import { InMemoryCorpus, renderCorpusToInstructions } from '../../src/runtime/personify/corpus'
import { createShapeContext } from '../../src/runtime/personify/persona'
import { equalKOnCost, trajectoryReport } from '../../src/runtime/personify/trajectory'
import type { Persona, ShapeBudget, ShapeContext } from '../../src/runtime/personify/types'
import type {
  CorpusRecord,
  Outcome,
  ScopeAnalyst,
  ScopeWidenGate,
  WidenDecision,
} from '../../src/runtime/personify/wave-types'
import { createBudgetPool, spendFromUsageEvents } from '../../src/runtime/supervise/budget'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createScope } from '../../src/runtime/supervise/scope'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
  Scope,
  Settled,
  SpawnJournal,
  Spend,
  UsageEvent,
} from '../../src/runtime/supervise/types'

// ── A trace-derived vs judge-derived finding (the firewall's only discriminator) ─────

function finding(over: Partial<AnalystFinding> = {}): AnalystFinding {
  return {
    schema_version: '1.0.0',
    finding_id: 'f1',
    analyst_id: 'test-analyst',
    produced_at: '2026-01-01T00:00:00Z',
    severity: 'high',
    area: 'verification',
    claim: 'the answer omits the required unit',
    evidence_refs: [],
    confidence: 0.8,
    ...over,
  }
}

const traceFinding = finding({
  finding_id: 'trace-1',
  evidence_refs: [{ kind: 'span', uri: 'otlp:span/abc' }],
})
const judgeFinding = finding({
  finding_id: 'judge-1',
  evidence_refs: [{ kind: 'metric', uri: 'verdict:score' }],
})

// ── Offline scope harness (mirrors supervise.test.ts) ─────────────────────────────────
//
// A BYO-executor leaf so the scope resolves it verbatim (no built-in router/sandbox fires).
// The analyst child's `out` is its `AnalystFinding[]`; a worker child's `out` is its result.

function leafAgent(name: string, out: unknown, events?: UsageEvent[]): Agent<unknown, unknown> {
  const evs = events ?? [{ kind: 'iteration' }, { kind: 'tokens', input: 5, output: 5 }]
  const executor: Executor<unknown> = {
    runtime: 'router',
    execute(): AsyncIterable<UsageEvent> {
      return (async function* () {
        for (const ev of evs) yield ev
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact(): ExecutorResult<unknown> {
      return { outRef: `mock:${name}`, out, spent: spendFromUsageEvents(evs) }
    },
  }
  const spec: AgentSpec = { profile: { name } as AgentProfile, harness: null, executor }
  return { name, act: async () => out, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

/** A leaf whose execute rejects — the scope types it into a `down` settlement (infra). */
function boomAgent(name: string, reason: string): Agent<unknown, unknown> {
  const executor: Executor<unknown> = {
    runtime: 'router',
    execute: () => Promise.reject(new ValidationError(reason)),
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: () => {
      throw new ValidationError('boom: resultArtifact unreachable')
    },
  }
  const spec: AgentSpec = { profile: { name } as AgentProfile, harness: null, executor }
  return { name, act: async () => undefined, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

async function beginScope(root = 'run') {
  const pool = createBudgetPool({ maxIterations: 100, maxTokens: 100_000 }, () => 0)
  const journal = new InMemorySpawnJournal()
  await journal.beginTree(root, new Date(0).toISOString())
  const scope = createScope<Outcome<unknown>>({
    parentId: root,
    root,
    pool,
    journal,
    blobs: new InMemoryResultBlobStore(),
    executors: createExecutorRegistry(),
    seams: {},
    depth: 0,
    signal: new AbortController().signal,
    now: () => 0,
  })
  return { scope, journal }
}

// ════════════════════════════════════════════════════════════════════════════════════
// 3. Cross-run corpus — append→query round-trip, render-back, second run reads the first
// ════════════════════════════════════════════════════════════════════════════════════

const record = (over: Partial<CorpusRecord> = {}): CorpusRecord => ({
  schemaVersion: '1.0.0',
  id: 'r1',
  runId: 'run-1',
  producedAt: '2026-01-01T00:00:00Z',
  area: 'sourcing',
  claim: 'always cite the 10-K filing date',
  tags: ['equity', 'research'],
  confidence: 0.9,
  ...over,
})

describe('cross-run corpus (G2)', () => {
  it('append → query round-trips and is idempotent on an identical re-append', async () => {
    const corpus = new InMemoryCorpus()
    expect(await corpus.append(record())).toEqual({ succeeded: true })
    // Identical re-append is idempotent (same learned fact), not a conflict.
    expect(await corpus.append(record())).toEqual({ succeeded: true })
    const hits = await corpus.query({ tags: ['equity'] })
    expect(hits).toHaveLength(1)
    expect(hits[0]?.claim).toBe('always cite the 10-K filing date')
  })

  it('fails loud (typed outcome) on a conflicting re-append under the same id', async () => {
    const corpus = new InMemoryCorpus()
    await corpus.append(record())
    const conflict = await corpus.append(record({ claim: 'a different fact' }))
    expect(conflict.succeeded).toBe(false)
    if (!conflict.succeeded) expect(conflict.error).toMatch(/conflict/)
  })

  it('renderCorpusToInstructions projects facts into a FRESH profile (input unchanged)', async () => {
    const corpus = new InMemoryCorpus()
    await corpus.append(record({ id: 'a', confidence: 0.95, claim: 'fact A', rationale: 'why A' }))
    await corpus.append(record({ id: 'b', confidence: 0.5, claim: 'fact B', tags: ['equity'] }))
    const profile: AgentProfile = {
      name: 'analyst',
      prompt: { instructions: ['base rule'] },
    } as AgentProfile
    const projected = await renderCorpusToInstructions({
      corpus,
      filter: { tags: ['equity'] },
      profile,
    })
    const lines = projected.prompt?.instructions ?? []
    // Most-confident first; the rationale renders inline. Base instruction is preserved.
    expect(lines).toEqual(['base rule', 'fact A (why A)', 'fact B'])
    // The input profile is untouched (fresh projection, never a mutation).
    expect(profile.prompt?.instructions).toEqual(['base rule'])
  })

  it("a second run reads the first run's accreted corpus (the flywheel READ side)", async () => {
    // Run 1 learns a fact and appends it; run 2 reads it back into its persona's prompt.
    const corpus = new InMemoryCorpus()
    const run1 = await corpus.append(
      record({ id: 'learned', runId: 'run-1', claim: 'prefer primary sources', confidence: 0.88 }),
    )
    expect(run1).toEqual({ succeeded: true })

    const run2Profile: AgentProfile = { name: 'analyst' } as AgentProfile
    const run2 = await renderCorpusToInstructions({
      corpus,
      filter: { area: 'sourcing', minConfidence: 0.5 },
      profile: run2Profile,
    })
    expect(run2.prompt?.instructions).toEqual(['prefer primary sources'])
  })
})

// ════════════════════════════════════════════════════════════════════════════════════
// 4. Analyst-on-Scope — a driver steers on findings; reading the raw verdict FAILS the firewall
// ════════════════════════════════════════════════════════════════════════════════════

describe('analyst-on-scope (G1) firewall', () => {
  it('a driver steers on trace-derived findings from a ScopeAnalyst', async () => {
    const { scope } = await beginScope()
    const analyst = createScopeAnalyst<unknown>(scope as Scope<Outcome<unknown>>, {
      analyst: leafAgent('analyst', [traceFinding]) as Agent<
        unknown,
        ReadonlyArray<AnalystFinding>
      >,
      buildTask: (input) => ({ settled: input.settledSoFar.length }),
      budget: { maxIterations: 1, maxTokens: 1000 },
    })
    const findings = await analyst.analyze({ task: 'goal', settledSoFar: [], nodeId: 'run' })
    expect(findings).toHaveLength(1)
    // The steer decision reads FINDINGS, never a raw verdict — the deployable, non-oracle steer.
    const steer = findings.some((f) => f.area === 'verification') ? 'refine' : 'keep'
    expect(steer).toBe('refine')
  })

  it('a ScopeAnalyst that emits a judge-derived finding ABORTS (selector ≠ judge)', async () => {
    const { scope } = await beginScope()
    const analyst = createScopeAnalyst<unknown>(scope as Scope<Outcome<unknown>>, {
      analyst: leafAgent('analyst', [judgeFinding]) as Agent<
        unknown,
        ReadonlyArray<AnalystFinding>
      >,
      buildTask: () => ({}),
      budget: { maxIterations: 1, maxTokens: 1000 },
    })
    // A finding whose evidence is a `metric` verdict/judge/score uri smuggles the write-only
    // judge into steering — the firewall throws rather than filters.
    await expect(
      analyst.analyze({ task: 'g', settledSoFar: [], nodeId: 'run' }),
    ).rejects.toBeInstanceOf(PlannerError)
  })

  it('a down analyst fails loud (no silent empty findings to steer on)', async () => {
    const { scope } = await beginScope()
    // The analyst child's executor throws → the scope types a `down`; the analyst seam
    // rejects it rather than steering on an empty diagnosis.
    const analyst = createScopeAnalyst<unknown>(scope as Scope<Outcome<unknown>>, {
      analyst: boomAgent('analyst', 'capture path broken') as Agent<
        unknown,
        ReadonlyArray<AnalystFinding>
      >,
      buildTask: () => ({}),
      budget: { maxIterations: 1, maxTokens: 1000 },
    })
    await expect(
      analyst.analyze({ task: 'g', settledSoFar: [], nodeId: 'run' }),
    ).rejects.toBeInstanceOf(AnalystError)
  })

  it('buildSteerContext surfaces lastValidScore for OBSERVABILITY but asserts trace-derived findings', () => {
    const done: Settled<Outcome<unknown>> = {
      kind: 'done',
      handle: { id: 'run:s0', label: 'w', status: 'done', abort() {} },
      out: { kind: 'done', deliverable: 'x' },
      outRef: 'mock:w',
      verdict: { valid: true, score: 0.77 },
      spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 0 },
      seq: 0,
    }
    const ctx = buildSteerContext([traceFinding], [done])
    expect(ctx.findings).toHaveLength(1)
    // Best valid score is exposed for rendering ONLY — steering off it is selector = judge.
    expect(ctx.lastValidScore).toBe(0.77)
    // A judge-derived finding handed in by any path is rejected on construction.
    expect(() => buildSteerContext([judgeFinding], [done])).toThrow(PlannerError)
  })
})

// ════════════════════════════════════════════════════════════════════════════════════
// 4b. Analyst→steer WIRE — the combinator gates steer on a ScopeAnalyst's findings, not []
// ════════════════════════════════════════════════════════════════════════════════════

/** A ShapeContext whose `spawnChild` yields a worker leaf carrying a fixed `done` Outcome (so the
 *  offline scope settles it via the BYO executor). Optionally threads a `ScopeAnalyst` so a
 *  combinator's gate sees its findings — the seam this wave connects. */
function workerCtx(analyst?: ScopeAnalyst<unknown>): ShapeContext<unknown> {
  const root: AgentSpec = { profile: { name: 'worker' } as AgentProfile, harness: null }
  const persona = { name: 'p', root } as Persona<unknown>
  const budget: ShapeBudget = { perChild: { maxIterations: 1, maxTokens: 1000 }, fanout: 1 }
  return {
    persona,
    budget,
    ...(analyst ? { analyst } : {}),
    spawnChild(name): Agent<unknown, Outcome<unknown>> {
      const outcome: Outcome<unknown> = { kind: 'done', deliverable: name }
      return leafAgent(name, outcome) as Agent<unknown, Outcome<unknown>>
    },
    childSpec(profile): AgentSpec {
      return { profile, harness: null }
    },
  }
}

/** A spy `ScopeAnalyst` — records every `analyze` call and returns a fixed finding list. */
function spyAnalyst(findings: ReadonlyArray<AnalystFinding>): {
  analyst: ScopeAnalyst<unknown>
  calls: Array<{ settledCount: number; nodeId: string }>
} {
  const calls: Array<{ settledCount: number; nodeId: string }> = []
  return {
    calls,
    analyst: {
      analyze: async (input) => {
        calls.push({ settledCount: input.settledSoFar.length, nodeId: input.nodeId })
        return findings
      },
    },
  }
}

describe('analyst→steer wire (combinator gates read findings, not [])', () => {
  it('createShapeContext threads an analyst onto the ShapeContext (absent when omitted)', () => {
    const root: AgentSpec = { profile: { name: 'w' } as AgentProfile, harness: null }
    const persona = { name: 'p', root } as Persona<unknown>
    const budget: ShapeBudget = { perChild: { maxIterations: 1, maxTokens: 10 }, fanout: 1 }
    const { analyst } = spyAnalyst([traceFinding])
    expect(createShapeContext(persona, budget).analyst).toBeUndefined()
    expect(createShapeContext(persona, budget, analyst).analyst).toBe(analyst)
  })

  it('loopUntil with ctx.analyst CALLS analyze and passes its findings to `until`', async () => {
    const { scope } = await beginScope()
    const { analyst, calls } = spyAnalyst([traceFinding])
    const seen: Array<ReadonlyArray<AnalystFinding>> = []
    const shape = loopUntil<string, number, unknown>(0, {
      step: () => ({}),
      fold: (prior) => ({ round: prior.round, value: prior.value + 1 }),
      until: (_state, findings) => {
        seen.push(findings)
        // Stop as soon as the analyst's trace finding arrives — proving the wire reached the gate.
        return findings.some((f) => f.finding_id === 'trace-1')
          ? { kind: 'done', deliverable: 'stopped-on-finding' }
          : null
      },
    })
    const out = await shape(workerCtx(analyst)).act('goal', scope as Scope<Outcome<unknown>>)
    expect(out).toEqual({ kind: 'done', deliverable: 'stopped-on-finding' })
    // The analyst was consulted, and the first round's `until` saw the analyst's finding (not []).
    expect(calls).toHaveLength(1)
    expect(seen[0]).toEqual([traceFinding])
    expect(calls[0]?.nodeId).toBe('run')
  })

  it('loopUntil WITHOUT an analyst consults `until` with the dormant empty default', async () => {
    const { scope } = await beginScope()
    const seen: Array<ReadonlyArray<AnalystFinding>> = []
    let rounds = 0
    const shape = loopUntil<string, number, unknown>(0, {
      step: () => ({}),
      fold: (prior) => ({ round: prior.round, value: prior.value + 1 }),
      until: (_state, findings) => {
        seen.push(findings)
        rounds += 1
        // No analyst ⇒ findings is always []; stop after one round on the state, not a finding.
        return rounds >= 1 ? { kind: 'done', deliverable: 'state-stop' } : null
      },
    })
    const out = await shape(workerCtx()).act('goal', scope as Scope<Outcome<unknown>>)
    expect(out).toEqual({ kind: 'done', deliverable: 'state-stop' })
    expect(seen[0]).toEqual([])
  })

  it('loopUntil drives the REAL createScopeAnalyst into the SAME scope (equal-k preserved)', async () => {
    // The analyst child is spawned into the combinator's own scope, so its tokens are charged to
    // the one conserved pool — equal-k holds by construction. Drive the real seam end to end.
    const { scope, journal } = await beginScope()
    const realAnalyst = createScopeAnalyst<unknown>(scope as Scope<Outcome<unknown>>, {
      analyst: leafAgent('analyst', [traceFinding]) as Agent<
        unknown,
        ReadonlyArray<AnalystFinding>
      >,
      buildTask: () => ({}),
      budget: { maxIterations: 1, maxTokens: 100 },
    })
    const shape = loopUntil<string, number, unknown>(0, {
      step: () => ({}),
      fold: (prior) => ({ round: prior.round, value: prior.value + 1 }),
      until: (_state, findings) =>
        findings.length > 0 ? { kind: 'done', deliverable: 'done' } : null,
    })
    const out = await shape(workerCtx(realAnalyst)).act('goal', scope as Scope<Outcome<unknown>>)
    expect(out).toEqual({ kind: 'done', deliverable: 'done' })
    // The journal recorded BOTH the worker child and the analyst child under the one run tree —
    // the analyst spawned as a sibling in the same scope (its compute is conserved-pooled).
    const tree = await journal.loadTree('run')
    const spawnedLabels = (tree ?? [])
      .filter((e): e is Extract<typeof e, { kind: 'spawned' }> => e.kind === 'spawned')
      .map((e) => e.label)
    expect(spawnedLabels).toContain('analyst')
    expect(spawnedLabels.some((l) => l.startsWith('step:'))).toBe(true)
  })

  it('widen with ctx.analyst feeds findings to the gate; the flat default ignores []', async () => {
    const { scope } = await beginScope()
    const { analyst, calls } = spyAnalyst([traceFinding])
    const gateFindings: Array<ReadonlyArray<AnalystFinding>> = []
    const recordingGate: ScopeWidenGate<unknown> = {
      decide(_settled, findings): WidenDecision<unknown> {
        gateFindings.push(findings)
        return { kind: 'stop' }
      },
    }
    const shape = widen<string, number, unknown>({
      seeds: [0],
      seedTask: () => ({}),
      gate: recordingGate,
      widenTask: () => ({}),
      synthesize: (gathered) =>
        gathered.length > 0
          ? { kind: 'done', deliverable: 'widened' }
          : { kind: 'blocked', blockers: ['none'] },
    })
    await shape(workerCtx(analyst)).act('goal', scope as Scope<Outcome<unknown>>)
    // The gate saw the analyst's finding for the one settled seed — not the hardcoded [].
    expect(calls.length).toBeGreaterThanOrEqual(1)
    expect(gateFindings[0]).toEqual([traceFinding])

    // And the shipped default (flatWidenGate) is consulted with [] when no analyst is wired.
    const { scope: scope2 } = await beginScope('run2')
    const flatSeen: Array<ReadonlyArray<AnalystFinding>> = []
    const flat = flatWidenGate<unknown>()
    const flatProbe: ScopeWidenGate<unknown> = {
      decide(settled, findings, budget) {
        flatSeen.push(findings)
        return flat.decide(settled, findings, budget)
      },
    }
    const shape2 = widen<string, number, unknown>({
      seeds: [0],
      seedTask: () => ({}),
      gate: flatProbe,
      widenTask: () => ({}),
      synthesize: () => ({ kind: 'done', deliverable: 'flat' }),
    })
    await shape2(workerCtx()).act('goal', scope2 as Scope<Outcome<unknown>>)
    expect(flatSeen[0]).toEqual([])
  })
})

// ════════════════════════════════════════════════════════════════════════════════════
// 4c. registryScopeAnalyst — N analyst kinds merged into one ScopeAnalyst, behind the firewall
// ════════════════════════════════════════════════════════════════════════════════════

/** A mock AnalystRegistry whose `run` returns a fixed merged findings list (the panel-of-analysts
 *  merge the real registry performs across N kinds). Records the projected inputs it received. */
function mockRegistry(findings: ReadonlyArray<AnalystFinding>): {
  registry: AnalystRegistryLike
  runs: Array<{ runId: string }>
} {
  const runs: Array<{ runId: string }> = []
  return {
    runs,
    registry: {
      list: () => [{ id: 'k1' }, { id: 'k2' }],
      run: async (runId) => {
        runs.push({ runId })
        return {
          run_id: runId,
          correlation_id: 'corr',
          started_at: '2026-01-01T00:00:00Z',
          ended_at: '2026-01-01T00:00:01Z',
          findings: [...findings],
          per_analyst: [],
          total_cost_usd: 0,
        }
      },
    },
  }
}

describe('registryScopeAnalyst (panel-of-analysts adapter)', () => {
  it('runs the registry, projects inputs via buildInputs, and returns the merged findings', async () => {
    const { registry, runs } = mockRegistry([traceFinding])
    const analyst = registryScopeAnalyst<unknown>(registry, (input) => ({
      runId: `proj-${input.nodeId}`,
      inputs: {},
    }))
    const findings = await analyst.analyze({ task: 'g', settledSoFar: [], nodeId: 'run' })
    expect(findings).toEqual([traceFinding])
    // The caller-supplied projection drove `run` — the adapter never invents the runId/inputs.
    expect(runs).toEqual([{ runId: 'proj-run' }])
  })

  it('pipes the merged findings through the SAME firewall (judge-derived ABORTS)', async () => {
    const { registry } = mockRegistry([judgeFinding])
    const analyst = registryScopeAnalyst<unknown>(registry, () => ({ runId: 'r', inputs: {} }))
    // A merged finding citing judge/verdict/score `metric` evidence aborts via
    // assertTraceDerivedFindings — single-sourced with createScopeAnalyst (selector ≠ judge).
    await expect(
      analyst.analyze({ task: 'g', settledSoFar: [], nodeId: 'run' }),
    ).rejects.toBeInstanceOf(PlannerError)
  })
})

// ════════════════════════════════════════════════════════════════════════════════════
// 5. Trajectory trace + cost ledger — roll-up over a multi-node tree, equalKOnCost confound
// ════════════════════════════════════════════════════════════════════════════════════

/** Hand-build a journaled spawn tree so the reconstructor can be tested without a live run.
 *  `spawn` records the structure (ordinal seq); `settle` records a node's own conserved spend
 *  (cursor seq). A leaf's spend may already INCLUDE its internal fanout — that is the confound. */
async function journalTree(
  root: string,
  edges: ReadonlyArray<{ id: string; parent: string; label?: string }>,
  settles: ReadonlyArray<{ id: string; spend: Spend }>,
): Promise<{ journal: SpawnJournal; blobs: InMemoryResultBlobStore }> {
  const journal = new InMemorySpawnJournal()
  const blobs = new InMemoryResultBlobStore()
  await journal.beginTree(root, new Date(0).toISOString())
  let ordinal = 0
  let cursor = 0
  // Root is its own spawned node (parent === root for the supervisor's root scope record).
  await journal.appendEvent(root, {
    kind: 'spawned',
    id: root,
    label: 'root',
    budget: { maxIterations: 1, maxTokens: 1 },
    runtime: 'router',
    seq: ordinal++,
    at: new Date(0).toISOString(),
  })
  for (const e of edges) {
    await journal.appendEvent(root, {
      kind: 'spawned',
      id: e.id,
      parent: e.parent,
      label: e.label ?? e.id,
      budget: { maxIterations: 1, maxTokens: 1 },
      runtime: 'router',
      seq: ordinal++,
      at: new Date(0).toISOString(),
    })
  }
  for (const s of settles) {
    const artifact = { node: s.id }
    const outRef = contentAddress(artifact)
    await blobs.put(outRef, artifact)
    await journal.appendEvent(root, {
      kind: 'settled',
      id: s.id,
      status: 'done',
      outRef,
      spent: s.spend,
      seq: cursor++,
      at: new Date(0).toISOString(),
    })
  }
  return { journal, blobs }
}

const spend = (iterations: number, tokens: number, usd = 0): Spend => ({
  iterations,
  tokens: { input: tokens / 2, output: tokens / 2 },
  usd,
  ms: 0,
})

describe('trajectory trace + cost ledger', () => {
  it('rolls up cost over a multi-node tree, charging a parent for its subtree fanout', async () => {
    // root → {a, b}; a → {a0, a1}. Roll-up: a = a + a0 + a1; root = root + a-subtree + b.
    const { journal, blobs } = await journalTree(
      'run',
      [
        { id: 'run:s0', parent: 'run', label: 'a' },
        { id: 'run:s1', parent: 'run', label: 'b' },
        { id: 'run:s0:s0', parent: 'run:s0', label: 'a0' },
        { id: 'run:s0:s1', parent: 'run:s0', label: 'a1' },
      ],
      [
        { id: 'run', spend: spend(1, 10) },
        { id: 'run:s0', spend: spend(1, 20) },
        { id: 'run:s1', spend: spend(1, 30) },
        { id: 'run:s0:s0', spend: spend(1, 40) },
        { id: 'run:s0:s1', spend: spend(1, 50) },
      ],
    )
    const report = await trajectoryReport(journal, blobs, 'run', { withOutputs: true })

    const a = report.nodes.find((n) => n.label === 'a')
    expect(a).toBeDefined()
    // a's own = 20; rolled-up = 20 + 40 + 50 = 110 tokens, 3 iterations.
    expect(tokensOf(a?.ownSpend)).toBe(20)
    expect(tokensOf(a?.rolledUpSpend)).toBe(110)
    expect(a?.rolledUpSpend.iterations).toBe(3)
    // Root total = 10 + 110 (a-subtree) + 30 (b) = 150 tokens, 5 iterations.
    expect(tokensOf(report.total)).toBe(150)
    expect(report.total.iterations).toBe(5)
    expect(report.statusCounts.done).toBe(5)
    // withOutputs rehydrated each done node's artifact.
    expect(a?.output).toEqual({ node: 'run:s0' })
  })

  it('equalKOnCost flags an arm whose leaf fanout inflated cost (closing the confound)', async () => {
    // Both arms log ONE leaf each, so a per-iteration count would call them equal-k. But the
    // treatment leaf fanned out internally and reports that cost in tokens — equalKOnCost reads
    // conserved COST, not iteration count, and flags them as NOT comparable at equal compute.
    const blind = await journalTree(
      'blind',
      [{ id: 'blind:s0', parent: 'blind', label: 'leaf' }],
      [
        { id: 'blind', spend: spend(0, 0) },
        { id: 'blind:s0', spend: spend(1, 100) },
      ],
    )
    const treatment = await journalTree(
      'treat',
      [{ id: 'treat:s0', parent: 'treat', label: 'leaf' }],
      [
        { id: 'treat', spend: spend(0, 0) },
        // Same iteration count (1), but the leaf's internal fanout cost is folded into tokens.
        { id: 'treat:s0', spend: spend(1, 600) },
      ],
    )
    const blindReport = await trajectoryReport(blind.journal, blind.blobs, 'blind')
    const treatReport = await trajectoryReport(treatment.journal, treatment.blobs, 'treat')

    // Iteration counts are identical (the naive equal-k a per-cursor count would believe).
    expect(blindReport.total.iterations).toBe(treatReport.total.iterations)

    const verdict = equalKOnCost([
      { label: 'blind', report: blindReport },
      { label: 'treatment', report: treatReport },
    ])
    // Token spread (600 vs 100) blows past the default tolerance — NOT comparable at equal-k.
    expect(verdict.withinTolerance).toBe(false)
    expect(verdict.spread.tokens).toBe(500)
    const treatArm = verdict.arms.find((a) => a.label === 'treatment')
    expect(treatArm?.tokens).toBe(600)
  })

  it('equalKOnCost passes arms whose conserved cost is within tolerance', async () => {
    const a = await journalTree(
      'a',
      [{ id: 'a:s0', parent: 'a', label: 'leaf' }],
      [
        { id: 'a', spend: spend(0, 0) },
        { id: 'a:s0', spend: spend(1, 100) },
      ],
    )
    const b = await journalTree(
      'b',
      [{ id: 'b:s0', parent: 'b', label: 'leaf' }],
      [
        { id: 'b', spend: spend(0, 0) },
        { id: 'b:s0', spend: spend(1, 102) },
      ],
    )
    const verdict = equalKOnCost(
      [
        { label: 'a', report: await trajectoryReport(a.journal, a.blobs, 'a') },
        { label: 'b', report: await trajectoryReport(b.journal, b.blobs, 'b') },
      ],
      { tolerance: 0.05 },
    )
    expect(verdict.withinTolerance).toBe(true)
  })
})

function tokensOf(value: Spend | undefined): number {
  if (!value) return Number.NaN
  return value.tokens.input + value.tokens.output
}
