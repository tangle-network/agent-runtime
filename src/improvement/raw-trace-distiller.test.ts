/**
 * `rawTraceDistiller` proof — the meta-harness edge.
 *
 * The guarantee this guards: the raw-trace `analyzeGeneration` producer does NOT
 * pre-summarize a generation's failures — it points the coding-agent proposer at
 * the ACTUAL run-trace files on disk (per-cell spans.jsonl + cached-result.json +
 * artifacts under the durable runDir) with a grep/cat-to-diagnose instruction. We
 * build a real tmp runDir with fake candidate + trace files, call the factory, and
 * assert the emitted findings reference those real absolute paths + the
 * grep/cat instruction (so the coding harness, running from a worktree cwd, can
 * open them).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rawTraceDistiller } from './raw-trace-distiller'

/** Minimal shape the factory reads — cast once to the analyzeGeneration input. */
type AnalyzeInput = Parameters<ReturnType<typeof rawTraceDistiller>>[0]

/** Write `<campaignDir>/<sanitizedCellId>/{spans.jsonl,cached-result.json,extra}`
 *  the way agent-eval's campaign executor does, and return the file paths. */
function writeCellTrace(
  campaignDir: string,
  cellId: string,
  opts: { spans: string; result: unknown; extraArtifact?: { name: string; body: string } },
): { cellDir: string; spansPath: string; resultPath: string; artifactPath?: string } {
  const cellDir = join(campaignDir, cellId.replace(/[^a-zA-Z0-9_-]/g, '_'))
  mkdirSync(cellDir, { recursive: true })
  const spansPath = join(cellDir, 'spans.jsonl')
  const resultPath = join(cellDir, 'cached-result.json')
  writeFileSync(spansPath, opts.spans)
  writeFileSync(resultPath, JSON.stringify(opts.result))
  let artifactPath: string | undefined
  if (opts.extraArtifact) {
    artifactPath = join(cellDir, opts.extraArtifact.name)
    writeFileSync(artifactPath, opts.extraArtifact.body)
  }
  return { cellDir, spansPath, resultPath, artifactPath }
}

