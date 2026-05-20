import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentManifestError, defineAgent } from '../src/agent/define-agent'
import {
  createSurfaceImprovementAdapter,
  type DraftPatchInput,
  type DraftPatchOutput,
} from '../src/agent/improvement-adapter'
import { measureOutcome } from '../src/agent/outcome'
import { resolveSubjectPath, validateSurfaces } from '../src/agent/surfaces'

// ── helpers ─────────────────────────────────────────────────────────

function makeAgentTree(root: string): void {
  mkdirSync(join(root, 'prompts'), { recursive: true })
  writeFileSync(join(root, 'prompts/intake.md'), '# intake\n\nOriginal intake section.\n')
  mkdirSync(join(root, 'tools/list_invoices'), { recursive: true })
  writeFileSync(join(root, 'tools/list_invoices/README.md'), '# list_invoices\n')
  mkdirSync(join(root, 'personas'), { recursive: true })
  writeFileSync(join(root, 'personas/w2-single.yaml'), 'id: w2-single\n')
  mkdirSync(join(root, '.agent-knowledge'), { recursive: true })
  writeFileSync(join(root, 'rubric.ts'), 'export const rubric = {}\n')
}

function f(
  id: string,
  subject: string | undefined,
  partial: Partial<import('@tangle-network/agent-eval').AnalystFinding> = {},
): import('@tangle-network/agent-eval').AnalystFinding {
  return {
    schema_version: '1.0.0',
    finding_id: id,
    analyst_id: 'improvement',
    produced_at: '2026-05-20T00:00:00Z',
    area: 'improvement',
    severity: 'high',
    claim: `${id} claim`,
    confidence: 0.9,
    evidence_refs: [],
    subject,
    ...partial,
  }
}

let tmpRoot: string

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'agent-runtime-substrate-'))
  makeAgentTree(tmpRoot)
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

// ── defineAgent ─────────────────────────────────────────────────────

describe('defineAgent', () => {
  it('returns the manifest when every required surface resolves', () => {
    const m = defineAgent({
      id: 'test-agent',
      repoRoot: tmpRoot,
      surfaces: {
        systemPrompt: 'prompts',
        tools: 'tools',
        rubric: 'rubric.ts',
        knowledge: '.agent-knowledge',
        personas: 'personas',
      },
      rubric: {
        dimensions: [
          { id: 'd1', weight: 0.5, score: () => 1 },
          { id: 'd2', weight: 0.5, score: () => 1 },
        ],
      },
      runtime: { act: async () => ({}) },
      personas: async () => [],
      analystKinds: [],
      analyst: { model: 'claude-haiku-4-5' },
    })
    expect(m.id).toBe('test-agent')
  })

  it('throws AgentManifestError on missing required surface', () => {
    expect(() =>
      defineAgent({
        id: 'broken',
        repoRoot: tmpRoot,
        surfaces: {
          systemPrompt: 'prompts',
          tools: 'tools',
          rubric: 'does-not-exist.ts',
          knowledge: '.agent-knowledge',
          personas: 'personas',
        },
        rubric: { dimensions: [{ id: 'd1', weight: 1, score: () => 0 }] },
        runtime: { act: async () => ({}) },
        personas: async () => [],
        analystKinds: [],
        analyst: { model: 'claude-haiku-4-5' },
      }),
    ).toThrow(AgentManifestError)
  })

  it('throws when rubric weights sum to a clearly miscalibrated total', () => {
    expect(() =>
      defineAgent({
        id: 'mis-weighted',
        repoRoot: tmpRoot,
        surfaces: {
          systemPrompt: 'prompts',
          tools: 'tools',
          rubric: 'rubric.ts',
          knowledge: '.agent-knowledge',
          personas: 'personas',
        },
        rubric: {
          dimensions: [
            { id: 'd1', weight: 5, score: () => 1 },
            { id: 'd2', weight: 5, score: () => 1 },
          ],
        },
        runtime: { act: async () => ({}) },
        personas: async () => [],
        analystKinds: [],
        analyst: { model: 'claude-haiku-4-5' },
      }),
    ).toThrow(/sum to 10\.000/)
  })

  it('does NOT validate optional surfaces that are omitted', () => {
    const m = defineAgent({
      id: 'no-optionals',
      repoRoot: tmpRoot,
      surfaces: {
        systemPrompt: 'prompts',
        tools: 'tools',
        rubric: 'rubric.ts',
        knowledge: '.agent-knowledge',
        personas: 'personas',
        // No scaffolding / memory / rag / outputSchema — should not throw.
      },
      rubric: { dimensions: [{ id: 'd1', weight: 1, score: () => 0 }] },
      runtime: { act: async () => ({}) },
      personas: async () => [],
      analystKinds: [],
      analyst: { model: 'claude-haiku-4-5' },
    })
    expect(m.surfaces.scaffolding).toBeUndefined()
  })
})

