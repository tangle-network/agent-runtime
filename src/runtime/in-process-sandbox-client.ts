/**
 * The ONE in-process pseudo-box: present a plain user callback as a
 * `SandboxClient` so an example or test can drive `runLoop` / `openSandboxRun`
 * with zero credentials and zero network — without re-faking a box at each call
 * site via `as unknown as SandboxInstance`.
 *
 * It is the structural sibling of {@link inlineSandboxClient}: that one adapts an
 * `Executor` (router / bridge / BYO) into a box; this one adapts a single
 * `onPrompt(prompt, round)` callback into a box. Both exist because
 * `SandboxInstance` is a `declare class` with private fields — a plain object
 * literal can NEVER structurally satisfy it, so every offline seam was forced to
 * write `as unknown as SandboxInstance`. The one unavoidable cast now lives HERE,
 * documented and tested, instead of in every example.
 *
 * What the box implements is exactly the subset `runLoop` + `openSandboxRun`
 * actually call on a box:
 *   - `id` — stable per box, used for trace correlation.
 *   - `streamPrompt(prompt, opts?)` — runs `onPrompt` and streams its events.
 *   - `streamTask(prompt, opts?)` — the task-mode verb (`streamAgentTurn`'s
 *     `box-task` backend); runs `onTask` when configured, else `onPrompt`.
 *   - `fs.read` / `fs.write` — over the optional real `workdir` (the deliverable
 *     artifact + any seeded fixtures live there). Present only when a `workdir`
 *     is given.
 *   - `exec(command)` — runs the command in `workdir`. Present only when a
 *     `workdir` is given.
 *   - `delete()` — removes the per-box temp dir (when one was minted) and is a
 *     no-op otherwise; `deleteBoxSafe` calls it at teardown.
 *
 * The `SandboxEvent` shape the callback returns — `{ type, data }` — is the
 * runtime metering protocol the kernel reads: emit a flat `llm_call`
 * (`{ tokensIn, tokensOut, costUsd }`) or a terminal `done`
 * (`{ tokenUsage, totalCostUsd }`) / `result` event and the kernel's cost ledger
 * picks it up. No cast is needed on the events (the union is structural); only
 * the box object is cast, once, inside this file.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import type { SandboxClient } from './types'

/** Context handed to each `onPrompt` / `onTask` call. */
export interface InProcessPromptCtx {
  /** 0-based round index — increments per `streamPrompt`/`streamTask` on the
   *  SAME box (so a refine driver's round N can differ from round N-1). Fresh
   *  boxes start at 0. */
  round: number
  /** Absolute path of this box's workspace, when a `workdir` was configured.
   *  Write the deliverable / fixtures here; `fs.read`/`fs.write`/`exec` operate
   *  over it. `undefined` for pure event-only boxes. */
  workdir?: string
  /** Cooperative cancellation channel for this turn. */
  signal: AbortSignal
  /** Which box verb produced this call: `prompt` = `streamPrompt`,
   *  `task` = `streamTask`. */
  mode: 'prompt' | 'task'
  /** The verbatim per-call options the caller passed to the box verb (minus
   *  `signal`, surfaced above) — lets an offline test assert an options
   *  passthrough (`model`, `sessionId`, `maxTurns`, …) actually arrived. */
  options?: Record<string, unknown>
}

/**
 * The user callback: given a prompt and its round, produce the box's event
 * stream for that turn. Return a plain `SandboxEvent[]` (the common case) or an
 * async iterable for streaming. The callback may also write files into
 * `ctx.workdir` (read back via `fs.read` or graded by `exec`).
 */
export type InProcessOnPrompt = (
  prompt: string,
  ctx: InProcessPromptCtx,
) => SandboxEvent[] | AsyncIterable<SandboxEvent> | Promise<SandboxEvent[]>

/** @experimental */
export interface InProcessSandboxClientOptions {
  /** The per-turn behavior — see {@link InProcessOnPrompt}. */
  onPrompt: InProcessOnPrompt
  /**
   * Task-mode behavior, driven by `box.streamTask` (the verb `streamAgentTurn`'s
   * `box-task` backend calls). When omitted, `streamTask` drives `onPrompt` —
   * the pseudo-box has ONE behavior callback and both verbs exercise it
   * (`ctx.mode` tells them apart). Provide `onTask` when a test must
   * discriminate the verbs or script different task-mode behavior.
   */
  onTask?: InProcessOnPrompt
  /**
   * Opt in to a REAL filesystem-backed box. When set, each `create()` mints a
   * fresh temp directory (prefixed `<workdir>-`) and the box exposes
   * `fs.read`/`fs.write` and `exec` over it; `delete()` removes the dir. Omit
   * for a pure event-only box (no `fs`/`exec` members), which is all a driver
   * or fanout loop needs.
   */
  workdir?: string
  /**
   * Override the box `id`. A string is used verbatim; a function receives the
   * 0-based create-sequence and returns the id (e.g. machine-keyed placement
   * demos). Default `in-process-<seq>`. The id is the value `describePlacement`
   * tags, so set it when a demo's output reads on a meaningful sandbox id.
   */
  id?: string | ((seq: number) => string)
}

