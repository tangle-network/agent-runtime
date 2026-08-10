/**
 * MCAD-CQ adapter tests, in two halves.
 *
 * PURE (no Python anywhere): the prompt mapping — that the CadQuery deliverable
 * replaces v1's OpenSCAD one while the upstream dimensional text stays
 * byte-identical, and that an unrecognised preamble throws instead of shipping a
 * prompt with two contradictory deliverables; interpreter resolution and the
 * fail-loud install message; the ASCII-STL gate; the extra `stepEmitted` check;
 * and `stripCodeFence`, reused from v1.
 *
 * LIVE (gated on the CadQuery interpreter existing): the real judge in BOTH
 * directions. Accept — every calibrated task scores 1.0 on its own gold, STEP
 * included. Reject — four separate failure modes, each isolated so it fails for
 * exactly one reason: one bore deleted (the named probes fail and NOTHING else),
 * no STL written at all, an STL written in binary, and the STEP export removed
 * (which must cost exactly one check). A judge that has only been shown passing
 * inputs is not calibrated, and a new scored check nobody made fail is not tested.
 *
 *   npx vitest run src/benchmarks/mcad-cq.test.mts
 */

import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { stripCodeFence } from './mcad-bench'
import {
  CADQUERY_INSTALL_FIX,
  MCAD_CQ_DELIVERABLE,
  MCAD_CQ_DELIVERABLE_MULTIBODY,
  STEP_MAGIC,
  asciiStlProblem,
  cadqueryMissingError,
  createMcadCqAdapter,
  resolveCadqueryPython,
  runAndMeasureCadQuery,
  toCadQueryPrompt,
  withStepCheck,
} from './mcad-cq-bench'
import { MCAD_CQ_GOLDS, MCAD_CQ_UNCALIBRATED } from './mcad-cq-golds'
import { MCAD_DELIVERABLE, MCAD_DELIVERABLE_MULTIBODY, MCAD_TASKS } from './mcad-tasks'

/** The upstream dimensional text of a v1 task, with its deliverable preamble removed. */
function upstreamBody(prompt: string): string {
  for (const preamble of [MCAD_DELIVERABLE_MULTIBODY, MCAD_DELIVERABLE]) {
    if (prompt.startsWith(preamble)) return prompt.slice(preamble.length)
  }
  throw new Error('fixture: prompt has no known v1 preamble')
}

// ---------------------------------------------------------------------------
// Prompt mapping
// ---------------------------------------------------------------------------

describe('mcad-cq prompt mapping', () => {
  it('swaps the deliverable and keeps the upstream dimensional text byte-identical', () => {
    for (const task of MCAD_TASKS) {
      const mapped = toCadQueryPrompt(task)
      expect(mapped, task.id).toContain('CadQuery')
      expect(mapped, task.id).toContain('part.step')
      expect(mapped, task.id).toContain('part.stl')
      expect(mapped, task.id).toContain('ASCII STL, not binary')
      expect(mapped, task.id).not.toContain('OpenSCAD')
      expect(mapped, task.id).not.toContain('$fn')
      // the tail is v1's, unchanged
      expect(mapped.endsWith(upstreamBody(task.prompt)), task.id).toBe(true)
    }
  })

  it('leaves v1 prompts untouched — the mapping is read-only', () => {
    const before = MCAD_TASKS.map((t) => t.prompt)
    MCAD_TASKS.forEach((t) => toCadQueryPrompt(t))
    expect(MCAD_TASKS.map((t) => t.prompt)).toEqual(before)
    for (const p of before) expect(p).toContain('OpenSCAD')
  })

  it('task 10 keeps the separate-bodies deliverable; every other task keeps one fused solid', () => {
    for (const task of MCAD_TASKS) {
      const mapped = toCadQueryPrompt(task)
      if (task.id === 'planetary-gear-stage') {
        expect(mapped.startsWith(MCAD_CQ_DELIVERABLE_MULTIBODY)).toBe(true)
        expect(mapped).not.toContain('one fused solid')
        expect(mapped).toContain('separate')
      } else {
        expect(mapped.startsWith(MCAD_CQ_DELIVERABLE), task.id).toBe(true)
        expect(mapped, task.id).toContain('one fused solid')
      }
    }
  })

  it('throws rather than guessing when a task carries an unknown preamble', () => {
    expect(() =>
      toCadQueryPrompt({
        id: 'invented',
        prompt: 'Author something in a format nobody registered.\n\nA 10 mm cube.',
        spec: {},
        source: 'none',
        calibrated: false,
      }),
    ).toThrow(/does not open with a known mcad deliverable preamble/)
  })
})

