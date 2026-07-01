/**
 * HumanEval adapter — the deployable-checker domain as a `BenchmarkAdapter`, so the
 * gate runner (`runGate`) can A/B the STEERING regime on it: a real rollout
 * through the `Supervisor` that self-corrects across rounds, vs blind
 * random@k. This is the experiment `humaneval-gate.mts` names as "the next one" —
 * the gate measures SELECTION over stateless single completions; this measures
 * whether observe→steer (self-correction) beats blind compute at equal k.
 *
 * Worker artifact = the model's reply (a Python function, fenced or raw). The
 * DETERMINISTIC judge runs the candidate against the task's own `test` in an
 * isolated `--network=none` python container — exit 0 = pass. No gold
 * `canonical_solution` is ever shown to the model; `goldArtifact` returns it only
 * to self-verify the judge before spending tokens.
 *
 * The primitives (loader / extractor / Docker checker) live here and are reused by
 * `humaneval-gate.mts` — one home, no duplication.
 */

import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

const humanevalUrl = 'https://github.com/openai/human-eval/raw/master/data/HumanEval.jsonl.gz'
const dockerImage = 'python:3.12-slim'
const dockerTimeoutMs = Number(process.env.DOCKER_TIMEOUT_MS ?? 20000)

export interface HumanEvalTask {
  taskId: string
  prompt: string
  test: string
  entryPoint: string
  /** Reference solution body — used ONLY to self-verify the judge, never shown to the worker. */
  canonicalSolution?: string
}

/** Pull the 164-task HumanEval JSONL.gz and parse it. Fail loud on a non-OK fetch
 *  or a malformed line — a silently-short task set would poison the gate. `offset`
 *  selects a deeper slice (the later tasks are harder) so the worker has a
 *  correctable middle band rather than a saturated easy prefix. */
export async function loadHumanEval(limit: number, offset = 0): Promise<HumanEvalTask[]> {
  const res = await fetch(humanevalUrl)
  if (!res.ok) throw new Error(`HumanEval fetch HTTP ${res.status}: ${humanevalUrl}`)
  const gz = Buffer.from(await res.arrayBuffer())
  const text = gunzipSync(gz).toString('utf8')
  const tasks: HumanEvalTask[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    const d = JSON.parse(line) as {
      task_id?: string
      prompt?: string
      test?: string
      entry_point?: string
      canonical_solution?: string
    }
    if (!d.task_id || !d.prompt || !d.test || !d.entry_point) {
      throw new Error(`malformed HumanEval record: ${line.slice(0, 120)}`)
    }
    tasks.push({
      taskId: d.task_id,
      prompt: d.prompt,
      test: d.test,
      entryPoint: d.entry_point,
      ...(d.canonical_solution ? { canonicalSolution: d.canonical_solution } : {}),
    })
  }
  if (tasks.length === 0) throw new Error('HumanEval parsed to 0 tasks')
  if (offset >= tasks.length) throw new Error(`OFFSET ${offset} >= dataset size ${tasks.length}`)
  return tasks.slice(offset, offset + limit)
}

const solveInstruction =
  'Complete the following Python function. Output the COMPLETE function definition (signature, docstring optional, body) inside a single ```python code block. Include any imports the function needs. Do not write tests or example calls.'

export function basePrompt(task: HumanEvalTask): string {
  return `${solveInstruction}\n\n\`\`\`python\n${task.prompt}\`\`\``
}

/** Extract the function source from a model reply: prefer a fenced ```python (or
 *  bare ```) block, else fall back to the raw text. The deployable program adds the
 *  prompt header (imports + signature context), so a candidate that returns only a
 *  body still runs; a candidate that re-defines the function shadows the header. */
export function extractCode(reply: string): string {
  const fenced = reply.match(/```(?:python|py)?\s*\n([\s\S]*?)```/i)
  if (fenced && typeof fenced[1] === 'string') return fenced[1].trim()
  return reply.trim()
}

/** The deployable test program: the prompt header (imports + signature/docstring the
 *  model was given), then the candidate (its def shadows the header's stub), then the
 *  task's own check() suite and the call. No gold solution anywhere. */
function buildProgram(task: HumanEvalTask, candidate: string): string {
  return `${task.prompt}\n${candidate}\n\n${task.test}\n\ncheck(${task.entryPoint})\n`
}

export interface CheckResult {
  /** {0,1} pass-count for this candidate (1 = the check() suite passed). */
  pass: number
  /** On failure: the interpreter stderr tail (traceback / failing assertion). The
   *  execution-grounded feedback a self-repair loop steers on; ignored by selection. */
  detail?: string
}

/** Run one candidate's deployable test program in an isolated container:
 *  `docker run --rm --network=none -v <tmp>:/w -w /w <img> python /w/p.py`.
 *  Exit 0 → pass. A docker invocation error (binary missing, daemon down, image
 *  pull failure) is NOT a test failure — it throws so the harness fails loud rather
 *  than scoring every candidate 0 from a broken checker. */
let dockerRunSeq = 0

