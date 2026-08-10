/**
 * MCAD adapter. Worker artifact = OpenSCAD source for a dimensioned mechanical
 * part; judge = the REAL OpenSCAD kernel (compile + ASCII-STL export) followed by
 * pure-TS mesh measurement against the task's `McadSpec`. No LLM, no self-report:
 * the part either has the stated extents, volume, body count and holes, or it does
 * not.
 *
 * Pipeline, in order, and every stage is a hard fact about the produced mesh:
 *   1. compile     : `xvfb-run -a openscad --export-format=asciistl -o out.stl` exits 0
 *   2. watertight  : every undirected edge shared by exactly two faces (2-manifold)
 *   3. measure     : bbox extents, enclosed volume (divergence theorem), connected
 *                    -component count ("solids"), triangle count
 *   4. probe       : ray-parity point-in-solid at the spec's pinned hole/material
 *                    coordinates — this is what makes a missing or misplaced bore
 *                    fail, which no aggregate measure can catch
 *
 * Scoring: compile failure or a non-watertight mesh is 0 / unresolved — a mesh that
 * is not a closed solid has no well-defined volume or interior, so every downstream
 * number would be fiction. Otherwise the score is the fraction of ASSERTED spec
 * checks passed (each bbox axis, the volume band, the solids band, the triangle
 * floor, and EACH probe count as one check), and `resolved` requires all of them.
 *
 * Requires `openscad` + `xvfb-run` on PATH at JUDGE time only; `loadTasks` and the
 * geometry engine below are dependency-free and run anywhere.
 *
 * Geometry checks 1-3 are ported from supervisor-lab's `bench/cad-stl-gate.ts`
 * (edge-key manifold parity + signed-tetrahedron volume). Ported, not imported:
 * these packages do not share a dependency edge.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { MCAD_GOLDS } from './mcad-golds'
import { MCAD_TASKS, type McadSpec, type McadTask } from './mcad-tasks'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

const execFileAsync = promisify(execFile)

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** One triangle as three vertices, in the STL's stated winding order. */
export type Tri = readonly [Vec3, Vec3, Vec3]

export interface McadGeometry {
  triangles: number
  /** Edges NOT shared by exactly two faces. 0 iff the surface is closed + 2-manifold. */
  openEdges: number
  watertight: boolean
  /** Zero-area faces — bad geometry even when the topology closes. */
  degenerateFaces: number
  /** Enclosed volume (absolute) via the signed-tetrahedron sum. */
  volume: number
  /** Connected components of the triangle-adjacency graph = disconnected bodies. */
  solids: number
  bbox: { min: Vec3; max: Vec3; size: Vec3 }
}

/** Coincident-vertex quantisation, in model units (mm). */
const VERTEX_QUANTUM = 1e-6
const AREA_EPS = 1e-9
const VOLUME_EPS = 1e-9

// ---------------------------------------------------------------------------
// Mesh parsing + measurement (ported from supervisor-lab bench/cad-stl-gate.ts)
// ---------------------------------------------------------------------------

/** Parse an ASCII STL into triangles by reading `vertex x y z` lines in groups of three. */
export function parseAsciiStl(stl: string): Tri[] {
  const verts: Vec3[] = []
  for (const line of stl.split('\n')) {
    const m = line.trim().match(/^vertex\s+(\S+)\s+(\S+)\s+(\S+)/i)
    if (!m) continue
    const x = Number(m[1])
    const y = Number(m[2])
    const z = Number(m[3])
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    verts.push({ x, y, z })
  }
  const tris: Tri[] = []
  for (let i = 0; i + 2 < verts.length; i += 3) tris.push([verts[i]!, verts[i + 1]!, verts[i + 2]!])
  return tris
}

/** Quantise a vertex so shared edges match despite float authoring noise. */
function vertexKey(v: Vec3): string {
  const r = (n: number) => (Math.round(n / VERTEX_QUANTUM) * VERTEX_QUANTUM).toFixed(6)
  return `${r(v.x)},${r(v.y)},${r(v.z)}`
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}
function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}
function norm(a: Vec3): number {
  return Math.sqrt(dot(a, a))
}
function normalize(a: Vec3): Vec3 {
  const n = norm(a)
  return { x: a.x / n, y: a.y / n, z: a.z / n }
}

