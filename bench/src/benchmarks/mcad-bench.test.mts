/**
 * MCAD adapter tests, in two halves.
 *
 * PURE: hand-written ASCII STL fixtures exercise the geometry engine with no
 * OpenSCAD anywhere — a unit cube, an open box, two disjoint cubes, and a cube
 * with a square through-channel. The fixtures are deliberately lattice-aligned,
 * because that is the case a naive axis-aligned ray-parity test gets wrong.
 *
 * LIVE (gated on `openscad` + `xvfb-run`): the real judge, in BOTH directions.
 * Accept — every `calibrated: true` task scores 1.0 on its own gold. Reject — the
 * task-01 gold with its four holes deleted must fail the bore probes, and the same
 * gold scaled to 90 x 54 x 18 must fail all three bbox axes. A judge that has only
 * been shown passing inputs is not calibrated, so the reject direction is not
 * optional here.
 *
 *   npx vitest run src/benchmarks/mcad-bench.test.mts
 */

import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  createMcadBenchAdapter,
  measureMesh,
  parseAsciiStl,
  pointInSolid,
  scoreAgainstSpec,
  stripCodeFence,
} from './mcad-bench'
import { MCAD_GOLDS } from './mcad-golds'
import { MCAD_TASKS } from './mcad-tasks'

// ---------------------------------------------------------------------------
// ASCII STL fixture builders (outward-facing winding, 2-manifold by construction)
// ---------------------------------------------------------------------------

type P = readonly [number, number, number]
type T = readonly [P, P, P]

/** A quad a-b-c-d as two triangles sharing the a-c diagonal. */
function quad(a: P, b: P, c: P, d: P): T[] {
  return [
    [a, b, c],
    [a, c, d],
  ]
}

function boxTris(min: P, max: P): T[] {
  const [x0, y0, z0] = min
  const [x1, y1, z1] = max
  const p000: P = [x0, y0, z0]
  const p100: P = [x1, y0, z0]
  const p110: P = [x1, y1, z0]
  const p010: P = [x0, y1, z0]
  const p001: P = [x0, y0, z1]
  const p101: P = [x1, y0, z1]
  const p111: P = [x1, y1, z1]
  const p011: P = [x0, y1, z1]
  return [
    ...quad(p000, p010, p110, p100), // bottom, -Z
    ...quad(p001, p101, p111, p011), // top, +Z
    ...quad(p000, p100, p101, p001), // front, -Y
    ...quad(p010, p011, p111, p110), // back, +Y
    ...quad(p000, p001, p011, p010), // left, -X
    ...quad(p100, p110, p111, p101), // right, +X
  ]
}

function toStl(tris: T[]): string {
  const facets = tris
    .map(([a, b, c]) =>
      [
        '  facet normal 0 0 0',
        '    outer loop',
        `      vertex ${a.join(' ')}`,
        `      vertex ${b.join(' ')}`,
        `      vertex ${c.join(' ')}`,
        '    endloop',
        '  endfacet',
      ].join('\n'),
    )
    .join('\n')
  return `solid fixture\n${facets}\nendsolid fixture\n`
}

const UNIT_CUBE = toStl(boxTris([0, 0, 0], [1, 1, 1]))
/** The unit cube with its two +Z triangles deleted — four edges left unpaired. */
const OPEN_BOX = toStl(boxTris([0, 0, 0], [1, 1, 1]).filter((_, i) => i !== 2 && i !== 3))
const TWO_CUBES = toStl([...boxTris([0, 0, 0], [1, 1, 1]), ...boxTris([3, 0, 0], [4, 1, 1])])

/**
 * A 6 x 6 x 6 block with a 2 x 2 square channel running through it in Z. Both end
 * faces are annuli split into four trapezoids whose corner diagonals are shared, so
 * the mesh stays 2-manifold. Enclosed volume: 216 - 24 = 192.
 */
