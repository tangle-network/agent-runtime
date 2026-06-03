/**
 * CAD-Design adapter. Worker artifact = OpenSCAD source (`.scad`). Judge = the
 * REAL OpenSCAD engine: compile + export STL, then measure the produced solid
 * geometry against the task's spec. Fully deterministic — the authoritative CAD
 * kernel is the gate, not an LLM and not the agent's own claim.
 *
 * This is verifiable-reward CAD: an agent is far better at *writing* exact
 * parametric code than at clicking a GUI, and the kernel either produces the
 * specified geometry or it doesn't. Every judged artifact also renders a PNG,
 * so a refine loop's attempts become a watchable "model getting better" reel
 * (run-capsule consumes the renders).
 *
 * Spec checks are geometric and ungameable:
 *   - compiles      : `openscad -o out.stl` exits 0 (hard gate)
 *   - volumes       : disconnected-solid count within [min,max]
 *   - bbox          : overall X/Y/Z extent within bounds (the thing is the right size)
 *   - detail        : triangle count ≥ floor (not a degenerate single cube)
 *   - pitchedRoof   : the top band's XY footprint NARROWS vs the base — a flat
 *                     box can't fake this; a real gabled/hipped roof tapers
 *   - hollow        : interior cavity present (walls, not a solid block) — the
 *                     bbox volume materially exceeds the printed solid volume
 *
 * Requires only `openscad` + `xvfb-run` on PATH (no venv, no Docker, no network).
 */

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

const execFileAsync = promisify(execFile)

/** Spec assertions a CAD task can require. All are deterministic + geometric. */
export interface CadSpec {
  volumes?: [number, number]
  bbox?: { x?: [number, number]; y?: [number, number]; z?: [number, number] }
  minTriangles?: number
  /** Top-band XY footprint must be < this fraction of the base footprint. */
  pitchedRoof?: number
  /** Printed solid volume must be < this fraction of the bbox volume (hollow). */
  hollowBelow?: number
}

interface CadTaskMeta {
  spec: CadSpec
  /** A known-good .scad that satisfies the spec — the oracle for verify-judge. */
  gold: string
}

/** Run openscad with xvfb (it needs a GL context even headless). */
async function openscad(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  // -a => auto-pick a free display; openscad writes Facets/Volumes to stderr.
  const { stdout, stderr } = await execFileAsync('xvfb-run', ['-a', 'openscad', ...args], {
    cwd,
    maxBuffer: 1024 * 1024 * 64,
    timeout: 120_000,
  })
  return { stdout, stderr }
}

interface Geometry {
  triangles: number
  volumes: number
  bbox: { x: number; y: number; z: number }
  /** XY footprint area (extent_x * extent_y) of the bottom 60% and top 25% z-bands. */
  baseFootprint: number
  topFootprint: number
  /** Convex-ish solid volume estimate from the STL (sum of signed tetra volumes). */
  solidVolume: number
  bboxVolume: number
}

/** Parse an ASCII STL into the geometric measures the spec checks. Pure. */
function measureStl(stl: string, volumesFromStderr: number): Geometry {
  const verts: Array<[number, number, number]> = []
  const tris: Array<[[number, number, number], [number, number, number], [number, number, number]]> = []
  const re = /vertex\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)/g
  let m: RegExpExecArray | null
  const flat: Array<[number, number, number]> = []
  while ((m = re.exec(stl))) flat.push([Number(m[1]), Number(m[2]), Number(m[3])])
  for (let i = 0; i + 2 < flat.length; i += 3) tris.push([flat[i]!, flat[i + 1]!, flat[i + 2]!])
  for (const v of flat) verts.push(v)

  const xs = verts.map((v) => v[0])
  const ys = verts.map((v) => v[1])
  const zs = verts.map((v) => v[2])
  const min = (a: number[]) => Math.min(...a)
  const max = (a: number[]) => Math.max(...a)
  const minZ = min(zs)
  const maxZ = max(zs)
  const h = maxZ - minZ || 1

  // Footprint of a z-band = XY extent of the vertices within it.
  const footprint = (lo: number, hi: number): number => {
    const band = verts.filter((v) => v[2] >= minZ + lo * h && v[2] <= minZ + hi * h)
    if (band.length < 3) return 0
    const bx = band.map((v) => v[0])
    const by = band.map((v) => v[1])
    return (max(bx) - min(bx)) * (max(by) - min(by))
  }

  // Signed volume via the divergence theorem over triangles (|Σ v0·(v1×v2)/6|).
  let vol6 = 0
  for (const [a, b, c] of tris) {
    vol6 +=
      a[0] * (b[1] * c[2] - b[2] * c[1]) -
      a[1] * (b[0] * c[2] - b[2] * c[0]) +
      a[2] * (b[0] * c[1] - b[1] * c[0])
  }
  const bbox = { x: max(xs) - min(xs), y: max(ys) - min(ys), z: maxZ - minZ }
  return {
    triangles: tris.length,
    volumes: volumesFromStderr,
    bbox,
    baseFootprint: footprint(0, 0.6),
    topFootprint: footprint(0.75, 1),
    solidVolume: Math.abs(vol6) / 6,
    bboxVolume: bbox.x * bbox.y * bbox.z || 1,
  }
}

