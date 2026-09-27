//#region src/mcp/kb-gate.d.ts
/**
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
 *
 * @experimental
 */
/** @experimental A fact proposed for the KB, with its grounding. */
interface FactCandidate {
  /** The atomic claim text. */
  claim: string;
  /** Optional extracted value (number or string) the claim asserts. */
  value?: string | number;
  /** Verbatim span lifted from the source that backs the claim. */
  verbatimPassage: string;
  /** The raw source text the passage must be grounded in. */
  sourceText: string;
  /** Where the fact claims to come from — checked for circular/self citations. */
  citation?: string;
}
/** @experimental */
interface FactJudgeVerdict {
  accept: boolean;
  reason?: string;
}
/** @experimental A pluggable fact validator. Throw is NOT allowed — return a
 *  verdict; a thrown judge is a programmer error, not a veto. */
interface FactJudge {
  name: string;
  judge(candidate: FactCandidate): FactJudgeVerdict | Promise<FactJudgeVerdict>;
}
/** @experimental */
interface KbGateResult {
  accepted: boolean;
  /** Name of the judge that vetoed; undefined when accepted. */
  vetoedBy?: string;
  reason?: string;
}
/** @experimental */
interface CreateKbGateOptions {
  /** Extra judges appended after the built-in floor (e.g. an LLM judge). */
  judges?: FactJudge[];
  /** Minimum verbatim-passage length. Default 12 — kills empty/stub passages. */
  minPassageChars?: number;
  /**
   * Citation tokens that denote a SELF-generated artifact (e.g. `'spec'`,
   * `'cad_params'`, `'requirements'`). A citation naming one is circular
   * (laundering) — the fact cites a derived artifact, not a real source.
   * Default `[]` (no circular check unless the consumer declares its kinds).
   */
  selfArtifactKinds?: string[];
}
/**
 *
 * Build a fail-closed KB gate. The returned function runs the built-in floor
 * (passage-non-empty → passage-present → value-in-passage → no-circular-citation)
 * then any consumer judges, returning on the first veto.
 *
 * @experimental
 */
declare function createKbGate(options?: CreateKbGateOptions): (candidate: FactCandidate) => Promise<KbGateResult>;
//#endregion
export { KbGateResult as a, FactJudgeVerdict as i, FactCandidate as n, createKbGate as o, FactJudge as r, CreateKbGateOptions as t };
//# sourceMappingURL=kb-gate-C8z2juK8.d.ts.map