/**
 * @experimental
 *
 * Sandbox-session coder decode layer. The sandbox-session delegate (`./delegates`) and the
 * cross-restart resume driver (`./bin`) run the in-box harness over a `SandboxClient` and need to
 * (a) build an `AgentRunSpec` from the authored coder profile, (b) decode the harness event stream
 * into a structured `CoderOutput`, and (c) gate it with the shared mechanical checks. This is the
 * MCP server's built-in `delegate_code` path — it is the live default delegate, NOT dormant — and is
 * kept separate from the generic recursive path: `worktreeFanout` instead settles the raw
 * `WorktreePatchArtifact` and gates via `patchDelivered`. Only the OPTIONAL cross-restart resume
 * (the `driveTurn` tick) is opt-in (`MCP_ENABLE_DETACHED_RESUME`); the held-stream delegate is
 * always live. Prefer `worktreeFanout` / `worktreeLoopRunner` for NEW local-repo coding.
 *
 * The decode tolerates two `result`-event shapes:
 *   1. the in-process executor's raw worktree-harness result (`{ branch, patch, stats, checks }`),
 *      projected onto `CoderOutput`; and
 *   2. an LLM-emitted JSON block (`{ branch, patch, testResult, typecheckResult, diffStats }`),
 *      lifted onto `data.result` or scanned out of the assistant transcript (any harness shape).
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import type { SandboxEvent } from '@tangle-network/sandbox'
import { type CoderTask, coderProfile, coderTaskToPrompt } from '../profiles/coder'
import { type CoderCheckConstraints, runCoderChecks } from '../runtime/supervise/patch-checks'
import type { AgentRunSpec, Driver, OutputAdapter, Validator } from '../runtime/types'

const DEFAULT_MAX_DIFF_LINES = 400

/** @experimental The structured coder result the sandbox-session path decodes + gates. */
export interface CoderOutput {
  /** Branch the agent wrote the patch on. */
  branch: string
  /** Unified diff (`git diff <base>..HEAD`). */
  patch: string
  testResult: { passed: boolean; output: string }
  typecheckResult: { passed: boolean; output: string }
  diffStats: { filesChanged: number; insertions: number; deletions: number }
  /** Optional reviewer commentary surfaced by the agent. */
  reviewerNotes?: string
}

/** @experimental Overrides for one authored coder run on the sandbox-session path. */
export interface CoderRunSpecOptions {
  /** Sandbox-SDK backend.type. Default `'claude-code'`. */
  harness?: string
  /** Default model id passed in `AgentProfile.model.default`. */
  model?: string
  /** Custom system prompt replacement. Default = the `coderProfile` constant's prompt. */
  systemPrompt?: string
  /** Stable name for `AgentRunSpec.name`. Default = `coder-${harness}`. */
  name?: string
}

/** Build the authored `AgentProfile` for one harness on the sandbox-session path, applying the
 *  optional per-run overrides over the `coderProfile` constant. */
function coderRunProfile(options: CoderRunSpecOptions): AgentProfile {
  const harness = options.harness ?? 'claude-code'
  const name = options.name ?? `coder-${harness}`
  return {
    ...coderProfile,
    name,
    ...(options.systemPrompt ? { prompt: { systemPrompt: options.systemPrompt } } : {}),
    model: options.model ? { default: options.model } : undefined,
    metadata: { ...coderProfile.metadata, backendType: harness },
  }
}

/** @experimental Build the `AgentRunSpec<CoderTask>` the sandbox-session `runLoop` path drives. */
export function coderRunSpec(options: CoderRunSpecOptions = {}): AgentRunSpec<CoderTask> {
  return {
    name: options.name ?? `coder-${options.harness ?? 'claude-code'}`,
    profile: coderRunProfile(options),
    taskToPrompt: coderTaskToPrompt,
  }
}

/** @experimental The output adapter the sandbox-session path decodes the harness stream with. */
export const coderOutputAdapter: OutputAdapter<CoderOutput> = { parse: parseCoderEvents }

/** @experimental */
export interface MultiHarnessCoderFanoutOptions {
  /**
   * Sandbox-SDK backend.type identifiers, one per parallel agent. Default:
   * `['claude-code', 'codex', 'opencode/zai-coding-plan/glm-5.1']`.
   */
  harnesses?: string[]
  /** Optional per-harness model override. Indexed parallel to `harnesses`. */
  models?: (string | undefined)[]
}