function inRange(v: number, [lo, hi]: [number, number]): boolean {
  return v >= lo && v <= hi
}

/** Score the geometry against the spec — each check is a named pass/fail. */
function scoreGeometry(g: Geometry, spec: CadSpec): { checks: Record<string, boolean>; score: number } {
  const checks: Record<string, boolean> = {}
  if (spec.volumes) checks.volumes = inRange(g.volumes, spec.volumes)
  if (spec.minTriangles != null) checks.detail = g.triangles >= spec.minTriangles
  if (spec.bbox?.x) checks.bboxX = inRange(g.bbox.x, spec.bbox.x)
  if (spec.bbox?.y) checks.bboxY = inRange(g.bbox.y, spec.bbox.y)
  if (spec.bbox?.z) checks.bboxZ = inRange(g.bbox.z, spec.bbox.z)
  if (spec.pitchedRoof != null)
    checks.pitchedRoof = g.baseFootprint > 0 && g.topFootprint < spec.pitchedRoof * g.baseFootprint
  if (spec.hollowBelow != null) checks.hollow = g.solidVolume < spec.hollowBelow * g.bboxVolume
  const vals = Object.values(checks)
  const score = vals.length ? vals.filter(Boolean).length / vals.length : 0
  return { checks, score }
}

/** A parametric multi-story gabled building — the gold generator for the
 *  building-family tasks. They share geometry (hollow stacked shells + a gabled
 *  roof that tapers to a ridge + cut openings) and differ only in dimensions, so
 *  one verified generator yields a spec-passing oracle for each. */
function buildingGold(w: number, d: number, sh: number, ns: number, rh: number, t = 3): string {
  return `
w=${w}; d=${d}; sh=${sh}; ns=${ns}; rh=${rh}; t=${t};
module shell(w,d,h,t){ difference(){ cube([w,d,h]); translate([t,t,-1]) cube([w-2*t,d-2*t,h+2]); } }
module roof(w,d,h){ rotate([90,0,90]) linear_extrude(height=w) polygon([[0,0],[d,0],[d/2,h]]); }
union(){
  for(s=[0:ns-1]) translate([0,0,s*sh]) shell(w,d,sh,t);
  for(s=[0:ns]) translate([0,0,s*sh-0.5]) cube([w,d,1]);
  translate([0,0,ns*sh]) roof(w,d,rh);
  for(s=[0:ns-1]) for(i=[0:floor((w-28)/22)]) translate([14+i*22,-1,s*sh+10]) cube([10,t+2,12]);
  translate([w/2-7,-1,2]) cube([14,t+2,20]);
}
`.trim()
}