function isAsyncIterable(v: unknown): v is AsyncIterable<SandboxEvent> {
  return typeof v === 'object' && v !== null && Symbol.asyncIterator in v
}

/**
 * Adapt a single `onPrompt(prompt, ctx)` callback into a `SandboxClient` for
 * `runLoop` / `openSandboxRun`. Returns a PROPERLY-TYPED `SandboxClient`: the
 * lone `SandboxInstance` cast (object literal → `declare class`) lives inside
 * this function, so call sites stay cast-free.
 *
 * @experimental
 */
export function inProcessSandboxClient(options: InProcessSandboxClientOptions): SandboxClient {
  const { onPrompt, onTask, workdir: workdirPrefix, id: idOption } = options
  let seq = 0
  return {
    async create(_options?: CreateSandboxOptions): Promise<SandboxInstance> {
      const current = seq++
      const id =
        typeof idOption === 'function' ? idOption(current) : (idOption ?? `in-process-${current}`)
      const boxWorkdir =
        workdirPrefix !== undefined ? mkdtempSync(join(tmpdir(), `${workdirPrefix}-`)) : undefined
      let round = 0

      const fsMembers =
        boxWorkdir !== undefined
          ? {
              fs: {
                async read(path: string): Promise<string> {
                  return readFile(join(boxWorkdir, path), 'utf8')
                },
                async write(path: string, content: string): Promise<void> {
                  const abs = join(boxWorkdir, path)
                  await mkdir(dirname(abs), { recursive: true })
                  await writeFile(abs, content, 'utf8')
                },
              },
              async exec(
                command: string,
              ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
                const { exec: execCb } = await import('node:child_process')
                const { promisify } = await import('node:util')
                const execAsync = promisify(execCb)
                try {
                  const { stdout, stderr } = await execAsync(command, {
                    cwd: boxWorkdir,
                    timeout: 30_000,
                  })
                  return { exitCode: 0, stdout, stderr }
                } catch (err) {
                  const e = err as {
                    code?: number
                    stdout?: string
                    stderr?: string
                    message?: string
                  }
                  return {
                    exitCode: e.code ?? 1,
                    stdout: e.stdout ?? '',
                    stderr: e.stderr ?? e.message ?? '',
                  }
                }
              },
            }
          : {}

      async function* drive(
        behavior: InProcessOnPrompt,
        mode: 'prompt' | 'task',
        message: string | unknown[],
        opts?: { signal?: AbortSignal } & Record<string, unknown>,
      ): AsyncGenerator<SandboxEvent> {
        const prompt = typeof message === 'string' ? message : JSON.stringify(message)
        const { signal: optSignal, ...rest } = opts ?? {}
        const signal = optSignal ?? new AbortController().signal
        const ctx: InProcessPromptCtx = {
          round,
          workdir: boxWorkdir,
          signal,
          mode,
          ...(Object.keys(rest).length > 0 ? { options: rest } : {}),
        }
        round += 1
        const produced = await behavior(prompt, ctx)
        if (isAsyncIterable(produced)) {
          for await (const ev of produced) yield ev
        } else {
          for (const ev of produced) yield ev
        }
      }

      const box = {
        id,
        streamPrompt(
          message: string | unknown[],
          opts?: { signal?: AbortSignal } & Record<string, unknown>,
        ): AsyncGenerator<SandboxEvent> {
          return drive(onPrompt, 'prompt', message, opts)
        },
        // Task-mode verb (`streamAgentTurn`'s `box-task` backend). Drives
        // `onTask` when configured; otherwise the box's one behavior callback.
        streamTask(
          message: string | unknown[],
          opts?: { signal?: AbortSignal } & Record<string, unknown>,
        ): AsyncGenerator<SandboxEvent> {
          return drive(onTask ?? onPrompt, 'task', message, opts)
        },
        ...fsMembers,
        async delete(): Promise<void> {
          if (boxWorkdir !== undefined) rmSync(boxWorkdir, { recursive: true, force: true })
        },
      }
      // The ONE unavoidable cast: `SandboxInstance` is a `declare class` with
      // private fields, so an object implementing only the called subset cannot
      // structurally satisfy it. Contained here so call sites never cast.
      return box as unknown as SandboxInstance
    },
  }
}
