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

import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import {
  collectAgentTurn,
  createExecutor,
  type OutputAdapter,
  streamAgentTurn,
  type ToolSpec,
} from '@tangle-network/agent-runtime/kernel'
import { benchRoot, preflightVenvImports, runVenvScriptStdin, venvPython } from './_harness'
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
 * AppWorld in its NATIVE protocol, run by OUR runtime: the worker is
 * Runtime's profile-bound `router-tools` executor with one tool —
 * `execute_python` — bound to a persistent AppWorld world session. The driver's
 * `session` subcommand is a dumb world shim (stdin JSONL: execute → output,
 * evaluate → verdict); every inference turn, the metering, and the typed
 * toolTrace the analyst steers on belong to the runtime, so runtime
 * improvements are what this benchmark measures.
 *
 * The one-shot codegen adapter above plays a strictly harder game (no execution
 * feedback — the first wrong API call kills the whole program at judge time),
 * which flatlines the score against ANY steering; this mode is what the
 * benchmark's published baselines use, where behavior can move sub-tests.
 *
 * Protocol: the round task string is `@appworld-react <taskId> <split>` on
 * line 1; everything after line 1 is the steer (an analyst correction, a push
 * directive) appended to the system prompt — so the existing arms steer this
 * worker without modification. The artifact is the episode evaluation JSON
 * (AppWorld's evaluator ran in-world); judge() parses it, never re-executes.
 */

export interface ReactResult {
  success?: boolean
  passes?: number
  fails?: number
  num_tests?: number
  failure_names?: string[]
  turns?: number
  input_tokens?: number
  output_tokens?: number
  cost_usd?: number
  transcript?: string
}

interface ReactRuntimeUsage {
  input: number
  output: number
  costUsd?: number
  tokensKnown?: boolean
  usdKnown?: boolean
}

/** Preserve a completed scientific/task result even when one accounting dimension is incomplete.
 * Unknown usage fields stay absent; later comparison/reporting can refuse a cost claim without
 * discarding the episode's task evidence. */
export function appworldReactResultWithUsage(
  verdict: ReactResult,
  usage: ReactRuntimeUsage,
  turns: number | undefined,
  transcript: string,
): ReactResult {
  return {
    ...verdict,
    ...(turns !== undefined ? { turns } : {}),
    ...(usage.tokensKnown === false
      ? {}
      : { input_tokens: usage.input, output_tokens: usage.output }),
    ...(usage.usdKnown === false || usage.costUsd === undefined
      ? {}
      : { cost_usd: usage.costUsd }),
    transcript,
  }
}

/** Emit only usage the Runtime actually knows. Catalog estimates never become observed dollars. */
export function appworldReactUsageEvent(
  result: ReactResult,
  model: string,
): { type: 'llm_call'; data: Record<string, unknown> } | undefined {
  const hasTokens =
    typeof result.input_tokens === 'number' && typeof result.output_tokens === 'number'
  const hasCost = typeof result.cost_usd === 'number'
  if (!hasTokens && !hasCost) return undefined
  return {
    type: 'llm_call',
    data: {
      model,
      ...(hasTokens
        ? { tokensIn: result.input_tokens, tokensOut: result.output_tokens }
        : {}),
      ...(hasCost ? { costUsd: result.cost_usd } : {}),
    },
  }
}

const REACT_HEADER = /^@appworld-react (\S+) (\S+)\n?/

const SESSION_SYSTEM = [
  'You are completing a task in AppWorld, a simulated multi-app environment.',
  'Use the execute_python tool to run Python that calls the app APIs (the `apis.<app>.<function>(...)` surface).',
  'Inspect API docs with `apis.api_docs.show_api_descriptions(app_name=...)` and `apis.api_docs.show_api_doc(app_name=..., api_name=...)`.',
  'Authenticate where needed via the supervisor-provided credentials (`apis.supervisor.show_account_passwords()`).',
  'Work incrementally: small snippets, read each output, correct course.',
  'When every step of the task is done, run `apis.supervisor.complete_task()` and then reply WITHOUT calling the tool again.',
].join('\n')

const EXECUTE_TOOL: ToolSpec = {
  type: 'function',
  function: {
    name: 'execute_python',
    description:
      'Execute a Python snippet in the persistent AppWorld world. State persists across calls. Returns the execution output (API results or errors).',
    parameters: {
      type: 'object',
      properties: { code: { type: 'string', description: 'Python code calling apis.<app>.<fn>(...)' } },
      required: ['code'],
    },
  },
}

/** One persistent world session: line-JSONL request/response over the driver. */
async function withWorldSession<T>(
  taskId: string,
  split: string,
  fn: (call: (cmd: Record<string, unknown>) => Promise<Record<string, unknown>>, instruction: string) => Promise<T>,
): Promise<T> {
  const child = spawn(venvPython, [DRIVER, 'session', '--task-id', taskId, '--split', split], {
    cwd: benchRoot,
  })
  const rl = createInterface({ input: child.stdout })
  const pending: Array<(line: string) => void> = []
  const backlog: string[] = []
  rl.on('line', (l) => {
    const next = pending.shift()
    if (next) next(l)
    else backlog.push(l)
  })
  let stderr = ''
  child.stderr.on('data', (c: Buffer) => {
    stderr += c.toString('utf8')
  })
  const nextLine = (timeoutMs: number): Promise<string> =>
    new Promise((resolve, reject) => {
      const fromBacklog = backlog.shift()
      if (fromBacklog !== undefined) return resolve(fromBacklog)
      const t = setTimeout(
        () => reject(new Error(`appworld session: no response in ${timeoutMs}ms; stderr: ${stderr.slice(-400)}`)),
        timeoutMs,
      )
      // One exit listener per await leaks (25-turn episodes blow the listener
      // cap) — remove it on the resolve path.
      const onExit = (code: number | null): void => {
        clearTimeout(t)
        reject(new Error(`appworld session exited (${code}); stderr: ${stderr.slice(-400)}`))
      }
      pending.push((l) => {
        clearTimeout(t)
        child.removeListener('exit', onExit)
        resolve(l)
      })
      child.once('exit', onExit)
    })
  try {
    const ready = JSON.parse(await nextLine(120_000)) as { ready?: boolean; instruction?: string; error?: string }
    if (!ready.ready) throw new Error(`appworld session failed to start: ${ready.error ?? 'no ready line'}`)
    const call = async (cmd: Record<string, unknown>): Promise<Record<string, unknown>> => {
      child.stdin.write(`${JSON.stringify(cmd)}\n`)
      const res = JSON.parse(await nextLine(180_000)) as Record<string, unknown>
      if (typeof res.error === 'string') throw new Error(`appworld session op failed: ${res.error}`)
      return res
    }
    return await fn(call, ready.instruction ?? '')
  } finally {
    child.stdin.end()
    child.kill('SIGTERM')
  }
}

/** SandboxClient whose leaf is Runtime's profile-bound Router executor driving a world session. */
export function appworldToolLoopClient(cfg: {
  model: string
  routerBaseUrl: string
  routerKey: string
  maxTurns?: number
}): unknown {
  const maxTurns = cfg.maxTurns ?? Number(process.env.REACT_MAX_TURNS ?? 40)
  let seq = 0
  return {
    async create() {
      const id = `appworld-toolloop-${seq++}`
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
          const out = await withWorldSession(taskId as string, split as string, async (call, instruction) => {
            const system = directive ? `${SESSION_SYSTEM}\n\n${directive}` : SESSION_SYSTEM
            const transcriptSteps: Array<{ args: string; result: string }> = []
            const profile = {
              name: 'appworld-react-worker',
              harness: 'cli-base' as const,
              model: {
                provider: 'tangle-router',
                default: cfg.model,
                metadata: { maxTurns },
              },
              prompt: { systemPrompt: system },
              tools: { execute_python: true },
            }
            const factory = createExecutor({
              backend: 'router-tools',
              routerBaseUrl: cfg.routerBaseUrl,
              routerKey: cfg.routerKey,
              tools: [EXECUTE_TOOL],
              executeToolCall: async (name, args) => {
                if (name !== 'execute_python') return `error: unknown tool ${name}`
                const res = await call({ op: 'execute', code: String(args.code ?? '') })
                const done = res.task_completed === true
                const result = `${String(res.output ?? '')}${done ? '\n\n[TASK MARKED COMPLETE — reply with a final summary and do not call the tool again]' : ''}`
                transcriptSteps.push({ args: JSON.stringify(args), result })
                return result
              },
            })
            const loop = await collectAgentTurn(
              streamAgentTurn(
                { kind: 'executor', factory, profile },
                `Task: ${instruction}`,
              ),
            )
            if (loop.status !== 'completed') {
              throw new Error(loop.error?.message ?? `AppWorld turn ended with ${loop.status}`)
            }
            const verdict = (await call({ op: 'evaluate' })) as unknown as ReactResult
            const transcript = transcriptSteps
              .slice(-3)
              .map((t) => `CODE:\n${t.args.slice(0, 600)}\nOUTPUT:\n${t.result.slice(0, 600)}`)
              .join('\n---\n')
              .slice(0, 1600)
            const finalEvent = loop.events.at(-1)
            const resultMetadata =
              finalEvent?.type === 'final' && finalEvent.metadata?.result
                ? (finalEvent.metadata.result as { spent?: { iterations?: number } })
                : undefined
            return appworldReactResultWithUsage(
              verdict,
              loop.usage,
              resultMetadata?.spent?.iterations,
              transcript,
            )
          })
          const usageEvent = appworldReactUsageEvent(out, cfg.model)
          if (usageEvent) yield usageEvent
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

    leafClient: (c) => appworldToolLoopClient(c),
  }
}
