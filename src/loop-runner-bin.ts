#!/usr/bin/env node
/**
 * @experimental
 *
 * `agent-runtime-loop` — the schedulable entrypoint for the configured
 * delegated loop-runner. A cron job / routine / Makefile target invokes:
 *
 *   agent-runtime-loop --mode research --config ./loops.config.js
 *
 * The config module wires the registry (with full access to env / creds —
 * which is why the deps live there, not in this generic bin). It must default-
 * export a `DelegatedLoopRegistry`, or a `() => DelegatedLoopRegistry | Promise<…>`.
 * The bin runs the selected mode, prints the `DelegatedLoopResult` as JSON, and
 * exits 0 on `ok`, 1 on a recorded failure, 2 on a usage/config error.
 */

import {
  DELEGATED_LOOP_MODES,
  type DelegatedLoopMode,
  type DelegatedLoopRegistry,
  type DelegatedLoopResult,
  isDelegatedLoopMode,
  runDelegatedLoop,
} from './loop-runner'

/** @experimental Parsed CLI invocation. */
export interface LoopRunnerCliArgs {
  mode: string
  /** Loads the registry — the bin wires this from `--config`; tests inject a stub. */
  loadRegistry: () => Promise<DelegatedLoopRegistry> | DelegatedLoopRegistry
  now?: () => number
}

/** @experimental */
export interface LoopRunnerCliResult {
  exitCode: number
  result?: DelegatedLoopResult
  error?: string
}

/**
 * @experimental
 *
 * Pure CLI core (no process / argv / IO) so it's unit-testable: validate the
 * mode, load the registry, dispatch, map to an exit code (0 ok / 1 failed /
 * 2 usage). Exported for embedding in custom runners + tests.
 */
export async function runLoopRunnerCli(args: LoopRunnerCliArgs): Promise<LoopRunnerCliResult> {
  if (!isDelegatedLoopMode(args.mode)) {
    return {
      exitCode: 2,
      error: `unknown mode '${args.mode}' (expected one of: ${DELEGATED_LOOP_MODES.join(', ')})`,
    }
  }
  let registry: DelegatedLoopRegistry
  try {
    registry = await args.loadRegistry()
  } catch (err) {
    return { exitCode: 2, error: `failed to load registry: ${errMsg(err)}` }
  }
  if (!registry[args.mode]) {
    return {
      exitCode: 2,
      error: `config registers no runner for mode '${args.mode}' (registered: ${
        Object.keys(registry).join(', ') || 'none'
      })`,
    }
  }
  // runDelegatedLoop throws only on a missing runner (guarded above); a failing
  // engine is captured as { ok: false } → exit 1, not a crash.
  const result = await runDelegatedLoop(args.mode as DelegatedLoopMode, registry, {
    ...(args.now ? { now: args.now } : {}),
  })
  return { exitCode: result.ok ? 0 : 1, result }
}

/** Parse `--mode X --config Y` from an argv tail (`process.argv.slice(2)`). */
export function parseLoopRunnerArgv(argv: string[]): { mode?: string; config?: string } {
  const out: { mode?: string; config?: string } = {}
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--mode') out.mode = argv[++i]
    else if (a === '--config') out.config = argv[++i]
    else if (a?.startsWith('--mode=')) out.mode = a.slice('--mode='.length)
    else if (a?.startsWith('--config=')) out.config = a.slice('--config='.length)
  }
  return out
}

/** Normalize a config module's default export → a registry. */
function resolveRegistry(mod: unknown): DelegatedLoopRegistry {
  const def = (mod as { default?: unknown })?.default ?? mod
  const value = typeof def === 'function' ? (def as () => unknown)() : def
  return value as DelegatedLoopRegistry
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The argv → IO → exit shell. Kept thin; logic lives in `runLoopRunnerCli`. */
async function main(): Promise<void> {
  const { mode, config } = parseLoopRunnerArgv(process.argv.slice(2))
  if (!mode || !config) {
    process.stderr.write(
      'usage: agent-runtime-loop --mode <mode> --config <module>\n' +
        `  modes: ${DELEGATED_LOOP_MODES.join(' | ')}\n` +
        '  config: a JS/TS module default-exporting a DelegatedLoopRegistry (or a factory)\n',
    )
    process.exit(2)
  }
  const { pathToFileURL } = await import('node:url')
  const { resolve } = await import('node:path')
  const cli = await runLoopRunnerCli({
    mode,
    loadRegistry: async () => resolveRegistry(await import(pathToFileURL(resolve(config)).href)),
  })
  process.stdout.write(`${JSON.stringify(cli.result ?? { error: cli.error }, null, 2)}\n`)
  if (cli.error) process.stderr.write(`${cli.error}\n`)
  process.exit(cli.exitCode)
}

// Run only when executed as the bin — never when imported for the testable
// core, and never when bundled into a runtime that has no `process.argv`
// (e.g. Cloudflare Workers, where `process` is a shim without `argv`). Reading
// `process.argv[1]` directly would throw at module load there; `process.argv?.`
// keeps the guard a no-op instead of crashing the Worker on startup.
const invokedScript = typeof process !== 'undefined' ? process.argv?.[1] : undefined
if (invokedScript && /loop-runner-bin\.(js|ts|mjs)$/.test(invokedScript)) {
  void main()
}
