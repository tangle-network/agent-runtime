/**
 * OFFLINE scripted seams for the P1 parity arms — zero network, zero env, $0. Mirrors
 * examples/graphs/shared.ts and reuses its `leafSeam` / `scriptedBrain` directly for the graph
 * arm, so only the multishot arm's transports are new scripting. Both arms' seams are generated from
 * the same {@link ShotScript}, so the SAME cell produces the SAME shot outcomes in both forms —
 * the CI-runnable proof path, and the capture point for the input-equivalence test.
 *
 * Synthetic accounting: every scripted completion reports `usage {5,5}` and `$0`, mirroring the
 * leaf seam's per-shot spend, so the two arms' metering pipelines carry comparable numbers
 * offline. BOTH driver legs are metered: the multishot arm meters its scripted DRIVER
 * completions at the transport seam (`runMultishot`'s driver is an inference leg), and the graph
 * arm's scripted brain reports the same synthetic usage per turn ({@link meteredScriptedBrain}),
 * metering through `spentBreakdown.driverInference` exactly as a live router brain would — so a
 * completed offline run's conserved pool stays fully KNOWN (`tokensKnown` / `usdKnown` true) and
 * the validity channel on a `ParityRecord` is exercised, not skipped. Real numbers arrive only
 * with the live backend.
 */

import type {
  MultishotTransport,
  MultishotTransportRequest,
} from '@tangle-network/agent-eval/multishot'
import type { AgentProfile } from '@tangle-network/agent-interface'
import type { MakeWorkerAgent } from '@tangle-network/agent-runtime/kernel'
import type { ToolLoopChat } from '../../src/testing'
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
      shotPassed: offlineShotPassed,
    },
    capture: { agentRequests, driverRequests },
  }
}

// ── Graph arm: scripted brain + leaf seam ──────────────────────────────────────

/** A `scriptedBrain` whose every turn reports the synthetic usage (`{5,5}` tokens, $0): the
 *  driver-inference meter records a KNOWN turn instead of a `tokensKnown: false` taint, matching
 *  how the multishot arm's scripted driver leg is metered. An unmetered brain is still expressible
 *  (use `scriptedBrain` directly) — that models a driver whose inference channel reports nothing,
 *  which honestly taints the pool. */
export function meteredScriptedBrain(turns: ScriptedTurn[]): ToolLoopChat {
  const brain = scriptedBrain(turns)
  return async (messages, tools) => ({
    ...(await brain(messages, tools)),
    usage: { input: 5, output: 5 },
    costUsd: 0,
    costProvenance: 'billing-receipt',
  })
}

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
  const makeLeafAgent: MakeWorkerAgent = (profile, context) => {
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
          name: 'spawn_worker',
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
      makeLeafAgent,
      brain: meteredScriptedBrain(turns),
      shotPassed: offlineShotPassed,
    },
    capture: { spawnedProfiles, spawnedTasks },
  }
}