/** Disjoint-set over triangle indices — the "how many separate bodies" primitive. */
function findRoot(parent: Int32Array, i: number): number {
  let r = i
  while (parent[r] !== r) r = parent[r]!
  let c = i
  while (parent[c] !== c) {
    const next = parent[c]!
    parent[c] = r
    c = next
  }
  return r
}

/**
 * Measure the closed-solid properties of a triangle soup. Pure: no I/O, no deps.
 *
 * `solids` is the number of connected components of the graph whose nodes are
 * triangles and whose edges join two triangles that share a quantised mesh edge.
 * On a watertight mesh that count IS the number of disconnected bodies (an
 * enclosed internal cavity is its own shell and counts, which is the behaviour
 * the specs want — a "hollow" body that is really two nested shells is not one
 * fused solid).
 */
export function measureMesh(tris: Tri[]): McadGeometry {
  if (tris.length === 0) {
    const zero = { x: 0, y: 0, z: 0 }
    return {
      triangles: 0,
      openEdges: 0,
      watertight: false,
      degenerateFaces: 0,
      volume: 0,
      solids: 0,
      bbox: { min: zero, max: zero, size: zero },
    }
  }

  const min: Vec3 = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY }
  const max: Vec3 = { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY, z: Number.NEGATIVE_INFINITY }
  const edgeFaces = new Map<string, number[]>()
  const parent = new Int32Array(tris.length)
  for (let i = 0; i < tris.length; i++) parent[i] = i
  let degenerateFaces = 0
  let volume6 = 0

  for (let i = 0; i < tris.length; i++) {
    const [a, b, c] = tris[i]!
    for (const v of [a, b, c]) {
      if (v.x < min.x) min.x = v.x
      if (v.y < min.y) min.y = v.y
      if (v.z < min.z) min.z = v.z
      if (v.x > max.x) max.x = v.x
      if (v.y > max.y) max.y = v.y
      if (v.z > max.z) max.z = v.z
    }
    if (norm(cross(sub(b, a), sub(c, a))) < AREA_EPS) degenerateFaces += 1
    volume6 += dot(a, cross(b, c))

    const ka = vertexKey(a)
    const kb = vertexKey(b)
    const kc = vertexKey(c)
    for (const [p, q] of [
      [ka, kb],
      [kb, kc],
      [kc, ka],
    ] as const) {
      const key = p < q ? `${p}|${q}` : `${q}|${p}`
      const seen = edgeFaces.get(key)
      if (seen) seen.push(i)
      else edgeFaces.set(key, [i])
    }
  }

  let openEdges = 0
  for (const faces of edgeFaces.values()) {
    if (faces.length !== 2) openEdges += 1
    // Union every face pair on this edge (a >2-face edge still connects bodies).
    const first = findRoot(parent, faces[0]!)
    for (let k = 1; k < faces.length; k++) {
      const other = findRoot(parent, faces[k]!)
      if (other !== first) parent[other] = first
    }
  }

  const roots = new Set<number>()
  for (let i = 0; i < tris.length; i++) roots.add(findRoot(parent, i))

  return {
    triangles: tris.length,
    openEdges,
    watertight: openEdges === 0,
    degenerateFaces,
    volume: Math.abs(volume6) / 6,
    solids: roots.size,
    bbox: {
      min: { ...min },
      max: { ...max },
      size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z },
    },
  }
}

// ---------------------------------------------------------------------------
// Point-in-solid by ray parity
// ---------------------------------------------------------------------------

/**
 * Three fixed, mutually linearly-independent directions built from irrational
 * constants (sqrt(3)-1, sqrt(2)-1, 1/sqrt(5), 1/sqrt(3) and the plastic-number
 * pair 0.7548777 / 0.5698403). Their 3x3 determinant is ~1.77, so no two are
 * near-parallel and no plane contains all three.
 */
const RAY_DIRECTIONS: readonly Vec3[] = [
  normalize({ x: 1, y: 0.7548777, z: 0.5698403 }),
  normalize({ x: -0.7320508, y: 1, z: 0.236068 }),
  normalize({ x: 0.4472136, y: -0.5773503, z: 1 }),
]