// ── resolveSubjectPath ──────────────────────────────────────────────

describe('resolveSubjectPath', () => {
  const surfaces = {
    systemPrompt: 'prompts',
    tools: 'tools',
    rubric: 'rubric.ts',
    knowledge: '.agent-knowledge',
    personas: 'personas',
    rag: 'rag',
  }

  it('routes system-prompt subject to <surfaces.systemPrompt>/<section>.md', () => {
    const r = resolveSubjectPath(
      { kind: 'system-prompt', section: 'intake' },
      surfaces,
      tmpRoot,
    )
    expect(r?.repoRelativePath).toBe('prompts/intake.md')
    expect(r?.exists).toBe(true)
    expect(r?.intent).toBe('edit-existing')
  })

  it('routes system-prompt to create-new when the file does not exist', () => {
    const r = resolveSubjectPath(
      { kind: 'system-prompt', section: 'new-section' },
      surfaces,
      tmpRoot,
    )
    expect(r?.intent).toBe('create-new')
    expect(r?.exists).toBe(false)
  })

  it('routes tool-doc with aspect to <tools>/<tool>/<aspect>.md', () => {
    const r = resolveSubjectPath(
      { kind: 'tool-doc', tool: 'list_invoices', aspect: 'examples' },
      surfaces,
      tmpRoot,
    )
    expect(r?.repoRelativePath).toBe('tools/list_invoices/examples.md')
  })

  it('returns null when subject targets an undeclared optional surface', () => {
    const noRag = { ...surfaces, rag: undefined }
    const r = resolveSubjectPath(
      { kind: 'rag', corpus: 'irs', docId: 'foo' },
      noRag,
      tmpRoot,
    )
    expect(r).toBeNull()
  })

  it('returns null for cluster subjects (failure-mode evidence, not mutations)', () => {
    const r = resolveSubjectPath({ kind: 'cluster', label: 'tool-call-loop' }, surfaces, tmpRoot)
    expect(r).toBeNull()
  })

  it('returns null for websearch.outdated / prior-run-summary (stale signals, no direct file)', () => {
    expect(
      resolveSubjectPath({ kind: 'websearch.outdated', topic: 't' }, surfaces, tmpRoot),
    ).toBeNull()
    expect(
      resolveSubjectPath({ kind: 'prior-run-summary', topic: 't' }, surfaces, tmpRoot),
    ).toBeNull()
  })
})

// ── createSurfaceImprovementAdapter — proposeFromFindings ───────────

