/**
 * GEN-4 proposer-model provenance — pin each author seat's MODEL IDENTITY in
 * the run record at t=0, before any author shot fires.
 *
 * Why: a proposer spec may pin a model explicitly (`spec.model` → the harness
 * CLI's `-m` flag via the author profile's `model.default`), but the claude
 * seat deliberately does NOT pass `-m` — the CLI runs on its logged-in
 * account, whose resolved model comes from its own settings. Verified against
 * claude CLI 2.1.217: `--model` IS supported headless (`-p`), but the run's
 * provenance must not depend on a flag we chose not to send. So the capture
 * records what is VERIFIABLE at launch for every configured harness:
 *
 *   - `<harness> --version` output (the exact CLI build that authored),
 *   - the claude settings default model (`~/.claude/settings.json` `model`),
 *   - `codex login status` (the codex seat must be authed or the run refuses
 *     at t=0 — a mid-run auth failure would silently kill one candidate slot),
 *   - the spec's pinned model id (null when the seat rides the CLI default).
 *
 * The capture FAILS LOUD on a missing/broken harness binary: populationSize
 * must equal proposers.length, so a dead seat cannot be skipped at runtime —
 * the config decides membership, this guard proves it at launch.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_GEPA_PYTHON,
  isGepaSeat,
  probeGepaRuntime,
} from './gepa-seat.mts'
import { run } from './proc.ts'
import type { ProposerSpec } from './proposer-fanout.mts'

export interface ProposerModelProvenance {
  name: string
  /** Absent on an engine seat (see `engine`). */
  harness: ProposerSpec['harness']
  /** Explicit model pin from the spec (threaded as `-m`), or null when the
   *  seat runs the CLI's own resolved default. */
  pinnedModel: string | null
  /** `<harness> --version` stdout (trimmed). For a GEPA seat this is
   *  the bridge python's `--version` output — the runtime that authors. */
  harnessVersion: string
  /** claude seats only: the settings default model the logged-in CLI resolves
   *  when no `-m` is passed. Null when unreadable (recorded, never fatal —
   *  the version capture is the hard gate). */
  settingsModel: string | null
  /** codex seats only: `codex login status` stdout (trimmed). */
  authStatus: string | null
  merge: boolean
  /** GEPA seat: the engine name from the spec. */
  engine?: 'gepa' | 'omni'
  /** GEPA seat: the one change-space file GEPA optimizes. */
  surface?: string
  /** GEPA seat: installed GEPA version ('source' for a source pin). */
  gepaVersion?: string
  /** GEPA seat: the Python bridge module the seat runs. */
  bridge?: string
}

export interface ProvenanceCaptureRecord {
  schema: 'swe-arena.proposer-provenance.v1'
  capturedAt: string
  proposers: ProposerModelProvenance[]
}

/** Exec seam — test-injectable. Mirrors `run` from proc.ts. */
export type VersionExec = (
  command: string,
  args: string[],
) => Promise<{ code: number | null; stdout: string; stderr: string }>

const defaultExec: VersionExec = async (command, args) => {
  const res = await run(command, args, { timeoutMs: 30_000 })
  return { code: res.code, stdout: res.stdout, stderr: res.stderr }
}

/** Read the claude CLI's settings default model. Pure over injected reader. */
export function claudeSettingsModel(
  readFile: (path: string) => string = (p) => readFileSync(p, 'utf8'),
  settingsPath = join(homedir(), '.claude', 'settings.json'),
): string | null {
  try {
    const parsed = JSON.parse(readFile(settingsPath)) as { model?: unknown }
    return typeof parsed.model === 'string' && parsed.model.length > 0 ? parsed.model : null
  } catch {
    return null
  }
}

/** Capture per-proposer model provenance. Throws when any configured harness
 *  binary is missing/broken, when a codex seat is not logged in, or when
 *  a GEPA seat's Python bridge or engine cannot import
 *  (`probeGepaRuntime` carries the exact install instructions). A dead seat
 *  fails the launch at t=0, never a mid-run candidate slot. The TypeScript
 *  adapter is a pinned package dependency and therefore checked at install. */
export async function captureProposerProvenance(
  proposers: ProposerSpec[],
  deps: {
    exec?: VersionExec
    readSettingsModel?: () => string | null
  } = {},
): Promise<ProvenanceCaptureRecord> {
  const exec = deps.exec ?? defaultExec
  const readSettingsModel = deps.readSettingsModel ?? (() => claudeSettingsModel())
  const versionByHarness = new Map<string, string>()
  const authByHarness = new Map<string, string>()
  const gepaBySeat = new Map<string, { pythonVersion: string; gepaVersion: string }>()
  const gepaSeats = proposers.filter(isGepaSeat)
  if (gepaSeats.length > 0) {
    for (const seat of gepaSeats) {
      gepaBySeat.set(seat.name, await probeGepaRuntime(seat.python ?? DEFAULT_GEPA_PYTHON, exec, seat.name))
    }
  }
  const harnesses = [...new Set(proposers.map((p) => p.harness))].filter(
    (h): h is NonNullable<ProposerSpec['harness']> => h !== undefined,
  )
  for (const harness of harnesses) {
    const res = await exec(harness, ['--version'])
    if (res.code !== 0) {
      throw new Error(
        `proposer provenance: '${harness} --version' failed (rc=${res.code}) — the ${harness} seat cannot author. ` +
          `stderr: ${res.stderr.slice(0, 300)}`,
      )
    }
    versionByHarness.set(harness, res.stdout.trim())
    if (harness === 'codex') {
      const auth = await exec('codex', ['login', 'status'])
      const authOut = auth.stdout + auth.stderr
      const authed = /logged in/i.test(authOut) && !/not logged in/i.test(authOut)
      if (auth.code !== 0 || !authed) {
        throw new Error(
          `proposer provenance: codex seat configured but 'codex login status' says not authed ` +
            `(rc=${auth.code}, out=${(auth.stdout + auth.stderr).trim().slice(0, 200)})`,
        )
      }
      authByHarness.set('codex', (auth.stdout + auth.stderr).trim())
    }
  }
  return {
    schema: 'swe-arena.proposer-provenance.v1',
    capturedAt: new Date().toISOString(),
    proposers: proposers.map((spec): ProposerModelProvenance => {
      if (isGepaSeat(spec)) {
        const probe = gepaBySeat.get(spec.name)!
        return {
          name: spec.name,
          harness: undefined,
          pinnedModel: null,
          harnessVersion: probe.pythonVersion,
          settingsModel: null,
          authStatus: null,
          merge: false,
          engine: spec.engine,
          surface: spec.surface,
          gepaVersion: probe.gepaVersion,
          bridge: 'agent_eval_rpc.gepa_bridge',
        }
      }
      return {
        name: spec.name,
        harness: spec.harness,
        pinnedModel: spec.model ?? null,
        harnessVersion: versionByHarness.get(spec.harness!)!,
        settingsModel: spec.harness === 'claude' && !spec.model ? readSettingsModel() : null,
        authStatus: (spec.harness !== undefined ? authByHarness.get(spec.harness) : undefined) ?? null,
        merge: spec.merge === true,
      }
    }),
  }
}