/** Barycentric / parametric tolerances for calling a crossing "on the boundary". */
const BARY_EPS = 1e-9
const DET_EPS = 1e-12
const T_EPS = 1e-9
const MAX_JITTERS = 8

/** Deterministic 32-bit PRNG (mulberry32) — seeded, so probes never use Math.random. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Stable integer hash of a probe point so its jitter sequence is reproducible. */
function seedForPoint(p: Vec3, rayIndex: number): number {
  let h = 2166136261 ^ rayIndex
  for (const n of [p.x, p.y, p.z]) {
    const bits = Math.round(n * 1e6) | 0
    h = Math.imul(h ^ (bits & 0xffff), 16777619)
    h = Math.imul(h ^ ((bits >>> 16) & 0xffff), 16777619)
  }
  return h >>> 0
}

type CastResult = { crossings: number } | { degenerate: true }

/**
 * Moller-Trumbore crossing count along one ray. Returns `degenerate` when the ray
 * touches a triangle edge/vertex, lies in a triangle's plane, or starts on a face
 * — the three cases where a parity count is not trustworthy.
 */
function castRay(tris: Tri[], origin: Vec3, dir: Vec3): CastResult {
  let crossings = 0
  for (const [v0, v1, v2] of tris) {
    const e1 = sub(v1, v0)
    const e2 = sub(v2, v0)
    const h = cross(dir, e2)
    const det = dot(e1, h)
    const scale = norm(e1) * norm(e2)
    if (Math.abs(det) <= DET_EPS * Math.max(scale, 1)) {
      // Ray parallel to (or inside) this triangle's plane. Only a problem when the
      // ray could actually meet the triangle; distinguishing that costs more than a
      // re-cast, so treat it as degenerate whenever the origin is near the plane.
      const n = cross(e1, e2)
      const nl = norm(n)
      if (nl > AREA_EPS && Math.abs(dot(sub(origin, v0), n)) / nl <= T_EPS) return { degenerate: true }
      continue
    }
    const f = 1 / det
    const s = sub(origin, v0)
    const u = f * dot(s, h)
    const q = cross(s, e1)
    const v = f * dot(dir, q)
    const w = 1 - u - v
    if (u < -BARY_EPS || v < -BARY_EPS || w < -BARY_EPS) continue
    const t = f * dot(e2, q)
    if (t < -T_EPS) continue
    // Inside the triangle (or within EPS of its border). Anything within EPS of a
    // border, or of the origin plane, makes the parity ambiguous.
    if (Math.abs(t) <= T_EPS) return { degenerate: true }
    if (u <= BARY_EPS || v <= BARY_EPS || w <= BARY_EPS) return { degenerate: true }
    crossings += 1
  }
  return { crossings }
}

/**
 * Point-in-solid membership by ray parity, made robust three ways.
 *
 * ROBUSTNESS ARGUMENT. A parity test is exact except on a measure-zero set: rays
 * that graze a triangle edge or vertex (the crossing is counted twice or zero
 * times), rays coplanar with a face, and origins lying on the surface. Those cases
 * are not merely rare here — they are SYSTEMATIC, because OpenSCAD emits
 * axis-aligned meshes whose vertices land on the same round millimetre lattice the
 * spec's probe coordinates come from, so an axis-aligned ray from a probe point
 * hits shared edges constantly. Three defences, in order:
 *   1. DIRECTIONS. The three fixed directions are irrational combinations, so a ray
 *      from a lattice point cannot stay in an axis-aligned face plane and cannot
 *      run along a lattice edge.
 *   2. DETECTION + DETERMINISTIC RE-JITTER. Grazing is DETECTED (a barycentric
 *      coordinate within BARY_EPS of 0, |det| below DET_EPS with the origin in the
 *      plane, or |t| within T_EPS) rather than hoped away. A detected ray is re-cast
 *      with a small direction perturbation drawn from a mulberry32 PRNG seeded by
 *      the probe coordinates and ray index, so the whole judge stays deterministic:
 *      the same mesh and the same point always take the same sequence of re-casts.
 *   3. MAJORITY VOTE. The verdict is the majority of three independent directions,
 *      so even an undetected miscount on one ray cannot flip the answer.
 * A point sitting exactly ON the surface has no correct answer; every direction
 * degenerates there and the vote falls back to whatever the jittered casts say.
 * The specs therefore place probes with >=1 mm clearance from any surface.
 */
