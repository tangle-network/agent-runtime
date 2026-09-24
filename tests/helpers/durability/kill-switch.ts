/**
 * Kill-point instrumentation for the durability conformance suites.
 *
 * A kill label names one exact instant in a run's scripted progress ("driver:turn:3:before",
 * "worker:builder:mid"). The child process arms exactly one label; the instant the run reaches it,
 * the child SIGKILLs ITSELF — no unwinding, no teardown, no flush — so the crash boundary is a
 * real OS process death at a known step of the work, reproducible case by case.
 *
 * The same seam RECORDS every label a no-kill reference run passes through, so the suite's case
 * matrix is the run's own step sequence (each step boundary and each mid-step point), never a
 * hand-maintained list that can drift from the script.
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'

/** SIGKILL this process NOW when the armed label is reached. */
export type KillSwitch = (label: string) => void

export interface KillSwitchOptions {
  /** The one label to die on, or undefined to only record (the reference run). */
  readonly killAt?: string
  /** File every passed label is appended to (the reference sequence). */
  readonly labelsFile: string
  /** File the armed kill records its hit to, so the parent can prove WHERE the process died. */
  readonly killedFile?: string
}

export function armKillSwitch(opts: KillSwitchOptions): KillSwitch {
  mkdirSync(dirnameOf(opts.labelsFile), { recursive: true })
  return (label: string): void => {
    appendFileSync(opts.labelsFile, `${label}\n`)
    if (opts.killAt !== undefined && label === opts.killAt) {
      if (opts.killedFile !== undefined) appendFileSync(opts.killedFile, `${label}\n`)
      process.kill(process.pid, 'SIGKILL')
    }
  }
}

/** Read a label log as non-empty lines. Missing file = empty list. */
export function readLabels(file: string): string[] {
  try {
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.length > 0)
  } catch {
    return []
  }
}

function dirnameOf(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx <= 0 ? '.' : path.slice(0, idx)
}
