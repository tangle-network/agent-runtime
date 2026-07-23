/**
 * Gen-5 MAP+TOOLBOX briefing: evidence-index generation (one line per
 * evidence path, private instances excluded, leak guard fail-loud), the
 * toolbox/permission prompt section, and the change-space briefing override.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AUTHOR_BRIEFING_RELPATH,
  AUTHOR_BRIEFING_VERSION,
  briefingPromptSection,
  collectEvidenceIndexRows,
  defaultAuthorBriefing,
  EVIDENCE_INDEX_FILENAME,
  resolveAuthorBriefing,
  writeEvidenceIndex,
} from './briefing.mts'
import { splitInstances } from './score-split.mts'
import { runOk } from './proc.ts'

const SIX = [
  'astropy__astropy-13033',
  'django__django-11532',
  'matplotlib__matplotlib-20826',
  'pydata__xarray-4687',
  'pytest-dev__pytest-6197',
  'sphinx-doc__sphinx-9658',
]

describe('evidence index', () => {
  let root: string
  let outDir: string
  let roundsDir: string
  let priorDir: string
  const split = splitInstances('r4-seed', SIX, 4)
  const publicIid = split.publicInstances[0]!
  const privateIid = split.privateInstances[0]!

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'briefing-'))
    outDir = join(root, 'out')
    roundsDir = join(root, 'rounds')
    priorDir = join(root, 'gen4')
    await mkdir(outDir, { recursive: true })
    await mkdir(roundsDir, { recursive: true })
    await writeFile(join(roundsDir, 'gen-0.jsonl'), '{}\n')
    await writeFile(join(roundsDir, 'round4-summary-r4-x.json'), '{}\n')
    // Seed artifact dirs: one public, one private instance.
    for (const iid of [publicIid, privateIid]) {
      await mkdir(join(root, 'runs', iid, 'SUP4'), { recursive: true })
      await writeFile(join(root, 'patches', `${iid}.sup4.patch`), 'p\n').catch(async () => {
        await mkdir(join(root, 'patches'), { recursive: true })
        await writeFile(join(root, 'patches', `${iid}.sup4.patch`), 'p\n')
      })
    }
    // Prior run outDir with arm-run judge evidence for a public + a private instance.
    for (const iid of [publicIid, privateIid]) {
      const runDir = join(priorDir, 'arm-runs', 'cand111111', 'rep-0', 'runs', iid)
      await mkdir(runDir, { recursive: true })
      await writeFile(join(runDir, 'judge.json'), '{}\n')
    }
    await mkdir(join(priorDir, 'candidates'), { recursive: true })
    await mkdir(join(priorDir, 'proposer-shots'), { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const args = () => ({
    outDir,
    roundsDir,
    seedArtifactRuns: [publicIid, privateIid].map((iid) => ({
      iid,
      arm: 'SUP4',
      dir: join(root, 'runs', iid, 'SUP4'),
      patchPath: join(root, 'patches', `${iid}.sup4.patch`),
    })),
    priorEvidenceDirs: [priorDir],
    paretoParentPatches: [] as Array<{ label: string; path: string }>,
    split,
  })

  it('lists one line per evidence path: staircase, summaries, seed runs, prior arm runs, shot receipts', async () => {
    const { path, rows } = await writeEvidenceIndex(args())
    expect(path).toBe(join(outDir, EVIDENCE_INDEX_FILENAME))
    expect(existsSync(path)).toBe(true)
    const text = await readFile(path, 'utf8')
    expect(text).toContain(join(roundsDir, 'gen-0.jsonl'))
    expect(text).toContain(join(roundsDir, 'round4-summary-r4-x.json'))
    expect(text).toContain(join(root, 'runs', publicIid, 'SUP4'))
    expect(text).toContain(join(root, 'patches', `${publicIid}.sup4.patch`))
    expect(text).toContain(join(priorDir, 'candidates'))
    expect(text).toContain(join(priorDir, 'proposer-shots'))
    expect(text).toContain(join(priorDir, 'arm-runs', 'cand111111', 'rep-0', 'runs', publicIid))
    // One markdown bullet per row.
    expect(text.split('\n').filter((l) => l.startsWith('- ')).length).toBe(rows.length)
  })

  it('NEVER surfaces private instances: no private row, no private id anywhere in the rendered text', async () => {
    const { path, rows } = await writeEvidenceIndex(args())
    const text = await readFile(path, 'utf8')
    for (const iid of split.privateInstances) expect(text).not.toContain(iid)
    expect(rows.every((r) => r.iid === null || !split.privateInstances.includes(r.iid))).toBe(true)
    // The withholding itself is disclosed (count only, no identities).
    expect(text).toContain('2 improvement instance(s) are PRIVATE')
  })

  it('fails loud when a run-level path would leak a private id into the rendered index', async () => {
    const leakPatch = join(outDir, `${privateIid}.parent.patch`)
    await writeFile(leakPatch, 'x\n')
    await expect(
      writeEvidenceIndex({ ...args(), paretoParentPatches: [{ label: 'leaky', path: leakPatch }] }),
    ).rejects.toThrow(/leaked/)
  })

  it('collectEvidenceIndexRows includes everything when no split is configured', async () => {
    const rows = await collectEvidenceIndexRows({ ...args(), split: null })
    const iids = rows.map((r) => r.iid).filter((i): i is string => i !== null)
    expect(iids).toContain(privateIid)
  })
})

describe('briefing text', () => {
  it('default briefing names the toolbox (traces CLI, trace analysts, AxLLM) and grants subagent permission with a budget', () => {
    const text = defaultAuthorBriefing()
    expect(text).toContain('npx --yes @tangle-network/traces@latest')
    expect(text).toContain('agent-eval trace analysts')
    expect(text).toContain('AxLLM')
    expect(text).toContain('spawn your own subagents')
    expect(text).toContain('Research budget')
    expect(text).toContain('ONE input')
    expect(text).toContain(AUTHOR_BRIEFING_RELPATH)
    expect(text).toContain(AUTHOR_BRIEFING_VERSION)
  })

  it('briefingPromptSection leads with the evidence map path', () => {
    const section = briefingPromptSection({
      indexPath: '/tmp/x/evidence-index.md',
      briefingText: defaultAuthorBriefing(),
      briefingSource: 'default',
    })
    expect(section).toContain('EVIDENCE MAP: /tmp/x/evidence-index.md')
    expect(section.indexOf('EVIDENCE MAP')).toBeLessThan(section.indexOf('TOOLBOX'))
  })

  it('resolveAuthorBriefing prefers the change-space file at the ref (authors may rewrite their own briefing)', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'briefing-repo-'))
    try {
      await runOk('git', ['init', '-q', '-b', 'main', repo])
      await runOk('git', ['-C', repo, 'config', 'user.email', 't@t.dev'])
      await runOk('git', ['-C', repo, 'config', 'user.name', 'T'])
      await writeFile(join(repo, 'base.txt'), 'x\n')
      await runOk('git', ['-C', repo, 'add', '-A'])
      await runOk('git', ['-C', repo, 'commit', '-q', '-m', 'init'])

      // No override committed → the versioned default.
      const fallback = await resolveAuthorBriefing(repo, 'main')
      expect(fallback.source).toBe('default')
      expect(fallback.text).toBe(defaultAuthorBriefing())

      // Commit the change-space override → it wins.
      await mkdir(join(repo, 'extensions', 'pi'), { recursive: true })
      await writeFile(join(repo, AUTHOR_BRIEFING_RELPATH), 'MY OWN RESEARCH RULES\n')
      await runOk('git', ['-C', repo, 'add', '-A'])
      await runOk('git', ['-C', repo, 'commit', '-q', '-m', 'briefing override'])
      const override = await resolveAuthorBriefing(repo, 'main')
      expect(override.source).toBe('change-space')
      expect(override.text).toBe('MY OWN RESEARCH RULES\n')
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })
})