export function pointInSolid(tris: Tri[], point: Vec3): boolean {
  let inside = 0
  let votes = 0
  for (let i = 0; i < RAY_DIRECTIONS.length; i++) {
    const base = RAY_DIRECTIONS[i]!
    const rand = mulberry32(seedForPoint(point, i))
    let dir = base
    for (let attempt = 0; attempt <= MAX_JITTERS; attempt++) {
      const r = castRay(tris, point, dir)
      if (!('degenerate' in r)) {
        votes += 1
        if (r.crossings % 2 === 1) inside += 1
        break
      }
      dir = normalize({
        x: base.x + (rand() - 0.5) * 1e-3,
        y: base.y + (rand() - 0.5) * 1e-3,
        z: base.z + (rand() - 0.5) * 1e-3,
      })
    }
  }
  // Every direction degenerating means the point is on the surface; call it outside
  // (fail-closed: a probe that must be inside the material will report a failure).
  if (votes === 0) return false
  return inside * 2 > votes
}

// ---------------------------------------------------------------------------
// Spec scoring
// ---------------------------------------------------------------------------

export interface McadCheck {
  name: string
  ok: boolean
  measured: string
  expected: string
}

export interface McadScoring {
  checks: McadCheck[]
  failed: McadCheck[]
  score: number
  resolved: boolean
}

function inBand(v: number, [lo, hi]: [number, number]): boolean {
  return v >= lo && v <= hi
}

function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000)
}

function pt(p: readonly [number, number, number]): string {
  return `(${p[0]}, ${p[1]}, ${p[2]})`
}

/** Score a measured mesh against the task's spec — one named check per assertion. */
export function scoreAgainstSpec(geo: McadGeometry, tris: Tri[], spec: McadSpec): McadScoring {
  const checks: McadCheck[] = []
  const add = (name: string, ok: boolean, measured: string, expected: string) =>
    checks.push({ name, ok, measured, expected })

  for (const axis of ['x', 'y', 'z'] as const) {
    const band = spec.bbox?.[axis]
    if (!band) continue
    const got = geo.bbox.size[axis]
    add(`bbox${axis.toUpperCase()}`, inBand(got, band), fmt(got), `[${band[0]}, ${band[1]}]`)
  }
  if (spec.volume) add('volume', inBand(geo.volume, spec.volume), fmt(geo.volume), `[${spec.volume[0]}, ${spec.volume[1]}]`)
  if (spec.solids) add('solids', inBand(geo.solids, spec.solids), String(geo.solids), `[${spec.solids[0]}, ${spec.solids[1]}]`)
  if (spec.minTriangles != null)
    add('minTriangles', geo.triangles >= spec.minTriangles, String(geo.triangles), `>= ${spec.minTriangles}`)

  for (const [i, p] of (spec.probesInsideSolid ?? []).entries()) {
    const got = pointInSolid(tris, { x: p[0], y: p[1], z: p[2] })
    add(`probeInside[${i}] ${pt(p)}`, got, got ? 'inside' : 'outside', 'inside')
  }
  for (const [i, p] of (spec.probesOutsideSolid ?? []).entries()) {
    const got = pointInSolid(tris, { x: p[0], y: p[1], z: p[2] })
    add(`probeOutside[${i}] ${pt(p)}`, !got, got ? 'inside' : 'outside', 'outside')
  }

  const failed = checks.filter((c) => !c.ok)
  const score = checks.length ? (checks.length - failed.length) / checks.length : 0
  return { checks, failed, score, resolved: checks.length > 0 && failed.length === 0 }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/** Task metadata carried onto every `BenchTask`, so the judge needs no lookup table. */
export interface McadTaskMeta extends Record<string, unknown> {
  spec: McadSpec
  source: string
  calibrated: boolean
}

/** Run openscad under xvfb (it wants a GL context even headless). */
async function openscad(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('xvfb-run', ['-a', 'openscad', ...args], {
    cwd,
    maxBuffer: 1024 * 1024 * 64,
    timeout: 600_000,
  })
}

/**
 * Strip a markdown fence if the model wrapped its answer in one. The prompt asks
 * for bare source; a fenced answer is a formatting slip, not a geometry failure,
 * and the geometric gate downstream is unchanged either way.
 */
export function stripCodeFence(artifact: string): string {
  const trimmed = artifact.trim()
  const fenced = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec(trimmed)
  return (fenced ? fenced[1]! : trimmed).trim()
}

/** Compile OpenSCAD source and measure the resulting mesh. Judge-time only. */
export async function compileAndMeasure(
  src: string,
): Promise<{ ok: true; geo: McadGeometry; tris: Tri[]; stlPath: string } | { ok: false; detail: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'mcad-'))
  const scadPath = join(dir, 'model.scad')
  const stlPath = join(dir, 'model.stl')
  await writeFile(scadPath, `${src}\n`)

  try {
    await openscad(['--export-format=asciistl', '-o', stlPath, scadPath], dir)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, detail: `compile failed: ${msg.slice(0, 400)}` }
  }

  let stl: string
  try {
    stl = await readFile(stlPath, 'utf8')
  } catch {
    return { ok: false, detail: 'compiled but produced no STL (empty geometry)' }
  }
  const tris = parseAsciiStl(stl)
  if (tris.length === 0) return { ok: false, detail: 'STL parsed to zero triangles (empty geometry)' }
  return { ok: true, geo: measureMesh(tris), tris, stlPath }
}

