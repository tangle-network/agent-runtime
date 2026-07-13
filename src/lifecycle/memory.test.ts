import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { afterAll, describe, expect, it } from 'vitest'
import { ValidationError } from '../errors'
import { materializeLocalMcp } from '../runtime/stdio-mcp-client'
import { applyArtifact } from './apply'
import type { GenerateContext } from './generator'
import {
  CURATED_MEMORY_BLOCK_END,
  CURATED_MEMORY_BLOCK_START,
  lessonsFromCuratedSurface,
  memoryArtifactFromCuratedSurface,
  memoryArtifactFromLessons,
  memoryGenerator,
  memoryMcpServer,
  memoryOfProfile,
  profileMemoryMetadataKey,
  readMemoryItemsFile,
} from './memory'
import type { ProfileArtifact } from './types'

const tmp = mkdtempSync(join(tmpdir(), 'lifecycle-memory-test-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const LESSONS = [
  'Always reproduce the failing test before editing the fix',
  'Read the full traceback before guessing the module',
]

const asArtifact = (input: ReturnType<typeof memoryArtifactFromLessons>): ProfileArtifact => ({
  ...input,
  id: input.key ?? 'memory',
  status: 'candidate',
})

describe('memoryArtifactFromLessons', () => {
  it('builds an inline-items memory artifact with content-addressed ids', () => {
    const a = memoryArtifactFromLessons(LESSONS)
    expect(a.kind).toBe('memory')
    const items = a.payload.spec.items ?? []
    expect(items).toHaveLength(2)
    expect(items[0]?.id).toMatch(/^mem-[0-9a-f]{12}$/)
    // Content-addressed: the same lesson always earns the same id.
    expect(memoryArtifactFromLessons(LESSONS).payload.spec.items?.[0]?.id).toBe(items[0]?.id)
  })

  it('dedupes near-identical lessons and throws on zero usable ones', () => {
    const a = memoryArtifactFromLessons(['  Do X.  ', 'do x', ''])
    expect(a.payload.spec.items).toHaveLength(1)
    expect(() => memoryArtifactFromLessons(['', '   '])).toThrow(ValidationError)
  })

  it('writes a durable JSONL store when storePath is given', () => {
    const storePath = join(tmp, 'store', 'memory.jsonl')
    const a = memoryArtifactFromLessons(LESSONS, { storePath })
    expect(a.payload.spec.path).toBe(storePath)
    expect(a.payload.spec.items).toBeUndefined()
    expect(readMemoryItemsFile(storePath).map((i) => i.text)).toEqual(LESSONS)
  })
})

describe('lessonsFromCuratedSurface (the memoryCurationProposer seam)', () => {
  it('parses the exact block shape the proposer emits', () => {
    const surface = [
      'You are a coding agent.',
      '',
      CURATED_MEMORY_BLOCK_START,
      '## Learned from prior runs (curated memory)',
      `- ${LESSONS[0]}`,
      `- ${LESSONS[1]}`,
      CURATED_MEMORY_BLOCK_END,
      '',
    ].join('\n')
    expect(lessonsFromCuratedSurface(surface)).toEqual(LESSONS)
    const a = memoryArtifactFromCuratedSurface(surface)
    expect(a?.payload.spec.items?.map((i) => i.text)).toEqual(LESSONS)
  })

  it('returns [] / undefined on a surface with no block (gen 0)', () => {
    expect(lessonsFromCuratedSurface('plain prompt')).toEqual([])
    expect(memoryArtifactFromCuratedSurface('plain prompt')).toBeUndefined()
  })
})

describe('applyArtifact(memory)', () => {
  it('mounts the typed spec on metadata.memory AND a live stdio server on mcp', () => {
    const base: AgentProfile = { name: 'agent', metadata: { keep: 1 } }
    const out = applyArtifact(base, asArtifact(memoryArtifactFromLessons(LESSONS)))
    // The local extension (published AgentProfile has no memory field).
    const spec = memoryOfProfile(out)
    expect(spec?.store).toBe('file')
    expect(spec?.items).toHaveLength(2)
    expect(out.metadata?.keep).toBe(1)
    // The LIVE mount: a stdio entry the same-host client can boot.
    const server = out.mcp?.memory
    expect(server?.transport).toBe('stdio')
    expect(server?.enabled).toBe(true)
    expect(server?.env?.AGENT_MEMORY_ITEMS).toContain(LESSONS[0])
    // Base untouched.
    expect(base.metadata).toEqual({ keep: 1 })
    expect(base.mcp).toBeUndefined()
  })

  it("store 'mcp' mounts the external server verbatim (enabled defaulted)", () => {
    const external = { transport: 'stdio' as const, command: 'my-memory-server' }
    const out = applyArtifact(
      {},
      {
        id: 'memory',
        kind: 'memory',
        name: 'external',
        status: 'candidate',
        payload: { spec: { store: 'mcp', server: external } },
      },
    )
    expect(out.mcp?.memory).toEqual({ ...external, enabled: true })
  })

  it('memoryOfProfile is undefined without memory and throws on a malformed spec', () => {
    expect(memoryOfProfile({})).toBeUndefined()
    expect(() =>
      memoryOfProfile({ metadata: { [profileMemoryMetadataKey]: 'not-a-spec' } }),
    ).toThrow(ValidationError)
    expect(() =>
      memoryOfProfile({ metadata: { [profileMemoryMetadataKey]: { store: 'file' } } }),
    ).toThrow(/path.*items/)
  })

  it('refuses inline items past the env-string cap, naming the file-store fix', () => {
    const huge = [`unique prefix ${'x'.repeat(120_000)}`]
    expect(() =>
      memoryMcpServer({
        store: 'file',
        items: memoryArtifactFromLessons(huge).payload.spec.items ?? [],
      }),
    ).toThrow(/writeMemoryStore/)
  })
})

describe('memoryGenerator', () => {
  const finding = (claim: string, extra: Record<string, unknown> = {}) => ({
    schema_version: '1.0.0' as const,
    finding_id: `f-${claim.slice(0, 8)}`,
    analyst_id: 'failure-mode',
    produced_at: new Date().toISOString(),
    severity: 'medium' as const,
    area: 'agent-reasoning',
    claim,
    evidence_refs: [],
    confidence: 0.8,
    ...extra,
  })
  const ctx = (over: Partial<GenerateContext>): GenerateContext => ({
    baseline: {},
    domain: 'swe',
    findings: [],
    ...over,
  })

  it('curates findings into ONE inline memory candidate, preferring recommended_action', async () => {
    const out = await memoryGenerator().generate(
      ctx({
        findings: [
          finding('agent guessed the module path', {
            recommended_action: 'Read the traceback before editing',
          }),
          finding('tests were never run'),
        ],
      }),
    )
    expect(out).toHaveLength(1)
    expect(out[0]?.payload.spec.items?.map((i) => i.text)).toEqual([
      'Read the traceback before editing',
      'tests were never run',
    ])
  })

  it('drops judge-derived findings (the firewall) and returns [] with nothing left', async () => {
    const out = await memoryGenerator().generate(
      ctx({ findings: [finding('judge said so', { derived_from_judge: true })] }),
    )
    expect(out).toEqual([])
  })

  it('accumulates the baseline memory and skips a no-change generation', async () => {
    const baseline = applyArtifact({}, asArtifact(memoryArtifactFromLessons(LESSONS)))
    // Same lessons re-observed → curated set == carried set → no candidate.
    const unchanged = await memoryGenerator().generate(
      ctx({ baseline, findings: [finding(LESSONS[0] as string)] }),
    )
    expect(unchanged).toEqual([])
    // A genuinely new lesson → one candidate carrying old + new.
    const grown = await memoryGenerator().generate(
      ctx({ baseline, findings: [finding('Pin the schema version before migrating')] }),
    )
    expect(grown).toHaveLength(1)
    const texts = grown[0]?.payload.spec.items?.map((i) => i.text) ?? []
    expect(texts).toContain('Pin the schema version before migrating')
    for (const lesson of LESSONS) expect(texts).toContain(lesson)
  })

  it('caps at maxLessons by recurrence', async () => {
    const out = await memoryGenerator({ maxLessons: 1 }).generate(
      ctx({
        findings: [finding('repeated lesson'), finding('repeated lesson'), finding('one-off')],
      }),
    )
    expect(out[0]?.payload.spec.items?.map((i) => i.text)).toEqual(['repeated lesson'])
  })
})

describe('live same-host boot (the Phase-5 smoke)', () => {
  it('apply memory artifact → materializeLocalMcp boots the bin → memory_search returns the seeded lesson', {
    timeout: 60_000,
  }, async () => {
    const logPath = join(tmp, 'live', 'retrieval.jsonl')
    const profile = applyArtifact({}, asArtifact(memoryArtifactFromLessons(LESSONS, { logPath })))
    // The SAME path sweEvalRunner({ materializeMcp: true }) runs during a
    // scored eval: spawn every profile.mcp stdio server next to the worker.
    const mat = await materializeLocalMcp(profile)
    try {
      expect(mat.tools.map((t) => t.function.name)).toEqual([
        'memory__memory_search',
        'memory__memory_get',
      ])
      const hit = await mat.call('memory__memory_search', { query: 'reproduce failing test' })
      expect(hit).toContain(LESSONS[0])
      // The retrieval log captured the live query (the RetrievalHoldout seam).
      const rows = readFileSync(logPath, 'utf8').trim().split('\n')
      expect(rows).toHaveLength(1)
      expect(JSON.parse(rows[0] as string).query).toBe('reproduce failing test')
    } finally {
      await mat.close()
    }
  })
})