describe('rawTraceDistiller', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'raw-trace-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('points the proposer at the real trace-file paths + a grep/cat instruction', async () => {
    const genRoot = join(root, 'gen-0')
    const cand0Dir = join(genRoot, 'candidate-0')
    const cand1Dir = join(genRoot, 'candidate-1')

    // Candidate 0: the worst — a failing cell with a distinctive error in its trace.
    const c0 = writeCellTrace(cand0Dir, 'crack-7z-hash:0', {
      spans: '{"name":"agent.run","error":"exit code 1: hashcat not found"}\n',
      result: { cellId: 'crack-7z-hash:0', composite: 0 },
      extraArtifact: { name: 'agent-output.txt', body: 'command failed\n' },
    })
    // Candidate 1: a milder failure.
    const c1 = writeCellTrace(cand1Dir, 'build-project:0', {
      spans: '{"name":"agent.run","note":"partial credit"}\n',
      result: { cellId: 'build-project:0', composite: 0.4 },
    })

    const input: AnalyzeInput = {
      generation: 0,
      runDir: genRoot,
      candidates: [
        {
          surfaceHash: 'cand0hash',
          composite: 0.0,
          campaign: {
            runDir: cand0Dir,
            cells: [
              {
                cellId: 'crack-7z-hash:0',
                scenarioId: 'crack-7z-hash',
                error: 'exit code 1: hashcat not found',
                judgeScores: { j: { composite: 0 } },
              },
            ],
            artifactsByPath: { 'crack-7z-hash:0/agent-output.txt': c0.artifactPath! },
          },
        },
        {
          surfaceHash: 'cand1hash',
          composite: 0.4,
          campaign: {
            runDir: cand1Dir,
            cells: [
              {
                cellId: 'build-project:0',
                scenarioId: 'build-project',
                judgeScores: { j: { composite: 0.4 } },
              },
            ],
          },
        },
      ],
      history: [],
    } as unknown as AnalyzeInput

    const findings = await rawTraceDistiller()(input)
    const blob = JSON.stringify(findings)

    // 1. Non-empty structured findings, each renderable through the proposer prompt
    //    (defaultBuildPrompt reads severity + claim + recommended_action).
    expect(Array.isArray(findings)).toBe(true)
    expect(findings.length).toBeGreaterThanOrEqual(2)
    for (const f of findings as Array<Record<string, unknown>>) {
      expect(typeof f.claim).toBe('string')
      expect(typeof f.recommended_action).toBe('string')
      expect(typeof f.severity).toBe('string')
    }

    // 2. The findings reference the ACTUAL absolute trace-file paths on disk.
    expect(blob).toContain(resolve(c0.spansPath))
    expect(blob).toContain(resolve(c0.resultPath))
    expect(blob).toContain(resolve(c0.artifactPath!))
    expect(blob).toContain(resolve(c1.spansPath))
    // …and the candidate/gen directories, so the agent can ls/grep -r them.
    expect(blob).toContain(resolve(cand0Dir))
    expect(blob).toContain(resolve(genRoot))

    // 3. The grep/cat-to-diagnose instruction — the meta-harness recipe, not a digest.
    expect(blob.toLowerCase()).toContain('grep')
    expect(blob.toLowerCase()).toContain('cat')
    const leader = findings[0] as Record<string, unknown>
    expect(String(leader.recommended_action)).toMatch(/do not rely on a pre-summarized finding/i)

    // 4. Worst candidate first (composite 0 before 0.4), and paths are absolute.
    const cand0Finding = (findings as Array<Record<string, unknown>>).find(
      (f) => f.subject === 'cand0hash',
    )!
    expect(cand0Finding).toBeDefined()
    const meta = cand0Finding.metadata as { cells: Array<{ files: string[] }> }
    expect(meta.cells[0]!.files.every((p) => p.startsWith('/'))).toBe(true)
    expect(meta.cells[0]!.files).toContain(resolve(c0.spansPath))
  })

  it('uses input.runDir when no override is given and resolves relative dirs to absolute', async () => {
    const genRoot = join(root, 'gen-3')
    const candDir = join(genRoot, 'candidate-0')
    const c = writeCellTrace(candDir, 's:0', {
      spans: '{"error":"boom"}\n',
      result: { composite: 0 },
    })
    const input = {
      generation: 3,
      runDir: genRoot,
      candidates: [
        {
          surfaceHash: 'h',
          composite: 0,
          campaign: {
            runDir: candDir,
            cells: [{ cellId: 's:0', scenarioId: 's', judgeScores: { j: { composite: 0 } } }],
          },
        },
      ],
      history: [],
    } as unknown as AnalyzeInput

    const findings = await rawTraceDistiller()(input)
    expect(JSON.stringify(findings)).toContain(resolve(c.spansPath))
  })

  it('keeps an unscored candidate explicit instead of treating it as zero', async () => {
    const genRoot = join(root, 'gen-unscored')
    const candidateDir = join(genRoot, 'candidate-0')
    const scoredDir = join(genRoot, 'candidate-1')
    writeCellTrace(candidateDir, 'failed:0', {
      spans: '{"error":"score unavailable"}\n',
      result: { composite: null },
    })
    writeCellTrace(scoredDir, 'scored:0', {
      spans: '{"error":"low score"}\n',
      result: { composite: 0.3 },
    })
    const input = {
      generation: 1,
      runDir: genRoot,
      candidates: [
        {
          surfaceHash: 'unscored',
          composite: null,
          campaign: {
            runDir: candidateDir,
            cells: [
              {
                cellId: 'failed:0',
                scenarioId: 'failed',
                error: 'score unavailable',
                judgeScores: {},
              },
            ],
          },
        },
        {
          surfaceHash: 'scored',
          composite: 0.3,
          campaign: {
            runDir: scoredDir,
            cells: [
              {
                cellId: 'scored:0',
                scenarioId: 'scored',
                judgeScores: { quality: { composite: 0.3 } },
              },
            ],
          },
        },
      ],
      history: [],
    } as unknown as AnalyzeInput

    const findings = await rawTraceDistiller()(input)
    const candidate = (findings as Array<Record<string, unknown>>).find(
      (finding) => finding.subject === 'unscored',
    )!
    expect(String(candidate.claim)).toContain('has no aggregate score')
    expect((candidate.metadata as { composite: number | null }).composite).toBeNull()
    expect(
      (findings as Array<Record<string, unknown>>).flatMap((finding) =>
        finding.subject === 'scored' || finding.subject === 'unscored' ? [finding.subject] : [],
      ),
    ).toEqual(['scored', 'unscored'])
  })

  it('uses the configured runDir override for generation-level trace anchors', async () => {
    const inputRunDir = join(root, 'input-gen')
    const overrideRunDir = join(root, 'override-gen')
    mkdirSync(overrideRunDir, { recursive: true })
    const input = {
      generation: 9,
      runDir: inputRunDir,
      candidates: [
        {
          surfaceHash: 'perfect',
          composite: 1,
          campaign: {
            runDir: join(root, 'candidate-perfect'),
            cells: [{ cellId: 's:0', scenarioId: 's', judgeScores: { j: { composite: 1 } } }],
          },
        },
      ],
      history: [],
    } as unknown as AnalyzeInput

    const findings = await rawTraceDistiller({ runDir: overrideRunDir })(input)
    const blob = JSON.stringify(findings)
    expect(blob).toContain(resolve(overrideRunDir))
    expect(blob).not.toContain(resolve(inputRunDir))
  })

  it('falls back to the seed findings when a generation has no failing cells', async () => {
    const seed = [{ seed: 'keep-me' }]
    const input = {
      generation: 0,
      runDir: join(root, 'gen-0'),
      candidates: [
        {
          surfaceHash: 'perfect',
          composite: 1,
          campaign: {
            runDir: join(root, 'gen-0', 'candidate-0'),
            cells: [{ cellId: 's:0', scenarioId: 's', judgeScores: { j: { composite: 1 } } }],
          },
        },
      ],
      history: [],
    } as unknown as AnalyzeInput

    const findings = await rawTraceDistiller({ fallbackFindings: seed })(input)
    expect(findings).toEqual(seed)
  })

  it('emits the default raw-trace instruction (not []) when the fallback seed is EMPTY on a clean generation', async () => {
    // The runner passes findings:[] as the seed, so fallbackFindings is []. An
    // empty fallback must NOT wipe the steering context to nothing — it must fall
    // through to the default raw-trace instruction so the meta-harness discipline
    // (and the agenticGenerator diagnosis-evidence gate keyed on the
    // `raw-trace-context` area) stays armed for the next generation.
    const input = {
      generation: 0,
      runDir: join(root, 'gen-0'),
      candidates: [
        {
          surfaceHash: 'perfect',
          composite: 1,
          campaign: {
            runDir: join(root, 'gen-0', 'candidate-0'),
            cells: [{ cellId: 's:0', scenarioId: 's', judgeScores: { j: { composite: 1 } } }],
          },
        },
      ],
      history: [],
    } as unknown as AnalyzeInput

    const findings = await rawTraceDistiller({ fallbackFindings: [] })(input)
    expect(findings).toHaveLength(1)
    expect((findings[0] as unknown as { area: string }).area).toBe('raw-trace-context')
  })
})