function channelCubeTris(): T[] {
  const o = 6
  const a = 2
  const b = 4
  const tris: T[] = []
  // outer side walls
  const outer: Array<[P, P]> = [
    [[0, 0, 0], [o, 0, 0]],
    [[o, 0, 0], [o, o, 0]],
    [[o, o, 0], [0, o, 0]],
    [[0, o, 0], [0, 0, 0]],
  ]
  for (const [s, e] of outer) {
    tris.push(...quad(s, e, [e[0], e[1], o], [s[0], s[1], o]))
  }
  // end-face annuli: four trapezoids per face, outer edge -> inner edge
  const strips: Array<[P, P, P, P]> = [
    [[0, 0, 0], [o, 0, 0], [b, a, 0], [a, a, 0]],
    [[o, 0, 0], [o, o, 0], [b, b, 0], [b, a, 0]],
    [[o, o, 0], [0, o, 0], [a, b, 0], [b, b, 0]],
    [[0, o, 0], [0, 0, 0], [a, a, 0], [a, b, 0]],
  ]
  for (const [p, q, r, s] of strips) {
    const up = (v: P): P => [v[0], v[1], o]
    tris.push(...quad(up(p), up(q), up(r), up(s))) // +Z face
    tris.push(...quad(s, r, q, p)) // -Z face, reversed winding
  }
  // channel walls, outward normals point INTO the void
  tris.push(...quad([a, a, 0], [a, b, 0], [a, b, o], [a, a, o])) // +X
  tris.push(...quad([b, a, 0], [b, a, o], [b, b, o], [b, b, 0])) // -X
  tris.push(...quad([a, a, 0], [a, a, o], [b, a, o], [b, a, 0])) // +Y
  tris.push(...quad([a, b, 0], [b, b, 0], [b, b, o], [a, b, o])) // -Y
  return tris
}

const CHANNEL_CUBE = toStl(channelCubeTris())

// ---------------------------------------------------------------------------
// Pure geometry tests
// ---------------------------------------------------------------------------

describe('mcad geometry engine (pure ASCII STL fixtures)', () => {
  it('measures a unit cube: watertight, one solid, volume 1', () => {
    const g = measureMesh(parseAsciiStl(UNIT_CUBE))
    expect(g.triangles).toBe(12)
    expect(g.watertight).toBe(true)
    expect(g.openEdges).toBe(0)
    expect(g.degenerateFaces).toBe(0)
    expect(g.solids).toBe(1)
    expect(g.volume).toBeCloseTo(1, 9)
    expect(g.bbox.size).toEqual({ x: 1, y: 1, z: 1 })
  })

  it('rejects an open box: four unpaired edges, not watertight', () => {
    const g = measureMesh(parseAsciiStl(OPEN_BOX))
    expect(g.triangles).toBe(10)
    expect(g.watertight).toBe(false)
    expect(g.openEdges).toBe(4)
  })

  it('counts two disjoint cubes as two solids', () => {
    const g = measureMesh(parseAsciiStl(TWO_CUBES))
    expect(g.watertight).toBe(true)
    expect(g.solids).toBe(2)
    expect(g.volume).toBeCloseTo(2, 9)
    expect(g.bbox.size.x).toBe(4)
  })

  it('measures the through-channel cube: one solid, volume 192', () => {
    const g = measureMesh(parseAsciiStl(CHANNEL_CUBE))
    expect(g.watertight).toBe(true)
    expect(g.openEdges).toBe(0)
    expect(g.solids).toBe(1)
    expect(g.degenerateFaces).toBe(0)
    expect(g.volume).toBeCloseTo(192, 6)
  })

  it('returns an empty measurement for a triangle-free STL', () => {
    const g = measureMesh(parseAsciiStl('solid empty\nendsolid empty\n'))
    expect(g.triangles).toBe(0)
    expect(g.watertight).toBe(false)
  })

  it('places probes correctly in the through-channel cube', () => {
    const tris = parseAsciiStl(CHANNEL_CUBE)
    // channel centre is void; the surrounding material is solid
    expect(pointInSolid(tris, { x: 3, y: 3, z: 3 })).toBe(false)
    expect(pointInSolid(tris, { x: 1, y: 1, z: 3 })).toBe(true)
    expect(pointInSolid(tris, { x: 5, y: 5, z: 3 })).toBe(true)
    expect(pointInSolid(tris, { x: 1, y: 5, z: 3 })).toBe(true)
    // outside the block entirely, including straight up the channel
    expect(pointInSolid(tris, { x: 3, y: 3, z: 9 })).toBe(false)
    expect(pointInSolid(tris, { x: -1, y: 3, z: 3 })).toBe(false)
  })
})

