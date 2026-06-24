/**
 * The OFFLINE seam — an in-process `SandboxClient` so the WHOLE benchmark runs
 * with no creds and no network, exactly like `examples/ui-audit/` does.
 *
 * The offline "agent" is a SCRIPTED STAND-IN for a real coding agent: it writes a
 * canned solution per round instead of calling a model. That is the only thing
 * stubbed — the matrix, the verifier, the realness gate, the judge wiring, and the
 * stats all run for real. `--live` swaps this client for `new SandboxClient(...)`
 * and the same dispatch runs each round in a real harness box.
 *
 * It implements only what `openSandboxRun` actually calls on a box:
 *   - `streamPrompt(prompt, opts)` — the "agent" turn. Writes the round's scripted
 *     solution into a real temp workspace and emits one terminal `done` event — the
 *     SAME shape a live box emits, carrying `tokenUsage` so the run meters honestly
 *     and `extractLlmCallEvent` reads it.
 *   - `fs.read` / `fs.write` — over the temp workspace (the `artifact` deliverable +
 *     the seeded fixture live here).
 *   - `exec(cmd)` — runs the deterministic check + fixture-seed commands. Offline the
 *     toolchain (tsc / biome / node --test) usually isn't installed, so a missing tool
 *     reads as a FAIL — the honest offline signal, not a fake pass. (The checks never
 *     pass offline, so all `maxRounds` run — which is exactly when refinement shows.)
 *   - `delete()` — tears the temp dir down.
 */

import { exec as execCb } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { SandboxClient } from '@tangle-network/agent-runtime/loops'
import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'

const execAsync = promisify(execCb)

/** A scripted offline solution: which file, and what content to write on a given
 *  round. `solutionFor(round)` lets round N differ from round N-1 — a REAL refine
 *  demo, not a constant. */
export interface OfflineScript {
  path: string
  solutionFor: (round: number) => string
}

function instanceMethods(workdir: string, script: OfflineScript) {
  let round = 0
  return {
    id: `offline-${Math.random().toString(36).slice(2, 8)}`,
    // The "agent" turn. Writes the scripted solution, emits one terminal event.
    async *streamPrompt(_message: string | unknown[]): AsyncGenerator<SandboxEvent> {
      const content = script.solutionFor(round)
      round += 1
      const abs = join(workdir, script.path)
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, content, 'utf8')
      // The real sandbox terminal event shape: `done` with `data.tokenUsage` +
      // top-level `totalCostUsd`. `extractLlmCallEvent` reads exactly this.
      yield {
        type: 'done',
        data: {
          tokenUsage: { inputTokens: 600, outputTokens: 400 },
          totalCostUsd: 0,
          finalText: `wrote ${script.path} (offline round ${round})`,
        },
      } as unknown as SandboxEvent
    },
    fs: {
      async read(path: string): Promise<string> {
        return readFile(join(workdir, path), 'utf8')
      },
      async write(path: string, content: string): Promise<void> {
        const abs = join(workdir, path)
        await mkdir(dirname(abs), { recursive: true })
        await writeFile(abs, content, 'utf8')
      },
    },
    async exec(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
      try {
        const { stdout, stderr } = await execAsync(command, { cwd: workdir, timeout: 30_000 })
        return { exitCode: 0, stdout, stderr }
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string; message?: string }
        return {
          exitCode: e.code ?? 1,
          stdout: e.stdout ?? '',
          stderr: e.stderr ?? e.message ?? '',
        }
      }
    },
    async delete(): Promise<void> {
      rmSync(workdir, { recursive: true, force: true })
    },
  }
}

/** An in-process `SandboxClient`. Each `create()` mints a fresh temp workspace box. */
export function offlineSandboxClient(script: OfflineScript): SandboxClient {
  return {
    async create(_options?: CreateSandboxOptions): Promise<SandboxInstance> {
      const workdir = mkdtempSync(join(tmpdir(), 'coding-bench-'))
      return instanceMethods(workdir, script) as unknown as SandboxInstance
    },
  }
}
