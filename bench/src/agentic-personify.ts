/**
 * Consolidation: drive the AgenticSurface through the EXISTING personify primitives —
 * `runPersonified` + the `fanout`/`loopUntil`/`widen` combinators + `createScopeAnalyst` — instead
 * of the hand-rolled depth/breadth/mix drivers. The surface's shot is already a `LeafExecutor`
 * (`shotExecutor`/`agenticRegistry`), so a `Persona` whose registry IS that surface registry lets
 * the keystone combinators spawn shots directly. This file is the bridge that lets us DELETE the
 * bespoke drivers in agentic.ts in favor of the keystone shapes.
 */

import {
  fanout,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  definePersona,
  runPersonified,
  trajectoryReport,
} from '@tangle-network/agent-runtime/loops'
import type { AgentProfile, AgentSpec, Persona, TrajectoryReport } from '@tangle-network/agent-runtime/loops'
import { type AgenticOptions, type AgenticSurface, type AgenticTask, agenticRegistry, type ShotTask } from './agentic'

/** A `Persona` whose executor registry is the surface registry — so the keystone combinators spawn
 *  surface shots as their leaves. The profile carries `metadata.role:'shot'` so the registry resolves
 *  the shot executor. (A future "Drew" operator persona is the SAME builder with a different profile/
 *  directive — one of infinitely many, all run through this one path.) */
export function surfacePersona(surface: AgenticSurface, opts: AgenticOptions, name = 'surface-solver'): Persona<string> {
  const root: AgentSpec = {
    profile: { name: 'shot', metadata: { role: 'shot' } } as unknown as AgentProfile,
    harness: null,
  }
  return definePersona<string>({
    name,
    root,
    directive: 'Bring the artifact to the required final state, addressing every required change.',
    context: { role: 'solver' },
    executors: { registry: agenticRegistry(surface, opts) },
  })
}

/** Best done-leaf score from the run's trajectory (the deployable selector reads the journaled
 *  per-child verdict — same best-valid-score rule the kernel uses). */
function bestDoneScore(report: TrajectoryReport): { score: number; resolved: boolean } {
  let best: { score: number; valid: boolean } | undefined
  for (const n of report.nodes) {
    const v = n.verdict
    if (n.status !== 'done' || !v || typeof v.score !== 'number') continue
    if (best === undefined || (v.valid && !best.valid) || (v.valid === best.valid && v.score > best.score)) {
      best = { score: v.score, valid: v.valid === true }
    }
  }
  return { score: best?.score ?? 0, resolved: best?.valid === true }
}

/** BREADTH via the existing `fanout` combinator + `runPersonified` over the surface — the
 *  consolidated replacement for the hand-rolled `breadthDriver`. */
export async function runBreadthPersonified(
  surface: AgenticSurface,
  task: AgenticTask,
  opts: AgenticOptions,
  k: number,
): Promise<{ score: number; resolved: boolean }> {
  const innerTurns = opts.innerTurns ?? 4
  const journal = new InMemorySpawnJournal()
  const blobs = new InMemoryResultBlobStore()
  const runId = `breadth:${task.id}`
  const items = Array.from({ length: k }, (_v, i) => i)
  const shape = fanout<unknown, number, string>(items, {
    itemTask: () => ({ task }) as ShotTask, // each child opens its OWN artifact (no handle) — a fresh rollout
    label: (_item, i) => `rollout:${i}`,
  })
  await runPersonified<unknown, string>({
    persona: surfacePersona(surface, opts),
    shape,
    task: undefined,
    budget: { maxIterations: k * (innerTurns + 1), maxTokens: 1_000_000_000 },
    shapeBudget: { fanout: k, perChild: { maxIterations: innerTurns + 1, maxTokens: 1_000_000 } },
    runId,
    journal,
    blobs,
    maxDepth: 3,
  })
  return bestDoneScore(await trajectoryReport(journal, blobs, runId, { withOutputs: true }))
}