describe('ray-parity robustness on lattice-aligned probes', () => {
  const cube = parseAsciiStl(toStl(boxTris([0, 0, 0], [2, 2, 2])))
  const channel = parseAsciiStl(CHANNEL_CUBE)

  it('answers correctly for points sitting on the cube edge lines', () => {
    // Every one of these shares two coordinates with a cube corner, so an
    // axis-aligned ray from it runs exactly along an edge or inside a face plane.
    expect(pointInSolid(cube, { x: 3, y: 0, z: 0 })).toBe(false)
    expect(pointInSolid(cube, { x: 3, y: 2, z: 2 })).toBe(false)
    expect(pointInSolid(cube, { x: -1, y: 0, z: 2 })).toBe(false)
    expect(pointInSolid(cube, { x: 1, y: 3, z: 0 })).toBe(false)
    expect(pointInSolid(cube, { x: 1, y: 1, z: 1 })).toBe(true)
  })

  it('answers correctly for interior points lying in a channel-wall plane', () => {
    // y = 2 and x = 2 are the channel wall planes; these points are in material,
    // and an axis-aligned ray from each would graze the channel wall's edge.
    expect(pointInSolid(channel, { x: 1, y: 2, z: 3 })).toBe(true)
    expect(pointInSolid(channel, { x: 2, y: 1, z: 3 })).toBe(true)
    expect(pointInSolid(channel, { x: 5, y: 2, z: 3 })).toBe(true)
    expect(pointInSolid(channel, { x: 4, y: 5, z: 3 })).toBe(true)
    // and for outside points on the same degenerate lines
    expect(pointInSolid(channel, { x: 7, y: 2, z: 3 })).toBe(false)
    expect(pointInSolid(channel, { x: 3, y: 2, z: 7 })).toBe(false)
  })

  it('is deterministic: the same point and mesh always give the same answer', () => {
    const pts = [
      { x: 3, y: 3, z: 3 },
      { x: 1, y: 2, z: 3 },
      { x: 2, y: 1, z: 3 },
    ]
    for (const p of pts) {
      const first = pointInSolid(channel, p)
      for (let i = 0; i < 5; i++) expect(pointInSolid(channel, p)).toBe(first)
    }
  })
})

describe('spec scoring', () => {
  const tris = parseAsciiStl(CHANNEL_CUBE)
  const geo = measureMesh(tris)

  it('scores 1.0 and resolves when every asserted check passes', () => {
    const s = scoreAgainstSpec(geo, tris, {
      bbox: { x: [5.9, 6.1], y: [5.9, 6.1], z: [5.9, 6.1] },
      volume: [190, 194],
      solids: [1, 1],
      minTriangles: 20,
      probesInsideSolid: [[1, 1, 3]],
      probesOutsideSolid: [[3, 3, 3]],
    })
    expect(s.score).toBe(1)
    expect(s.resolved).toBe(true)
    expect(s.failed).toEqual([])
  })

  it('gives partial credit and names every failed check with measured vs expected', () => {
    const s = scoreAgainstSpec(geo, tris, {
      bbox: { x: [10, 12] },
      volume: [190, 194],
      solids: [1, 1],
      probesOutsideSolid: [[1, 1, 3]],
    })
    expect(s.resolved).toBe(false)
    expect(s.score).toBeCloseTo(2 / 4, 9)
    const names = s.failed.map((c) => c.name)
    expect(names).toContain('bboxX')
    expect(names.some((n) => n.startsWith('probeOutside[0]'))).toBe(true)
    const bbox = s.failed.find((c) => c.name === 'bboxX')
    expect(bbox?.measured).toBe('6')
    expect(bbox?.expected).toBe('[10, 12]')
  })

  it('counts each bbox axis, each band and each probe as one check', () => {
    const s = scoreAgainstSpec(geo, tris, {
      bbox: { x: [5, 7], y: [5, 7], z: [5, 7] },
      volume: [190, 194],
      solids: [1, 1],
      minTriangles: 1,
      probesInsideSolid: [
        [1, 1, 3],
        [5, 5, 3],
      ],
      probesOutsideSolid: [[3, 3, 3]],
    })
    expect(s.checks).toHaveLength(9)
  })
})

