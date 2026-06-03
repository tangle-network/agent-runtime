import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  appendFindings,
  initAuditWorkspace,
  readAuditRegistry,
  registerCaptures,
  summarizeRegistry,
  writeAuditIndex,
} from '../../src/audit'
import type { UiFinding } from '../../src/profiles/ui-auditor/substrate'

let workspaceDir: string

beforeEach(async () => {
  workspaceDir = await fs.mkdtemp(path.join(tmpdir(), 'ui-audit-writer-'))
})

afterEach(async () => {
  await fs.rm(workspaceDir, { recursive: true, force: true })
})

function finding(overrides: Partial<UiFinding> = {}): UiFinding {
  return {
    title: 'Inconsistent button heights on home page',
    lens: 'consistency',
    severity: 'med',
    route: 'home',
    url: 'https://example.com',
    viewport: '1280x800',
    selector: '.btn-primary',
    observation: 'Two primary buttons render at different heights on the same page.',
    impact: 'Visual rhythm wobbles card-to-card.',
    suggestedFix: 'Consolidate to one variant token.',
    screenshots: [
      { path: 'screenshots/home--1280x800--a.png', viewport: '1280x800' },
      { path: 'screenshots/home--1280x800--b.png', viewport: '1280x800' },
    ],
    tags: ['nav', 'header'],
    ...overrides,
  }
}

describe('initAuditWorkspace', () => {
  it('creates the issues + screenshots dirs and a fresh registry', async () => {
    await initAuditWorkspace(workspaceDir)
    const reg = await readAuditRegistry(workspaceDir)
    expect(reg.schemaVersion).toBe(1)
    expect(reg.findings).toEqual([])
    expect(reg.routes).toEqual({})
    const issuesStat = await fs.stat(path.join(workspaceDir, 'issues'))
    expect(issuesStat.isDirectory()).toBe(true)
  })

  it('is idempotent', async () => {
    await initAuditWorkspace(workspaceDir)
    await appendFindings(workspaceDir, [finding()])
    await initAuditWorkspace(workspaceDir)
    const reg = await readAuditRegistry(workspaceDir)
    expect(reg.findings).toHaveLength(1)
  })
})

