import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectAgentRun } from '../src/agent/environment-act'
import {
  createSurfaceImprovementProposer,
  type DraftPatchInput,
  type DraftPatchOutput,
} from '../src/agent/improvement-adapter'
import { resolveSubjectPath, validateImprovementPaths } from '../src/agent/improvement-paths'

// ── helpers ─────────────────────────────────────────────────────────

function makeAgentTree(root: string): void {
  mkdirSync(join(root, 'prompts'), { recursive: true })
  writeFileSync(join(root, 'prompts/intake.md'), '# intake\n\nOriginal intake section.\n')
  mkdirSync(join(root, 'tools/list_invoices'), { recursive: true })
  writeFileSync(join(root, 'tools/list_invoices/README.md'), '# list_invoices\n')
  mkdirSync(join(root, '.agent-knowledge'), { recursive: true })
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

// ── resolveSubjectPath ──────────────────────────────────────────────

describe('resolveSubjectPath', () => {
  const paths = {
    systemPrompt: 'prompts',
    tools: 'tools',
    knowledge: '.agent-knowledge',
    rag: 'rag',
    skills: 'skills',
    mcp: 'mcp',
    hooks: 'hooks',
    subagents: 'agents',
    workflows: 'workflows',
    rolloutPolicy: 'rollout-policy.json',
    agentProfile: 'agent-profile.json',
    code: 'src',
  }

  it('routes a system-prompt subject to its declared prompt directory', () => {
    const r = resolveSubjectPath({ kind: 'system-prompt', section: 'intake' }, paths, tmpRoot)
    expect(r?.declaredPath).toBe('prompts/intake.md')
    expect(r?.exists).toBe(true)
    expect(r?.intent).toBe('edit-existing')
  })

  it('routes system-prompt to create-new when the file does not exist', () => {
    const r = resolveSubjectPath({ kind: 'system-prompt', section: 'new-section' }, paths, tmpRoot)
    expect(r?.intent).toBe('create-new')
    expect(r?.exists).toBe(false)
  })

  it('routes tool-doc with aspect to <tools>/<tool>/<aspect>.md', () => {
    const r = resolveSubjectPath(
      { kind: 'tool-doc', tool: 'list_invoices', aspect: 'examples' },
      paths,
      tmpRoot,
    )
    expect(r?.declaredPath).toBe('tools/list_invoices/examples.md')
  })

  it.each([
    [{ kind: 'skill', name: 'linear-close' } as const, 'skills/linear-close/SKILL.md'],
    [
      { kind: 'mcp', server: 'linear', tool: 'update_issue' } as const,
      'mcp/linear/update_issue.md',
    ],
    [{ kind: 'hook', name: 'pre-dispatch' } as const, 'hooks/pre-dispatch.md'],
    [{ kind: 'subagent', name: 'reviewer' } as const, 'agents/reviewer.md'],
    [{ kind: 'workflow', name: 'linear-task' } as const, 'workflows/linear-task.md'],
    [{ kind: 'rollout-policy', field: 'k' } as const, 'rollout-policy.json'],
    [{ kind: 'agent-profile', field: 'prompt.systemPrompt' } as const, 'agent-profile.json'],
    [{ kind: 'code', path: 'workers/dispatch.ts' } as const, 'src/workers/dispatch.ts'],
  ])('routes the %s finding to its declared surface', (subject, expected) => {
    expect(resolveSubjectPath(subject, paths, tmpRoot)?.declaredPath).toBe(expected)
  })

  it('rejects a code finding that escapes its declared source root', () => {
    expect(
      resolveSubjectPath({ kind: 'code', path: '../../secrets.env' }, paths, tmpRoot),
    ).toBeNull()
  })

  it('rejects raw-knowledge and RAG findings that escape their declared roots', () => {
    expect(
      resolveSubjectPath({ kind: 'knowledge.raw', sourceId: '../../secrets' }, paths, tmpRoot),
    ).toBeNull()
    expect(
      resolveSubjectPath({ kind: 'rag', corpus: 'irs', docId: '../../secrets' }, paths, tmpRoot),
    ).toBeNull()
  })

  it('rejects traversal in every profile surface derived from findings', () => {
    const escaped = [
      { kind: 'skill', name: '../secrets' } as const,
      { kind: 'tool-doc', tool: '../secrets' } as const,
      { kind: 'new-tool', name: '../secrets' } as const,
      { kind: 'mcp', server: '../secrets' } as const,
      { kind: 'mcp', server: 'safe', tool: '../../secrets' } as const,
      { kind: 'hook', name: '../secrets' } as const,
      { kind: 'subagent', name: '../secrets' } as const,
      { kind: 'workflow', name: '../secrets' } as const,
      { kind: 'rag', corpus: '../../secrets', docId: 'entry' } as const,
    ]
    for (const subject of escaped) {
      expect(resolveSubjectPath(subject, paths, tmpRoot)).toBeNull()
    }
  })

  it('returns null when subject targets an undeclared optional surface', () => {
    const noRag = { ...paths, rag: undefined }
    const r = resolveSubjectPath({ kind: 'rag', corpus: 'irs', docId: 'foo' }, noRag, tmpRoot)
    expect(r).toBeNull()
  })

  it('returns null for cluster subjects (failure-mode evidence, not mutations)', () => {
    const r = resolveSubjectPath({ kind: 'cluster', label: 'tool-call-loop' }, paths, tmpRoot)
    expect(r).toBeNull()
  })

  it('returns null for websearch.outdated / prior-run-summary (stale signals, no direct file)', () => {
    expect(
      resolveSubjectPath({ kind: 'websearch.outdated', topic: 't' }, paths, tmpRoot),
    ).toBeNull()
    expect(resolveSubjectPath({ kind: 'prior-run-summary', topic: 't' }, paths, tmpRoot)).toBeNull()
  })
})

// ── createSurfaceImprovementProposer — proposeFromFindings ───────────

describe('createSurfaceImprovementProposer — proposeFromFindings', () => {
  const basePaths = {
    systemPrompt: 'prompts',
    tools: 'tools',
    knowledge: '.agent-knowledge',
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
          patch: `--- a/${input.target.declaredPath}\n+++ b/${input.target.declaredPath}\n@@ +1,1 @@\n+drafted\n`,
          summary: `edit ${input.target.declaredPath}`,
          rationale: 'because',
        }
      },
    }
  }

  it('proposes an edit when subject + surface resolve cleanly', async () => {
    const { fn, calls } = mkDraft()
    const adapter = createSurfaceImprovementProposer({
      paths: basePaths,
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
    const adapter = createSurfaceImprovementProposer({
      paths: basePaths,
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
    const adapter = createSurfaceImprovementProposer({
      paths: basePaths,
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
    const adapter = createSurfaceImprovementProposer({
      paths: basePaths,
      repoRoot: tmpRoot,
      draftPatch: fn,
    })
    const { edits, skipped } = await adapter.proposeFromFindings([f('c', 'tool-call-loop')])
    expect(edits).toEqual([])
    expect(skipped).toBe(1)
  })

  it('skips agent-knowledge:* subjects (they route to the KnowledgeProposalSource)', async () => {
    const { fn } = mkDraft()
    const adapter = createSurfaceImprovementProposer({
      paths: basePaths,
      repoRoot: tmpRoot,
      draftPatch: fn,
    })
    const { edits, skipped } = await adapter.proposeFromFindings([
      f('k', 'agent-knowledge:wiki:invoice-shape'),
    ])
    expect(edits).toEqual([])
    expect(skipped).toBe(1)
  })

  it('records an error when subject targets an undeclared improvement path', async () => {
    const { fn } = mkDraft()
    const adapter = createSurfaceImprovementProposer({
      paths: basePaths,
      repoRoot: tmpRoot,
      draftPatch: fn,
    })
    const { edits, errors } = await adapter.proposeFromFindings([
      f('r', 'rag:irs-rulings:rev-rul-2024-12'),
    ])
    expect(edits).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toMatch(/undeclared improvement path/)
  })

  it('records an error when target does not exist for a non-create kind', async () => {
    const { fn } = mkDraft()
    const adapter = createSurfaceImprovementProposer({
      paths: basePaths,
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

  it('binds each patch to the source content for later activation checks', async () => {
    const { fn } = mkDraft()
    const adapter = createSurfaceImprovementProposer({
      paths: basePaths,
      repoRoot: tmpRoot,
      draftPatch: fn,
    })
    const { edits } = await adapter.proposeFromFindings([f('f1', 'system-prompt:intake')])
    expect(edits[0]!.baseSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('records an error when draftPatch throws (no silent skip)', async () => {
    const adapter = createSurfaceImprovementProposer({
      paths: basePaths,
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
    const adapter = createSurfaceImprovementProposer({
      paths: basePaths,
      repoRoot: tmpRoot,
      draftPatch: async () => ({ patch: '', summary: 'no-op', rationale: '' }),
    })
    const { edits, skipped } = await adapter.proposeFromFindings([f('np', 'system-prompt:intake')])
    expect(edits).toEqual([])
    expect(skipped).toBe(1)
  })
})

// ── validateImprovementPaths direct ─────────────────────────────────

describe('validateImprovementPaths', () => {
  it('reports every declared missing path', () => {
    const issues = validateImprovementPaths(
      {
        systemPrompt: 'nope',
        tools: 'nada',
      },
      tmpRoot,
    )
    expect(issues.map((issue) => issue.pathKind).sort()).toEqual(['systemPrompt', 'tools'])
  })

  it('accepts omitted paths and reports only explicitly declared missing paths', () => {
    const ok = validateImprovementPaths(
      {
        systemPrompt: 'prompts',
        tools: 'tools',
        knowledge: '.agent-knowledge',
      },
      tmpRoot,
    )
    expect(ok).toEqual([])

    const flagged = validateImprovementPaths(
      {
        systemPrompt: 'prompts',
        tools: 'tools',
        knowledge: '.agent-knowledge',
        rag: 'rag',
      },
      tmpRoot,
    )
    expect(flagged).toHaveLength(1)
    expect(flagged[0]!.pathKind).toBe('rag')
  })

  it('distinguishes files from directories instead of treating existence as valid', () => {
    writeFileSync(join(tmpRoot, 'not-a-directory'), 'file\n')
    mkdirSync(join(tmpRoot, 'not-a-file'))
    const issues = validateImprovementPaths(
      {
        systemPrompt: 'prompts',
        tools: 'not-a-directory',
        outputSchema: 'not-a-file',
      },
      tmpRoot,
    )
    expect(issues).toEqual([
      { pathKind: 'tools', path: 'not-a-directory', reason: 'not-directory' },
      { pathKind: 'outputSchema', path: 'not-a-file', reason: 'not-file' },
    ])
  })
})

describe('AgentRunInvocation streaming contract', () => {
  it('collectAgentRun drains events AND awaits output', async () => {
    const invocation = {
      events: (async function* yielder() {
        yield { type: 'task_start', task: { id: 't' }, timestamp: 'now' } as never
        yield { type: 'task_end', task: { id: 't' }, ok: true, timestamp: 'now' } as never
      })(),
      output: Promise.resolve({ score: 0.9 }),
    }
    const result = await collectAgentRun(invocation)
    expect(result.events.length).toBe(2)
    expect(result.output).toEqual({ score: 0.9 })
  })

  it('preserves chat-UX streaming — events consumed incrementally', async () => {
    const yielded: string[] = []
    const invocation = {
      events: (async function* tokens() {
        yielded.push('start')
        yield { type: 'task_start', task: { id: 't' }, timestamp: 'now' } as never
        yielded.push('mid')
        yield { type: 'task_end', task: { id: 't' }, ok: true, timestamp: 'now' } as never
        yielded.push('end')
      })(),
      output: Promise.resolve({ score: 1 }),
    }
    for await (const _ev of invocation.events) {
      /* incremental render */
    }
    expect(yielded).toEqual(['start', 'mid', 'end'])
  })
})

describe('multi-candidate path probing', () => {
  it('probes <section>/SKILL.md skill-dir layout when present', () => {
    const surfaces = {
      systemPrompt: 'prompts',
      tools: 'tools',
      rubric: 'rubric.ts',
      knowledge: '.agent-knowledge',
      personas: 'personas',
    }
    mkdirSync(join(tmpRoot, 'prompts/expense-categorization'), { recursive: true })
    writeFileSync(
      join(tmpRoot, 'prompts/expense-categorization/SKILL.md'),
      '# expense-categorization\n',
    )
    const r = resolveSubjectPath(
      { kind: 'system-prompt', section: 'expense-categorization' },
      surfaces,
      tmpRoot,
    )
    expect(r?.declaredPath).toBe('prompts/expense-categorization/SKILL.md')
    expect(r?.intent).toBe('edit-existing')
  })

  it('prefers flat <section>.md when both layouts exist', () => {
    const surfaces = {
      systemPrompt: 'prompts',
      tools: 'tools',
      rubric: 'rubric.ts',
      knowledge: '.agent-knowledge',
      personas: 'personas',
    }
    mkdirSync(join(tmpRoot, 'prompts/both-layouts'), { recursive: true })
    writeFileSync(join(tmpRoot, 'prompts/both-layouts.md'), '# flat\n')
    writeFileSync(join(tmpRoot, 'prompts/both-layouts/SKILL.md'), '# skill\n')
    const r = resolveSubjectPath(
      { kind: 'system-prompt', section: 'both-layouts' },
      surfaces,
      tmpRoot,
    )
    expect(r?.declaredPath).toBe('prompts/both-layouts.md')
  })

  it('falls back to flat tool-doc <tool>.md when <tool>/README.md is absent', () => {
    const surfaces = {
      systemPrompt: 'prompts',
      tools: 'tools',
      rubric: 'rubric.ts',
      knowledge: '.agent-knowledge',
      personas: 'personas',
    }
    writeFileSync(join(tmpRoot, 'tools/flat-tool.md'), '# flat-tool\n')
    const r = resolveSubjectPath({ kind: 'tool-doc', tool: 'flat-tool' }, surfaces, tmpRoot)
    expect(r?.declaredPath).toBe('tools/flat-tool.md')
  })
})