const TASKS: Array<{ id: string; prompt: string; meta: CadTaskMeta }> = [
  {
    id: 'two-story-house',
    prompt: [
      'Write OpenSCAD source for a two-story house.',
      'Requirements:',
      '- footprint roughly 80 (X) by 60 (Y) units',
      '- two stories, total wall height ~68 units',
      '- a PITCHED / gabled roof on top (NOT a flat roof) — the roof must taper toward a ridge',
      '- hollow shell (walls with an interior cavity), not a solid block',
      '- at least one door opening and several windows',
      'Output ONLY the .scad source, no prose, no code fences.',
    ].join('\n'),
    meta: {
      spec: {
        volumes: [1, 12],
        bbox: { x: [70, 110], y: [50, 80], z: [80, 130] },
        minTriangles: 60,
        pitchedRoof: 0.55,
        hollowBelow: 0.7,
      },
      gold: `
w=80; d=60; sh=34; t=3; rh=28;
module shell(w,d,h,t){ difference(){ cube([w,d,h]); translate([t,t,-1]) cube([w-2*t,d-2*t,h+2]); } }
module roof(w,d,h){ translate([0,0,0]) rotate([90,0,90]) linear_extrude(height=w) polygon([[0,0],[d,0],[d/2,h]]); }
union(){
  for(s=[0,1]) translate([0,0,s*sh]) shell(w,d,sh,t);
  for(s=[0,1,2]) translate([0,0,s*sh-1]) cube([w,d,1]);
  translate([0,0,2*sh]) roof(w,d,rh);
  for(s=[0,1]) for(i=[0:2]) translate([16+i*22,-1,s*sh+10]) cube([12,t+2,14]);
  translate([w/2-8,-1,2]) cube([16,t+2,22]);
}
`.trim(),
    },
  },
  {
    id: 'cottage',
    prompt: [
      'Write OpenSCAD source for a single-story cottage.',
      'Requirements:',
      '- footprint roughly 50 (X) by 40 (Y) units',
      '- one story, wall height ~30 units',
      '- a PITCHED / gabled roof on top that tapers toward a ridge (NOT flat)',
      '- hollow shell (walls with an interior cavity), not a solid block',
      '- a front door opening and at least one window',
      'Output ONLY the .scad source, no prose, no code fences.',
    ].join('\n'),
    meta: {
      spec: {
        volumes: [1, 12],
        bbox: { x: [44, 58], y: [34, 46], z: [40, 58] },
        minTriangles: 50,
        pitchedRoof: 0.55,
        hollowBelow: 0.72,
      },
      gold: buildingGold(50, 40, 30, 1, 18),
    },
  },
  {
    id: 'barn',
    prompt: [
      'Write OpenSCAD source for a barn.',
      'Requirements:',
      '- footprint roughly 60 (X) by 96 (Y) units (long and deep)',
      '- one tall story, wall height ~42 units',
      '- a PITCHED / gabled roof on top that tapers toward a ridge (NOT flat)',
      '- hollow shell (walls with an interior cavity), not a solid block',
      '- a large door opening and several windows',
      'Output ONLY the .scad source, no prose, no code fences.',
    ].join('\n'),
    meta: {
      spec: {
        volumes: [1, 12],
        bbox: { x: [52, 72], y: [84, 108], z: [58, 84] },
        minTriangles: 50,
        pitchedRoof: 0.55,
        hollowBelow: 0.72,
      },
      gold: buildingGold(60, 96, 42, 1, 26),
    },
  },
  {
    id: 'townhouse',
    prompt: [
      'Write OpenSCAD source for a narrow three-story townhouse.',
      'Requirements:',
      '- footprint roughly 42 (X) by 52 (Y) units',
      '- three stories, total wall height ~90 units',
      '- a PITCHED / gabled roof on top that tapers toward a ridge (NOT flat)',
      '- hollow shell (walls with an interior cavity), not a solid block',
      '- a front door opening and several windows per floor',
      'Output ONLY the .scad source, no prose, no code fences.',
    ].join('\n'),
    meta: {
      spec: {
        volumes: [1, 16],
        bbox: { x: [36, 52], y: [44, 62], z: [112, 138] },
        minTriangles: 50,
        pitchedRoof: 0.55,
        hollowBelow: 0.72,
      },
      gold: buildingGold(42, 52, 30, 3, 34),
    },
  },
  {
    id: 'chapel',
    prompt: [
      'Write OpenSCAD source for a small chapel.',
      'Requirements:',
      '- footprint roughly 40 (X) by 72 (Y) units (narrow and long)',
      '- one tall story, wall height ~48 units',
      '- a STEEP pitched / gabled roof on top that tapers toward a ridge (NOT flat)',
      '- hollow shell (walls with an interior cavity), not a solid block',
      '- a tall door opening and several windows',
      'Output ONLY the .scad source, no prose, no code fences.',
    ].join('\n'),
    meta: {
      spec: {
        volumes: [1, 12],
        bbox: { x: [34, 50], y: [62, 84], z: [68, 96] },
        minTriangles: 50,
        pitchedRoof: 0.55,
        hollowBelow: 0.72,
      },
      gold: buildingGold(40, 72, 48, 1, 30),
    },
  },
  {
    id: 'hex-planter',
    prompt: [
      'Write OpenSCAD source for a hexagonal planter pot.',
      'Requirements:',
      '- a hollow hexagonal prism (6-sided), outer width ~50 units across, height ~45',
      '- open at the top, closed at the bottom (a cavity for soil)',
      '- a wall thickness around 3 units',
      'Output ONLY the .scad source, no prose, no code fences.',
    ].join('\n'),
    meta: {
      spec: {
        volumes: [1, 3],
        bbox: { x: [40, 60], y: [40, 60], z: [40, 55] },
        minTriangles: 30,
        hollowBelow: 0.7,
      },
      gold: `
$fn=6; or=25; h=45; t=3;
difference(){
  cylinder(h=h, r=or);
  translate([0,0,t]) cylinder(h=h, r=or-t);
}
`.trim(),
    },
  },
]

