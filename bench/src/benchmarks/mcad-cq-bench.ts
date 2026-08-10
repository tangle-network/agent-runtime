/**
 * MCAD-CQ adapter — the v2 runner that closes v1's format deviation.
 *
 * `mcad-tasks.ts` states the deviation in its header: the upstream text-to-cad
 * benchmark asks for STEP, and OpenSCAD cannot emit it, so v1 grades an STL that
 * OpenSCAD compiled. This adapter runs the SAME ten dimensioned parts against the
 * SAME spec assertions, but the worker's artifact is a Python CadQuery script that
 * must export BOTH `part.step` (the format upstream actually asks for) and
 * `part.stl` (ASCII — what the geometry engine measures).
 *
 * Everything downstream of the mesh is v1's engine, IMPORTED not copied:
 * `parseAsciiStl` / `measureMesh` / `pointInSolid` / `scoreAgainstSpec` /
 * `stripCodeFence` all come from `./mcad-bench`, and the specs come from
 * `./mcad-tasks`. Only two things differ:
 *   1. the deliverable preamble (Python + CadQuery, not OpenSCAD) — applied by
 *      mapping at load time, so v1's prompt strings are never mutated;
 *   2. one EXTRA scored check, `stepEmitted`: `part.step` exists and begins with
 *      `ISO-10303-21` (the ISO 10303-21 exchange-file magic every STEP file
 *      opens with). It is scored like any other assertion, so a script that
 *      emits only the mesh cannot reach 1.0 no matter how correct its geometry.
 *
 * Pipeline, in order:
 *   1. run       : `<python> model.py` in a fresh temp dir, 120 s hard deadline
 *   2. deliver   : `part.stl` exists and is ASCII (a binary STL is a miss, not a
 *                  parse problem — the prompt pins the format)
 *   3. watertight: every undirected edge shared by exactly two faces
 *   4. measure   : bbox / volume / connected components / triangle count
 *   5. probe     : ray-parity point-in-solid at the spec's pinned coordinates
 *   6. step      : the `stepEmitted` check above
 * A non-watertight mesh scores 0 for the same reason as v1: an unclosed surface
 * has no well-defined interior, so every downstream number would be fiction.
 *
 * SAFETY, stated once and deliberately. The judge EXECUTES the worker's Python on
 * the host with no sandbox. That is the same trust level as v1 handing arbitrary
 * source to the OpenSCAD kernel, and it carries the same rule: run this judge only
 * on artifacts you would be willing to run by hand. The child process is given a
 * scrubbed environment — no inherited variables beyond `PATH`, `HOME`/`TMPDIR`
 * pointed at the scratch directory, and proxy variables pointed at a closed port —
 * which DISCOURAGES network access and keeps host secrets out of the script's
 * reach. It is not a network jail and does not claim to be one; put the judge in a
 * container if you need that guarantee.
 *
 * Requires an interpreter that can `import cadquery` at JUDGE time only.
 * Resolution order: `MCAD_CQ_PYTHON` (absolute path) → `bench/.venv-cadquery/bin/python`
 * → throw with the exact install command (see `CADQUERY_INSTALL_FIX`).
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, open, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { venvPythonAt } from './_harness'
import {
  type McadCheck,
  type McadGeometry,
  type McadScoring,
  type McadTaskMeta,
  type Tri,
  measureMesh,
  parseAsciiStl,
  scoreAgainstSpec,
  stripCodeFence,
} from './mcad-bench'
import { MCAD_CQ_GOLDS, MCAD_CQ_UNCALIBRATED } from './mcad-cq-golds'
import { MCAD_DELIVERABLE, MCAD_DELIVERABLE_MULTIBODY, MCAD_TASKS, type McadTask } from './mcad-tasks'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

const execFileAsync = promisify(execFile)

/** Package-relative venv, resolved through `_harness`'s bench-root lookup. */
export const CADQUERY_VENV = '.venv-cadquery'

/** Files the worker's script must leave in its working directory. */
export const STL_NAME = 'part.stl'
export const STEP_NAME = 'part.step'

/** Every ISO 10303-21 exchange file (a "STEP file") starts with this token. */
export const STEP_MAGIC = 'ISO-10303-21'

/** Hard deadline for one worker script. A hang is a miss, not a stall. */
export const MCAD_CQ_TIMEOUT_MS = 120_000

