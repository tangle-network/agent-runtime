/**
 * P1 parity arms — the SAME coding cell replayed through two execution forms, under measurement.
 *
 *   A. `runMultishotArm` — agent-eval's multishot runner (`runMultishot`), with the
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
 *
 * SUBSTRATE SYMMETRY (the validity invariant, per #710/#721): live, BOTH arms' coders are a
 * conversation on the SAME bare OpenAI-compatible `/v1/chat/completions` endpoint — the multishot
 * arm through `runMultishot`'s transport seam, the graph arm through `chatTransportExecutor`
 * (whose delegates edge declares `continuity: 'resume'`, so its shots continue ONE session
 * exactly as `runMultishot`'s single transcript does). Pairing a full harness-worker coder
 * against a bare-chat coder would measure the substrate gap, not the orchestration layer, so
 * that shape is not expressible here: the ONLY difference between the arms is the thing P1
 * exists to measure — the orchestration form (transcript loop vs supervised graph with ledger +
 * conserved pool). Models are likewise explicit everywhere; a silent fallback id could let the
 * two arms drift to different models unnoticed, so a missing model always fails loud. Sampling
 * is part of the substrate too: both arms pin the coder's temperature + max_tokens to
 * {@link PARITY_CODER_SAMPLING} (residual documented on {@link ParityRecord}).
 */