export function createCadDesignAdapter(): BenchmarkAdapter {
  return {
    name: 'cad-design',

    async preflight() {
      try {
        await execFileAsync('xvfb-run', ['-a', 'openscad', '--version'], { timeout: 30_000 })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(
          `cad-design preflight failed: ${msg}\n` +
            `Fix: install OpenSCAD + Xvfb (Debian/Ubuntu: sudo apt-get install -y openscad xvfb). ` +
            `The judge runs \`xvfb-run -a openscad -o out.stl model.scad\` — both must be on PATH.`,
        )
      }
    },

    async loadTasks(opts: LoadOptions = {}) {
      let tasks = TASKS
      if (opts.ids) tasks = tasks.filter((t) => opts.ids!.includes(t.id))
      if (opts.limit != null) tasks = tasks.slice(0, opts.limit)
      return tasks.map((t): BenchTask => ({ id: t.id, prompt: t.prompt, metadata: t.meta as unknown as Record<string, unknown> }))
    },

    async goldArtifact(task: BenchTask) {
      const meta = task.metadata as unknown as CadTaskMeta | undefined
      return meta?.gold
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const spec = (task.metadata as unknown as CadTaskMeta).spec
      const src = artifact.trim()
      if (!src) return { resolved: false, score: 0, detail: 'empty artifact' }

      const dir = await mkdtemp(join(tmpdir(), 'cad-'))
      const scad = join(dir, 'model.scad')
      const stlPath = join(dir, 'model.stl')
      const pngPath = join(dir, 'model.png')
      await writeFile(scad, src)

      // GATE 1: compile + export STL. Nonzero exit / CGAL error => does not compile.
      let stderr = ''
      try {
        const r = await openscad(['-o', stlPath, scad], dir)
        stderr = r.stderr
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { resolved: false, score: 0, detail: `compile failed: ${msg.slice(0, 300)}` }
      }

      // Render a PNG alongside (the artifact run-capsule animates). Non-fatal.
      try {
        await openscad(
          ['-o', pngPath, '--imgsize=1100,850', '--camera=40,30,40,55,0,25,260', '--colorscheme=Tomorrow', scad],
          dir,
        )
      } catch {
        /* render is for the reel; geometry gate already has the STL */
      }

      let stl: string
      try {
        stl = await readFile(stlPath, 'utf8')
      } catch {
        return { resolved: false, score: 0, detail: 'compiled but produced no STL (empty geometry)' }
      }
      const volumes = Number(/Volumes:\s*(\d+)/.exec(stderr)?.[1] ?? '1')
      const geo = measureStl(stl, volumes)
      const { checks, score } = scoreGeometry(geo, spec)
      const resolved = score === 1
      const detail = JSON.stringify({
        checks,
        geo: {
          triangles: geo.triangles,
          volumes: geo.volumes,
          bbox: { x: +geo.bbox.x.toFixed(1), y: +geo.bbox.y.toFixed(1), z: +geo.bbox.z.toFixed(1) },
          hollowRatio: +(geo.solidVolume / geo.bboxVolume).toFixed(3),
          topVsBaseFootprint: geo.baseFootprint ? +(geo.topFootprint / geo.baseFootprint).toFixed(3) : null,
        },
        renderPath: pngPath,
        stlPath,
      })
      return { resolved, score, detail }
    },
  }
}