/**
 * The exact, VERIFIED install command. Two pins here are load-bearing and neither
 * is optional on a current host:
 *   - `--python 3.12`: cadquery 2.4.0 resolves to `cadquery-ocp` 7.7.2, which ships
 *     wheels for cp38–cp312 only. On a default CPython 3.13 the resolve fails.
 *   - `'numpy<2'`: cadquery 2.4.0 pins `nptyping==2.0.1`, whose module body reads
 *     `np.bool8` — removed in numpy 2. Without the pin `import cadquery` raises
 *     `AttributeError: module 'numpy' has no attribute 'bool8'` at import time.
 */
export const CADQUERY_INSTALL_FIX =
  'Fix: create the isolated CadQuery venv (needs `uv`):\n' +
  '  cd bench && uv venv --python 3.12 .venv-cadquery \\\n' +
  "    && uv pip install --python .venv-cadquery/bin/python 'cadquery==2.4.0' 'numpy<2'\n" +
  'Both pins are required: cadquery-ocp 7.7.2 has no cp313 wheel, and cadquery 2.4.0 pins ' +
  "nptyping 2.0.1, which reads the numpy-1.x-only `np.bool8` at import.\n" +
  'Or set MCAD_CQ_PYTHON to the ABSOLUTE path of any interpreter that can `import cadquery`.'

/**
 * Resolve the CadQuery interpreter. Never falls back to a system `python`: a
 * silent fallback would either fail deep inside a worker script or — worse — run
 * against a different CadQuery than the golds were calibrated on.
 */
export function resolveCadqueryPython(
  env: Readonly<{ MCAD_CQ_PYTHON?: string }> = process.env,
): string {
  const configured = env.MCAD_CQ_PYTHON
  if (configured === undefined) return venvPythonAt(CADQUERY_VENV)
  if (!isAbsolute(configured)) throw new Error(`MCAD_CQ_PYTHON must be an absolute path (got ${JSON.stringify(configured)})`)
  return configured
}

/** The one message shape for "there is no usable interpreter" — HARNESS.md style. */
export function cadqueryMissingError(python: string, cause?: string): Error {
  return new Error(
    `mcad-cq: no CadQuery interpreter at ${python}${cause ? `\n${cause}` : ''}\n${CADQUERY_INSTALL_FIX}`,
  )
}

// ---------------------------------------------------------------------------
// Prompt mapping (v1's prompt strings are read, never written)
// ---------------------------------------------------------------------------

const CQ_EXPORT_STEP = `cq.exporters.export(result, "${STEP_NAME}")`
const CQ_EXPORT_STL =
  `cq.exporters.export(result, "${STL_NAME}", exportType="STL", opt={"ascii": True}, ` +
  'tolerance=0.01, angularTolerance=0.05)'

/** Shared tail: what the script must WRITE, which is the whole deliverable contract. */
const CQ_DELIVERABLE_TAIL =
  'The script must run standalone under `python model.py` and write BOTH of these files into its ' +
  `current working directory: \`${STEP_NAME}\` (STEP) and \`${STL_NAME}\` (ASCII STL, not binary). ` +
  'Export with exactly these two lines:\n' +
  `  ${CQ_EXPORT_STEP}\n` +
  `  ${CQ_EXPORT_STL}\n` +
  'Those tessellation tolerances are what make round features accurate — do not coarsen them. ' +
  'Reply with ONLY the Python code.'

/** v2 replacement for `MCAD_DELIVERABLE`. */
export const MCAD_CQ_DELIVERABLE =
  'Author a Python script using CadQuery (units: mm) that builds exactly this part as one fused solid ' +
  'and binds it to a variable named `result`. ' +
  CQ_DELIVERABLE_TAIL

/** v2 replacement for `MCAD_DELIVERABLE_MULTIBODY` — task 10 only, same reason as v1. */
export const MCAD_CQ_DELIVERABLE_MULTIBODY =
  'Author a Python script using CadQuery (units: mm) that builds exactly this assembly as the separate ' +
  'solid bodies listed below and binds them to a variable named `result` (a `cq.Compound` of those bodies, ' +
  'or a Workplane holding all of them). The bodies must stay disjoint — no two of them may touch or ' +
  'intersect. ' +
  CQ_DELIVERABLE_TAIL