// ---------------------------------------------------------------------------
// Interpreter resolution + fail-loud message
// ---------------------------------------------------------------------------

describe('mcad-cq interpreter resolution', () => {
  it('defaults to the package-owned .venv-cadquery interpreter', () => {
    expect(resolveCadqueryPython({})).toMatch(/\.venv-cadquery\/bin\/python$/)
  })

  it('honours an absolute MCAD_CQ_PYTHON and rejects a relative one', () => {
    expect(resolveCadqueryPython({ MCAD_CQ_PYTHON: '/opt/cq/bin/python' })).toBe('/opt/cq/bin/python')
    expect(() => resolveCadqueryPython({ MCAD_CQ_PYTHON: './cq/bin/python' })).toThrow(/must be an absolute path/)
  })

  it('fails loud with the exact install command and both pins', () => {
    const message = cadqueryMissingError('/nowhere/bin/python').message
    expect(message).toContain('/nowhere/bin/python')
    expect(message).toContain('uv venv --python 3.12 .venv-cadquery')
    expect(message).toContain("uv pip install --python .venv-cadquery/bin/python 'cadquery==2.4.0' 'numpy<2'")
    expect(message).toContain('MCAD_CQ_PYTHON')
    expect(CADQUERY_INSTALL_FIX).toContain('cp313')
    expect(CADQUERY_INSTALL_FIX).toContain('np.bool8')
  })
})

// ---------------------------------------------------------------------------
// Delivery gates (pure)
// ---------------------------------------------------------------------------

describe('mcad-cq delivery gates', () => {
  const ascii = 'solid part\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n  endloop\n endfacet\nendsolid part\n'

  it('accepts a real ASCII STL', () => {
    expect(asciiStlProblem(Buffer.from(ascii))).toBeUndefined()
  })

  it('rejects empty, binary, mis-headed and facet-free files by name', () => {
    expect(asciiStlProblem(Buffer.alloc(0))).toMatch(/is empty/)
    // A binary STL's 80-byte header often begins "solid" too, so the NUL scan decides.
    const binary = Buffer.concat([Buffer.from('solid binary export'.padEnd(80, ' ')), Buffer.alloc(4)])
    expect(asciiStlProblem(binary)).toMatch(/not ASCII/)
    expect(asciiStlProblem(Buffer.from('ISO-10303-21;\nHEADER;\n'))).toMatch(/does not start with "solid"/)
    expect(asciiStlProblem(Buffer.from('solid empty\nendsolid empty\n'))).toMatch(/no "facet normal" records/)
  })

  it('scores stepEmitted as one more check, and it can flip resolved on its own', () => {
    const base = {
      checks: [
        { name: 'bboxX', ok: true, measured: '100', expected: '[99, 101]' },
        { name: 'volume', ok: true, measured: '1', expected: '[0, 2]' },
      ],
      failed: [],
      score: 1,
      resolved: true,
    }
    const withStep = withStepCheck(base, true)
    expect(withStep.checks).toHaveLength(3)
    expect(withStep.score).toBe(1)
    expect(withStep.resolved).toBe(true)

    const without = withStepCheck(base, false)
    expect(without.score).toBeCloseTo(2 / 3, 9)
    expect(without.resolved).toBe(false)
    expect(without.failed.map((c) => c.name)).toEqual(['stepEmitted'])
    expect(without.failed[0]?.expected).toContain(STEP_MAGIC)
  })

  it('strips a markdown fence the model may have wrapped its answer in', () => {
    expect(stripCodeFence('```python\nimport cadquery as cq\n```')).toBe('import cadquery as cq')
    expect(stripCodeFence('```\nimport cadquery as cq\n```')).toBe('import cadquery as cq')
    expect(stripCodeFence('  import cadquery as cq  ')).toBe('import cadquery as cq')
  })
})

// ---------------------------------------------------------------------------
// Loading (pure)
// ---------------------------------------------------------------------------