export function runChecker(task: HumanEvalTask, candidate: string): Promise<CheckResult> {
  const dir = mkdtempSync(join(tmpdir(), 'hev-'))
  writeFileSync(join(dir, 'p.py'), buildProgram(task, candidate))
  // Unique container name so we can force-reap it regardless of the docker client's state.
  const name = `hev-${process.pid}-${dockerRunSeq++}`
  return new Promise<CheckResult>((resolvePromise, reject) => {
    let settled = false
    const cleanup = () => {
      rmSync(dir, { recursive: true, force: true })
      // `execFile`'s `timeout` kills the docker CLIENT, not the container — a hung
      // `python` would otherwise pin a CPU forever. Force-reap by name (fire-and-forget;
      // the name is unique, so no reuse race).
      execFile('docker', ['rm', '-f', name], () => {})
    }
    const finish = (res: CheckResult) => {
      if (settled) return
      settled = true
      clearTimeout(backstop)
      cleanup()
      resolvePromise(res)
    }
    const fail = (e: Error) => {
      if (settled) return
      settled = true
      clearTimeout(backstop)
      cleanup()
      reject(e)
    }
    // A hung container can leave the docker client stuck forwarding SIGTERM, so the
    // execFile callback never fires. This guarantees resolution (and reap) after the
    // timeout, independent of the callback.
    const backstop = setTimeout(() => finish({ pass: 0 }), dockerTimeoutMs + 3000)
    execFile(
      'docker',
      [
        'run',
        '--rm',
        '--name',
        name,
        '--network=none',
        '--cpus=1',
        '--memory=512m',
        '-v',
        `${dir}:/w:ro`,
        '-w',
        '/w',
        dockerImage,
        'python',
        '/w/p.py',
      ],
      { timeout: dockerTimeoutMs, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: number | string }
          if (e.code === 'ENOENT') {
            fail(new Error('docker binary not found on PATH — cannot run the deployable checker'))
            return
          }
          if (/cannot connect to the docker daemon|is the docker daemon running|permission denied while trying to connect/i.test(stderr)) {
            fail(new Error(`docker daemon unreachable: ${stderr.slice(0, 200)}`))
            return
          }
          if (/(unable to find image|pull access denied|manifest unknown|error response from daemon).*(pull|repository|registry)/i.test(stderr)) {
            fail(new Error(`docker image ${dockerImage} unavailable: ${stderr.slice(0, 200)}`))
            return
          }
          // killed-by-timeout or a non-zero exit (assert failure / error) are genuine
          // test FAILURES — score 0, do not throw. Carry the stderr tail as the
          // execution-grounded failure detail (empty ⇒ timeout/SIGKILL left no output).
          finish({ pass: 0, detail: (stderr || '').slice(-600) || 'timed out (no output)' })
          return
        }
        finish({ pass: 1 })
      },
    )
  })
}

/** A HumanEval task carries its checker inputs in metadata so the deterministic
 *  judge can rebuild the deployable program from a `BenchTask` alone. */
interface HumanEvalMeta extends Record<string, unknown> {
  promptHeader: string
  test: string
  entryPoint: string
  canonicalSolution?: string
}

function toBenchTask(t: HumanEvalTask): BenchTask {
  const metadata: HumanEvalMeta = {
    promptHeader: t.prompt,
    test: t.test,
    entryPoint: t.entryPoint,
    ...(t.canonicalSolution ? { canonicalSolution: t.canonicalSolution } : {}),
  }
  return { id: t.taskId, prompt: basePrompt(t), metadata }
}

function taskFromMeta(task: BenchTask): HumanEvalTask {
  const m = task.metadata as HumanEvalMeta | undefined
  if (!m?.promptHeader || !m.test || !m.entryPoint) {
    throw new Error(`HumanEval judge: task ${task.id} missing checker metadata`)
  }
  return { taskId: task.id, prompt: m.promptHeader, test: m.test, entryPoint: m.entryPoint }
}

/** The HumanEval `BenchmarkAdapter`. OFFSET (env) selects the correctable middle
 *  band; loadTasks honors `limit`/`ids`. The judge is the Docker deployable checker. */
export function createHumanEvalAdapter(): BenchmarkAdapter {
  return {
    name: 'humaneval',
    async preflight() {
      // The judge is the only hard dependency; it fails loud on a missing/broken
      // docker, so a cheap presence check here gives an earlier, clearer signal.
      await new Promise<void>((resolve, reject) => {
        execFile('docker', ['version', '--format', '{{.Server.Version}}'], (err) => {
          if (err) reject(new Error('HumanEval judge needs a running Docker daemon (python:3.12-slim, --network=none)'))
          else resolve()
        })
      })
    },
    async loadTasks(opts?: LoadOptions) {
      const offset = Number(process.env.OFFSET ?? 0)
      // Pull a generous window when filtering by id, else exactly `limit` from offset.
      const all = await loadHumanEval(opts?.ids ? 164 : (opts?.limit ?? 8), offset)
      const picked = opts?.ids ? all.filter((t) => opts.ids?.includes(t.taskId)) : all
      return picked.map(toBenchTask)
    },
    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const { pass } = await runChecker(taskFromMeta(task), extractCode(artifact))
      return { resolved: pass === 1, score: pass, detail: pass === 1 ? 'tests passed' : 'tests failed' }
    },
    async goldArtifact(task: BenchTask) {
      const m = task.metadata as HumanEvalMeta | undefined
      const sol = m?.canonicalSolution
      // Return the COMPLETE function (signature header + canonical body), i.e. what a
      // real worker emits — NOT the body alone. The judge runs `extractCode`, whose
      // unfenced fallback is `reply.trim()`; trimming a body-only string strips its
      // leading indent and breaks it, so a body-only gold fails its own judge. A full
      // def starts at column 0, trims safely, and self-verifies.
      return sol ? `${m!.promptHeader}${sol}` : undefined
    },
  }
}
