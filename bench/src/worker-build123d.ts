/**
 * CADGenBench worker. The deliverable is a STEP B-rep solid (output.step). We
 * author a build123d (Python on the OpenCascade kernel) script via the router,
 * execute it in the CADGenBench venv, and read back the produced output.step —
 * exactly the reference baseline's contract. The artifact returned IS the STEP
 * text, which the CADGenBench geometric scorer grades against the ground truth.
 *
 * The build123d authoring directive is the GEPA-optimizable surface; the
 * build123d API cheat sheet (shipped in the cadgenbench package) is appended as
 * fixed reference context. Requires the CADGenBench venv (CADGENBENCH_VENV) +
 * its clone (CADGENBENCH_DIR for the cheat sheet).
 */

import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Span } from '@tangle-network/agent-eval'
import type { BenchTask } from './benchmarks/types'

const execFileAsync = promisify(execFile)

export const CGB_VENV_PY = process.env.CADGENBENCH_VENV ?? '/tmp/cgb-venv/bin/python'
export const CGB_DIR = process.env.CADGENBENCH_DIR ?? '/tmp/cadgenbench'

async function runLocal(cmd: string, args: string[], cwd: string, timeoutMs = 120_000): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { cwd, maxBuffer: 1 << 26, timeout: timeoutMs })
    return { code: 0, stdout, stderr }
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message?: string }
    return { code: typeof e.code === 'number' ? e.code : 1, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? String(err) }
  }
}

async function routerChatWithUsage(
  cfg: { routerBaseUrl: string; routerKey: string; model: string },
  messages: Array<{ role: string; content: string }>,
): Promise<{ content: string; usage: { input: number; output: number } }> {
  const res = await fetch(`${cfg.routerBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.routerKey}` },
    body: JSON.stringify({ model: cfg.model, messages, temperature: 0.2 }),
  })
  if (!res.ok) throw new Error(`router ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  return {
    content: data.choices?.[0]?.message?.content ?? '',
    usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
  }
}

function extractPy(text: string): string {
  const fence = /```(?:python|py)?\s*\n([\s\S]*?)```/i.exec(text)
  return (fence ? fence[1] : text).trim()
}

let _cheat: string | null = null
function cheatSheet(): string {
  if (_cheat != null) return _cheat
  const p = join(CGB_DIR, 'src/cadgenbench/baseline/build123d_cheat_sheet.md')
  _cheat = existsSync(p) ? readFileSync(p, 'utf8').slice(0, 12000) : ''
  return _cheat
}

/** The hand-written baseline build123d authoring directive — the GEPA surface.
 *  Minimal: states the contract (build123d → output.step, valid solid, match the
 *  spec) but not HOW, leaving headroom for the optimizer. */
export const DEFAULT_BUILD123D_DIRECTIVE =
  'You are an expert CAD engineer. Write a build123d (Python, OpenCascade BREP) script that builds the described part and saves it with `export_step(part, "output.step")`. Output ONLY the Python script — no prose, no markdown fences. The script must run, produce a single VALID watertight solid, and match the described geometry as precisely as possible (exact stated dimensions).'

export interface Build123dConfig {
  routerBaseUrl: string
  routerKey: string
  model: string
  rounds?: number
  /** The build123d authoring directive — the GEPA-optimizable surface. */
  directive?: string
}

export interface Build123dShot {
  /** The produced STEP text (the artifact the CADGenBench scorer grades). */
  artifact: string
  /** The Python source the agent wrote. */
  source: string
  trace: Span[]
  usage: { input: number; output: number }
  ok: boolean
  built: boolean
  detail?: string
}

/** Author a build123d script via the router, execute it in the CADGenBench venv,
 *  read back output.step. Refine on execution error / missing STEP. */
export async function solveBuild123dLocal(task: BenchTask, cfg: Build123dConfig): Promise<Build123dShot> {
  const rounds = Math.max(1, cfg.rounds ?? 2)
  const directive = cfg.directive ?? DEFAULT_BUILD123D_DIRECTIVE
  const sys = `${directive}\n\nbuild123d API reference:\n${cheatSheet()}`
  const dir = await mkdtemp(join(tmpdir(), 'b123d-'))
  const scriptPath = join(dir, 'build.py')
  const stepPath = join(dir, 'output.step')
  const trace: Span[] = []
  const runId = `cadgenbench-${task.id}`
  let ts = Date.now()
  const tick = () => (ts += 1)
  const usage = { input: 0, output: 0 }
  let source = ''
  let step = ''
  let built = false
  let lastErr = ''

  trace.push({ spanId: 's-brief', runId, kind: 'llm', name: 'brief', model: cfg.model, messages: [{ role: 'user', content: task.prompt }], startedAt: tick(), endedAt: tick(), status: 'ok' } as Span)

  try {
    for (let round = 1; round <= rounds && !built; round++) {
      const user =
        round === 1
          ? task.prompt
          : `Your previous build123d script failed:\n${lastErr}\n\nPrevious script:\n${source}\n\nFix it so it runs in python and writes a valid output.step. Brief:\n${task.prompt}`
      const { content, usage: u } = await routerChatWithUsage(cfg, [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ])
      usage.input += u.input
      usage.output += u.output
      source = extractPy(content)
      trace.push({ spanId: `s-author-${round}`, runId, kind: 'llm', name: `author r${round}`, model: cfg.model, messages: [{ role: 'user', content: round === 1 ? task.prompt : 'refine' }], output: content.slice(0, 600), startedAt: tick(), endedAt: tick(), status: 'ok' } as Span)
      trace.push({ spanId: `s-write-${round}`, runId, kind: 'tool', name: 'write_file', toolName: 'create_file', args: { path: 'build.py', content: source }, startedAt: tick(), endedAt: tick(), status: 'ok' } as Span)

      await writeFile(scriptPath, source)
      const run = await runLocal(CGB_VENV_PY, [scriptPath], dir)
      const got = existsSync(stepPath) ? await readFile(stepPath, 'utf8').catch(() => '') : ''
      built = got.includes('ISO-10303-21') && got.length > 200
      lastErr = built ? '' : `${run.stdout}\n${run.stderr}`.trim().slice(-800) || 'no output.step written'
      if (built) step = got
      trace.push({ spanId: `s-exec-${round}`, runId, kind: 'tool', name: `build123d r${round}`, toolName: 'shell.exec', args: 'python build.py', result: (built ? 'wrote output.step' : lastErr).slice(0, 1500), startedAt: tick(), endedAt: tick(), status: built ? 'ok' : 'error', error: built ? undefined : `exit ${run.code}` } as Span)
    }
    return {
      artifact: step,
      source,
      trace,
      usage,
      ok: source.trim().length > 0,
      built,
      detail: built ? 'exported output.step' : `did not produce a STEP in ${rounds} rounds${lastErr ? `; last: ${lastErr.slice(0, 140)}` : ''}`,
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
