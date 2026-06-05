/**
 * @experimental
 *
 * `coderProfile` — opinionated preset for code-modification tasks.
 *
 * The agent is told to:
 *   - work on a fresh branch inside the sandbox workspace
 *   - keep the patch minimal (under `maxDiffLines`)
 *   - avoid `forbiddenPaths`
 *   - run `testCmd` and `typecheckCmd`
 *   - emit a final JSON result the output adapter parses
 *
 * The profile is stateless and agent-agnostic — `harness` selects the
 * sandbox-SDK backend (`claude-code`, `codex`, `opencode/*`). For
 * heterogeneous fanout, use `multiHarnessCoderFanout`.
 */

import type { AgentProfile, SandboxEvent } from '@tangle-network/sandbox'
import type { AgentRunSpec, DefaultVerdict, Driver, OutputAdapter, Validator } from '../loops/types'

const DEFAULT_MAX_DIFF_LINES = 400

/** @experimental */
export interface CoderTask {
  /** What the agent must accomplish. Free-form prose. */
  goal: string
  /** Absolute path inside the sandbox where the repo lives. */
  repoRoot: string
  /** Default `main`. The branch the agent diffs against. */
  baseBranch?: string
  /** Default `pnpm test --run`. */
  testCmd?: string
  /** Default `pnpm typecheck`. */
  typecheckCmd?: string
  /** Files the agent may inspect for context. Surfaced verbatim in the prompt. */
  contextFiles?: string[]
  /**
   * Paths the agent must not touch. Validator hard-fails on any match.
   * Use glob-free literal path prefixes for unambiguous enforcement.
   */
  forbiddenPaths?: string[]
  /** Default 400. Hard cap; validator hard-fails when exceeded. */
  maxDiffLines?: number
}

/** @experimental */
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

/** @experimental */
export interface CoderProfileOptions {
  /** Sandbox-SDK backend.type. Default `'claude-code'`. */
  harness?: string
  /** Default model id passed in `AgentProfile.model.default`. */
  model?: string
  /** Custom system prompt replacement. Default = built-in coder preset. */
  systemPrompt?: string
  /** Stable name for `AgentRunSpec.name`. Default = `coder-${harness}`. */
  name?: string
}

/**
 * Build a coder preset.
 *
 * `validator` enforces test + typecheck + a 400-line default diff cap. For
 * per-task `forbiddenPaths` / `maxDiffLines` enforcement, pass `task` here
 * — the returned validator closes over its constraints. Without a task
 * the validator falls back to the default cap and skips path enforcement.
 *
 * @experimental
 */
export function coderProfile(options: CoderProfileOptions & { task?: CoderTask } = {}): {
  profile: AgentProfile
  taskToPrompt: (task: CoderTask) => string
  output: OutputAdapter<CoderOutput>
  validator: Validator<CoderOutput>
  agentRunSpec: AgentRunSpec<CoderTask>
} {
  const harness = options.harness ?? 'claude-code'
  const name = options.name ?? `coder-${harness}`
  const systemPrompt = options.systemPrompt ?? DEFAULT_CODER_SYSTEM_PROMPT
  const profile: AgentProfile = {
    name,
    description: 'Code-modification agent. Minimal-diff worktree-based coder.',
    prompt: { systemPrompt },
    model: options.model ? { default: options.model } : undefined,
    tools: { git: true, fs: true, shell: true, test_runner: true },
    metadata: { backendType: harness, role: 'coder' },
  }
  const output: OutputAdapter<CoderOutput> = { parse: parseCoderEvents }
  const validator: Validator<CoderOutput> = options.task
    ? createCoderValidator(options.task)
    : createCoderValidator({
        goal: '',
        repoRoot: '',
        forbiddenPaths: [],
        maxDiffLines: DEFAULT_MAX_DIFF_LINES,
      })
  const agentRunSpec: AgentRunSpec<CoderTask> = {
    name,
    profile,
    taskToPrompt: formatCoderPrompt,
  }
  return { profile, taskToPrompt: formatCoderPrompt, output, validator, agentRunSpec }
}

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

/** @experimental */
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
  const agentRuns = harnesses.map((harness, i) => {
    const { agentRunSpec } = coderProfile({ harness, model: models[i] })
    return agentRunSpec
  })
  const { output, validator } = coderProfile()
  const driver: Driver<CoderTask, CoderOutput, 'pick-winner' | 'fail'> = {
    name: 'fanout',
    plan: async (task, history) => (history.length === 0 ? agentRuns.map(() => task) : []),
    decide: (history) => (history.some((i) => i.verdict?.valid === true) ? 'pick-winner' : 'fail'),
  }
  return { agentRuns, output, validator, driver }
}