describe('mcad-cq task loading', () => {
  it('carries spec/source/calibrated metadata and a CadQuery gold for every task', async () => {
    const a = createMcadCqAdapter()
    const tasks = await a.loadTasks()
    expect(tasks).toHaveLength(MCAD_TASKS.length)
    for (const t of tasks) {
      const md = t.metadata as { spec: unknown; source: string; calibrated: boolean }
      expect(md.spec, t.id).toBeTruthy()
      expect(typeof md.source).toBe('string')
      expect(md.calibrated, t.id).toBe(!MCAD_CQ_UNCALIBRATED.has(t.id))
      const gold = await a.goldArtifact(t)
      expect(typeof gold, t.id).toBe('string')
      expect(gold, t.id).toContain('import cadquery as cq')
      expect(gold, t.id).toContain('cq.exporters.export(result, "part.step")')
      expect(gold, t.id).toContain('"ascii": True')
    }
  })

  it('honours ids and limit', async () => {
    const a = createMcadCqAdapter()
    expect((await a.loadTasks({ ids: ['l-bracket'] })).map((t) => t.id)).toEqual(['l-bracket'])
    expect(await a.loadTasks({ limit: 3 })).toHaveLength(3)
  })

  it('scores an empty artifact 0 without starting an interpreter', async () => {
    const a = createMcadCqAdapter()
    const [t] = await a.loadTasks({ ids: ['calibration-block'] })
    const s = await a.judge(t!, '   ')
    expect(s.resolved).toBe(false)
    expect(s.score).toBe(0)
    expect(s.detail).toBe('empty artifact')
  })
})

// ---------------------------------------------------------------------------
// Live judge (needs the CadQuery interpreter)
// ---------------------------------------------------------------------------

function cadqueryPresent(): boolean {
  try {
    return existsSync(resolveCadqueryPython())
  } catch {
    return false
  }
}

const CADQUERY = cadqueryPresent()
const JUDGE_TIMEOUT = 300_000

/** The task-01 gold with ONE of its four bores deleted; everything else identical. */
const BLOCK_MISSING_ONE_BORE = MCAD_CQ_GOLDS['calibration-block']!.replace(
  'for x in (-35, 35) for y in (-20, 20)',
  'for (x, y) in ((-35, 20), (35, -20), (-35, -20))',
)

/** Correct geometry, but the script never writes the mesh the judge grades. */
const STEP_ONLY = `
import cadquery as cq
result = cq.Workplane("XY").box(100, 60, 20, centered=(True, True, False))
cq.exporters.export(result, "part.step")
`

/** Correct geometry, mesh written in BINARY STL — the prompt pins ASCII. */
const BINARY_STL = `
import cadquery as cq
result = cq.Workplane("XY").box(100, 60, 20, centered=(True, True, False))
cq.exporters.export(result, "part.step")
cq.exporters.export(result, "part.stl", exportType="STL", tolerance=0.01, angularTolerance=0.05)
`

/** The task-01 gold with only the STEP export removed. */
const NO_STEP_EXPORT = MCAD_CQ_GOLDS['calibration-block']!.replace('cq.exporters.export(result, "part.step")\n', '')

