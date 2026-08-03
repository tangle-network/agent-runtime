/**
 * OFFLINE scripted seams for the P1 parity arms — zero network, zero env, $0. Mirrors
 * examples/graphs/shared.ts and reuses its `leafSeam` / `scriptedBrain` directly for the graph
 * arm, so only the multishot arm's transports are new scripting. Both arms' seams are generated from
 * the same {@link ShotScript}, so the SAME cell produces the SAME shot outcomes in both forms —
 * the CI-runnable proof path, and the capture point for the input-equivalence test.
 *
 * Synthetic accounting: every scripted completion reports `usage {5,5}` and `$0`, mirroring the
 * leaf seam's per-shot spend, so the two arms' metering pipelines carry comparable numbers
 * offline. The multishot arm additionally meters its scripted DRIVER completions (`runMultishot`'s
 * driver is an inference leg); the graph arm's scripted brain meters nothing (a live graph
 * driver would meter through `spentBreakdown.driverInference`). Real numbers arrive only with
 * the live backend.
 */

import type {
  MultishotTransport,
  MultishotTransportRequest,
} from '@tangle-network/agent-eval/multishot'
import type { AgentProfile } from '@tangle-network/agent-interface'
import type { MakeWorkerAgent } from '@tangle-network/agent-runtime/kernel'
import { type LeafShot, leafSeam, type ScriptedTurn, scriptedBrain } from '../graphs/shared'
import type { CellSpec, GraphArmBackend, MultishotArmBackend } from './arms'

/** Per-shot scripted outcome; the last entry repeats for later shots. */
export type ShotScript = ReadonlyArray<'pass' | 'fail'>

export const SHOT_PASS_TEXT = 'TESTS: pass'
export const SHOT_FAIL_TEXT = 'TESTS: fail'

/** The one completion check BOTH offline arms share (multishot reply = graph settle output). */
export const offlineShotPassed = (text: string): boolean => text.includes(SHOT_PASS_TEXT)

/** The reviewer's re-brief for shot N — identical wording in both arms, so steering payloads
 *  differ only by what each form adds (the graph's versioned edge directive). */
export const rebriefText = (shot: number): string =>
  `shot ${shot}: revise — the verifier reported failing tests; make them pass`

const scriptedUsage = () => ({ prompt_tokens: 5, completion_tokens: 5 })

const shotAt = (script: ShotScript, index: number): 'pass' | 'fail' =>
  script[Math.min(index, script.length - 1)] ?? 'fail'

// ── Multishot arm: scripted transports ─────────────────────────────────────────

export interface LoopCapture {
  /** Every request the coder (agent) leg received, in order — the input-equivalence evidence. */
  readonly agentRequests: MultishotTransportRequest[]
  /** Every request the reviewer (driver) leg received, in order. */
  readonly driverRequests: MultishotTransportRequest[]
}

/** Scripted multishot backend: coder replies follow the shot script; the reviewer re-briefs between
 *  shots with {@link rebriefText}. All requests are captured for assertion. */
export function offlineMultishotBackend(script: ShotScript): {
  backend: MultishotArmBackend
  capture: LoopCapture
} {
  const agentRequests: MultishotTransportRequest[] = []
  const driverRequests: MultishotTransportRequest[] = []
  const agentTransport: MultishotTransport = async (req) => {
    agentRequests.push(req)
    const outcome = shotAt(script, agentRequests.length - 1)
    return {
      message: { content: outcome === 'pass' ? SHOT_PASS_TEXT : SHOT_FAIL_TEXT },
      usage: scriptedUsage(),
      costUsd: 0,
    }
  }
  const driverTransport: MultishotTransport = async (req) => {
    driverRequests.push(req)
    // Driver call k re-briefs shot k+1 (`runMultishot` drives one driver turn between shots).
    return {
      message: { content: rebriefText(driverRequests.length + 1) },
      usage: scriptedUsage(),
      costUsd: 0,
    }
  }
  return {
    backend: {
      agentTransport,
      driverTransport,
      driverModel: 'scripted/parity-reviewer',
      shotPassed: offlineShotPassed,
    },
    capture: { agentRequests, driverRequests },
  }
}

// ── Graph arm: scripted brain + leaf seam ──────────────────────────────────────

export interface GraphCapture {
  /** Every profile the leaf factory received (the graph-pinned coder profile, with the
   *  delegates directive appended to its instructions), in spawn order. */
  readonly spawnedProfiles: AgentProfile[]
  /** Every spawn's task payload, in spawn order — shot 1 must be the cell task verbatim. */
  readonly spawnedTasks: unknown[]
}

/** Scripted graph backend for one cell: the leaf settles each shot per the script, and the
 *  reviewer brain spawns shot-by-shot until the first scripted pass. A script with no pass
 *  inside the shot budget drives one extra spawn INTO the delegates cap, so the backstop —
 *  not silence — ends the run (`runGraphArm` maps that to an honest non-convergence row). */
export function offlineGraphBackend(
  cell: CellSpec,
  script: ShotScript,
): { backend: GraphArmBackend; capture: GraphCapture } {
  const coder = cell.coderProfile.name ?? 'coder'
  const spawnedProfiles: AgentProfile[] = []
  const spawnedTasks: unknown[] = []
  const shots: LeafShot[] = script.map((outcome) => ({
    out: outcome === 'pass' ? SHOT_PASS_TEXT : SHOT_FAIL_TEXT,
    valid: outcome === 'pass',
  }))
  const seam = leafSeam(spawnedProfiles, { [coder]: { withTrace: true, shots } })
  const makeWorkerAgent: MakeWorkerAgent = (profile, context) => {
    spawnedTasks.push(context?.task)
    return seam(profile, context)
  }
  const firstPass = script.indexOf('pass')
  const converges = firstPass >= 0 && firstPass < cell.shots
  const spawnCount = converges ? firstPass + 1 : cell.shots + 1
  const turns: ScriptedTurn[] = []
  for (let shot = 1; shot <= spawnCount; shot += 1) {
    turns.push({
      toolCalls: [
        {
          name: 'spawn_agent',
          arguments: {
            profile: { name: coder },
            task: shot === 1 ? cell.task : rebriefText(shot),
          },
        },
      ],
    })
    // A delivered shot produces two bus events (settle, then its verify report). The final
    // over-cap spawn of a non-converging script is REFUSED, so it awaits nothing.
    if (shot <= cell.shots) {
      turns.push({ toolCalls: [{ name: 'await_event', arguments: {} }] })
      turns.push({ toolCalls: [{ name: 'await_event', arguments: {} }] })
    }
  }
  turns.push({ content: 'done' })
  return {
    backend: {
      kind: 'seam',
      makeWorkerAgent,
      brain: scriptedBrain(turns),
      shotPassed: offlineShotPassed,
    },
    capture: { spawnedProfiles, spawnedTasks },
  }
}
