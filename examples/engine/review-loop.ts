/**
 * review-loop — a PR review as an ENGINE graph: build, three parallel auditors, a joined
 * verdict, and a capped rebuild loop.
 *
 * This is the first example authored against the graph ENGINE rather than `runGraph`. The
 * difference is who decides: under `runGraph` a supervisor model chooses what to spawn, so a
 * skipped review is a prompt failure. Here the topology decides. The three auditors ALWAYS run,
 * the verdict ALWAYS waits for all three, and the rebuild edge fires exactly when the verdict
 * says `passed: false` — none of that is a model's to get wrong.
 *
 * WHAT IT EXERCISES, end to end:
 *   - fan-out on `data` edges: one build output reaches three auditors, each on its own port
 *   - `join: 'all'`: the verdict node releases only when all three auditors have settled
 *   - guards, both ways: the same verdict output feeds a rebuild edge (`passed == false`) and a
 *     ship edge (`passed == true`); exactly one fires per round
 *   - a CYCLE with a bound: the rebuild edge carries `maxTraversals: 3`, so the loop cannot spin
 *   - one pure projection: the ship edge carries `{ path: 'build' }`, reshaping on the edge
 *     instead of spending a node on it
 *   - terminals + the finalizer: `ship` is the only terminal and carries the completion check
 *
 * The build is deliberately imperfect: round 1 ships a hardcoded secret (security rejects),
 * round 2 fixes it but leaves a bare `any` (style rejects), round 3 is clean and ships. So the
 * loop runs three times and the run ends `winner` — the rebuild path and the success path are
 * both proven by one run.
 *
 * Every node is a `script` kind: pure, offline, no credentials, no model call, $0. Swapping any
 * one of them for an `agent` node is a config change, not a rewrite — which is the point of the
 * node-kind registry.
 *
 * Run:  pnpm tsx examples/engine/review-loop.ts
 */

import { InMemoryResultBlobStore } from '../../src/durable/spawn-journal'
import {
  agentKind,
  createGraphEngine,
  type EngineGraphSpec,
  type GraphRunResult,
  runEngineGraph,
  scriptKind,
  subgraphKind,
  supervisorKind,
} from '../../src/runtime/graph'

/** One auditor's answer. `ok: false` carries the reason the next build round must address. */
interface Audit {
  readonly ok: boolean
  readonly reason?: string
}

/** What `build` emits each round, and what the auditors read. */
interface Build {
  readonly round: number
  readonly code: string
}

/** A rule an auditor applies to the built code. Pure, so the whole example stays deterministic. */
const auditors = [
  {
    id: 'audit-security',
    port: 'security',
    check: (code: string): Audit =>
      code.includes('SECRET=')
        ? { ok: false, reason: 'hardcoded credential in source' }
        : { ok: true },
  },
  {
    id: 'audit-style',
    port: 'style',
    check: (code: string): Audit =>
      code.includes(': any')
        ? { ok: false, reason: 'bare `any` defeats the type check' }
        : { ok: true },
  },
  {
    id: 'audit-correctness',
    port: 'correctness',
    check: (code: string): Audit =>
      code.includes('return')
        ? { ok: true }
        : { ok: false, reason: 'the function returns nothing' },
  },
] as const

/** The three drafts the build produces, in order. Each round fixes what the last round failed. */
const DRAFTS = [
  'const SECRET="hunter2"; export function rate(x: number) { return x * 2 }',
  'export function rate(x: any) { return x * 2 }',
  'export function rate(x: number): number { return x * 2 }',
] as const

/** The engine every node runs on: the four core kinds, nothing host-specific. */
export function reviewEngine() {
  return createGraphEngine({
    coreKinds: [
      agentKind({}),
      supervisorKind({
        blobs: new InMemoryResultBlobStore(),
        makeWorkerAgent: () => ({ name: 'unused-offline', act: async () => null }),
      }),
      scriptKind(),
      subgraphKind(),
    ],
  })
}

