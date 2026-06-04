/**
 * AppWorld adapter (StonyBrookNLP/appworld). Worker artifact = the agent's
 * Python solution that calls the simulated apps' APIs (the same `apis.<app>.<fn>`
 * surface AppWorld exposes inside `world.execute(...)`), ending in
 * `apis.supervisor.complete_task()`. Judge = AppWorld's OWN programmatic
 * evaluator: a driver runs the solution in a fresh `AppWorld(task_id=...)` world,
 * then `world.evaluate().to_dict()` reports `success` (binary TGC), `num_tests`
 * (per-requirement total) and the `passes`/`failures` lists. Score =
 * passes / num_tests — GRADED; resolved = success. Fully deterministic — no LLM judge.
 *
 * loadTasks enumerates the real task suite via `load_task_ids(split)`
 * (train|dev|test_normal|test_challenge); the prompt = `world.task.instruction`.
 * The OutputAdapter is stream-only, so the worker emits its solution as a fenced
 * ```python block which the driver executes.
 *
 * Requires for a live run: the bench `.venv` with `appworld` installed + the
 * unpacked engine + downloaded data (`appworld install` ; `appworld download
 * data`). preflight + loadTasks + judge all fail loud with the exact step when the
 * engine/data is absent — never a fabricated score.
 */

import { join } from 'node:path'
import type { OutputAdapter } from '@tangle-network/agent-runtime/loops'
import { benchRoot, preflightVenvImports, runVenvScriptStdin } from './_harness'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

const DRIVER = join(benchRoot, 'scripts', 'appworld_driver.py')

/** AppWorld splits; only the test splits ship evaluation-only (no setup/solution). */
const DEFAULT_SPLIT = 'test_normal'

interface AppWorldMeta {
  taskId: string
  split: string
}

/** Worker solution code = the last fenced ```python block, else the raw text. */
export const appworldSolutionOutput: OutputAdapter<string> = {
  parse(events) {
    let text = ''
    for (const ev of events) {
      const d = (ev as { data?: Record<string, unknown> })?.data
      const t = d?.finalText ?? d?.text ?? d?.result
      if (typeof t === 'string' && t.length > 0) text = t
    }
    const fences = [...text.matchAll(/```(?:python|py)?\s*\n([\s\S]*?)```/g)]
    return (fences.at(-1)?.[1] ?? text).trim()
  },
}

const WORKER_CONTRACT = [
  '',
  'Solve this by writing Python that calls the available app APIs (the `apis.<app>.<function>(...)` surface). You may inspect API docs with `apis.api_docs.show_api_descriptions(app_name=...)` and `apis.api_docs.show_api_doc(app_name=..., api_name=...)`.',
  'Authenticate where needed via the supervisor-provided credentials, perform every step the task requires, and FINISH with `apis.supervisor.complete_task()`.',
  'Emit your COMPLETE solution as the LAST thing in your reply, in a single fenced ```python block. Nothing after the closing fence.',
].join('\n')

function readMeta(task: BenchTask): AppWorldMeta {
  const md = task.metadata
  if (!md || typeof md.taskId !== 'string') {
    throw new Error(`appworld task ${task.id} missing metadata.taskId — loadTasks did not populate it`)
  }
  return md as unknown as AppWorldMeta
}

/**
 * Run the appworld engine driver with a subcommand; JSON on the LAST stdout line.
 * The solution code (evaluate) is piped to stdin via the shared stdin-aware runner —
 * execFile's `input` option is not honored async and hangs the driver's
 * sys.stdin.read() forever. `load` ignores stdin, so an empty pipe is harmless.
 */
async function driver(args: string[], input = ''): Promise<unknown> {
  let stdout: string
  try {
    stdout = await runVenvScriptStdin(DRIVER, args, input, { cwd: benchRoot })
  } catch (err) {
    const e = err as { message?: string }
    throw new Error(`appworld driver failed (${args.join(' ')}): ${(e.message || String(err)).slice(0, 1500)}`)
  }
  const last = stdout.trim().split('\n').at(-1) ?? '{}'
  const parsed = JSON.parse(last) as { error?: string }
  if (parsed.error) throw new Error(`appworld driver error: ${parsed.error}`)
  return parsed
}

export function createAppWorldAdapter(): BenchmarkAdapter {
  return {
    name: 'appworld',
    output: appworldSolutionOutput,

    async preflight() {
      await preflightVenvImports({
        modules: ['appworld'],
        requireDocker: false,
        fix:
          'Fix: bench/.venv/bin/pip install appworld ; ' +
          'bench/.venv/bin/appworld install ; bench/.venv/bin/appworld download data ' +
          '(unpacks the engine + downloads the simulated-app data/tasks). ' +
          'Set APPWORLD_ROOT to the data root if not the default.',
      })
    },

    async loadTasks(opts: LoadOptions = {}): Promise<BenchTask[]> {
      const split = opts.split ?? DEFAULT_SPLIT
      const out = (await driver([
        'load',
        '--split', split,
        ...(opts.limit !== undefined ? ['--limit', String(opts.limit)] : []),
        ...(opts.ids ? ['--ids', opts.ids.join(',')] : []),
      ])) as { tasks?: Array<{ task_id: string; instruction: string }> }
      const tasks = out.tasks ?? []
      if (tasks.length === 0) {
        throw new Error(`appworld loadTasks returned no tasks for split=${split} ${JSON.stringify(opts)}`)
      }
      return tasks.map(
        (t): BenchTask => ({
          id: t.task_id,
          split,
          prompt: t.instruction + WORKER_CONTRACT,
          metadata: { taskId: t.task_id, split } as unknown as Record<string, unknown>,
        }),
      )
    },

    async goldArtifact() {
      // Reference solution code ships only for train/dev, and only inside the
      // engine's decrypted `.bundle` (it is not a portable string this adapter can
      // emit across splits). The test splits are evaluation-only. So verify-judge
      // here requires a real solve on a train/dev task through the live engine
      // rather than a synthetic gold — returning a fabricated artifact would be a
      // fake. Returns undefined.
      return undefined
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const meta = readMeta(task)
      const out = (await driver(['evaluate', '--task-id', meta.taskId, '--split', meta.split], artifact)) as {
        success?: boolean
        passes?: number
        fails?: number
        num_tests?: number
      }
      const passes = out.passes ?? 0
      const fails = out.fails ?? 0
      // num_tests is the evaluator's authoritative per-requirement count; prefer it
      // over passes+fails (which can disagree if a requirement neither passed nor
      // failed). Never default the total to a phantom denominator.
      const total = out.num_tests ?? passes + fails
      const score = total > 0 ? passes / total : 0
      return {
        resolved: out.success === true,
        score,
        detail: JSON.stringify({ taskId: meta.taskId, success: out.success, passes, fails, total }),
      }
    },
  }
}