describe('artifact handling', () => {
  it('strips a markdown fence the model may have wrapped its answer in', () => {
    expect(stripCodeFence('```openscad\ncube([1,1,1]);\n```')).toBe('cube([1,1,1]);')
    expect(stripCodeFence('```\ncube([1,1,1]);\n```')).toBe('cube([1,1,1]);')
    expect(stripCodeFence('  cube([1,1,1]);  ')).toBe('cube([1,1,1]);')
  })

  it('loads tasks with spec/source/calibrated metadata and no openscad', async () => {
    const a = createMcadBenchAdapter()
    const tasks = await a.loadTasks()
    expect(tasks).toHaveLength(MCAD_TASKS.length)
    for (const t of tasks) {
      const md = t.metadata as { spec: unknown; source: string; calibrated: boolean }
      expect(md.spec).toBeTruthy()
      expect(typeof md.source).toBe('string')
      expect(typeof md.calibrated).toBe('boolean')
      expect(typeof (await a.goldArtifact(t))).toBe('string')
    }
  })

  it('honours ids and limit', async () => {
    const a = createMcadBenchAdapter()
    expect((await a.loadTasks({ ids: ['l-bracket'] })).map((t) => t.id)).toEqual(['l-bracket'])
    expect(await a.loadTasks({ limit: 3 })).toHaveLength(3)
  })

  it('task 10 asks for separate bodies, never "one fused solid"', () => {
    const t10 = MCAD_TASKS.find((t) => t.id === 'planetary-gear-stage')
    expect(t10?.prompt).not.toContain('one fused solid')
    expect(t10?.prompt).toContain('separate')
    // every other task keeps the single-solid boilerplate
    for (const t of MCAD_TASKS) {
      if (t.id === 'planetary-gear-stage') continue
      expect(t.prompt).toContain('one fused solid')
    }
  })

  it('scores an empty artifact 0 without touching openscad', async () => {
    const a = createMcadBenchAdapter()
    const [t] = await a.loadTasks({ ids: ['calibration-block'] })
    const s = await a.judge(t!, '   ')
    expect(s.resolved).toBe(false)
    expect(s.score).toBe(0)
    expect(s.detail).toBe('empty artifact')
  })
})

// ---------------------------------------------------------------------------
// Live judge (needs openscad + xvfb-run)
// ---------------------------------------------------------------------------

function openscadPresent(): boolean {
  try {
    execFileSync('xvfb-run', ['-a', 'openscad', '--version'], { stdio: 'ignore', timeout: 60_000 })
    return true
  } catch {
    return false
  }
}

const OPENSCAD = openscadPresent()
const JUDGE_TIMEOUT = 300_000

/** Task 01's gold with the four through-holes deleted — the geometry is otherwise identical. */
const BLOCK_WITHOUT_HOLES = `
$fn=96;
module chamfered_block(l, w, h, c) {
  hull() {
    translate([-l/2, -w/2, 0]) cube([l, w, h - c]);
    translate([-l/2 + c, -w/2 + c, h - c]) cube([l - 2*c, w - 2*c, c]);
  }
}
chamfered_block(100, 60, 20, 2);
`

/** Task 01's gold at 0.9 scale: 90 x 54 x 18, every feature otherwise correct.
 *  Wrapped in a module rather than a bare `scale(){...}` block because OpenSCAD
 *  rejects a module definition inside a transform's child block but accepts one
 *  inside a module body — this keeps the fixture derived from the gold itself. */
const BLOCK_SCALED_90 = `module gold() {\n${MCAD_GOLDS['calibration-block']}\n}\nscale([0.9, 0.9, 0.9]) gold();`

