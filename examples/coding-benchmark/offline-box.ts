/**
 * The OFFLINE seam — an in-process `SandboxClient` so the WHOLE benchmark runs
 * with no creds and no network, exactly like `examples/ui-audit/` does.
 *
 * It implements only what `openSandboxRun` actually calls on a box:
 *   - `streamPrompt(prompt, opts)` — the "agent" turn. Offline it deterministically
 *     writes a canned solution into a real temp workspace and emits one terminal
 *     `result` event carrying finalText + tokenUsage (so the run meters honestly).
 *   - `fs.read` / `fs.write` — over the temp workspace (the `artifact` deliverable
 *     + the validators read/write real files here).
 *   - `exec(cmd)` — runs the deterministic check commands. Offline the toolchain
 *     (tsc/biome/node --test) usually isn't installed, so a missing tool reads as a
 *     FAIL — which is the honest offline signal, not a fake pass.
 *   - `delete()` — tears the temp dir down.
 *
 * Swap this for `new SandboxClient({ apiKey, baseUrl })` (cast to the runtime's
 * `SandboxClient`) and the SAME dispatch runs each round in a real harness box.
 * Nothing else in the example changes — that is the point.
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

/** Produces the canned solution an offline "agent" writes for a given task. Two
 *  fidelity levels let the example show the validators/judge separating quality:
 *  a `real` implementation passes the realness scan, a `stub` is caught by it. */
export type OfflineQuality = 'real' | 'stub'

/** A scripted offline solution: which file, what content, per round. The harness
 *  calls `solutionFor(round)` so round 2 can differ from round 1 (refine demo). */
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
      yield {
        type: 'result',
        data: {
          finalText: `wrote ${script.path} (offline round ${round})`,
          tokenUsage: { inputTokens: 600, outputTokens: 400 },
          costUsd: 0,
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