describe.skipIf(!CADQUERY)('mcad-cq judge, live cadquery', () => {
  it('preflight passes when the interpreter is present', async () => {
    await expect(createMcadCqAdapter().preflight()).resolves.toBeUndefined()
  }, JUDGE_TIMEOUT)

  for (const task of MCAD_TASKS.filter((t) => !MCAD_CQ_UNCALIBRATED.has(t.id))) {
    it(
      `gold for ${task.id} resolves at score 1.0`,
      async () => {
        const a = createMcadCqAdapter()
        const [t] = await a.loadTasks({ ids: [task.id] })
        const gold = await a.goldArtifact(t!)
        expect(typeof gold).toBe('string')
        const s = await a.judge(t!, gold as string)
        const detail = JSON.parse(s.detail ?? '{}')
        expect(detail.failed ?? [], `failed checks: ${s.detail}`).toEqual([])
        expect(detail.checks?.stepEmitted).toBe(true)
        expect(s.score).toBe(1)
        expect(s.resolved).toBe(true)
      },
      JUDGE_TIMEOUT,
    )
  }

  it(
    'grades a fenced answer identically — the fence is a formatting slip, not geometry',
    async () => {
      const a = createMcadCqAdapter()
      const [t] = await a.loadTasks({ ids: ['calibration-block'] })
      const s = await a.judge(t!, `\`\`\`python\n${MCAD_CQ_GOLDS['calibration-block']!.trim()}\n\`\`\``)
      expect(s.score).toBe(1)
      expect(s.resolved).toBe(true)
    },
    JUDGE_TIMEOUT,
  )

  it(
    'MUST REJECT: one bore of four deleted fails its named probes and nothing else',
    async () => {
      const a = createMcadCqAdapter()
      const [t] = await a.loadTasks({ ids: ['calibration-block'] })
      const s = await a.judge(t!, BLOCK_MISSING_ONE_BORE)
      expect(s.resolved).toBe(false)
      expect(s.score).toBeGreaterThan(0)
      expect(s.score).toBeLessThan(1)
      const failed = (JSON.parse(s.detail as string).failed as Array<{ name: string }>).map((f) => f.name)
      // the deleted bore is the (35, 20) one: its centre probe and the 3 mm-off
      // probe both now sit in solid material
      expect(failed).toContain('probeOutside[0] (35, 20, 10)')
      expect(failed).toContain('probeOutside[4] (35, 23, 10)')
      // and the part is otherwise correct, so nothing aggregate may be blamed:
      // one filled 8 mm bore is +1005 mm^3 on a 4000 mm^3-wide band
      expect(failed).not.toContain('volume')
      expect(failed).not.toContain('bboxX')
      expect(failed).not.toContain('solids')
      expect(failed).not.toContain('stepEmitted')
    },
    JUDGE_TIMEOUT,
  )

  it(
    'MUST REJECT: a script that writes no part.stl scores 0 and the detail says so',
    async () => {
      const a = createMcadCqAdapter()
      const [t] = await a.loadTasks({ ids: ['calibration-block'] })
      const s = await a.judge(t!, STEP_ONLY)
      expect(s.resolved).toBe(false)
      expect(s.score).toBe(0)
      expect(s.detail).toMatch(/wrote no part\.stl/)
      // it DID write the STEP file, and the detail says that too
      expect(s.detail).toMatch(/stepEmitted true/)
    },
    JUDGE_TIMEOUT,
  )

  it(
    'MUST REJECT: a binary STL is a format miss, not a parse problem',
    async () => {
      const a = createMcadCqAdapter()
      const [t] = await a.loadTasks({ ids: ['calibration-block'] })
      const s = await a.judge(t!, BINARY_STL)
      expect(s.resolved).toBe(false)
      expect(s.score).toBe(0)
      expect(s.detail).toMatch(/not ASCII/)
    },
    JUDGE_TIMEOUT,
  )

  it(
    'MUST REJECT: dropping the STEP export costs exactly the stepEmitted check',
    async () => {
      const a = createMcadCqAdapter()
      const [t] = await a.loadTasks({ ids: ['calibration-block'] })
      const s = await a.judge(t!, NO_STEP_EXPORT)
      expect(s.resolved).toBe(false)
      const detail = JSON.parse(s.detail as string) as {
        failed: Array<{ name: string }>
        checks: Record<string, boolean>
        stepEmitted: boolean
      }
      expect(detail.stepEmitted).toBe(false)
      expect(detail.failed.map((f) => f.name)).toEqual(['stepEmitted'])
      const total = Object.keys(detail.checks).length
      expect(s.score).toBeCloseTo((total - 1) / total, 9)
    },
    JUDGE_TIMEOUT,
  )

  it(
    'MUST REJECT: a hanging script is killed at its deadline and scores nothing',
    async () => {
      const built = await runAndMeasureCadQuery('while True:\n    pass\n', 3_000)
      expect(built.ok).toBe(false)
      if (built.ok) return
      expect(built.detail).toMatch(/timed out after 3000 ms and was killed/)
      expect(built.stepEmitted).toBe(false)
    },
    JUDGE_TIMEOUT,
  )

  it(
    'MUST REJECT: a script that raises is scored 0 with its traceback in the detail',
    async () => {
      const a = createMcadCqAdapter()
      const [t] = await a.loadTasks({ ids: ['calibration-block'] })
      const s = await a.judge(t!, 'import cadquery as cq\nraise SystemExit("no model here")\n')
      expect(s.resolved).toBe(false)
      expect(s.score).toBe(0)
      expect(s.detail).toMatch(/script failed:/)
      expect(s.detail).toMatch(/no model here/)
    },
    JUDGE_TIMEOUT,
  )
})
