/**
 * Proof for the two intelligence pieces, driven by a SCRIPTED router (a fake
 * `fetch` on the `LlmClientOptions`) so the loop is deterministic and offline:
 *
 *   1. AUTOPSY turns 3 failing rows into RANKED mechanism findings (dominant
 *      first), excludes the resolved row, and carries the evidence quote +
 *      firewall provenance onto each finding.
 *   2. REFLECTIVE REFINE turns those findings into N drafts, each REFERENCING a
 *      failure mode in its label + rationale.
 *   3. DIVERSE SEEDS does the same across N framings.
 *
 * The POINT is the wiring: failing rows → findings → finding-targeted drafts.
 */

import type { AnalystFinding, LlmClientOptions } from '@tangle-network/agent-eval'
import { describe, expect, it } from 'vitest'
import type { GenerateContext } from './generator'
import {
  authorDiverseSweSeeds,
  autopsySweFailures,
  reflectiveSweRefine,
  type SweFailureRow,
} from './reflective-swe'

/** A router transport whose `fetch` always answers with `payload` as the
 *  assistant's JSON content, and counts how many times it was called. */
function scriptedLlm(payload: unknown): { llm: LlmClientOptions; calls: () => number } {
  let calls = 0
  const llm: LlmClientOptions = {
    baseUrl: 'https://router.test/v1',
    apiKey: 'test-key',
    fetch: (async () => {
      calls += 1
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(payload) } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          model: 'stub-model',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch,
  }
  return { llm, calls: () => calls }
}

describe('autopsySweFailures — failing rows → ranked mechanism findings', () => {
  it('turns 3 failing rows into findings ranked by count, dominant first', async () => {
    // Non-zero patches so the analyst's LABEL is honored (an empty patch would
    // be force-classified by the bytes shortcut instead).
    const rows: SweFailureRow[] = [
      { id: 'django__django-a', resolved: false, patch: 'diff --git a', patchBytes: 12 },
      { id: 'django__django-b', resolved: false, patch: 'diff --git b', patchBytes: 12 },
      { id: 'django__django-c', resolved: false, patch: 'diff --git c', patchBytes: 12 },
      { id: 'django__django-ok', resolved: true, patch: 'diff --git ok', patchBytes: 13 },
    ]

    // Two failures share the dominant mechanism, one is the tail.
    const { llm, calls } = scriptedLlm({
      classifications: [
        {
          instanceId: 'django__django-a',
          mechanism: 'wrong-file-or-function',
          evidence: 'edited urls.py but the bug is in views.py',
        },
        {
          instanceId: 'django__django-b',
          mechanism: 'wrong-file-or-function',
          evidence: 'patched the wrong model field',
        },
        {
          instanceId: 'django__django-c',
          mechanism: 'no-reproduction',
          evidence: 'never ran the failing test before editing',
        },
      ],
    })

    const findings = await autopsySweFailures(rows, { llm, model: 'stub-model' })

    // ONE batched analyst call over all failing rows.
    expect(calls()).toBe(1)

    // Two mechanisms → two findings, ranked by count (2 then 1).
    expect(findings).toHaveLength(2)
    expect(findings[0]?.area).toBe('wrong-file-or-function')
    expect(findings[0]?.metadata?.count).toBe(2)
    expect(findings[0]?.severity).toBe('high')
    expect(findings[0]?.claim).toContain('2/3')
    expect(findings[1]?.area).toBe('no-reproduction')
    expect(findings[1]?.metadata?.count).toBe(1)
    expect(findings[0]?.confidence).toBeCloseTo(2 / 3, 10)

    // The evidence quote rode onto the finding's evidence_refs.
    const excerpts = findings[0]?.evidence_refs.map((e) => e.excerpt)
    expect(excerpts).toContain('edited urls.py but the bug is in views.py')
    expect(findings[0]?.evidence_refs.map((e) => e.uri)).toContain('swe://django__django-a')

    // FIREWALL: autopsy findings are observed, never judge-derived.
    expect(findings.every((f) => f.derived_from_judge === false)).toBe(true)

    // The RESOLVED row is excluded from every finding.
    const allIds = findings.flatMap((f) => (f.metadata?.instanceIds as string[]) ?? [])
    expect(allIds).not.toContain('django__django-ok')
  })

  it('force-classifies an empty patch regardless of the analyst label', async () => {
    const rows: SweFailureRow[] = [{ id: 'x', resolved: false, patchBytes: 0 }]
    // The analyst mislabels it; the bytes==0 shortcut overrides to empty-patch.
    const { llm } = scriptedLlm({
      classifications: [{ instanceId: 'x', mechanism: 'regression', evidence: 'noise' }],
    })

    const findings = await autopsySweFailures(rows, { llm })
    expect(findings).toHaveLength(1)
    expect(findings[0]?.area).toBe('empty-patch')
  })

  it('returns [] when nothing failed (a clean exam has no autopsy)', async () => {
    const { llm, calls } = scriptedLlm({ classifications: [] })
    const findings = await autopsySweFailures([{ id: 'a', resolved: true }], { llm })
    expect(findings).toEqual([])
    // No failing rows → no analyst call spent.
    expect(calls()).toBe(0)
  })
})

/** A ranked pair of findings standing in for the autopsy output. */
const findingsFixture = (): AnalystFinding[] => [
  {
    schema_version: '1.0.0',
    finding_id: 'f-empty',
    analyst_id: 'swe-failure-autopsy',
    produced_at: '2026-01-01T00:00:00.000Z',
    severity: 'high',
    area: 'empty-patch',
    claim: '2/3 failing task(s) failed via empty-patch',
    recommended_action: 'require a non-empty diff before yielding',
    confidence: 0.66,
    derived_from_judge: false,
    evidence_refs: [{ kind: 'artifact', uri: 'swe://a', excerpt: 'no diff produced' }],
  },
  {
    schema_version: '1.0.0',
    finding_id: 'f-wrong',
    analyst_id: 'swe-failure-autopsy',
    produced_at: '2026-01-01T00:00:00.000Z',
    severity: 'medium',
    area: 'wrong-file-or-function',
    claim: '1/3 failing task(s) failed via wrong-file-or-function',
    recommended_action: 'confirm the edit site against the traceback',
    confidence: 0.33,
    derived_from_judge: false,
    evidence_refs: [{ kind: 'artifact', uri: 'swe://c', excerpt: 'edited the wrong file' }],
  },
]

const ctxFrom = (findings: AnalystFinding[]): GenerateContext => ({
  baseline: { name: 'swe-agent', prompt: { systemPrompt: 'You fix SWE-bench issues.' } },
  domain: 'swe-bench-verified',
  findings,
})

describe('reflectiveSweRefine — findings → N finding-targeted drafts', () => {
  it('turns findings into N drafts, each referencing a failure mode', async () => {
    const { llm, calls } = scriptedLlm({
      candidates: [
        {
          instruction:
            'Before finishing, confirm a non-empty unified diff exists in the workspace.',
          targetsMechanism: 'empty-patch',
          hypothesis: 'empty patches happen because the worker yields without writing changes',
          predictedMechanism: 'empty-patch',
        },
        {
          instruction: 'Locate the failing symbol from the traceback before editing any file.',
          targetsMechanism: 'wrong-file-or-function',
          hypothesis: 'wrong-file edits come from guessing the site instead of tracing it',
          predictedMechanism: 'wrong-file-or-function',
        },
        {
          instruction: 'Reproduce the failing test first, then edit until it passes.',
          targetsMechanism: 'no-reproduction',
          hypothesis: 'blind edits miss the real defect',
          predictedMechanism: 'no-reproduction',
        },
      ],
    })

    const refine = reflectiveSweRefine({ llm, model: 'stub-model', populationSize: 3 })
    const drafts = await refine(ctxFrom(findingsFixture()))

    expect(calls()).toBe(1)
    expect(drafts).toHaveLength(3)
    // Each draft references the failure mode it targets, in BOTH label + rationale.
    for (const d of drafts) {
      expect(d.label.startsWith('refine:')).toBe(true)
      const mechanism = d.label.slice('refine:'.length)
      expect(d.rationale).toContain(`targets ${mechanism}`)
      expect(d.instruction.length).toBeGreaterThan(0)
    }
    expect(drafts.map((d) => d.label)).toContain('refine:empty-patch')
    // The hypothesis rode into the rationale (auditable against the finding).
    expect(drafts[0]?.rationale).toContain('hypothesis:')
  })
})

describe('authorDiverseSweSeeds — findings → N diverse framings', () => {
  it('turns findings into N seeds, each referencing a failure mode with a framing', async () => {
    const { llm } = scriptedLlm({
      candidates: [
        {
          instruction: 'Directive: never finish without a non-empty diff.',
          targetsMechanism: 'empty-patch',
          framing: 'imperative',
        },
        {
          instruction: 'Checklist: reproduce, locate, edit, re-run, confirm diff.',
          targetsMechanism: 'no-reproduction',
          framing: 'checklist',
        },
      ],
    })

    const seeds = authorDiverseSweSeeds({ llm, model: 'stub-model' })
    const drafts = await seeds(ctxFrom(findingsFixture()), 2)

    expect(drafts).toHaveLength(2)
    expect(drafts.map((d) => d.label)).toEqual(['seed:imperative', 'seed:checklist'])
    for (const d of drafts) {
      expect(d.rationale).toMatch(/targets (empty-patch|no-reproduction)/)
    }
  })
})