export function createMcadBenchAdapter(): BenchmarkAdapter {
  return {
    name: 'mcad',

    async preflight() {
      try {
        await execFileAsync('xvfb-run', ['-a', 'openscad', '--version'], { timeout: 30_000 })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(
          `mcad preflight failed: ${msg}\n` +
            'Fix: install OpenSCAD + Xvfb (Debian/Ubuntu: sudo apt-get install -y openscad xvfb). ' +
            'The judge runs `xvfb-run -a openscad --export-format=asciistl -o out.stl model.scad` — both must be on PATH.',
        )
      }
    },

    async loadTasks(opts: LoadOptions = {}) {
      let tasks: McadTask[] = MCAD_TASKS
      if (opts.ids) tasks = tasks.filter((t) => opts.ids?.includes(t.id))
      if (opts.limit != null) tasks = tasks.slice(0, opts.limit)
      return tasks.map(
        (t): BenchTask => ({
          id: t.id,
          prompt: t.prompt,
          metadata: { spec: t.spec, source: t.source, calibrated: t.calibrated } satisfies McadTaskMeta,
        }),
      )
    },

    async goldArtifact(task: BenchTask) {
      return MCAD_GOLDS[task.id]
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const spec = (task.metadata as McadTaskMeta | undefined)?.spec
      if (!spec) return { resolved: false, score: 0, detail: `task ${task.id} carries no mcad spec` }

      const src = stripCodeFence(artifact)
      if (!src) return { resolved: false, score: 0, detail: 'empty artifact' }

      const built = await compileAndMeasure(src)
      if (!built.ok) return { resolved: false, score: 0, detail: built.detail }

      const { geo, tris, stlPath } = built
      if (!geo.watertight) {
        return {
          resolved: false,
          score: 0,
          detail: JSON.stringify({
            gate: 'watertight',
            failed: [
              {
                name: 'watertight',
                measured: `${geo.openEdges} edge(s) not shared by exactly two faces`,
                expected: '0 open edges (closed 2-manifold solid)',
              },
            ],
            geo: { triangles: geo.triangles, degenerateFaces: geo.degenerateFaces },
            stlPath,
          }),
        }
      }

      const scored = scoreAgainstSpec(geo, tris, spec)
      return {
        resolved: scored.resolved,
        score: scored.score,
        detail: JSON.stringify({
          failed: scored.failed.map((c) => ({ name: c.name, measured: c.measured, expected: c.expected })),
          checks: Object.fromEntries(scored.checks.map((c) => [c.name, c.ok])),
          geo: {
            triangles: geo.triangles,
            solids: geo.solids,
            volume: +geo.volume.toFixed(2),
            degenerateFaces: geo.degenerateFaces,
            bbox: {
              x: +geo.bbox.size.x.toFixed(3),
              y: +geo.bbox.size.y.toFixed(3),
              z: +geo.bbox.size.z.toFixed(3),
            },
          },
          stlPath,
        }),
      }
    },
  }
}