describe('appendFindings', () => {
  it('assigns monotonic ids and writes self-contained Markdown', async () => {
    const result = await appendFindings(workspaceDir, [
      finding(),
      finding({ title: 'Weak hierarchy in hero', lens: 'hierarchy', severity: 'high' }),
    ])
    expect(result.written.map((f) => f.id)).toEqual([1, 2])

    const f1Body = await fs.readFile(path.join(workspaceDir, result.files[0] ?? ''), 'utf8')
    expect(f1Body).toMatch(/# \[UI\] Inconsistent button heights on home page/)
    expect(f1Body).toMatch(/Issue #001/)
    expect(f1Body).toMatch(/Severity:\*\* med/)
    expect(f1Body).toMatch(/Lens:\*\* consistency/)
    expect(f1Body).toMatch(
      /!\[home--1280x800--a\.png\]\(\.\.\/screenshots\/home--1280x800--a\.png\)/,
    )
    expect(f1Body).toMatch(
      /!\[home--1280x800--b\.png\]\(\.\.\/screenshots\/home--1280x800--b\.png\)/,
    )

    const f2Body = await fs.readFile(path.join(workspaceDir, result.files[1] ?? ''), 'utf8')
    expect(f2Body).toMatch(/Issue #002/)

    const reg = await readAuditRegistry(workspaceDir)
    expect(reg.findings).toHaveLength(2)
    expect(reg.findings[0]?.createdAt).toBeTruthy()
  })

  it('rejects an incoming finding whose id collides with the registry', async () => {
    await appendFindings(workspaceDir, [finding()])
    await expect(
      appendFindings(workspaceDir, [finding({ id: 1, title: 'Other thing' })]),
    ).rejects.toThrow(/collides/)
  })

  it('throws when a finding has no screenshots', async () => {
    await expect(appendFindings(workspaceDir, [finding({ screenshots: [] })])).rejects.toThrow(
      /screenshots must be a non-empty array/,
    )
  })

  it('rejects invalid lens at the public boundary (path-traversal defense)', async () => {
    await expect(
      appendFindings(workspaceDir, [
        finding({ lens: '../../etc' as unknown as UiFinding['lens'] }),
      ]),
    ).rejects.toThrow(/invalid lens/)
    // The malicious file must not have been written.
    const issuesDir = path.join(workspaceDir, 'issues')
    const entries = await fs.readdir(issuesDir).catch(() => [])
    expect(entries).toHaveLength(0)
  })

  it('rejects invalid severity', async () => {
    await expect(
      appendFindings(workspaceDir, [
        finding({ severity: 'nuclear' as unknown as UiFinding['severity'] }),
      ]),
    ).rejects.toThrow(/invalid severity/)
  })

  it('rejects empty required string fields', async () => {
    for (const field of ['title', 'route', 'observation', 'impact', 'suggestedFix'] as const) {
      await expect(
        appendFindings(workspaceDir, [
          finding({ [field]: '   ' } as unknown as Partial<UiFinding>),
        ]),
      ).rejects.toThrow(new RegExp(`${field} must be a non-empty string`))
    }
  })

  it('serialises concurrent calls and assigns distinct monotonic ids', async () => {
    const batchA = [finding({ title: 'A1' }), finding({ title: 'A2' })]
    const batchB = [finding({ title: 'B1' }), finding({ title: 'B2' })]
    const [resA, resB] = await Promise.all([
      appendFindings(workspaceDir, batchA),
      appendFindings(workspaceDir, batchB),
    ])
    const ids = [...resA.written, ...resB.written].map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    const reg = await readAuditRegistry(workspaceDir)
    expect(reg.findings).toHaveLength(4)
    const regIds = reg.findings.map((f) => f.id)
    expect([...regIds].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 2, 3, 4])
  })

  it('uses an atomic registry write — no `.tmp` leftover after success', async () => {
    await appendFindings(workspaceDir, [finding()])
    const entries = await fs.readdir(workspaceDir)
    expect(entries.some((e) => e.startsWith('registry.json.tmp-'))).toBe(false)
    expect(entries).toContain('registry.json')
  })

  it('rejects relative workspaceDir at the public boundary', async () => {
    for (const dir of ['relative', './foo', '../foo']) {
      await expect(appendFindings(dir, [finding()])).rejects.toThrow(/must be an absolute path/)
    }
  })

  it("rejects workspaceDir containing '..' segments", async () => {
    for (const dir of ['/tmp/../etc', '/var/../etc/audits']) {
      await expect(appendFindings(dir, [finding()])).rejects.toThrow(
        /must not contain '\.\.' segments/,
      )
    }
  })

  it("rejects screenshot paths containing '..' segments", async () => {
    await expect(
      appendFindings(workspaceDir, [finding({ screenshots: [{ path: '../../../etc/passwd' }] })]),
    ).rejects.toThrow(/screenshots\[0\]\.path must not contain '\.\.' segments/)
  })

  it('encodes blockquote meta lines on every line so the GitHub preview holds together', async () => {
    const result = await appendFindings(workspaceDir, [finding()])
    const body = await fs.readFile(path.join(workspaceDir, result.files[0] ?? ''), 'utf8')
    const block = body.split('\n').filter((l) => l.startsWith('> '))
    expect(block.length).toBeGreaterThanOrEqual(5)
    // Every meta line should be inside a single blockquote — assert that the
    // header section between the title and the first H2 is all blockquoted.
    const lines = body.split('\n')
    const startIdx = lines.findIndex((l) => l.startsWith('> '))
    const endIdx = lines.findIndex((l) => l.startsWith('## '))
    expect(endIdx).toBeGreaterThan(startIdx)
    for (let i = startIdx; i < endIdx; i += 1) {
      const line = lines[i] ?? ''
      // Within the blockquote, only `> ` lines and blank lines are allowed.
      expect(line === '' || line.startsWith('> ')).toBe(true)
    }
  })
})

describe('registerCaptures + summarizeRegistry + writeAuditIndex', () => {
  it('summarizes by severity / lens / route and writes a sortable index', async () => {
    await appendFindings(workspaceDir, [
      finding({ severity: 'critical', lens: 'accessibility', route: 'home' }),
      finding({ severity: 'high', lens: 'hierarchy', route: 'home' }),
      finding({ severity: 'med', lens: 'consistency', route: 'settings' }),
    ])
    await registerCaptures(workspaceDir, {
      route: 'home',
      url: 'https://example.com',
      captures: [
        {
          file: 'screenshots/home--1280x800--a.png',
          viewport: '1280x800',
          fullPage: false,
          capturedAt: '2026-06-02T00:00:00.000Z',
        },
      ],
    })
    const reg = await readAuditRegistry(workspaceDir)
    const sum = summarizeRegistry(reg)
    expect(sum.total).toBe(3)
    expect(sum.bySeverity).toEqual({ critical: 1, high: 1, med: 1, low: 0 })
    expect(sum.byLens).toEqual({ accessibility: 1, hierarchy: 1, consistency: 1 })
    expect(sum.byRoute).toEqual({ home: 2, settings: 1 })
    expect(reg.routes.home?.captures).toHaveLength(1)

    const indexPath = await writeAuditIndex(workspaceDir)
    const body = await fs.readFile(indexPath, 'utf8')
    // Critical sorts before high before med.
    const critIdx = body.indexOf('critical')
    const highIdx = body.indexOf('high')
    const medIdx = body.indexOf('med')
    expect(critIdx).toBeGreaterThan(-1)
    expect(highIdx).toBeGreaterThan(critIdx)
    expect(medIdx).toBeGreaterThan(highIdx)
  })
})