const DEFAULT_CODER_SYSTEM_PROMPT = [
  'You are a coder agent operating inside an isolated sandbox workspace.',
  'Your job is to deliver a minimal, correct patch for the user-supplied goal.',
  '',
  'Hard rules:',
  '  1. Work on a fresh branch off the supplied base. Do not mutate the base branch.',
  '  2. Never touch a forbidden path. The user will list them explicitly.',
  '  3. Keep the diff under the max-diff cap. Prefer the smallest change that ships.',
  '  4. Run the supplied test and typecheck commands before declaring done.',
  '  5. If either command fails, fix the cause — do not weaken the test or hide the error.',
  '',
  'When you finish, emit a single final structured message of the shape:',
  '  ```json',
  '  { "branch": "<branch-name>",',
  '    "patch": "<unified-diff>",',
  '    "testResult": { "passed": <bool>, "output": "<stdout/stderr>" },',
  '    "typecheckResult": { "passed": <bool>, "output": "<stdout/stderr>" },',
  '    "diffStats": { "filesChanged": <int>, "insertions": <int>, "deletions": <int> },',
  '    "reviewerNotes": "<optional commentary>" }',
  '  ```',
].join('\n')

function formatCoderPrompt(task: CoderTask): string {
  const base = task.baseBranch ?? 'main'
  const testCmd = task.testCmd ?? 'pnpm test --run'
  const typecheckCmd = task.typecheckCmd ?? 'pnpm typecheck'
  const maxDiff = task.maxDiffLines ?? DEFAULT_MAX_DIFF_LINES
  const forbidden = task.forbiddenPaths?.length ? task.forbiddenPaths.join(', ') : '(none)'
  const context = task.contextFiles?.length
    ? task.contextFiles.map((f) => `  - ${f}`).join('\n')
    : '  (none)'
  return [
    `Goal: ${task.goal}`,
    `Repo: ${task.repoRoot}`,
    `Base branch: ${base}`,
    `Run tests with: ${testCmd}`,
    `Run typecheck with: ${typecheckCmd}`,
    `Forbidden paths: ${forbidden}`,
    `Max diff lines: ${maxDiff}`,
    'Context files:',
    context,
    '',
    'Produce a minimal patch on a fresh branch. Run tests and typecheck before',
    'returning. Emit the final JSON result block exactly as instructed.',
  ].join('\n')
}

/**
 * Walk the event stream and return the last structured `coder.result` payload.
 *
 * The agent is instructed to emit a JSON block; in practice the sandbox SDK
 * lifts the structured payload onto `data.result` of a `result` / `final`
 * event. When the event stream does not contain a structured result, the
 * adapter scans text deltas for a fenced JSON block matching the expected
 * keys. Both shapes converge on `CoderOutput`.
 */
function parseCoderEvents(events: SandboxEvent[]): CoderOutput {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (!event) continue
    const type = String(event.type ?? '')
    const data = isRecord(event.data) ? event.data : {}
    if (type === 'result' || type === 'final' || type === 'coder.result') {
      const direct = coerceCoderOutput(data.result ?? data.output ?? data)
      if (direct) return direct
    }
  }
  // Fallback: scan text deltas in reverse for a fenced JSON block.
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (!event) continue
    const data = isRecord(event.data) ? event.data : {}
    const text = pickString(data.text) ?? pickString(data.delta)
    if (!text) continue
    const fenced = extractFencedJson(text)
    if (!fenced) continue
    const coerced = coerceCoderOutput(fenced)
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

/**
 * Build a validator that closes over a specific `CoderTask`'s constraints.
 *
 * Checks in order:
 *   1. Forbidden-path: any `+++` / `---` header in the patch matching a
 *      path prefix in `task.forbiddenPaths` fails hard.
 *   2. Diff size: line count above `task.maxDiffLines` (default 400) fails
 *      hard; below cap, the score shrinks linearly.
 *   3. Tests: `output.testResult.passed` must be `true`.
 *   4. Typecheck: `output.typecheckResult.passed` must be `true`.
 *
 * Aggregate score: `0.5 * tests + 0.3 * typecheck + 0.2 * (1 - diffLines/maxDiff)`.
 * `valid` is the conjunction of all four.
 *
 * @experimental
 */
/**
 * Default-on safety floor (folded from the ai-trading-blueprint delegation
 * MCP): a coder patch that touches a credential-shaped path is rejected
 * regardless of `forbiddenPaths` config. Catches `.env`, private keys,
 * keystores, wallets, and the common secret/credential JSON files.
 */
