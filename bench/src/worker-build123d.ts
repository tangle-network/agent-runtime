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
import { DEFAULT_BUILD123D_DIRECTIVE } from './directives'
import { runRefineLoop } from './refine-loop'
import { runBenchRouterTurn } from './router-turn'

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

interface Build123dConfig {
  routerBaseUrl: string
  routerKey: string
  model: string
  rounds?: number
  /** The build123d authoring directive — the GEPA-optimizable surface. */
  directive?: string
}

interface Build123dShot {
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
