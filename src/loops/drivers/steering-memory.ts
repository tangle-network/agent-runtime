/**
 * @experimental
 *
 * `createSteeringMemory` — persistent driver memory (#19), seeded by causal
 * attribution. Gen 3's {@link attributeSteer} PROVES which steer wins (verdict
 * `driver-attributable` → `best.steer` measurably beat the actual). This turns
 * that proof into a {@link PlaybookEntry} and accumulates a playbook the steering
 * driver reads on future runs — so it adopts a known-good steer on shot 1 instead
 * of re-deriving it. Closes the learning loop: steer → attribute → remember →
 * steer better, campaign over campaign.
 *
 * De-dup: agent-eval owns the playbook substrate (`Playbook`/`PlaybookEntry` +
 * `distillPlaybook` dedup/rank/cap + `renderPlaybookMarkdown`). This owns only the
 * loop binding — attribution → entry, the in-process store, and rendering for the
 * steering prompt (consumed via `createSteeringPlanner`'s `priorContext` hook).
 */

import {
  distillPlaybook,
  type Playbook,
  type PlaybookEntry,
  renderPlaybookMarkdown,
} from '@tangle-network/agent-eval'
import type { SteerAttribution } from './steer-attribution'

/** @experimental */
export interface AttributionToEntryOptions {
  /** Short tag for the failure situation this steer addresses (the retrieval key). */
  situation: string
  /** Run that produced the attribution (for provenance). */
  sourceRunId?: string
  /** Render the suggested steer (a `Task`) as instruction text. Default: JSON. */
  describeSteer?: (steer: unknown) => string
}

/**
 * Map a {@link SteerAttribution} to a {@link PlaybookEntry} — ONLY when the
 * verdict is `driver-attributable` (a steer that MEASURABLY beat the actual);
 * otherwise `null` (don't record un-proven or worker-bound outcomes). `weight`
 * is the `driverShare` so the strongest proven steers survive distillation.
 */
export function attributionToPlaybookEntry<Task>(
  attr: SteerAttribution<Task>,
  opts: AttributionToEntryOptions,
): PlaybookEntry | null {
  if (attr.verdict !== 'driver-attributable' || !attr.best) return null
  const describe = opts.describeSteer ?? safeJson
  const actual = attr.actualScore === null ? 'n/a' : attr.actualScore.toFixed(3)
  return {
    instruction: `For "${opts.situation}": steer toward ${describe(attr.best.steer)}`,
    rationale: `a counterfactual steer scored ${attr.best.score.toFixed(3)} vs the attempt's ${actual} — proven to recover this failure, not a guess`,
    category: opts.situation,
    evidence: `driverShare=${attr.driverShare.toFixed(3)} workerShare=${attr.workerShare.toFixed(3)}`,
    weight: attr.driverShare,
    ...(opts.sourceRunId ? { sourceRunId: opts.sourceRunId } : {}),
  }
}

/** @experimental */
export interface CreateSteeringMemoryOptions {
  /** Cap stored entries; on overflow the lowest-`weight` entries are dropped. Default 50. */
  maxEntries?: number
  /** Pre-seed entries (e.g. loaded from a prior campaign). */
  seed?: readonly PlaybookEntry[]
}

/** @experimental */
export interface SteeringMemory<Task> {
  /** Record a driver-attributable attribution as a playbook entry (null if not recorded). */
  record(attr: SteerAttribution<Task>, opts: AttributionToEntryOptions): PlaybookEntry | null
  /** Add a raw entry directly. */
  add(entry: PlaybookEntry): void
  /** Distilled playbook (dedup/rank/cap via the substrate). */
  playbook(maxEntries?: number): Playbook
  /** Markdown for prompt injection — empty string when the memory is empty. */
  render(maxEntries?: number): string
  /** Raw stored entries (post-cap). */
  entries(): readonly PlaybookEntry[]
  readonly size: number
}

/**
 * In-process steering memory. NOT safe to share one instance across CONCURRENT
 * loops (the entry list is mutated by `record`); a memory belongs to one loop,
 * or the caller synchronizes. `record` is a synchronous append (atomic under
 * JS's single thread), called sequentially from the loop's planning path.
 */
export function createSteeringMemory<Task>(
  opts: CreateSteeringMemoryOptions = {},
): SteeringMemory<Task> {
  const cap = Math.max(1, Math.floor(opts.maxEntries ?? 50))
  let entries: PlaybookEntry[] = [...(opts.seed ?? [])]

  const trim = () => {
    if (entries.length > cap) {
      entries = [...entries].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)).slice(0, cap)
    }
  }
  trim()

  const playbook = (maxEntries?: number): Playbook =>
    distillPlaybook(entries, maxEntries !== undefined ? { maxEntries } : undefined)

  const render = (maxEntries?: number): string =>
    entries.length === 0 ? '' : renderPlaybookMarkdown(playbook(maxEntries))

  return {
    record(attr, recordOpts) {
      const entry = attributionToPlaybookEntry(attr, recordOpts)
      if (entry) {
        entries.push(entry)
        trim()
      }
      return entry
    },
    add(entry) {
      entries.push(entry)
      trim()
    },
    playbook,
    render,
    entries() {
      return entries
    },
    get size() {
      return entries.length
    },
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}
