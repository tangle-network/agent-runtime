/**
 * Intent router primitive — classifies a user message against a profile's
 * subagent map.
 *
 * Today's product agents implement variants of this in their own
 * `src/lib/router/intent.ts` files: legal (101 lines), gtm (167 lines via
 * `index.ts` + `intents.ts`), tax (127 lines), creative (184 lines). All four
 * read `metadata.matchers` (or parallel constant tables) off `AgentSubagentProfile`
 * entries and keyword-score against the user message. The audit at
 * `/tmp/canonical-audit/SUMMARY.md` flagged the duplication.
 *
 * `classifyIntent` is the extraction. Routes are declared via
 * `AgentSubagentProfile.metadata.matchers` (regexes + literal keywords); the
 * router scores each subagent against the message and returns a typed result.
 * The contract — what shape `metadata.matchers` takes — is part of the
 * `@tangle-network/sandbox` profile spec, so every consumer encodes routes
 * once, on the profile, instead of in a parallel SPECIALIST_INTENTS table.
 *
 * No LLM call. Pure scoring. The runtime decides whether the score is high
 * enough to dispatch the subagent vs route to the base agent.
 */

import type { AgentProfile, AgentSubagentProfile } from '@tangle-network/sandbox'

/**
 * The matcher shape consumers attach to `subagent.metadata.matchers`. We
 * deliberately keep this minimal — every additional dimension is something
 * a route mistakes can hide behind.
 */
export interface SubagentMatcher {
  /** Literal keywords (case-insensitive substring match). +1 per match unless `weight` overrides. */
  keywords?: readonly string[]
  /** Regex patterns (case-insensitive). +`weight` per match (default 1.5). */
  patterns?: readonly (string | RegExp)[]
  /** Per-rule weight override. */
  weight?: number
  /** Minimum score for this subagent to be considered "matched". Default 1. */
  minScore?: number
}

export interface ClassifyIntentResult {
  /** Best-scoring subagent id; null if no subagent crossed `minScore`. */
  id: string | null
  /** Best subagent's `AgentSubagentProfile`; null if no match. */
  subagent: AgentSubagentProfile | null
  /** Score of the chosen subagent. */
  score: number
  /** All subagent scores keyed by id — useful for telemetry / debugging. */
  scores: Record<string, number>
  /** The matchers checked, for debugging "why didn't X route?" */
  evaluated: Record<string, { keywordHits: number; patternHits: number; minScore: number }>
}

export interface ClassifyIntentOptions {
  /** Override the global default `minScore` (used when a subagent omits its own). */
  defaultMinScore?: number
  /** Subagent ids to skip (e.g. scaffold-only subagents with `metadata.status === 'scaffold'`). */
  skip?: readonly string[]
  /** Only consider subagents whose metadata predicate returns true (e.g. `m =&gt; m.status === 'full'`). */
  filter?: (subagent: AgentSubagentProfile, id: string) => boolean
}

const DEFAULT_PATTERN_WEIGHT = 1.5
const DEFAULT_MIN_SCORE = 1

function isMatcher(value: unknown): value is SubagentMatcher {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return Array.isArray(v.keywords) || Array.isArray(v.patterns) || typeof v.minScore === 'number'
}

function readMatcher(subagent: AgentSubagentProfile): SubagentMatcher | null {
  const m = subagent.metadata as Record<string, unknown> | undefined
  if (!m) return null
  const raw = m.matchers ?? m.matcher ?? null
  if (!raw) return null
  if (Array.isArray(raw)) {
    // Allow consumers to declare an array-of-matchers; merge into one shape.
    const merged: SubagentMatcher = { keywords: [], patterns: [], minScore: DEFAULT_MIN_SCORE }
    for (const entry of raw) {
      if (!isMatcher(entry)) continue
      merged.keywords = [...(merged.keywords ?? []), ...(entry.keywords ?? [])]
      merged.patterns = [...(merged.patterns ?? []), ...(entry.patterns ?? [])]
      if (entry.minScore !== undefined) merged.minScore = entry.minScore
    }
    return merged
  }
  if (isMatcher(raw)) return raw
  return null
}

/**
 * Pure intent classifier.
 *
 * For each subagent in `profile.subagents`: read `metadata.matchers`,
 * score keyword + pattern hits against the user message, return the
 * highest-scoring subagent (or null if none crossed `minScore`). No LLM
 * call, no side effects. The runtime decides what to do with the result.
 */
export function classifyIntent(
  profile: AgentProfile,
  message: string,
  opts: ClassifyIntentOptions = {},
): ClassifyIntentResult {
  const lower = message.toLowerCase()
  const subagents = profile.subagents ?? {}
  const skip = new Set(opts.skip ?? [])
  const defaultMinScore = opts.defaultMinScore ?? DEFAULT_MIN_SCORE

  const scores: Record<string, number> = {}
  const evaluated: Record<string, { keywordHits: number; patternHits: number; minScore: number }> =
    {}
  let bestId: string | null = null
  let bestScore = -Infinity
  let bestSubagent: AgentSubagentProfile | null = null

  for (const [id, subagent] of Object.entries(subagents)) {
    if (skip.has(id)) continue
    if (opts.filter && !opts.filter(subagent, id)) continue
    const matcher = readMatcher(subagent)
    if (!matcher) {
      evaluated[id] = { keywordHits: 0, patternHits: 0, minScore: defaultMinScore }
      scores[id] = 0
      continue
    }
    const weight = matcher.weight ?? 1
    let kHits = 0
    for (const kw of matcher.keywords ?? []) {
      if (kw && lower.includes(kw.toLowerCase())) kHits += 1
    }
    let pHits = 0
    for (const p of matcher.patterns ?? []) {
      const re = p instanceof RegExp ? p : new RegExp(p, 'i')
      if (re.test(message)) pHits += 1
    }
    const score = kHits * weight + pHits * DEFAULT_PATTERN_WEIGHT * weight
    const minScore = matcher.minScore ?? defaultMinScore
    scores[id] = score
    evaluated[id] = { keywordHits: kHits, patternHits: pHits, minScore }
    if (score >= minScore && score > bestScore) {
      bestScore = score
      bestId = id
      bestSubagent = subagent
    }
  }

  if (bestId === null) {
    return { id: null, subagent: null, score: 0, scores, evaluated }
  }
  return { id: bestId, subagent: bestSubagent, score: bestScore, scores, evaluated }
}