/**
 * The multi-harness coder fanout driving the sandbox-session delegate's `variants>1` path.
 * (`worktreeFanout` is the local-repo generic counterpart for new code.)
 *
 * @experimental
 */
export function multiHarnessCoderFanout(options: MultiHarnessCoderFanoutOptions = {}): {
  agentRuns: AgentRunSpec<CoderTask>[]
  output: OutputAdapter<CoderOutput>
  validator: Validator<CoderOutput>
  driver: Driver<CoderTask, CoderOutput, 'pick-winner' | 'fail'>
} {
  const harnesses =
    options.harnesses && options.harnesses.length > 0
      ? options.harnesses
      : ['claude-code', 'codex', 'opencode/zai-coding-plan/glm-5.1']
  const models = options.models ?? []
  const agentRuns = harnesses.map((harness, i) => coderRunSpec({ harness, model: models[i] }))
  const driver: Driver<CoderTask, CoderOutput, 'pick-winner' | 'fail'> = {
    name: 'fanout',
    plan: async (task, history) => (history.length === 0 ? agentRuns.map(() => task) : []),
    decide: (history) => (history.some((i) => i.verdict?.valid === true) ? 'pick-winner' : 'fail'),
  }
  return { agentRuns, output: coderOutputAdapter, validator: defaultCoderValidator(), driver }
}

/**
 * The sandbox `CoderOutput` validator. A thin shim over the shared {@link runCoderChecks} gate,
 * adapting the parsed `CoderOutput` into the gate inputs.
 *
 * @experimental
 */
export function createCoderValidator(task: CoderTask): Validator<CoderOutput> {
  const constraints: CoderCheckConstraints = {
    maxDiffLines: task.maxDiffLines ?? DEFAULT_MAX_DIFF_LINES,
    forbiddenPaths: task.forbiddenPaths ?? [],
  }
  return {
    async validate(output) {
      return runCoderChecks(
        {
          patch: output.patch,
          testsPassed: output.testResult.passed,
          typecheckPassed: output.typecheckResult.passed,
        },
        constraints,
      )
    },
  }
}

function defaultCoderValidator(): Validator<CoderOutput> {
  return createCoderValidator({
    goal: '',
    repoRoot: '',
    forbiddenPaths: [],
    maxDiffLines: DEFAULT_MAX_DIFF_LINES,
  })
}

/**
 * Walk the event stream and return the structured coder payload.
 *
 * A `result` / `final` event lifts the structured payload onto `data.result`. That payload is
 * either the in-process executor's raw worktree-harness result (projected onto `CoderOutput`) or an
 * LLM-emitted `CoderOutput`-shaped JSON. When neither is present, the scan accumulates ALL assistant
 * text in stream order (any harness shape) and takes the last fenced JSON block that coerces —
 * claude-code lifts whole text onto `data.text`/`data.delta`; opencode streams `message.part.updated`
 * fragments, so the final block is split across many events and never whole in one.
 */
function parseCoderEvents(events: SandboxEvent[]): CoderOutput {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (!event) continue
    const type = String(event.type ?? '')
    const data = isRecord(event.data) ? event.data : {}
    if (type === 'result' || type === 'final' || type === 'coder.result') {
      const payload = data.result ?? data.output ?? data
      const projected = projectWorktreeArtifact(payload)
      if (projected) return projected
      const direct = coerceCoderOutput(payload)
      if (direct) return direct
    }
  }
  const transcript = collectAssistantText(events)
  for (const candidate of fencedJsonBlocks(transcript)) {
    const coerced = coerceCoderOutput(candidate)
    if (coerced) return coerced
  }
  return {
    branch: '',
    patch: '',
    testResult: { passed: false, output: '' },
    typecheckResult: { passed: false, output: '' },
    diffStats: { filesChanged: 0, insertions: 0, deletions: 0 },
  }
}

/** Project the in-process executor's raw worktree-harness result (`{ branch, patch, stats, checks,
 *  harness }`) onto `CoderOutput`. A check that did not run is treated as passing (the executor
 *  simply didn't run that command). Returns undefined when the payload is not a worktree artifact. */
