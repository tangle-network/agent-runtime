/**
 * @experimental
 *
 * `createKbGate` — the valid-only knowledge-base growth gate, distilled from
 * physim's KB-research subsystem. A research-in-a-loop delegate (or any KB
 * writer) runs candidate facts through this before persisting, so the KB grows
 * with ONLY grounded facts — hallucinated, unsourced, or laundered claims are
 * vetoed at the gate.
 *
 * Fail-closed by construction: every judge must `accept`; the FIRST veto wins
 * and the fact is rejected. The non-negotiable floor (always on, can't be
 * disabled) is the **passage-present guard** — a fact's `verbatimPassage` MUST
 * literally appear in its `sourceText`. That single check kills the dominant
 * failure mode (a confident claim decoupled from any real source).
 *
 * Pure + dependency-free: it operates on fact candidates, not on a store, so it
 * composes with `@tangle-network/agent-knowledge` or any persistence layer
 * without importing it. The remediation policy (correct-on-veto vs
 * escalate-as-unverified) is the caller's — this returns the verdict; it never
 * drops a fact silently.
 */

/** @experimental A fact proposed for the KB, with its grounding. */
export interface FactCandidate {
  /** The atomic claim text. */
  claim: string
  /** Optional extracted value (number or string) the claim asserts. */
  value?: string | number
  /** Verbatim span lifted from the source that backs the claim. */
  verbatimPassage: string
  /** The raw source text the passage must be grounded in. */
  sourceText: string
  /** Where the fact claims to come from — checked for circular/self citations. */
  citation?: string
}

/** @experimental */
export interface FactJudgeVerdict {
  accept: boolean
  reason?: string
}

/** @experimental A pluggable fact validator. Throw is NOT allowed — return a
 *  verdict; a thrown judge is a programmer error, not a veto. */
export interface FactJudge {
  name: string
  judge(candidate: FactCandidate): FactJudgeVerdict | Promise<FactJudgeVerdict>
}

/** @experimental */
export interface KbGateResult {
  accepted: boolean
  /** Name of the judge that vetoed; undefined when accepted. */
  vetoedBy?: string
  reason?: string
}

/** @experimental */
export interface CreateKbGateOptions {
  /** Extra judges appended after the built-in floor (e.g. an LLM judge). */
  judges?: FactJudge[]
  /** Minimum verbatim-passage length. Default 12 — kills empty/stub passages. */
  minPassageChars?: number
  /**
   * Citation tokens that denote a SELF-generated artifact (e.g. `'spec'`,
   * `'cad_params'`, `'requirements'`). A citation naming one is circular
   * (laundering) — the fact cites a derived artifact, not a real source.
   * Default `[]` (no circular check unless the consumer declares its kinds).
   */
  selfArtifactKinds?: string[]
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Does `value` appear in the (normalized) passage — literally, comma-grouped,
 *  or in billion/million shorthand (the forms a source actually writes). */
function valueAppears(value: string | number, passageNorm: string): boolean {
  if (passageNorm.includes(norm(String(value)))) return true
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  const forms = [value.toLocaleString('en-US')]
  if (Math.abs(value) >= 1e9) forms.push(`${trimZero(value / 1e9)} billion`)
  if (Math.abs(value) >= 1e6) forms.push(`${trimZero(value / 1e6)} million`)
  return forms.some((f) => passageNorm.includes(norm(f)))
}

function trimZero(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)))
}

/** The always-on floor judges. Order matters: cheapest / most-fundamental first. */
function builtinJudges(minPassageChars: number, selfArtifactKinds: string[]): FactJudge[] {
  const kinds = selfArtifactKinds.map((k) => k.toLowerCase())
  return [
    {
      name: 'passage-non-empty',
      judge: (c) =>
        c.verbatimPassage.trim().length >= minPassageChars
          ? { accept: true }
          : { accept: false, reason: `passage shorter than ${minPassageChars} chars` },
    },
    {
      // THE anti-hallucination floor — the passage must literally be in the source.
      name: 'passage-present',
      judge: (c) =>
        norm(c.sourceText).includes(norm(c.verbatimPassage))
          ? { accept: true }
          : { accept: false, reason: 'verbatim passage not found in source (unbacked fact)' },
    },
    {
      name: 'value-in-passage',
      judge: (c) =>
        c.value === undefined || valueAppears(c.value, norm(c.verbatimPassage))
          ? { accept: true }
          : { accept: false, reason: `value ${JSON.stringify(c.value)} not present in passage` },
    },
    {
      name: 'no-circular-citation',
      judge: (c) => {
        if (!c.citation || kinds.length === 0) return { accept: true }
        const cite = c.citation.toLowerCase()
        const hit = kinds.find((k) => cite.includes(k))
        return hit
          ? { accept: false, reason: `circular citation to self-generated artifact "${hit}"` }
          : { accept: true }
      },
    },
  ]
}

/**
 * @experimental
 *
 * Build a fail-closed KB gate. The returned function runs the built-in floor
 * (passage-non-empty → passage-present → value-in-passage → no-circular-citation)
 * then any consumer judges, returning on the first veto.
 */
export function createKbGate(
  options: CreateKbGateOptions = {},
): (candidate: FactCandidate) => Promise<KbGateResult> {
  const judges = [
    ...builtinJudges(options.minPassageChars ?? 12, options.selfArtifactKinds ?? []),
    ...(options.judges ?? []),
  ]
  return async (candidate) => {
    for (const j of judges) {
      const verdict = await j.judge(candidate)
      if (!verdict.accept) {
        return { accepted: false, vetoedBy: j.name, reason: verdict.reason }
      }
    }
    return { accepted: true }
  }
}
