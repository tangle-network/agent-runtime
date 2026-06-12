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
        failure_names?: string[]
      }
      const passes = out.passes ?? 0
      const fails = out.fails ?? 0
      // num_tests is the evaluator's authoritative per-requirement count; prefer it
      // over passes+fails (which can disagree if a requirement neither passed nor
      // failed). Never default the total to a phantom denominator.
      const total = out.num_tests ?? passes + fails
      const score = total > 0 ? passes / total : 0
      // failure_names = WHICH sub-tests failed — the evidence a trace analyst
      // steers on. Carried in `detail` so it reaches the verdict's `notes`.
      const failures = Array.isArray(out.failure_names) ? out.failure_names : []
      return {
        resolved: out.success === true,
        score,
        detail: JSON.stringify({
          taskId: meta.taskId,
          success: out.success,
          passes,
          fails,
          total,
          ...(failures.length ? { failures } : {}),
        }),
      }
    },
  }
}

/**
 * AppWorld in its NATIVE protocol: the worker is the driver's interactive ReAct
 * episode (`react` subcommand) — write a python block, the engine executes it in
 * the persistent world, the output feeds back, iterate until done or the turn
 * backstop. The one-shot codegen adapter above plays a strictly harder game
 * (no execution feedback — the first wrong API call kills the whole program at
 * judge time), which flatlines the score against ANY steering; this adapter is
 * the mode the benchmark's published baselines use, where behavior can actually
 * move sub-tests.
 *
 * Protocol: the round task string is `@appworld-react <taskId> <split>` on line 1;
 * everything after line 1 is the steer (an analyst correction, a push directive)
 * and rides into the episode as the `directive` — so the existing arms steer this
 * worker without modification. The artifact is the episode's own evaluation JSON
 * (AppWorld's evaluator ran in-world); judge() parses it and never re-executes.
 */

interface ReactResult {
  success?: boolean
  passes?: number
  fails?: number
  num_tests?: number
  failure_names?: string[]
  turns?: number
  input_tokens?: number
  output_tokens?: number
  transcript?: string
}

const REACT_HEADER = /^@appworld-react (\S+) (\S+)\n?/

/** SandboxClient whose leaf is one full ReAct episode in the AppWorld engine. */
export function appworldReactClient(cfg: {
  model: string
  routerBaseUrl: string
  routerKey: string
  maxTurns?: number
}): unknown {
  const maxTurns = cfg.maxTurns ?? Number(process.env.REACT_MAX_TURNS ?? 40)
  let seq = 0
  return {
    async create() {
      const id = `appworld-react-${seq++}`
      return {
        id,
        async *streamPrompt(prompt: string) {
          const m = prompt.match(REACT_HEADER)
          if (!m) {
            throw new Error(
              `appworld-react leaf: prompt missing '@appworld-react <taskId> <split>' header — got: ${prompt.slice(0, 120)}`,
            )
          }
          const [, taskId, split] = m
          const directive = prompt.replace(REACT_HEADER, '').trim()
          // Direct runner call (not the shared driver()) so the episode carries a
          // wall-clock backstop — a hung in-engine turn must not hang the cell.
          const stdout = await runVenvScriptStdin(
            DRIVER,
            ['react', '--task-id', taskId as string, '--split', split as string],
            JSON.stringify({
              directive,
              model: cfg.model,
              max_turns: maxTurns,
              router_base: cfg.routerBaseUrl,
              router_key: cfg.routerKey,
            }),
            { cwd: benchRoot, timeoutMs: 1_200_000 },
          )
          const lastLine = stdout.trim().split('\n').at(-1) ?? '{}'
          const out = JSON.parse(lastLine) as ReactResult & { error?: string }
          if (out.error) throw new Error(`appworld react episode error: ${out.error}`)
          // Real usage from the episode — flat llm_call so the kernel meters it.
          if (out.input_tokens || out.output_tokens) {
            yield {
              type: 'llm_call',
              data: { tokensIn: out.input_tokens ?? 0, tokensOut: out.output_tokens ?? 0, model: cfg.model },
            }
          }
          yield { type: 'result', data: { finalText: JSON.stringify(out) } }
        },
        async delete() {},
      }
    },
  }
}

/** Artifact = the episode's evaluation JSON, verbatim (no fence extraction). */
const reactEpisodeOutput: OutputAdapter<string> = {
  parse(events) {
    let text = ''
    for (const ev of events) {
      const d = (ev as { data?: Record<string, unknown> })?.data
      const t = d?.finalText
      if (typeof t === 'string' && t.length > 0) text = t
    }
    return text
  },
}

export function createAppWorldReactAdapter(): BenchmarkAdapter {
  const base = createAppWorldAdapter()
  return {
    name: 'appworld-react',
    output: reactEpisodeOutput,
    preflight: () => base.preflight(),

    async loadTasks(opts: LoadOptions = {}): Promise<BenchTask[]> {
      const tasks = await base.loadTasks(opts)
      return tasks.map((t) => {
        const meta = readMeta(t)
        return {
          ...t,
          // Header carries task identity to the leaf; the body (empty at round 0)
          // is the directive slot the arms append their steer into.
          prompt: `@appworld-react ${meta.taskId} ${meta.split}\n`,
        }
      })
    },

    goldArtifact: () => Promise.resolve(undefined),

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const meta = readMeta(task)
      let out: ReactResult
      try {
        out = JSON.parse(artifact) as ReactResult
      } catch {
        throw new Error(
          `appworld-react judge: artifact is not the episode's evaluation JSON (task ${meta.taskId}): ${artifact.slice(0, 200)}`,
        )
      }
      if (typeof out.success !== 'boolean' || typeof out.num_tests !== 'number') {
        throw new Error(
          `appworld-react judge: episode JSON missing success/num_tests (task ${meta.taskId}): ${artifact.slice(0, 200)}`,
        )
      }
      const passes = out.passes ?? 0
      const total = out.num_tests
      const failures = Array.isArray(out.failure_names) ? out.failure_names : []
      return {
        resolved: out.success === true,
        score: total > 0 ? passes / total : 0,
        detail: JSON.stringify({
          taskId: meta.taskId,
          success: out.success,
          passes,
          fails: out.fails ?? 0,
          total,
          turns: out.turns,
          ...(failures.length ? { failures } : {}),
          ...(out.transcript ? { transcriptTail: out.transcript.slice(-800) } : {}),
        }),
      }
    },

    leafClient: (c) => appworldReactClient(c),
  }
}
