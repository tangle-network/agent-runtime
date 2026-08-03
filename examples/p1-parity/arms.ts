/**
 * P1 parity arms — the SAME coding cell replayed through the two loop forms, under measurement.
 *
 *   A. `runLoopArm` — the LEGACY loop: agent-eval's multishot loop (`runMultishot`), with the
 *      reviewer profile as the simulated-user driver leg and the coder profile as the agent leg.
 *      Each driver→agent turn is one SHOT; `maxTurns` is the shot budget.
 *   B. `runGraphArm` — the graph form: `runGraph` over the two-node reviewer→coder topology
 *      (examples/graphs/shot-loop.ts as data), the shot budget on the delegates edge's
 *      `maxTraversals`, the completion oracle on the mandatory deliverable.
 *
 * Both arms take one identical {@link CellSpec} and return one {@link ParityRecord}, so a run of
 * N cells yields N paired rows — the measurement harness for the loop→graph migration (#694 P1).
 * The record maps each arm's OWN instrumentation onto shared field names; where the two forms
 * genuinely differ (edge ledger, conserved pool, early stop) the difference is documented on the
 * field and left visible in the data, never papered over.
 */

import type { MultishotMessage, MultishotTransport } from '@tangle-network/agent-eval/multishot'
import { runMultishot } from '@tangle-network/agent-eval/multishot'
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type AgentGraph,
  type AnalystRegistry,
  type Budget,
  type EdgeTraversal,
  GraphEdgeCapError,
  type MakeWorkerAgent,
  promptHandle,
  type RouterConfig,
  type RunGraphOptions,
  runGraph,
  type Spend,
  type ToolLoopChat,
} from '@tangle-network/agent-runtime/kernel'

// ── The shared cell ────────────────────────────────────────────────────────────

/** One coding cell, fed VERBATIM to both arms — the input-equivalence contract of the harness. */
export interface CellSpec {
  /** The coding task text. Shot 1's brief in both arms: the multishot opener (loop) and the
   *  first spawn's task payload + the root task (graph). */
  readonly task: string
  /** The coder under test. Loop arm: the agent leg's profile. Graph arm: the pinned worker node
   *  (`profile.name` is the node id, so it must be non-empty and differ from the reviewer's). */
  readonly coderProfile: AgentProfile
  /** The reviewer driving the shots. Loop arm: the driver leg (its `prompt.systemPrompt` is the
   *  driver system prompt). Graph arm: the root node. */
  readonly reviewerProfile: AgentProfile
  /** The shot budget. Loop arm: `maxTurns`. Graph arm: the delegates edge's `maxTraversals`. */
  readonly shots: number
  /** The conserved resource pool. ENFORCED BY THE GRAPH ARM ONLY: `runGraph` reserves against it
   *  for every spawn. The legacy loop has no conserved-pool concept — its only enforceable limit
   *  is `shots` — so this field cannot reach it. That gap is a P1 finding, not a harness bug. */
  readonly budget: Budget
}

// ── The shared record ──────────────────────────────────────────────────────────

/**
 * One arm's measured outcome for one cell. Same field names, each populated from that arm's OWN
 * instrumentation — the asymmetries below are real differences between the two forms and are the
 * exact thing P1 exists to measure:
 *
 *  - `ledger` exists ONLY for the graph arm (the edge ledger is what the graph form adds). The
 *    loop arm's instrumentation is a transcript, not an edge ledger; its `ledger` is ALWAYS
 *    `undefined` and must never be synthesized from the transcript.
 *  - The loop arm cannot stop early: `runMultishot` has no deliverable gate, so it burns the full
 *    shot budget even when an early shot converges. The graph arm settles at the first shot whose
 *    output passes the deliverable. Expect `shotsUsed` to differ on early-convergence cells.
 *  - Loop `spend.tokens` is metered at the transport seam (the sum of `usage` on every agent and
 *    driver completion); graph `spend` is the run's reconciled `spentTotal` from the conserved
 *    pool's journal. Both are that form's honest total, measured by different machinery.
 */
export interface ParityRecord {
  /** Did any shot satisfy the completion check? Graph arm: the run settled a winner (the
   *  deliverable passed). Loop arm: some turn-initial coder reply passed `shotPassed`. */
  converged: boolean
  /** Coder shots actually executed. Graph arm: distinct live coder workers spawned (from the
   *  ledger). Loop arm: turn-initial agent replies in the transcript. */
  shotsUsed: number
  /** Total measured resource spend for the arm's whole run (driver + coder legs). */
  spend: { tokens: { input: number; output: number }; usd: number }
  /** Wall-clock duration of the arm call, measured identically around both arms. */
  wallMs: number
  /** Corrective direction DELIVERED to the coder after the initial brief. Loop arm: driver (user)
   *  messages after the opener, counted with their UTF-8 bytes. Graph arm: delegates-edge
   *  traversals beyond the first with outcome `delivered` — re-brief spawns AND mid-run steers,
   *  with the bytes that actually crossed the edge. Graph bytes include the versioned edge
   *  directive text; loop bytes are the raw message only (the loop has no directive layer). */
  steeringDelivered: { count: number; bytes: number }
  /** The graph arm's edge ledger — every traversal, outcome, and byte count. ABSENT for the loop
   *  arm, honestly: the legacy loop has no observable edges (that is the migration's point). */
  ledger?: ReadonlyArray<EdgeTraversal>
}

