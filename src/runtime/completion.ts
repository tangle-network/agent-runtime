/**
 * @experimental
 *
 * Completion / satisfiability — the OTHER output of the pluggable analyst (the steer output
 * is `AnalystFinding[]` via the `analyze` hook; this is the "is it done?" output via the
 * `complete` hook). A `CompletionAnalyst` reads a node's trace and returns a `CompletionVerdict`
 * the PARENT (driver) acts on: end the node, or keep going. It fits ANY node and composes to
 * any depth — a 1-deep loop has one; an N-deep tree has one per node.
 *
 * The verdict's authority scales with its DETERMINISM (the thing that varies by task):
 *   - `deterministic` — build/test/lint pass, a proof checks, every claim's citation resolves:
 *     ground truth, the driver TRUSTS it and ends. Not an opinion.
 *   - `probabilistic` — a quality/soundness judgment (marketing, "the experiment is sound"):
 *     ADVISORY. It passes to the driver with its reasons; the driver validates (here: a
 *     confidence threshold; a richer driver may re-examine the reasons) before ending.
 *
 * Two stop-signal mechanisms, by node mode, both → one `CompletionVerdict`:
 *   - sandbox-agent (text stream): a unique per-node STOP SENTINEL the agent emits when done
 *     (`stopSentinel` / `sentinelCompletion`) — ralph-loop style; the seed makes it
 *     unguessable + attributable, so it can't be spuriously emitted or confused with content.
 *   - deterministic check (compile/test/citation/proof): `deterministicCompletion(check)` —
 *     a verifier over the output, never the judge verdict (selector ≠ judge holds).
 */

import type { Iteration } from './types'

/** Trace-derived evidence for a completion claim — an artifact (output) or a verifier metric,
 *  never the judge's own verdict. Mirrors the steer-firewall's provenance discipline. */
export interface CompletionEvidence {
  kind: 'artifact' | 'metric'
  uri: string
}

/** The "is it done?" verdict an analyst returns to the parent. */
export interface CompletionVerdict {
  done: boolean
  /** How verifiable the claim is — sets whether the driver trusts it or validates it. */
  determinism: 'deterministic' | 'probabilistic'
  /** Why the analyst believes it is (or isn't) done — what the driver validates. */
  reasons?: string
  /** 0..1, for probabilistic verdicts; the driver's validation threshold reads this. */
  confidence?: number
  evidence?: ReadonlyArray<CompletionEvidence>
}

/** Reads a node's trace → a completion verdict. Same input shape as the `analyze` hook, so
 *  ONE analyst node can back both channels (findings for steer, a verdict for stop). */
export interface CompletionAnalyst<Task, Output> {
  assess(input: {
    task: Task
    history: ReadonlyArray<Iteration<Task, Output>>
  }): CompletionVerdict | Promise<CompletionVerdict>
}

/** When a verdict authorizes the driver to END. Deterministic → trust (ground truth);
 *  probabilistic → validate by confidence threshold (the driver's check). */
export interface CompletionPolicy {
  /** Minimum confidence a PROBABILISTIC verdict must clear to end. Default 0.8. */
  minConfidence?: number
}

export function completionAuthorizes(v: CompletionVerdict, policy?: CompletionPolicy): boolean {
  if (!v?.done) return false
  if (v.determinism === 'deterministic') return true
  return (v.confidence ?? 0) >= (policy?.minConfidence ?? 0.8)
}

/**
 * A unique, attributable stop sentinel for a node (ralph-loop style). Deterministic from the
 * seed (no Math.random — reproducible + attributable to the node); the agent is instructed to
 * emit it VERBATIM when it judges itself done. Unguessable enough that content never trips it.
 */
export function stopSentinel(seed: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `<<<{{STOP:${(h >>> 0).toString(16).padStart(8, '0')}}}>>>`
}

/**
 * Completion for a sandbox-agent node: done iff the latest output carries the node's stop
 * sentinel. PROBABILISTIC (the agent's own self-judgment) — the driver validates it.
 */
export function sentinelCompletion<Task>(
  sentinel: string,
  opts?: { confidence?: number },
): CompletionAnalyst<Task, string> {
  return {
    assess({ history }) {
      const last = history[history.length - 1]
      const out = typeof last?.output === 'string' ? last.output : ''
      const done = out.includes(sentinel)
      return {
        done,
        determinism: 'probabilistic',
        confidence: done ? (opts?.confidence ?? 0.9) : 0,
        reasons: done ? 'agent emitted its assigned stop sentinel' : undefined,
        evidence: done && last ? [{ kind: 'artifact', uri: `attempt:${last.index}` }] : [],
      }
    },
  }
}

/**
 * Completion for a DETERMINISTIC check (build/test/lint/citation/proof): done iff the check
 * passes. Ground truth — the driver ends directly, no validation. The check reads the output
 * (a verifier), never the judge verdict — selector ≠ judge stays intact.
 */
export function deterministicCompletion<Task, Output>(
  check: (
    output: Output,
    history: ReadonlyArray<Iteration<Task, Output>>,
  ) => { passed: boolean; reasons?: string },
): CompletionAnalyst<Task, Output> {
  return {
    assess({ history }) {
      const last = history[history.length - 1]
      if (last?.output === undefined) {
        return { done: false, determinism: 'deterministic', reasons: 'no output yet' }
      }
      const r = check(last.output, history)
      return {
        done: r.passed,
        determinism: 'deterministic',
        reasons: r.reasons,
        evidence: [{ kind: 'artifact', uri: `attempt:${last.index}` }],
      }
    },
  }
}