describe.skipIf(!OPENSCAD)('mcad judge, live openscad', () => {
  it('preflight passes when the toolchain is present', async () => {
    await expect(createMcadBenchAdapter().preflight()).resolves.toBeUndefined()
  })

  for (const task of MCAD_TASKS.filter((t) => t.calibrated)) {
    it(
      `gold for ${task.id} resolves at score 1.0`,
      async () => {
        const a = createMcadBenchAdapter()
        const [t] = await a.loadTasks({ ids: [task.id] })
        const gold = await a.goldArtifact(t!)
        expect(typeof gold).toBe('string')
        const s = await a.judge(t!, gold as string)
        const failed = JSON.parse(s.detail ?? '{}').failed ?? []
        expect(failed, `failed checks: ${JSON.stringify(failed)}`).toEqual([])
        expect(s.score).toBe(1)
        expect(s.resolved).toBe(true)
      },
      JUDGE_TIMEOUT,
    )
  }

  it(
    'MUST REJECT: the calibration block with its four holes removed fails the bore probes',
    async () => {
      const a = createMcadBenchAdapter()
      const [t] = await a.loadTasks({ ids: ['calibration-block'] })
      const s = await a.judge(t!, BLOCK_WITHOUT_HOLES)
      expect(s.resolved).toBe(false)
      expect(s.score).toBeLessThan(1)
      const failed = (JSON.parse(s.detail as string).failed as Array<{ name: string; measured: string }>).map(
        (f) => f.name,
      )
      // all five "must be outside" probes now sit in solid material
      const outside = failed.filter((n) => n.startsWith('probeOutside['))
      const spec = MCAD_TASKS.find((x) => x.id === 'calibration-block')?.spec
      expect(outside).toHaveLength(spec?.probesOutsideSolid?.length ?? 0)
      expect(failed).toContain('volume')
      // the block itself is still the right size, so bbox must NOT be blamed
      expect(failed).not.toContain('bboxX')
    },
    JUDGE_TIMEOUT,
  )

  it(
    'MUST REJECT: the calibration block scaled to 90 x 54 x 18 fails every bbox axis',
    async () => {
      const a = createMcadBenchAdapter()
      const [t] = await a.loadTasks({ ids: ['calibration-block'] })
      const s = await a.judge(t!, BLOCK_SCALED_90)
      expect(s.resolved).toBe(false)
      const detail = JSON.parse(s.detail as string) as {
        failed: Array<{ name: string; measured: string; expected: string }>
        geo: { bbox: { x: number; y: number; z: number } }
      }
      expect(detail.geo.bbox).toEqual({ x: 90, y: 54, z: 18 })
      const failed = detail.failed.map((f) => f.name)
      expect(failed).toContain('bboxX')
      expect(failed).toContain('bboxY')
      expect(failed).toContain('bboxZ')
      const x = detail.failed.find((f) => f.name === 'bboxX')
      expect(x?.measured).toBe('90')
      expect(x?.expected).toBe('[99, 101]')
    },
    JUDGE_TIMEOUT,
  )

  it(
    'MUST REJECT: a non-watertight surface is scored 0 by the hard gate',
    async () => {
      const a = createMcadBenchAdapter()
      const [t] = await a.loadTasks({ ids: ['calibration-block'] })
      const s = await a.judge(t!, 'polyhedron(points=[[0,0,0],[10,0,0],[0,10,0]], faces=[[0,1,2]]);')
      expect(s.resolved).toBe(false)
      expect(s.score).toBe(0)
      expect(JSON.parse(s.detail as string).gate).toBe('watertight')
    },
    JUDGE_TIMEOUT,
  )

  it(
    'MUST REJECT: source that does not compile is scored 0',
    async () => {
      const a = createMcadBenchAdapter()
      const [t] = await a.loadTasks({ ids: ['calibration-block'] })
      const s = await a.judge(t!, 'this is not openscad {{{')
      expect(s.resolved).toBe(false)
      expect(s.score).toBe(0)
      expect(s.detail).toMatch(/compile failed/)
    },
    JUDGE_TIMEOUT,
  )
})