const SECRET_PATH_RE =
  /(^|\/)(\.env(\.|$)|.*\.(pem|key|p12|pfx|keystore|wallet)|id_rsa|id_ed25519|secrets?\.json|credentials?\.json)$/i

export function createCoderValidator(task: CoderTask): Validator<CoderOutput> {
  const maxDiff = task.maxDiffLines ?? DEFAULT_MAX_DIFF_LINES
  const forbidden = task.forbiddenPaths ?? []
  return {
    async validate(output) {
      const scores: Record<string, number> = {}
      const notes: string[] = []
      let pass = true

      const touched = touchedPathsFromPatch(output.patch)

      // No-op rejection: an empty patch can trivially "pass" tests/typecheck
      // (nothing changed) yet does no work — never a valid coder result.
      if (touched.length === 0 || output.patch.trim().length === 0) {
        pass = false
        scores.nonEmpty = 0
        notes.push('empty patch — no files changed')
      } else {
        scores.nonEmpty = 1
      }

      // Secret-path floor: always-on, independent of `forbiddenPaths`.
      const touchedSecrets = touched.filter((p) => SECRET_PATH_RE.test(p))
      if (touchedSecrets.length > 0) {
        pass = false
        scores.noSecrets = 0
        notes.push(`touched secret-shaped paths: ${touchedSecrets.join(', ')}`)
      } else {
        scores.noSecrets = 1
      }

      const touchedForbidden = forbidden.filter((path) => {
        const prefix = path.endsWith('/') ? path : `${path}/`
        const exact = prefix.slice(0, -1)
        return touched.some((p) => p === exact || p.startsWith(prefix))
      })
      if (touchedForbidden.length > 0) {
        pass = false
        scores.forbiddenPath = 0
        notes.push(`touched forbidden paths: ${touchedForbidden.join(', ')}`)
      } else {
        scores.forbiddenPath = 1
      }

      const diffLines = countDiffLines(output.patch)
      if (diffLines > maxDiff) {
        pass = false
        scores.diffSize = 0
        notes.push(`diff ${diffLines} lines exceeds cap ${maxDiff}`)
      } else {
        scores.diffSize = maxDiff === 0 ? 0 : Math.max(0, 1 - diffLines / maxDiff)
      }

      scores.tests = output.testResult.passed ? 1 : 0
      scores.typecheck = output.typecheckResult.passed ? 1 : 0
      if (!output.testResult.passed) {
        pass = false
        notes.push('tests failed')
      }
      if (!output.typecheckResult.passed) {
        pass = false
        notes.push('typecheck failed')
      }

      const score = 0.5 * scores.tests + 0.3 * scores.typecheck + 0.2 * scores.diffSize
      const verdict: DefaultVerdict = {
        valid: pass,
        score: Number.isFinite(score) ? score : 0,
        scores,
      }
      if (notes.length > 0) verdict.notes = notes.join('; ')
      return verdict
    },
  }
}

function touchedPathsFromPatch(patch: string): string[] {
  const out = new Set<string>()
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      const rest = line.slice(4).trim()
      if (rest === '/dev/null') continue
      const stripped = rest.startsWith('a/') || rest.startsWith('b/') ? rest.slice(2) : rest
      out.add(stripped)
    }
  }
  return [...out]
}

function countDiffLines(patch: string): number {
  let count = 0
  for (const line of patch.split(/\r?\n/)) {
    if (
      (line.startsWith('+') || line.startsWith('-')) &&
      !line.startsWith('+++') &&
      !line.startsWith('---')
    ) {
      count += 1
    }
  }
  return count
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function extractFencedJson(text: string): unknown | undefined {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (!match) return undefined
  const body = (match[1] ?? '').trim()
  if (!body) return undefined
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

function coerceCoderOutput(value: unknown): CoderOutput | undefined {
  if (!isRecord(value)) return undefined
  const branch = pickString(value.branch)
  const patch = pickString(value.patch) ?? ''
  if (branch === undefined) return undefined
  const testResult = coerceCmdResult(value.testResult)
  const typecheckResult = coerceCmdResult(value.typecheckResult)
  const diffStats = coerceDiffStats(value.diffStats)
  return {
    branch,
    patch,
    testResult,
    typecheckResult,
    diffStats,
    reviewerNotes: pickString(value.reviewerNotes),
  }
}

function coerceCmdResult(value: unknown): { passed: boolean; output: string } {
  if (!isRecord(value)) return { passed: false, output: '' }
  return {
    passed: value.passed === true,
    output: pickString(value.output) ?? '',
  }
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