// ── Backends ───────────────────────────────────────────────────────────────────

/** Execution seams for the loop arm. Offline: scripted transports (see ./offline.ts).
 *  Live: transports posting to a cli-bridge OpenAI-compatible endpoint (see ./run-parity.ts). */
export interface LoopArmBackend {
  readonly agentTransport: MultishotTransport
  readonly driverTransport: MultishotTransport
  /** The shared completion check, applied to each turn-initial coder reply. MUST be the same
   *  predicate the paired graph arm's deliverable uses, or the comparison is invalid. */
  readonly shotPassed: (assistantText: string) => boolean
  /** `runMultishot` resolves apiKey/baseUrl eagerly even with both transports injected; the
   *  offline path passes inert placeholders so no env is required. */
  readonly apiKey?: string
  readonly baseUrl?: string
}

/** Execution seams for the graph arm: fully-scripted (offline/CI) or the live cli-bridge. */
export type GraphArmBackend =
  | {
      readonly kind: 'seam'
      readonly makeWorkerAgent: MakeWorkerAgent
      readonly brain: ToolLoopChat
      readonly analysts?: AnalystRegistry
      /** Same predicate as the paired loop arm — becomes the graph's deliverable check. */
      readonly shotPassed: (workerOutText: string) => boolean
    }
  | {
      readonly kind: 'bridge'
      readonly bridgeUrl: string
      readonly bridgeBearer: string
      /** Fallback bridge wire id (e.g. `pi/deepseek`); the spawned profile may select its own. */
      readonly model?: string
      readonly cwd?: string
      /** Router substrate for the reviewer (driver) brain. */
      readonly router?: RouterConfig
      readonly shotPassed: (workerOutText: string) => boolean
    }

// ── The graph topology (exported so tests can assert on the exact inputs) ──────

export const PARITY_VERIFY_ANALYST = 'verify'

/** The verify lens is ENVIRONMENT: it reads the coder's settle trace, never sits in the graph. */
export function parityAnalysts(): AnalystRegistry {
  return {
    kinds: [
      {
        id: PARITY_VERIFY_ANALYST,
        description: 'read the coder trace, report shot outcome to the reviewer',
        area: 'qa',
      },
    ],
    run: async () => [{ check: 'shot-completion', observed: 'see the settled output' }],
  }
}

/** The two-node reviewer→coder topology for one cell — plain data, the shot budget on the edge.
 *  The cell's profiles are used AS-IS (node id = `profile.name`), the task is the root task
 *  (`deliverable.describe`) and each spawn's payload, and `shotPassed` is the deliverable. */
export function buildParityGraph(
  cell: CellSpec,
  shotPassed: (workerOutText: string) => boolean,
): AgentGraph {
  const reviewer = requireProfileName(cell.reviewerProfile, 'reviewerProfile')
  const coder = requireProfileName(cell.coderProfile, 'coderProfile')
  return {
    nodes: [
      { id: reviewer, profile: cell.reviewerProfile },
      { id: coder, profile: cell.coderProfile },
    ],
    edges: [
      {
        kind: 'delegates',
        from: reviewer,
        to: coder,
        directive: promptHandle('delegates/worker-brief/v1'),
        maxTraversals: cell.shots,
      },
      {
        kind: 'analyzes',
        analyst: PARITY_VERIFY_ANALYST,
        over: [coder],
        to: reviewer,
        directive: promptHandle('analyzes/findings-report/v1'),
      },
    ],
    deliverable: {
      describe: cell.task,
      check: (out) => typeof out === 'string' && shotPassed(out),
    },
    budget: cell.budget,
  }
}

// ── Arm A: the legacy multishot loop ───────────────────────────────────────────

export async function runLoopArm(cell: CellSpec, backend: LoopArmBackend): Promise<ParityRecord> {
  validateCell(cell)
  const tokens = { input: 0, output: 0 }
  // Meter tokens at the transport seam — the only usage channel the legacy loop exposes.
  const metered =
    (transport: MultishotTransport): MultishotTransport =>
    async (req) => {
      const res = await transport(req)
      tokens.input += res.usage?.prompt_tokens ?? 0
      tokens.output += res.usage?.completion_tokens ?? 0
      return res
    }
  const startedAt = Date.now()
  const sim = await runMultishot({
    profile: cell.coderProfile,
    persona: { id: 'parity-cell' },
    shape: {
      buildOpener: () => cell.task,
      buildDriverSystemPrompt: () => cell.reviewerProfile.prompt?.systemPrompt ?? '',
    },
    tools: [],
    toolExecutors: {},
    maxTurns: cell.shots,
    agentModel: cell.coderProfile.model?.default ?? 'parity/unspecified',
    driverModel: cell.reviewerProfile.model?.default ?? 'parity/unspecified',
    agentTransport: metered(backend.agentTransport),
    driverTransport: metered(backend.driverTransport),
    apiKey: backend.apiKey ?? 'unused',
    baseUrl: backend.baseUrl ?? 'http://unused.invalid',
  })
  const wallMs = Date.now() - startedAt
  const shotReplies = turnInitialAssistantReplies(sim.transcript)
  const steering = sim.transcript.slice(1).filter((msg) => msg.role === 'user')
  return {
    converged: shotReplies.some((text) => backend.shotPassed(text)),
    shotsUsed: shotReplies.length,
    spend: { tokens: { ...tokens }, usd: sim.costUsd },
    wallMs,
    steeringDelivered: {
      count: steering.length,
      bytes: steering.reduce((sum, msg) => sum + Buffer.byteLength(msg.content, 'utf8'), 0),
    },
    // No `ledger`: the legacy loop has no edge instrumentation, and the harness never fakes one.
  }
}