describe('createSurfaceImprovementAdapter — proposeFromFindings', () => {
  const baseSurfaces = {
    systemPrompt: 'prompts',
    tools: 'tools',
    rubric: 'rubric.ts',
    knowledge: '.agent-knowledge',
    personas: 'personas',
  }

  function mkDraft(): {
    fn: (i: DraftPatchInput) => Promise<DraftPatchOutput>
    calls: Array<DraftPatchInput>
  } {
    const calls: Array<DraftPatchInput> = []
    return {
      calls,
      fn: async (input) => {
        calls.push(input)
        return {
          patch: `--- a/${input.target.repoRelativePath}\n+++ b/${input.target.repoRelativePath}\n@@ +1,1 @@\n+drafted\n`,
          summary: `edit ${input.target.repoRelativePath}`,
          rationale: 'because',
        }
      },
    }
  }

  it('proposes an edit when subject + surface resolve cleanly', async () => {
    const { fn, calls } = mkDraft()
    const adapter = createSurfaceImprovementAdapter({
      surfaces: baseSurfaces,
      repoRoot: tmpRoot,
      draftPatch: fn,
    })
    const { edits, errors, skipped } = await adapter.proposeFromFindings([
      f('f1', 'system-prompt:intake'),
    ])
    expect(edits).toHaveLength(1)
    expect(errors).toEqual([])
    expect(skipped).toBe(0)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.currentContent).toMatch(/Original intake section/)
  })

  it('records an error when subject does not parse', async () => {
    const { fn } = mkDraft()
    const adapter = createSurfaceImprovementAdapter({
      surfaces: baseSurfaces,
      repoRoot: tmpRoot,
      draftPatch: fn,
    })
    const { edits, errors } = await adapter.proposeFromFindings([f('bad', 'fix the prompt')])
    expect(edits).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toMatch(/grammar/)
  })

  it('skips findings without a subject (descriptive findings)', async () => {
    const { fn } = mkDraft()
    const adapter = createSurfaceImprovementAdapter({
      surfaces: baseSurfaces,
      repoRoot: tmpRoot,
      draftPatch: fn,
    })
    const { edits, errors, skipped } = await adapter.proposeFromFindings([f('none', undefined)])
    expect(edits).toEqual([])
    expect(errors).toEqual([])
    expect(skipped).toBe(1)
  })

  it('skips cluster findings (failure-mode evidence)', async () => {
    const { fn } = mkDraft()
    const adapter = createSurfaceImprovementAdapter({
      surfaces: baseSurfaces,
      repoRoot: tmpRoot,
      draftPatch: fn,
    })
    const { edits, skipped } = await adapter.proposeFromFindings([f('c', 'tool-call-loop')])
    expect(edits).toEqual([])
    expect(skipped).toBe(1)
  })

  it('skips agent-knowledge:* subjects (they route to the KnowledgeAdapter)', async () => {
    const { fn } = mkDraft()
    const adapter = createSurfaceImprovementAdapter({
      surfaces: baseSurfaces,
      repoRoot: tmpRoot,
      draftPatch: fn,
    })
    const { edits, skipped } = await adapter.proposeFromFindings([
      f('k', 'agent-knowledge:wiki:invoice-shape'),
    ])
    expect(edits).toEqual([])
    expect(skipped).toBe(1)
  })

  it('records an error when subject targets an undeclared surface', async () => {
    const { fn } = mkDraft()
    const adapter = createSurfaceImprovementAdapter({
      surfaces: baseSurfaces, // no `rag` declared
      repoRoot: tmpRoot,
      draftPatch: fn,
    })
    const { edits, errors } = await adapter.proposeFromFindings([
      f('r', 'rag:irs-rulings:rev-rul-2024-12'),
    ])
    expect(edits).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toMatch(/undeclared surface/)
  })

  it('records an error when target does not exist for a non-create kind', async () => {
    const { fn } = mkDraft()
    const adapter = createSurfaceImprovementAdapter({
      surfaces: baseSurfaces,
      repoRoot: tmpRoot,
      draftPatch: fn,
      allowCreateForKinds: ['knowledge.wiki'], // explicitly disallow create for system-prompt
    })
    const { edits, errors } = await adapter.proposeFromFindings([
      f('miss', 'system-prompt:nonexistent-section'),
    ])
    expect(edits).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toMatch(/does not exist/)
  })

  it('passes baseSha256 of current content so apply can race-check', async () => {
    const { fn } = mkDraft()
    const adapter = createSurfaceImprovementAdapter({
      surfaces: baseSurfaces,
      repoRoot: tmpRoot,
      draftPatch: fn,
    })
    const { edits } = await adapter.proposeFromFindings([f('f1', 'system-prompt:intake')])
    expect(edits[0]!.baseSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('records an error when draftPatch throws (no silent skip)', async () => {
    const adapter = createSurfaceImprovementAdapter({
      surfaces: baseSurfaces,
      repoRoot: tmpRoot,
      draftPatch: async () => {
        throw new Error('boom')
      },
    })
    const { edits, errors } = await adapter.proposeFromFindings([f('e', 'system-prompt:intake')])
    expect(edits).toEqual([])
    expect(errors[0]!.message).toMatch(/draftPatch threw: boom/)
  })

  it('skips when draftPatch returns an empty patch', async () => {
    const adapter = createSurfaceImprovementAdapter({
      surfaces: baseSurfaces,
      repoRoot: tmpRoot,
      draftPatch: async () => ({ patch: '', summary: 'no-op', rationale: '' }),
    })
    const { edits, skipped } = await adapter.proposeFromFindings([
      f('np', 'system-prompt:intake'),
    ])
    expect(edits).toEqual([])
    expect(skipped).toBe(1)
  })
})

// ── createSurfaceImprovementAdapter — apply (mode=none) ─────────────

describe('createSurfaceImprovementAdapter — apply', () => {
  const surfaces = {
    systemPrompt: 'prompts',
    tools: 'tools',
    rubric: 'rubric.ts',
    knowledge: '.agent-knowledge',
    personas: 'personas',
  }

  it('mode=none returns a warning and applies nothing', async () => {
    const adapter = createSurfaceImprovementAdapter({
      surfaces,
      repoRoot: tmpRoot,
      draftPatch: async () => ({ patch: 'x', summary: 'y', rationale: 'z' }),
      mode: 'none',
    })
    const r = await adapter.apply!([])
    expect(r.applied).toEqual([])
    expect(r.warnings.join(' ')).toMatch(/mode=none/)
  })

  it('mode=open-pr without ghRepo fails loud (no silent fallback)', async () => {
    const adapter = createSurfaceImprovementAdapter({
      surfaces,
      repoRoot: tmpRoot,
      draftPatch: async () => ({ patch: 'x', summary: 'y', rationale: 'z' }),
      mode: 'open-pr',
    })
    const r = await adapter.apply!([])
    expect(r.applied).toEqual([])
    expect(r.warnings.join(' ')).toMatch(/requires `ghRepo`/)
  })
})

// ── outcome.measureOutcome ──────────────────────────────────────────

describe('measureOutcome', () => {
  it('returns a zero-delta outcome when nothing was applied', async () => {
    const reRun = vi.fn(async () => [{ personaId: 'p1', composite: 0.9 }])
    const enriched = await measureOutcome(
      {
        runId: 'r',
        baselineRunId: null,
        analystResult: {
          run_id: 'r',
          correlation_id: 'c',
          started_at: '',
          ended_at: '',
          findings: [],
          per_analyst: [],
          total_cost_usd: 0,
        },
        diff: null,
        knowledge: null,
        improvement: null,
      },
      {
        baseline: [{ personaId: 'p1', composite: 0.7 }],
        reRunCohort: reRun,
      },
    )
    expect(enriched.outcome.delta).toBe(0)
    expect(reRun).not.toHaveBeenCalled()
  })

  it('re-runs the cohort and computes the score delta when applies occurred', async () => {
    const reRun = vi.fn(async () => [
      { personaId: 'p1', composite: 0.85 },
      { personaId: 'p2', composite: 0.95 },
    ])
    const enriched = await measureOutcome(
      {
        runId: 'r',
        baselineRunId: null,
        analystResult: {
          run_id: 'r',
          correlation_id: 'c',
          started_at: '',
          ended_at: '',
          findings: [],
          per_analyst: [],
          total_cost_usd: 0,
        },
        diff: null,
        knowledge: {
          proposals: [],
          applied: ['knowledge/foo.md'],
          skipped: 0,
          errors: [],
          withheld_for_review: 0,
        },
        improvement: null,
      },
      {
        baseline: [
          { personaId: 'p1', composite: 0.7 },
          { personaId: 'p2', composite: 0.8 },
        ],
        reRunCohort: reRun,
      },
    )
    expect(reRun).toHaveBeenCalledOnce()
    expect(enriched.outcome.baselineComposite).toBeCloseTo(0.75)
    expect(enriched.outcome.afterComposite).toBeCloseTo(0.9)
    expect(enriched.outcome.delta).toBeCloseTo(0.15)
    expect(enriched.outcome.perPersona).toHaveLength(2)
    expect(enriched.outcome.rolledBackPaths).toEqual([])
  })

  it('rolls back applied paths on regression when rollbackOnRegression is set', async () => {
    const reRun = async () => [{ personaId: 'p1', composite: 0.5 }]
    const revert = vi.fn(async () => {})
    const enriched = await measureOutcome(
      {
        runId: 'r',
        baselineRunId: null,
        analystResult: {
          run_id: 'r',
          correlation_id: 'c',
          started_at: '',
          ended_at: '',
          findings: [],
          per_analyst: [],
          total_cost_usd: 0,
        },
        diff: null,
        knowledge: {
          proposals: [],
          applied: ['knowledge/foo.md'],
          skipped: 0,
          errors: [],
          withheld_for_review: 0,
        },
        improvement: null,
      },
      {
        baseline: [{ personaId: 'p1', composite: 0.8 }],
        reRunCohort: reRun,
        rollbackOnRegression: true,
        revert,
      },
    )
    expect(enriched.outcome.delta).toBeLessThan(0)
    expect(revert).toHaveBeenCalledWith(['knowledge/foo.md'])
    expect(enriched.outcome.rolledBackPaths).toEqual(['knowledge/foo.md'])
  })
})

// ── validateSurfaces direct ─────────────────────────────────────────

describe('validateSurfaces', () => {
  it('flags every missing required surface (not first-fail)', () => {
    const issues = validateSurfaces(
      {
        systemPrompt: 'nope',
        tools: 'nada',
        rubric: 'rubric.ts',
        knowledge: '.agent-knowledge',
        personas: 'personas',
      },
      tmpRoot,
    )
    expect(issues.map((i) => i.surface).sort()).toEqual(['systemPrompt', 'tools'])
  })

  it('flags an optional surface only when explicitly declared but missing', () => {
    const ok = validateSurfaces(
      {
        systemPrompt: 'prompts',
        tools: 'tools',
        rubric: 'rubric.ts',
        knowledge: '.agent-knowledge',
        personas: 'personas',
        // rag undefined → not flagged
      },
      tmpRoot,
    )
    expect(ok).toEqual([])

    const flagged = validateSurfaces(
      {
        systemPrompt: 'prompts',
        tools: 'tools',
        rubric: 'rubric.ts',
        knowledge: '.agent-knowledge',
        personas: 'personas',
        rag: 'rag', // explicitly declared but absent
      },
      tmpRoot,
    )
    expect(flagged).toHaveLength(1)
    expect(flagged[0]!.surface).toBe('rag')
  })
})