function projectWorktreeArtifact(value: unknown): CoderOutput | undefined {
  if (!isRecord(value)) return undefined
  const stats = value.stats
  if (!isRecord(stats)) return undefined // not the raw artifact shape
  const branch = pickString(value.branch) ?? ''
  const patch = pickString(value.patch) ?? ''
  const checks = isRecord(value.checks) ? value.checks : {}
  const tests = isRecord(checks.tests) ? checks.tests : undefined
  const typecheck = isRecord(checks.typecheck) ? checks.typecheck : undefined
  const harness = isRecord(value.harness) ? value.harness : undefined
  const exitCode = harness ? toFiniteInt(harness.exitCode) : 0
  const timedOut = harness?.timedOut === true
  const harnessName = harness ? (pickString(harness.name) ?? 'harness') : 'harness'
  return {
    branch,
    patch,
    testResult: {
      passed: tests ? tests.passed === true : true,
      output: tail(pickString(tests?.output) ?? '', 4000),
    },
    typecheckResult: {
      passed: typecheck ? typecheck.passed === true : true,
      output: tail(pickString(typecheck?.output) ?? '', 4000),
    },
    diffStats: {
      filesChanged: toFiniteInt(stats.filesChanged),
      insertions: toFiniteInt(stats.insertions),
      deletions: toFiniteInt(stats.deletions),
    },
    ...(exitCode !== 0
      ? {
          reviewerNotes: `harness ${harnessName} exited ${exitCode}${timedOut ? ' (timed out)' : ''}`,
        }
      : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Keep the last `max` chars of a diagnostic string — harness stdout can be large; the gate reads
 *  `passed`, not this text, so only the tail is retained for traces/logs. */
function tail(text: string, max: number): string {
  return text.length <= max ? text : text.slice(text.length - max)
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Concatenate assistant text across the event stream in arrival order, tolerating every harness
 * shape: claude-code lifts text onto `data.text`/`data.delta`; opencode streams
 * `message.part.updated` with `data.part.type === 'text'` carrying `data.delta`/`data.part.text`.
 * Reasoning/thinking parts are excluded — only the final answer text carries the result JSON.
 */
function collectAssistantText(events: SandboxEvent[]): string {
  const chunks: string[] = []
  for (const event of events) {
    if (!event) continue
    const data = isRecord(event.data) ? event.data : {}
    if (String(event.type ?? '') === 'message.part.updated') {
      const part = isRecord(data.part) ? data.part : {}
      const partType = String(part.type ?? '')
      if (partType !== 'text' && partType !== '') continue
      const text = pickString(data.delta) ?? pickString(part.text)
      if (text) chunks.push(text)
      continue
    }
    const text = pickString(data.text) ?? pickString(data.delta)
    if (text) chunks.push(text)
  }
  return chunks.join('')
}

/** All parseable fenced JSON blocks in `text`, last-first (the final result block the agent emits
 *  is the one we want). */
function fencedJsonBlocks(text: string): unknown[] {
  const out: unknown[] = []
  const matches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const body = (matches[i]?.[1] ?? '').trim()
    if (!body) continue
    try {
      out.push(JSON.parse(body))
    } catch {
      // not JSON — keep scanning earlier blocks
    }
  }
  return out
}

function coerceCoderOutput(value: unknown): CoderOutput | undefined {
  if (!isRecord(value)) return undefined
  const branch = pickString(value.branch)
  const patch = pickString(value.patch) ?? ''
  if (branch === undefined) return undefined
  return {
    branch,
    patch,
    testResult: coerceCmdResult(value.testResult),
    typecheckResult: coerceCmdResult(value.typecheckResult),
    diffStats: coerceDiffStats(value.diffStats),
    reviewerNotes: pickString(value.reviewerNotes),
  }
}

function coerceCmdResult(value: unknown): { passed: boolean; output: string } {
  if (!isRecord(value)) return { passed: false, output: '' }
  return { passed: value.passed === true, output: pickString(value.output) ?? '' }
}

function coerceDiffStats(value: unknown): {
  filesChanged: number
  insertions: number
  deletions: number
} {
  if (!isRecord(value)) return { filesChanged: 0, insertions: 0, deletions: 0 }
  return {
    filesChanged: toFiniteInt(value.filesChanged),
    insertions: toFiniteInt(value.insertions),
    deletions: toFiniteInt(value.deletions),
  }
}

function toFiniteInt(value: unknown): number {
  if (typeof value !== 'number') return 0
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}