/**
 * Swap the deliverable preamble for the CadQuery one, leaving the upstream
 * dimensional text byte-identical. Fails loud rather than guessing: a task whose
 * prompt does not open with one of v1's two known preambles means v1 changed
 * shape, and silently shipping a prompt with two contradictory deliverables is
 * exactly the failure this function exists to prevent.
 */
export function toCadQueryPrompt(task: McadTask): string {
  for (const [v1, v2] of [
    [MCAD_DELIVERABLE_MULTIBODY, MCAD_CQ_DELIVERABLE_MULTIBODY],
    [MCAD_DELIVERABLE, MCAD_CQ_DELIVERABLE],
  ] as const) {
    if (task.prompt.startsWith(v1)) return v2 + task.prompt.slice(v1.length)
  }
  throw new Error(
    `mcad-cq: task ${task.id} does not open with a known mcad deliverable preamble; ` +
      'mcad-tasks.ts changed shape and the CadQuery prompt mapping must be updated with it',
  )
}

// ---------------------------------------------------------------------------
// Running the worker's script
// ---------------------------------------------------------------------------

/**
 * The child's whole environment. Nothing is inherited except `PATH` (the
 * interpreter needs its own toolchain on it) and `LANG`. `HOME`/`TMPDIR` point at
 * the scratch dir so the script cannot write to the operator's home, and the proxy
 * variables point at port 9 (discard), which every mainstream HTTP client honours.
 * DISCOURAGEMENT, not a jail — see the file header.
 */
function scriptEnv(dir: string): NodeJS.ProcessEnv {
  const blackhole = 'http://127.0.0.1:9'
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    LANG: process.env.LANG ?? 'C.UTF-8',
    HOME: dir,
    TMPDIR: dir,
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONHASHSEED: '0',
    http_proxy: blackhole,
    https_proxy: blackhole,
    HTTP_PROXY: blackhole,
    HTTPS_PROXY: blackhole,
    no_proxy: '',
    NO_PROXY: '',
  }
}

/**
 * Reject anything that is not an ASCII STL. A binary STL also opens with the
 * bytes `solid` often enough that the header alone is not a test, so the NUL scan
 * carries the decision: ASCII STL is printable text end to end.
 */
export function asciiStlProblem(buf: Buffer): string | undefined {
  if (buf.length === 0) return `${STL_NAME} is empty`
  if (buf.includes(0)) return `${STL_NAME} is not ASCII (contains NUL bytes — it looks like a binary STL)`
  const head = buf.subarray(0, 64).toString('latin1')
  if (!/^\s*solid\b/.test(head)) return `${STL_NAME} does not start with "solid" (got ${JSON.stringify(head.slice(0, 32))})`
  if (!/\bfacet\s+normal\b/.test(buf.toString('utf8'))) return `${STL_NAME} contains no "facet normal" records`
  return undefined
}

/** `part.step` exists AND opens with the ISO 10303-21 magic. Reads 12 bytes, not the file. */
export async function stepFileEmitted(path: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(path, 'r')
  } catch {
    return false
  }
  try {
    const buf = Buffer.alloc(STEP_MAGIC.length)
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
    return bytesRead === buf.length && buf.toString('latin1') === STEP_MAGIC
  } finally {
    await handle.close()
  }
}

export type McadCqBuild =
  | { ok: true; geo: McadGeometry; tris: Tri[]; dir: string; stlPath: string; stepEmitted: boolean }
  | { ok: false; detail: string; dir: string; stepEmitted: boolean }

/**
 * Run one CadQuery script and measure what it delivered. Judge-time only.
 * Throws (never scores) when there is no usable interpreter — an absent toolchain
 * is an operator defect, and scoring it 0 would silently poison a whole corpus.
 */