export function reviewLoop(options: { readonly neverFix?: boolean } = {}): EngineGraphSpec {
  // The build reads the previous round's feedback, so round N+1 is a function of round N's
  // verdict — the loop carries state as DATA on an edge, never as hidden mutable scope.
  let attempt = 0
  const build = {
    id: 'build',
    kind: 'script/v1',
    config: {
      body: (): Build => {
        // `neverFix` models the build that cannot satisfy its reviewers: it re-emits the first
        // draft forever, so the run has to be ENDED by the edge cap rather than by success.
        const code = options.neverFix
          ? (DRAFTS[0] as string)
          : (DRAFTS[Math.min(attempt, DRAFTS.length - 1)] as string)
        attempt += 1
        return { round: attempt, code }
      },
    },
    ports: { inputs: [{ name: 'feedback', schema: { type: 'object' } }] },
  }

  const auditNodes = auditors.map((auditor) => ({
    id: auditor.id,
    kind: 'script/v1',
    config: {
      body: (inputs: Record<string, unknown>): Audit => auditor.check((inputs.diff as Build).code),
      pure: true,
    },
    ports: { inputs: [{ name: 'diff', schema: { type: 'object' } }] },
  }))

  const verdict = {
    id: 'verdict',
    kind: 'script/v1',
    // `all` is the whole point: no verdict is reached until every auditor has spoken.
    join: 'all' as const,
    config: {
      body: (inputs: Record<string, unknown>) => {
        const failures = auditors
          .map((auditor) => [auditor.id, inputs[auditor.port] as Audit] as const)
          .filter(([, audit]) => !audit?.ok)
          .map(([id, audit]) => `${id}: ${audit?.reason ?? 'rejected'}`)
        return {
          passed: failures.length === 0,
          failures,
          build: inputs.build as Build,
        }
      },
      pure: true,
    },
    ports: {
      inputs: [
        ...auditors.map((auditor) => ({ name: auditor.port, schema: { type: 'object' } })),
        { name: 'build', schema: { type: 'object' } },
      ],
    },
  }

  const ship = {
    id: 'ship',
    kind: 'script/v1',
    config: {
      body: (inputs: Record<string, unknown>) => ({ shipped: (inputs.approved as Build).code }),
      pure: true,
    },
    ports: { inputs: [{ name: 'approved', schema: { type: 'object' } }] },
    deliverable: {
      check: (out: unknown) => typeof (out as { shipped?: string }).shipped === 'string',
      describe: 'a build that all three auditors approved',
    },
  }

  return {
    root: 'build',
    nodes: [build, ...auditNodes, verdict, ship],
    edges: [
      // Fan-out: one build reaches all three auditors AND the verdict, which keeps the build
      // itself addressable at decision time without an auditor having to pass it along.
      ...auditors.map((auditor) => ({
        kind: 'data' as const,
        from: { node: 'build' },
        to: { node: auditor.id, port: 'diff' },
      })),
      { kind: 'data' as const, from: { node: 'build' }, to: { node: 'verdict', port: 'build' } },
      // Fan-in: each auditor lands on its own port, so the verdict cannot confuse them.
      ...auditors.map((auditor) => ({
        kind: 'data' as const,
        from: { node: auditor.id },
        to: { node: 'verdict', port: auditor.port },
      })),
      // The loop, bounded. Three traversals is the cap; a fourth would be refused, ledgered
      // `unpropagated`, and would end the run loud rather than spinning.
      {
        kind: 'data' as const,
        from: { node: 'verdict' },
        to: { node: 'build', port: 'feedback' },
        guard: { path: 'out.passed', op: 'eq', value: false },
        maxTraversals: 3,
      },
      // The exit. One pure projection lifts the approved build out of the verdict envelope, so
      // no node exists just to reshape it.
      {
        kind: 'data' as const,
        from: { node: 'verdict' },
        to: { node: 'ship', port: 'approved' },
        guard: { path: 'out.passed', op: 'eq', value: true },
        projection: { path: 'build' },
      },
    ],
  }
}

export async function main(): Promise<void> {
  const result = await runEngineGraph(reviewEngine(), reviewLoop(), 'review the change', {
    budget: { maxIterations: 60, maxTokens: 200_000 },
    perNode: { maxIterations: 4, maxTokens: 10_000 },
  })
  printRun(result)
}

/** The run as a reader can check it: what each round decided, and what the graph did about it. */
export function printRun(result: GraphRunResult): void {
  console.log(`\nreview-loop → ${result.kind}`)
  if (result.kind === 'winner') console.log(`shipped: ${JSON.stringify(result.out)}`)
  const rounds = result.settles.filter((settle) => settle.node === 'verdict')
  for (const round of rounds) {
    const out = round.out as { passed: boolean; failures: string[] }
    console.log(
      `  round ${round.visit}: ${out.passed ? 'PASSED' : `rejected — ${out.failures.join('; ')}`}`,
    )
  }
  console.log(
    `  ${result.settles.length} node settlements, ${result.ledger.length} edge traversals`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