import type {
  MultishotMessage,
  MultishotResult,
  MultishotTransport,
} from '@tangle-network/agent-eval/multishot'
import { runMultishot } from '@tangle-network/agent-eval/multishot'
import type { AgentProfile } from '@tangle-network/agent-interface'
import type { RuntimeHooks } from '@tangle-network/agent-runtime'
import {
  type AgentGraph,
  type AnalystRegistry,
  type Budget,
  chatWorkerSeam,
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

// ── The shared coder sampling (the F1 parity pin) ──────────────────────────────

/**
 * The ONE sampling configuration BOTH arms' coder completions use. The arms must sample
 * identically or a paired row measures a sampling difference and calls it an orchestration
 * effect. `runMultishot` hardcodes agent temperature 0.7 and defaults its turn-initial
 * `max_tokens` to 2500; the graph arm pins the SAME two values through `chatWorkerSeam` →
 * `chatTransportExecutor`, and the multishot arm pins `agentMaxTokens` explicitly so an upstream
 * default change cannot silently split the arms. (Temperature has no `runMultishot` option — the
 * offline suite asserts the captured agent requests carry this constant, so upstream drift fails
 * a test instead of skewing live rows.)
 */
export const PARITY_CODER_SAMPLING = { temperature: 0.7, maxTokens: 2500 } as const

// ── The shared cell ────────────────────────────────────────────────────────────

/** One coding cell, fed VERBATIM to both arms — the input-equivalence contract of the harness. */
export interface CellSpec {
  /** The coding task text. Shot 1's brief in both arms: the multishot opener and the
   *  first spawn's task payload + the root task (graph). */
  readonly task: string
  /** The coder under test. Multishot arm: the agent leg's profile. Graph arm: the pinned worker node
   *  (`profile.name` is the node id, so it must be non-empty and differ from the reviewer's). */
  readonly coderProfile: AgentProfile
  /** The reviewer driving the shots. Multishot arm: the driver leg (its `prompt.systemPrompt` is the
   *  driver system prompt). Graph arm: the root node. */
  readonly reviewerProfile: AgentProfile
  /** The shot budget. Multishot arm: `maxTurns`. Graph arm: the delegates edge's `maxTraversals`. */
  readonly shots: number
  /** The conserved resource pool. ENFORCED BY THE GRAPH ARM ONLY: `runGraph` reserves against it
   *  for every spawn. `runMultishot` has no conserved-pool concept — its only enforceable limit
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
 *    multishot arm's instrumentation is a transcript, not an edge ledger; its `ledger` is ALWAYS
 *    `undefined` and must never be synthesized from the transcript.
 *  - The multishot arm cannot stop early: `runMultishot` has no deliverable check, so it burns the full
 *    shot budget even when an early shot converges. The graph arm settles at the first shot whose
 *    output passes the deliverable. Expect `shotsUsed` to differ on early-convergence cells.
 *  - Multishot `spend.tokens` is metered at the transport seam (the sum of `usage` on every agent and
 *    driver completion); graph `spend` is the run's reconciled `spentTotal` from the conserved
 *    pool's journal. Both are that form's honest total, measured by different machinery.
 *  - Coder sampling is pinned identically in both arms ({@link PARITY_CODER_SAMPLING}), with ONE
 *    residual: `runMultishot` lowers `max_tokens` to 2000 for tool-FOLLOW-UP completions — a
 *    second request class the graph arm does not have (`chatTransportExecutor` sends one pinned
 *    `max_tokens` on every request). This harness advertises no tools, so the follow-up class
 *    never fires here; a future tool-carrying cell would reintroduce the asymmetry. Documented,
 *    never silent.
 */
export interface ParityRecord {
  /** Did any shot satisfy the completion check? Graph arm: the run settled a winner (the
   *  deliverable passed). Multishot arm: some turn-initial coder reply passed `shotPassed`. */
  converged: boolean
  /** Coder shots actually executed. Graph arm: distinct live coder workers spawned (from the
   *  ledger). Multishot arm: turn-initial agent replies in the transcript. */
  shotsUsed: number
  /** Total measured resource spend for the arm's whole run (driver + coder legs). */
  spend: { tokens: { input: number; output: number }; usd: number }
  /** Where `spend.usd` came from. `'measured'` = every counted completion carried the provider's
   *  own cost field (`usage.cost` / `usage.cost_usd` → the transport's `costUsd`). `'estimated'`
   *  = at least one completion lacked it and `runMultishot`'s price-table fallback
   *  (`estimateRouterCost`) filled the gap — only the multishot arm's completed runs can produce
   *  this. `'unknown'` = at least one completion lacked it and NOTHING estimated it: the graph
   *  arm never estimates (the chat executor's no-fabricated-measurement rule), and neither does
   *  the multishot arm's infra-death path (the loop died before its estimator could run). */
  usdSource: 'measured' | 'estimated' | 'unknown'
  /** Coder shots that died to TRANSPORT/INFRA faults, not to the task. Graph arm: infra-flagged
   *  `down` settles of delegates-spawned workers (`Settled.down.infra`, observed on the run's own
   *  hook stream). Multishot arm: transport throws counted at the arm's metering seam — either
   *  leg, because `runMultishot` has no infra channel and dies on the FIRST one, so a nonzero
   *  count also means the loop ended early and the row is an infra casualty, never an ordinary
   *  non-convergence. (The graph arm's driver-brain death surfaces as the run's no-winner
   *  reason, not here.) */
  infraShots: number
  /** False when ANY counted completion lacked provider token usage — `spend.tokens` is then a
   *  known subtotal, not the measured total. Graph arm: the conserved pool's own taint flag
   *  (`spentTotal.tokensKnown`). Multishot arm: metered per response at the transport seam; a
   *  transport throw counts as an unreported turn (work may have burned tokens the provider
   *  never got to report — mirroring the kernel's never-reinterpret-as-zero rule). */
  tokensKnown: boolean
  /** The dollar twin of `tokensKnown`: false when ANY counted completion lacked a provider cost
   *  field (equivalently, `usdSource !== 'measured'`). */
  usdKnown: boolean
  /** Wall-clock duration of the arm call, measured identically around both arms. */
  wallMs: number
  /** Corrective direction DELIVERED to the coder after the initial brief. Multishot arm: driver (user)
   *  messages after the opener, counted with their UTF-8 bytes. Graph arm: delegates-edge
   *  traversals beyond the first with outcome `delivered` — re-brief spawns AND mid-run steers,
   *  with the bytes that actually crossed the edge. Graph bytes include the versioned edge
   *  directive text; multishot bytes are the raw message only (`runMultishot` has no directive layer). */
  steeringDelivered: { count: number; bytes: number }
  /** The graph arm's edge ledger — every traversal, outcome, and byte count. ABSENT for the
   *  multishot arm: `runMultishot` has no observable edges. */
  ledger?: ReadonlyArray<EdgeTraversal>
}

// ── Backends ───────────────────────────────────────────────────────────────────

/** Execution seams for the multishot arm. Offline: scripted transports (see ./offline.ts).
 *  Live: transports posting to a cli-bridge OpenAI-compatible endpoint (see ./run-parity.ts). */
export interface MultishotArmBackend {
  readonly agentTransport: MultishotTransport
  readonly driverTransport: MultishotTransport
  /** The reviewer (driver) leg's wire model — REQUIRED, no fallback. Substrate config of this
   *  arm, exactly as the paired graph arm declares its driver model on `RouterConfig.model`
   *  (the reviewer PROFILE stays model-less: as the graph ROOT it is materialized by the driver
   *  brain, whose model axis lives in that substrate config). Live runs feed BOTH arms the same
   *  env value; the offline backend pins a scripted id. */
  readonly driverModel: string
  /** The shared completion check, applied to each turn-initial coder reply. MUST be the same
   *  predicate the paired graph arm's deliverable uses, or the comparison is invalid. */
  readonly shotPassed: (assistantText: string) => boolean
  /** `runMultishot` resolves apiKey/baseUrl eagerly even with both transports injected; the
   *  offline path passes inert placeholders so no env is required. */
  readonly apiKey?: string
  readonly baseUrl?: string
}

/** Execution seams for the graph arm: fully-scripted (offline/CI) or the live chat transport. */
export type GraphArmBackend =
  | {
      readonly kind: 'seam'
      readonly makeWorkerAgent: MakeWorkerAgent
      readonly brain: ToolLoopChat
      readonly analysts?: AnalystRegistry
      /** Same predicate as the paired multishot arm — becomes the graph's deliverable check. */
      readonly shotPassed: (workerOutText: string) => boolean
    }
  | {
      /** LIVE: the coder runs on `chatTransportExecutor` against the SAME bare chat-completions
       *  endpoint the multishot arm's transport posts to — the substrate-symmetry contract. */
      readonly kind: 'chat'
      /** OpenAI-compatible base URL both arms' coders speak (e.g. a cli-bridge `/v1`). */
      readonly url: string
      readonly bearer?: string
      /** The coder wire model id — the same id the paired multishot arm sends. */
      readonly model: string
      /** Router substrate for the reviewer (driver) brain. REQUIRED: a live graph driver with
       *  neither `brain` nor `router` cannot run at all. */
      readonly router: RouterConfig
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
 *  (`deliverable.describe`) and each spawn's payload, and `shotPassed` is the deliverable.
 *  The delegates edge declares `continuity: 'resume'` — every shot after the first CONTINUES the
 *  coder's session, mirroring `runMultishot`'s one persistent transcript, so the two arms share
 *  the conversation shape and differ only in orchestration. */
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
        continuity: 'resume',
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

// ── Arm A: agent-eval multishot ────────────────────────────────────────────────

/** Marker for a transport throw inside `runMultishot`: the loop has no infra channel and dies on
 *  the first one, so the metering seam wraps the fault and the arm settles an honest infra row
 *  (`infraShots > 0`) instead of crashing the whole cell run. Any OTHER `runMultishot` rejection
 *  (e.g. an empty-driver authoring fault) still fails loud. */
class LoopTransportFailure extends Error {
  readonly fault: unknown
  constructor(fault: unknown) {
    super(
      `p1-parity multishot transport failed: ${fault instanceof Error ? fault.message : String(fault)}`,
    )
    this.name = 'LoopTransportFailure'
    this.fault = fault
  }
}

export async function runMultishotArm(
  cell: CellSpec,
  backend: MultishotArmBackend,
): Promise<ParityRecord> {
  validateCell(cell)
  // The arm's OWN meter at the transport seam — the one channel `runMultishot` exposes. Beyond
  // tokens it records the validity facts the record must state: completions that lacked usage or
  // a cost field, transport deaths, and (for the infra-abort path, where the loop returns no
  // transcript) each leg's successful replies. With `tools: []` every agent completion IS one
  // turn-initial shot reply, so the abort-path tallies match the transcript-derived ones exactly.
  const meter = {
    tokens: { input: 0, output: 0 },
    usdMeasured: 0,
    turnsMissingUsage: 0,
    turnsMissingCost: 0,
    infraShots: 0,
    agentReplies: [] as string[],
    driverReplies: [] as string[],
  }
  const metered =
    (transport: MultishotTransport, leg: 'agent' | 'driver'): MultishotTransport =>
    async (req) => {
      let res: Awaited<ReturnType<MultishotTransport>>
      try {
        res = await transport(req)
      } catch (fault) {
        // The dead turn's spend is UNREPORTED, not zero: mark both channels unknown, exactly as
        // the kernel marks an infra-thrown executor's spend.
        meter.infraShots += 1
        meter.turnsMissingUsage += 1
        meter.turnsMissingCost += 1
        throw new LoopTransportFailure(fault)
      }
      const usage = res.usage
      if (
        typeof usage?.prompt_tokens === 'number' &&
        typeof usage?.completion_tokens === 'number'
      ) {
        meter.tokens.input += usage.prompt_tokens
        meter.tokens.output += usage.completion_tokens
      } else {
        meter.turnsMissingUsage += 1
      }
      // A completion without a provider cost field makes `runMultishot` substitute its
      // price-table estimate — recorded so the row states `usdSource: 'estimated'`, never
      // presenting an estimate as a measurement.
      if (typeof res.costUsd === 'number') meter.usdMeasured += res.costUsd
      else meter.turnsMissingCost += 1
      const content = (res.message.content ?? '').trim()
      if (leg === 'agent') meter.agentReplies.push(content)
      else if (content.length > 0) meter.driverReplies.push(content) // empty ⇒ retried, never delivered
      return res
    }
  const startedAt = Date.now()
  let sim: MultishotResult | undefined
  try {
    sim = await runMultishot({
      profile: cell.coderProfile,
      persona: { id: 'parity-cell' },
      shape: {
        buildOpener: () => cell.task,
        buildDriverSystemPrompt: () => cell.reviewerProfile.prompt?.systemPrompt ?? '',
      },
      tools: [],
      toolExecutors: {},
      maxTurns: cell.shots,
      agentModel: requireProfileModel(cell.coderProfile, 'coderProfile'),
      driverModel: requireModel(backend.driverModel, 'MultishotArmBackend.driverModel'),
      // Coder sampling parity (F1): pin the turn-initial ceiling to the shared constant; the
      // agent leg's temperature 0.7 is hardcoded inside `runMultishot` and asserted by test.
      agentMaxTokens: PARITY_CODER_SAMPLING.maxTokens,
      agentTransport: metered(backend.agentTransport, 'agent'),
      driverTransport: metered(backend.driverTransport, 'driver'),
      apiKey: backend.apiKey ?? 'unused',
      baseUrl: backend.baseUrl ?? 'http://unused.invalid',
    })
  } catch (err) {
    if (!(err instanceof LoopTransportFailure)) throw err
  }
  const wallMs = Date.now() - startedAt
  // Completed run: shots/steering read off the loop's own transcript; the infra-abort path reads
  // the meter (the transcript died with the loop). The two agree by construction — see the meter
  // note above.
  const shotReplies = sim !== undefined ? turnInitialAssistantReplies(sim.transcript) : []
  const steering =
    sim !== undefined
      ? sim.transcript
          .slice(1)
          .filter((msg) => msg.role === 'user')
          .map((msg) => msg.content)
      : meter.driverReplies
  const replies = sim !== undefined ? shotReplies : meter.agentReplies
  return {
    converged: replies.some((text) => backend.shotPassed(text)),
    shotsUsed: replies.length,
    // A completed run's usd is the loop's own honest total (which may CONTAIN estimates — stated
    // by `usdSource`); an infra-aborted run reports only what was measured, never re-estimating.
    spend: {
      tokens: { ...meter.tokens },
      usd: sim !== undefined ? sim.costUsd : meter.usdMeasured,
    },
    usdSource:
      meter.turnsMissingCost === 0 ? 'measured' : sim !== undefined ? 'estimated' : 'unknown',
    infraShots: meter.infraShots,
    tokensKnown: meter.turnsMissingUsage === 0,
    usdKnown: meter.turnsMissingCost === 0,
    wallMs,
    steeringDelivered: {
      count: steering.length,
      bytes: steering.reduce((sum, text) => sum + Buffer.byteLength(text, 'utf8'), 0),
    },
    // No `ledger`: `runMultishot` has no edge instrumentation, and the runner never fakes one.
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
  // The infra channel: `runGraph` composes caller hooks onto the run's own event stream, and an
  // infra-flagged `down` settle rides `agent.child` with its `infra` marker. Collected here, then
  // intersected with the ledger's delegates-bound worker ids so ONLY coder shots count (the
  // driver brain's own death surfaces as the run's no-winner reason instead).
  const downInfraWorkers = new Set<string>()
  const infraHooks: RuntimeHooks = {
    onEvent: (event) => {
      if (event.target !== 'agent.child' || event.phase !== 'after') return
      const payload = event.payload as
        | { childId?: unknown; status?: unknown; infra?: unknown }
        | undefined
      if (
        typeof payload?.childId === 'string' &&
        payload.status === 'down' &&
        payload.infra === true
      ) {
        downInfraWorkers.add(payload.childId)
      }
    },
  }
  const opts: RunGraphOptions =
    backend.kind === 'seam'
      ? {
          makeWorkerAgent: backend.makeWorkerAgent,
          brain: backend.brain,
          analysts: backend.analysts ?? parityAnalysts(),
          hooks: infraHooks,
        }
      : {
          // The coder on the SAME bare chat transport the multishot arm posts to, with the
          // session-owning seam honoring the edge's `continuity: 'resume'`, and the graph's own
          // deliverable as the settle gate. The reviewer brain runs on the router substrate.
          makeWorkerAgent: chatWorkerSeam({
            url: backend.url,
            ...(backend.bearer !== undefined ? { bearer: backend.bearer } : {}),
            model: backend.model,
            // Coder sampling parity (F1): the same pinned temperature + max_tokens the multishot
            // arm's coder leg sends, from the one shared constant — never a per-arm choice.
            temperature: PARITY_CODER_SAMPLING.temperature,
            maxTokens: PARITY_CODER_SAMPLING.maxTokens,
            deliverable: graph.deliverable,
          }),
          router: backend.router,
          analysts: parityAnalysts(),
          hooks: infraHooks,
        }
  const startedAt = Date.now()
  try {
    const res = await runGraph(graph, opts)
    return graphRecord(
      res.result.kind === 'winner',
      res.result.spentTotal,
      res.ledger,
      Date.now() - startedAt,
      downInfraWorkers,
    )
  } catch (err) {
    if (err instanceof GraphEdgeCapError) {
      // The cap (the cyclic-graph backstop), not the task, ended the run: an honest
      // non-convergence row, with the full evidence the error carries.
      return graphRecord(
        false,
        err.result.spentTotal,
        err.ledger,
        Date.now() - startedAt,
        downInfraWorkers,
      )
    }
    throw err
  }
}

function graphRecord(
  converged: boolean,
  spentTotal: Spend,
  ledger: ReadonlyArray<EdgeTraversal>,
  wallMs: number,
  downInfraWorkers: ReadonlySet<string>,
): ParityRecord {
  const delegates = ledger.filter((row) => row.kind === 'delegates')
  // Each live coder worker is one shot; steers re-use an existing worker id, refused rows have
  // none — so distinct bound worker ids count executed shots exactly.
  const workerIds = new Set(
    delegates
      .map((row) => row.workerId)
      .filter((workerId): workerId is string => workerId !== undefined),
  )
  const steering = delegates.filter((row) => row.outcome === 'delivered' && row.traversal > 1)
  return {
    converged,
    shotsUsed: workerIds.size,
    spend: {
      tokens: { input: spentTotal.tokens.input, output: spentTotal.tokens.output },
      usd: spentTotal.usd,
    },
    // The graph arm NEVER estimates: dollars come only from provider cost fields, so the pool's
    // taint flag decides between fully-measured and known-subtotal — 'estimated' is unreachable.
    usdSource: spentTotal.usdKnown !== false ? 'measured' : 'unknown',
    infraShots: [...downInfraWorkers].filter((workerId) => workerIds.has(workerId)).length,
    tokensKnown: spentTotal.tokensKnown !== false,
    usdKnown: spentTotal.usdKnown !== false,
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

/** Fail loud on a missing model: a silent fallback id would let the two arms drift to different
 *  models — the exact class of hidden asymmetry this harness exists to rule out. */
function requireModel(model: string | undefined, field: string): string {
  if (typeof model !== 'string' || model.length === 0) {
    throw new Error(
      `p1-parity: ${field} must name the model — no 'parity/unspecified' fallback; live runs ` +
        'take it from the environment (see run-parity.ts), offline backends pin a scripted id',
    )
  }
  return model
}

/** The coder's model rides its PROFILE (both arms consume it: `agentModel` here, the chat seam in
 *  the graph arm) — required, same no-fallback rule. */
function requireProfileModel(profile: AgentProfile, field: string): string {
  return requireModel(profile.model?.default, `${field}.model.default`)
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