/** The coder's per-shot replies: assistant messages that directly answer a user (driver) message.
 *  Tool-followup assistant messages (which follow tool results) are the same shot continuing. */
function turnInitialAssistantReplies(transcript: ReadonlyArray<MultishotMessage>): string[] {
  const replies: string[] = []
  for (let i = 1; i < transcript.length; i += 1) {
    const msg = transcript[i]
    if (msg !== undefined && msg.role === 'assistant' && transcript[i - 1]?.role === 'user') {
      replies.push(msg.content)
    }
  }
  return replies
}

// ── Arm B: the runGraph two-node form ──────────────────────────────────────────

export async function runGraphArm(cell: CellSpec, backend: GraphArmBackend): Promise<ParityRecord> {
  validateCell(cell)
  const graph = buildParityGraph(cell, backend.shotPassed)
  const opts: RunGraphOptions =
    backend.kind === 'seam'
      ? {
          makeWorkerAgent: backend.makeWorkerAgent,
          brain: backend.brain,
          analysts: backend.analysts ?? parityAnalysts(),
        }
      : {
          backend: {
            backend: 'bridge',
            bridgeUrl: backend.bridgeUrl,
            bridgeBearer: backend.bridgeBearer,
            ...(backend.model !== undefined ? { model: backend.model } : {}),
            ...(backend.cwd !== undefined ? { cwd: backend.cwd } : {}),
          },
          ...(backend.router !== undefined ? { router: backend.router } : {}),
          analysts: parityAnalysts(),
        }
  const startedAt = Date.now()
  try {
    const res = await runGraph(graph, opts)
    return graphRecord(
      res.result.kind === 'winner',
      res.result.spentTotal,
      res.ledger,
      Date.now() - startedAt,
    )
  } catch (err) {
    if (err instanceof GraphEdgeCapError) {
      // The cap (the cyclic-graph backstop), not the task, ended the run: an honest
      // non-convergence row, with the full evidence the error carries.
      return graphRecord(false, err.result.spentTotal, err.ledger, Date.now() - startedAt)
    }
    throw err
  }
}

function graphRecord(
  converged: boolean,
  spentTotal: Spend,
  ledger: ReadonlyArray<EdgeTraversal>,
  wallMs: number,
): ParityRecord {
  const delegates = ledger.filter((row) => row.kind === 'delegates')
  // Each live coder worker is one shot; steers re-use an existing worker id, refused rows have
  // none — so distinct bound worker ids count executed shots exactly.
  const shotsUsed = new Set(
    delegates.filter((row) => row.workerId !== undefined).map((row) => row.workerId),
  ).size
  const steering = delegates.filter((row) => row.outcome === 'delivered' && row.traversal > 1)
  return {
    converged,
    shotsUsed,
    spend: {
      tokens: { input: spentTotal.tokens.input, output: spentTotal.tokens.output },
      usd: spentTotal.usd,
    },
    wallMs,
    steeringDelivered: {
      count: steering.length,
      bytes: steering.reduce((sum, row) => sum + row.bytes, 0),
    },
    ledger,
  }
}

// ── Shared validation ──────────────────────────────────────────────────────────

function requireProfileName(profile: AgentProfile, field: string): string {
  const name = profile.name
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(
      `p1-parity: ${field}.name must be a non-empty string — it is the graph node id, and both ` +
        'arms report against it',
    )
  }
  return name
}

function validateCell(cell: CellSpec): void {
  const reviewer = requireProfileName(cell.reviewerProfile, 'reviewerProfile')
  const coder = requireProfileName(cell.coderProfile, 'coderProfile')
  if (reviewer === coder) {
    throw new Error('p1-parity: reviewerProfile.name and coderProfile.name must differ')
  }
  if (!Number.isInteger(cell.shots) || cell.shots < 1) {
    throw new Error(`p1-parity: shots must be a positive integer, got ${cell.shots}`)
  }
  if (typeof cell.task !== 'string' || cell.task.length === 0) {
    throw new Error('p1-parity: task must be a non-empty string')
  }
}