export async function runAndMeasureCadQuery(src: string, timeoutMs = MCAD_CQ_TIMEOUT_MS): Promise<McadCqBuild> {
  const python = resolveCadqueryPython()
  if (!existsSync(python)) throw cadqueryMissingError(python)

  const dir = await mkdtemp(join(tmpdir(), 'mcad-cq-'))
  const stlPath = join(dir, STL_NAME)
  const stepPath = join(dir, STEP_NAME)
  await writeFile(join(dir, 'model.py'), `${src}\n`)

  const fail = async (detail: string): Promise<McadCqBuild> => ({
    ok: false,
    detail,
    dir,
    stepEmitted: await stepFileEmitted(stepPath),
  })

  try {
    await execFileAsync(python, ['model.py'], {
      cwd: dir,
      env: scriptEnv(dir),
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024 * 64,
    })
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { killed?: boolean; stderr?: string }
    if (e.killed) return fail(`script timed out after ${timeoutMs} ms and was killed`)
    const stderr = (e.stderr ?? e.message ?? '').trim()
    return fail(`script failed: ${stderr.slice(-800)}`)
  }

  let stl: Buffer
  try {
    stl = await readFile(stlPath)
  } catch {
    return fail(`script wrote no ${STL_NAME} in its working directory`)
  }
  const bad = asciiStlProblem(stl)
  if (bad) return fail(bad)

  const tris = parseAsciiStl(stl.toString('utf8'))
  if (tris.length === 0) return fail(`${STL_NAME} parsed to zero triangles (empty geometry)`)

  return {
    ok: true,
    geo: measureMesh(tris),
    tris,
    dir,
    stlPath,
    stepEmitted: await stepFileEmitted(stepPath),
  }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Append the STEP-delivery check to a v1 scoring and recompute. It is one check
 * among the spec's, deliberately: the upstream benchmark's deliverable IS a STEP
 * file, so failing to produce one costs exactly what failing a dimension costs.
 */
export function withStepCheck(scored: McadScoring, stepEmitted: boolean): McadScoring {
  const check: McadCheck = {
    name: 'stepEmitted',
    ok: stepEmitted,
    measured: stepEmitted ? `${STEP_NAME} starts with ${STEP_MAGIC}` : `no ${STEP_NAME} starting with ${STEP_MAGIC}`,
    expected: `${STEP_NAME} exists and starts with ${STEP_MAGIC}`,
  }
  const checks = [...scored.checks, check]
  const failed = checks.filter((c) => !c.ok)
  return { checks, failed, score: (checks.length - failed.length) / checks.length, resolved: failed.length === 0 }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export function createMcadCqAdapter(): BenchmarkAdapter {
  return {
    name: 'mcad-cq',

    async preflight() {
      const python = resolveCadqueryPython()
      if (!existsSync(python)) throw cadqueryMissingError(python)
      try {
        await execFileAsync(python, ['-c', 'import cadquery; print(cadquery.__version__)'], {
          timeout: 300_000,
          env: scriptEnv(tmpdir()),
        })
      } catch (err) {
        const e = err as NodeJS.ErrnoException & { stderr?: string }
        throw cadqueryMissingError(python, `\`import cadquery\` failed: ${(e.stderr ?? e.message ?? '').trim().slice(-800)}`)
      }
    },

    async loadTasks(opts: LoadOptions = {}) {
      let tasks: McadTask[] = MCAD_TASKS
      if (opts.ids) tasks = tasks.filter((t) => opts.ids?.includes(t.id))
      if (opts.limit != null) tasks = tasks.slice(0, opts.limit)
      return tasks.map(
        (t): BenchTask => ({
          id: t.id,
          prompt: toCadQueryPrompt(t),
          metadata: {
            spec: t.spec,
            source: t.source,
            // Calibration is per-ADAPTER: a task calibrated against the OpenSCAD
            // gold says nothing about whether a CadQuery gold reaches 1.0 here.
            calibrated: t.calibrated && !MCAD_CQ_UNCALIBRATED.has(t.id),
          } satisfies McadTaskMeta,
        }),
      )
    },

    async goldArtifact(task: BenchTask) {
      return MCAD_CQ_GOLDS[task.id]
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const spec = (task.metadata as McadTaskMeta | undefined)?.spec
      if (!spec) return { resolved: false, score: 0, detail: `task ${task.id} carries no mcad spec` }

      const src = stripCodeFence(artifact)
      if (!src) return { resolved: false, score: 0, detail: 'empty artifact' }

      const built = await runAndMeasureCadQuery(src)
      if (!built.ok) {
        return { resolved: false, score: 0, detail: `${built.detail} [dir ${built.dir}, stepEmitted ${built.stepEmitted}]` }
      }

      const { geo, tris, stlPath, stepEmitted, dir } = built
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
            stepEmitted,
            stlPath,
            dir,
          }),
        }
      }

      const scored = withStepCheck(scoreAgainstSpec(geo, tris, spec), stepEmitted)
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
          stepEmitted,
          stlPath,
          dir,
        }),
      }
    },
  }
}
