/**
 * The PROSE read side shared by the corpus A/B runners (`eops-corpus-ab.mts`,
 * `e3-memory-ab.mts`): query the accumulated trace-fact corpus and fold the top-k facts
 * into the task's system prompt. Both modes are measured arms:
 *   naive     — unconditional top-k (the context-pollution arm, −11.6pp on the stream).
 *   relevance — inject ONLY facts whose claims lexically overlap the task (≥2 shared
 *               content words); nothing relevant ⇒ inject nothing (+4.2pp n.s.).
 */
import type { AgenticTask, Corpus, CorpusRecord } from '@tangle-network/agent-runtime/loops'

export type PrimeMode = 'naive' | 'relevance'

export interface PrimeBlock {
  /** The system-prompt suffix ('' when nothing qualifies). */
  text: string
  /** Facts injected. */
  count: number
}

const contentWords = (t: string): Set<string> =>
  new Set(t.toLowerCase().match(/[a-z]{4,}/g) ?? [])

export async function primeBlock(
  corpus: Corpus,
  mode: PrimeMode,
  kFacts: number,
  task?: AgenticTask,
): Promise<PrimeBlock> {
  const all = await corpus.query({ tags: ['audience:agent'], limit: 50 })
  let facts: readonly CorpusRecord[] = all
  if (mode === 'relevance' && task) {
    const want = contentWords(task.userPrompt)
    facts = all
      .map((f) => ({ f, hits: [...contentWords(f.claim)].filter((w) => want.has(w)).length }))
      .filter((x) => x.hits >= 2)
      .sort((a, b) => b.hits - a.hits)
      .map((x) => x.f)
  }
  facts = facts.slice(0, kFacts)
  if (facts.length === 0) return { text: '', count: 0 }
  const lines = facts.map((f) => `- ${f.claim}${f.rationale ? ` (${f.rationale.slice(0, 120)})` : ''}`)
  return {
    text: `\n\nLEARNINGS FROM PRIOR RUNS (apply where relevant):\n${lines.join('\n')}`,
    count: facts.length,
  }
}
