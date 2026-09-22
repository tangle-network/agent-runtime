/**
 * `defineLeaderboard` — the declarative eval-leaderboard facade.
 *
 * A product's harness×model leaderboard is always the same assembly: expand a
 * base profile across the harness×model axes (`expandProfileAxes`), run every
 * (profile, case) cell as a driven loop (`loopDispatch` + `naiveDriver`), score
 * with the domain's grader, and emit ONE `runProfileMatrix` call. Each product
 * hand-rolled that assembly (~650 lines each) and re-hit the same footguns:
 * stale cell-cache reuse, zero-token stub cells, missing model snapshots.
 *
 * This facade IS that assembly, once, with the domain reduced to a declarative
 * spec: `cases` + `prompt` + `score`. It contains NO execution, judging, or
 * metering logic of its own — every moving part is an existing primitive, and
 * every default is overridable:
 *
 *   - LEVEL 0 (declarative): `cases` / `prompt` / `score` / `axis`.
 *   - LEVEL 1 (configuration): `providers`, `flags`, `parseOutput`, `onCellEvents`,
 *     `resolveModel`, `setup`/`teardown`, `export`, `modelBackend`, `matrix`
 *     passthrough.
 *   - LEVEL 2 (replacement): `dispatch` and `judges` swap out the whole
 *     loop wiring or scoring; `runProfileMatrix` itself stays public as the
 *     escape floor — a product overriding everything just writes what it has
 *     today, no capability removed.
 *
 * `toBenchmarkAdapter()` exposes the same domain surface in the structural
 * `BenchmarkAdapter` shape (`name`/`preflight`/`loadTasks`/`judge`/
 * `goldArtifact`) so a product leaderboard can register into a benchmark
 * registry without this module depending on one.
 *
 * @experimental
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type AgentProfile,
  CODING_HARNESSES,
  expandProfileAxes,
  type HarnessType,
  harnessAxisOf,
  type MaximumCharge,
} from '@tangle-network/agent-eval'
import {
  type JudgeConfig,
  type ProfileDispatchFn,
  type RunProfileMatrixOptions,
  type RunProfileMatrixResult,
  runProfileMatrix,
  type Scenario,
} from '@tangle-network/agent-eval/campaign'
import { harnessTypeSchema } from '@tangle-network/agent-interface'
import type {
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { createCliBridgeProvider } from '@tangle-network/agent-provider-cli-bridge'
import { leaderboard, renderLeaderboardMarkdown } from './benchmark-report'
import { loopDispatch } from './loop-dispatch'
import { naiveDriver, type SteeringDecision } from './steering-drivers'
import type { LoopResult } from './types'

/** Structured per-case verdict a `score` function may return (a bare number is
 *  shorthand for `{ composite }`). `composite` is the [0,1] leaderboard score;
 *  `dimensions` are recorded as extra judge dimensions. */
export interface LeaderboardScore {
  composite: number
  dimensions?: Record<string, number>
  notes?: string
}

/** The campaign scenario a case is wrapped into: the case rides along so
 *  judges and hooks can reach the full domain payload, not just its id. */
export interface LeaderboardScenario<TCase> extends Scenario {
  case: TCase
}

/** One extra CLI flag a spec declares. Parsed by `run()` as `--<name> <value>`
 *  and surfaced to every hook via `ctx.args`. */
export interface LeaderboardFlagSpec {
  default?: string
  description: string
}

/** Resolved run configuration handed to `setup` / `teardown` / `export`. */
export interface LeaderboardRunContext {
  name: string
  /** Environment provider name selected by `--provider`. */
  provider: string
  runDir: string
  exportDir: string
  /** Every parsed flag (standard + `spec.flags`), by name without `--`. */
  args: Record<string, string | undefined>
  harnesses: readonly HarnessType[]
  /** Snapshot-stamped model ids (`name@snapshot`) — the eval identity models. */
  models: readonly string[]
  caseIds: readonly string[]
  shots: number
  reps: number
}

/** Structurally `BenchTask` (bench registry shape) — declared locally so this
 *  module adds no dependency on a benchmark package. */
export interface LeaderboardBenchTask {
  id: string
  prompt: string
  split?: string
  metadata?: Record<string, unknown>
}

/** Structurally `BenchScore` (bench registry shape). */
export interface LeaderboardBenchScore {
  resolved: boolean
  score: number
  detail?: string
}

/** Structurally `BenchmarkAdapter` (bench registry shape): `name`,
 *  `preflight()`, `loadTasks()`, deterministic `judge()`, `goldArtifact()`.
 *  Generic over the artifact channel; the `string` default IS the registry
 *  shape, so a default-artifact adapter registers unchanged. */
export interface LeaderboardBenchmarkAdapter<TArtifact = string> {
  readonly name: string
  preflight(): Promise<void>
  loadTasks(opts?: {
    limit?: number
    split?: string
    ids?: string[]
  }): Promise<LeaderboardBenchTask[]>
  judge(task: LeaderboardBenchTask, artifact: TArtifact): Promise<LeaderboardBenchScore>
  goldArtifact(task: LeaderboardBenchTask): Promise<string | undefined>
}

/** Per-shot outcome context passed as `onCellEvents`'s third argument — how a
 *  thrown shot (which never reaches `parseOutput`) stays visible through the
 *  facade instead of surfacing only as an empty zero-token cell. */
export interface LeaderboardIterationInfo {
  /** 0-based shot index within the cell. */
  index: number
  /** The shot's thrown error message, when the shot failed before scoring. */
  error?: string
  /** The shot's validator verdict, when the shot reached scoring. */
  verdict?: { score?: number }
}

/**
 * The declarative leaderboard spec. `TArtifact` is the artifact channel the
 * dispatch produces and the judges score — `string` (the default) is the plain
 * agent-response-text path; a structured artifact type flows natively once the
 * spec supplies `parseOutput` (or a LEVEL-2 `dispatch`) producing it.
 */
export interface LeaderboardSpec<TCase, TArtifact = string> {
  /** Leaderboard name — the scenario `kind`, default profile name, and report title. */
  name: string
  /** The case corpus. Every case needs a stable string id (see `caseId`). */
  cases: TCase[]
  /** Stable id extractor. Default: the case's own `id` property (fail-loud
   *  when absent or not a string). */
  caseId?: (c: TCase) => string
  /** The per-case task prompt. May be async (e.g. built by shelling out to a
   *  reference implementation); resolved ONCE per case before dispatch. */
  prompt: (c: TCase) => string | Promise<string>
  /** The domain grader: agent output artifact → score. Used BOTH as the
   *  per-shot validator (a shot with `composite > 0` stops the naive retry
   *  loop) and, wrapped as a campaign judge, as the recorded leaderboard score. */
  score: (output: TArtifact, c: TCase) => number | LeaderboardScore
  /** Harness × model axes for `expandProfileAxes`. Defaults: the canonical
   *  `CODING_HARNESSES` × the base profile's `model.default`. `--harnesses` /
   *  `--models` override per run. */
  axis?: { harnesses?: readonly HarnessType[]; models?: readonly string[] }
  /** Base profile the axes expand over (prompt/tools/skills held fixed).
   *  Default: a minimal `{ name, model: { default: <first model> } }`. */
  baseProfile?: AgentProfile
  /**
   * Provider registry: `--provider <name>` picks the official
   * `AgentEnvironmentProvider` used by every cell. `cli-bridge` is available by
   * default and reads `CLI_BRIDGE_URL` plus `BRIDGE_BEARER` or
   * `CLI_BRIDGE_BEARER`. Product providers extend or replace that default.
   */
  providers?: Record<string, (() => AgentEnvironmentProvider) | undefined>
  /** Extra `--flag value` CLI args `run()` parses and surfaces via `ctx.args`. */
  flags?: Record<string, LeaderboardFlagSpec>
  /** Runs once before the matrix (fetch fixtures, warm caches). */
  setup?: (ctx: LeaderboardRunContext) => Promise<void> | void
  /** Runs once after the matrix, even on failure (reap boxes, close handles). */
  teardown?: (ctx: LeaderboardRunContext) => Promise<void> | void
  /** Per-cell event tap: the raw provider events of every shot, with the case.
   *  the seam for domain metric capture (search counts, citations) without a
   *  substrate change. Fires once per shot after the cell's loop settles, in
   *  shot order, including thrown shots (whose events may be partial or empty);
   *  the third argument carries the shot's index + error/verdict outcome. */
  onCellEvents?: (
    events: readonly AgentEnvironmentEvent[],
    c: TCase,
    iteration?: LeaderboardIterationInfo,
  ) => void
  /** Output decode override: raw events to the scored artifact. Default:
   *  `collectEnvironmentResponseText` (final answer text; empty string when the
   *  stream carried none, which then scores 0). The default only
   *  produces `string`, so a spec with a structured `TArtifact` MUST supply
   *  this (or a LEVEL-2 `dispatch`). */
  parseOutput?: (events: readonly AgentEnvironmentEvent[], c: TCase) => TArtifact
  /**
   * Resolve the model the provider actually served from a shot's raw events.
   * Required for HARNESS_NATIVE_MODEL-snapped cells (a vendor-locked harness ×
   * an out-of-family model expands to the `default` sentinel): the RunRecord
   * must pin a real snapshot-bearing model id, which only the dispatch,
   * reading the provider's usage and terminal events, can know. When this returns
   * a value the default dispatch records it on the paid-call receipt;
   * in-family cells (concrete declared model) never need it.
   */
  resolveModel?: (events: readonly AgentEnvironmentEvent[]) => string | undefined
  /** Result export. Default: write `matrix-result.json` under the run dir and
   *  print (+ write) the ranked leaderboard markdown under the export dir. */
  export?: (
    result: RunProfileMatrixResult<TArtifact, LeaderboardScenario<TCase>>,
    ctx: LeaderboardRunContext,
  ) => Promise<void> | void
  /** LEVEL 2 — full dispatch replacement (in-process products bring their own).
   *  The default is `loopDispatch` + `naiveDriver` over the resolved provider. */
  dispatch?: ProfileDispatchFn<LeaderboardScenario<TCase>, TArtifact>
  /** LEVEL 2 — full judge replacement. Default: `score` wrapped as one judge. */
  judges?: JudgeConfig<TArtifact, LeaderboardScenario<TCase>>[]
  /** Naive-retry shot cap per cell (`--shots`). Default 1. */
  shots?: number
  /** Replicates per cell (`--reps`). Default 1. */
  reps?: number
  /** Provider- or executor-enforced maximum for one cell dispatch. Required
   * before execution when `matrix.costCeiling` is configured. */
  maximumCharge?:
    | MaximumCharge
    | ((profile: AgentProfile, scenario: LeaderboardScenario<TCase>) => MaximumCharge | undefined)
  /** Passthrough overrides spread onto the final `runProfileMatrix` call
   *  (e.g. `maxConcurrency`, `costCeiling`, `integrity`, `storage`) — spread
   *  LAST, so anything the facade wired can be overridden. */
  matrix?: Partial<RunProfileMatrixOptions<LeaderboardScenario<TCase>, TArtifact>>
}

export interface DefinedLeaderboard<TCase, TArtifact = string> {
  /**
   * Parse flags, run the matrix, export, and return the raw result.
   *
   * Standard flags: `--provider <name>` (default `cli-bridge`), `--harnesses a,b`,
   * `--models m1,m2`, `--cases id1,id2`, `--shots N`, `--reps N`,
   * `--model-snapshot <tag>`, `--run-dir <path>`, `--export-dir <path>`,
   * plus every `spec.flags` entry. `argv` defaults to `process.argv.slice(2)`.
   *
   * The default run dir is FRESH per invocation (timestamp+pid under the OS
   * tmpdir). `runProfileMatrix` caches cells by run dir, and a stable default
   * would silently reuse a prior FAILED zero-token cell and skip dispatch —
   * only an explicit `--run-dir` opts into that resume behavior.
   */
  run(argv?: string[]): Promise<RunProfileMatrixResult<TArtifact, LeaderboardScenario<TCase>>>
  /** The same domain surface in the structural `BenchmarkAdapter` shape. */
  toBenchmarkAdapter(): LeaderboardBenchmarkAdapter<TArtifact>
}

/** Read `--name <value>` from an argv array. */
function argOf(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1]
  return undefined
}

function splitList(v: string | undefined): string[] | undefined {
  if (v === undefined) return undefined
  const parts = v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.length > 0 ? parts : undefined
}

/** RunRecords reject a bare model id — the eval IDENTITY model must carry a
 *  snapshot (`name@<snapshot>`). Unchanged when already stamped. */
function withSnapshot(model: string, snapshot: string): string {
  return model.includes('@') ? model : `${model}@${snapshot}`
}

/** The bare model id the provider actually serves (identity snapshot stripped). */
function bareModel(model: string): string {
  return model.split('@')[0] ?? model
}

function gitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

function normalizeScore(s: number | LeaderboardScore): LeaderboardScore {
  return typeof s === 'number' ? { composite: s } : s
}

function collectEnvironmentResponseText(events: readonly AgentEnvironmentEvent[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!event) continue
    for (const key of ['finalText', 'response', 'text', 'content']) {
      const value = event.data[key]
      if (typeof value === 'string') return value
    }
  }
  let text = ''
  for (const event of events) {
    if (
      event.normalized?.type === 'message.part.updated' &&
      typeof event.normalized.delta === 'string'
    ) {
      text += event.normalized.delta
    } else if (typeof event.data.delta === 'string') {
      text += event.data.delta
    }
  }
  return text
}

/**
 * Assemble a declarative spec (`cases` + `prompt` + `score`) into a runnable
 * harness×model leaderboard — `run()` executes the matrix, `toBenchmarkAdapter()`
 * exposes the same domain as a structural `BenchmarkAdapter`.
 */
export function defineLeaderboard<TCase, TArtifact = string>(
  spec: LeaderboardSpec<TCase, TArtifact>,
): DefinedLeaderboard<TCase, TArtifact> {
  const caseId = (c: TCase): string => {
    const id = spec.caseId ? spec.caseId(c) : (c as { id?: unknown }).id
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(
        `defineLeaderboard(${spec.name}): every case needs a stable string id — ` +
          'give cases an `id` property or supply spec.caseId',
      )
    }
    return id
  }

  const selectCases = (ids?: readonly string[]): TCase[] => {
    if (!ids) return spec.cases
    const byId = new Map(spec.cases.map((c) => [caseId(c), c]))
    return ids.map((id) => {
      const c = byId.get(id)
      if (c === undefined) {
        throw new Error(
          `defineLeaderboard(${spec.name}): unknown case "${id}" (have: ${[...byId.keys()].join(', ')})`,
        )
      }
      return c
    })
  }

  const scoreJudge: JudgeConfig<TArtifact, LeaderboardScenario<TCase>> = {
    name: `${spec.name}-score`,
    dimensions: [{ key: 'composite', description: `${spec.name} case score` }],
    score({ artifact, scenario }) {
      const s = normalizeScore(spec.score(artifact, scenario.case))
      return {
        composite: s.composite,
        dimensions: { composite: s.composite, ...s.dimensions },
        notes: s.notes ?? '',
      }
    },
  }

  async function run(
    argv: string[] = process.argv.slice(2),
  ): Promise<RunProfileMatrixResult<TArtifact, LeaderboardScenario<TCase>>> {
    const args: Record<string, string | undefined> = {}
    for (const name of [
      'provider',
      'harnesses',
      'models',
      'cases',
      'shots',
      'reps',
      'model-snapshot',
      'run-dir',
      'export-dir',
    ]) {
      args[name] = argOf(argv, name)
    }
    for (const [name, flag] of Object.entries(spec.flags ?? {})) {
      args[name] = argOf(argv, name) ?? flag.default
    }

    const providerName = args.provider ?? 'cli-bridge'
    const shots = Number(args.shots ?? spec.shots ?? 1)
    const reps = Number(args.reps ?? spec.reps ?? 1)
    const snapshot = args['model-snapshot'] ?? 'leaderboard'
    // FRESH run dir per invocation: runProfileMatrix caches cells by run dir,
    // and a stable default resumes a prior FAILED zero-token cell without
    // re-dispatching. Only an explicit --run-dir opts into resume.
    const runDir =
      args['run-dir'] ?? join(tmpdir(), `leaderboard-${spec.name}-${Date.now()}-${process.pid}`)
    const exportDir = args['export-dir'] ?? join(runDir, 'export')
    mkdirSync(runDir, { recursive: true })

    const cases = selectCases(splitList(args.cases))
    if (cases.length === 0) throw new Error(`defineLeaderboard(${spec.name}): no cases to run`)
    const scenarios: LeaderboardScenario<TCase>[] = cases.map((c) => ({
      id: caseId(c),
      kind: spec.name,
      case: c,
    }))

    const requestedHarnesses = splitList(args.harnesses)
    const harnesses =
      requestedHarnesses?.map((harness) => {
        const parsed = harnessTypeSchema.safeParse(harness)
        if (!parsed.success) {
          throw new Error(`defineLeaderboard(${spec.name}): invalid harness "${harness}"`)
        }
        return parsed.data
      }) ??
      spec.axis?.harnesses ??
      CODING_HARNESSES
    const rawModels =
      splitList(args.models) ??
      spec.axis?.models ??
      (spec.baseProfile?.model?.default !== undefined
        ? [spec.baseProfile.model.default]
        : undefined)
    if (!rawModels || rawModels.length === 0) {
      throw new Error(
        `defineLeaderboard(${spec.name}): no models — pass --models, set spec.axis.models, ` +
          'or give spec.baseProfile a model.default',
      )
    }
    const models = rawModels.map((m) => withSnapshot(m, snapshot))

    const base: AgentProfile =
      spec.baseProfile ??
      ({ name: spec.name, model: { default: bareModel(models[0] ?? '') } } as AgentProfile)
    const profiles = expandProfileAxes({ base, harnesses, models })

    const ctx: LeaderboardRunContext = {
      name: spec.name,
      provider: providerName,
      runDir,
      exportDir,
      args,
      harnesses,
      models,
      caseIds: scenarios.map((s) => s.id),
      shots,
      reps,
    }

    // Factories are lazy so an unused provider never resolves credentials.
    const providers: Record<string, (() => AgentEnvironmentProvider) | undefined> = {
      'cli-bridge': () => {
        const bearer = process.env.BRIDGE_BEARER ?? process.env.CLI_BRIDGE_BEARER
        if (!bearer) {
          throw new Error(
            `defineLeaderboard(${spec.name}): provider 'cli-bridge' needs BRIDGE_BEARER or CLI_BRIDGE_BEARER`,
          )
        }
        return createCliBridgeProvider({
          baseUrl: process.env.CLI_BRIDGE_URL ?? 'http://127.0.0.1:3355',
          bearerToken: bearer,
          defaultModel: bareModel(models[0] ?? ''),
        })
      },
      ...spec.providers,
    }
    const makeProvider = providers[providerName]
    if (!makeProvider) {
      throw new Error(
        `defineLeaderboard(${spec.name}): unknown provider "${providerName}" (have: ${Object.keys(providers).join(', ')})`,
      )
    }
    const environmentProvider = makeProvider()

    // Prompts resolve ONCE per case, up front — spec.prompt may be async
    // (shelling out to a reference implementation) but the loop kernel's
    // taskToPrompt is sync.
    const promptById = new Map<string, string>()
    for (const s of scenarios) promptById.set(s.id, await spec.prompt(s.case))
    const promptOf = (s: LeaderboardScenario<TCase>): string => {
      const p = promptById.get(s.id)
      if (p === undefined)
        throw new Error(`defineLeaderboard(${spec.name}): no prompt for case "${s.id}"`)
      return p
    }

    // Monotonic per-shot nonce appended to each shot's prompt — defeats router
    // response-caching of byte-identical prompts across naive-retry shots.
    let shotNonce = 0

    // The default dispatch wraps loopDispatch per cell (closures only — no
    // per-cell resource cost) so the loop's finished iterations can be joined
    // with the campaign ctx: onCellEvents gets EVERY shot's outcome (a thrown
    // shot never reaches parse, so parse-time tapping would hide it), and a
    // the cost receipt records the spec-resolved served model (the only way to
    // pin HARNESS_NATIVE_MODEL-snapped cells to a real model).
    const maximumCharge = spec.maximumCharge
    const dispatch: ProfileDispatchFn<LeaderboardScenario<TCase>, TArtifact> = spec.dispatch ??
    ((profile, scenario, dispatchCtx) => {
      const cellDispatch = loopDispatch<
        LeaderboardScenario<TCase>,
        TArtifact,
        SteeringDecision,
        LeaderboardScenario<TCase>,
        TArtifact
      >({
        environmentProvider,
        maximumCharge:
          typeof maximumCharge === 'function'
            ? (cellScenario, cellProfile) => maximumCharge(cellProfile, cellScenario)
            : maximumCharge,
        resolveCostModel: (result, _cellScenario, cellProfile) => {
          if (!spec.resolveModel) return cellProfile.model?.default
          const served = new Set(
            result.iterations
              .map((iteration) => spec.resolveModel?.(iteration.events))
              .filter((model): model is string => model !== undefined),
          )
          if (served.size > 1) {
            throw new Error(
              `defineLeaderboard(${spec.name}): one cell reported multiple served models: ${[...served].join(', ')}`,
            )
          }
          return [...served][0] ?? cellProfile.model?.default
        },
        toLoopOptions: (cellScenario, cellProfile) => {
          // The cell's harness and model come from the profile axis. The
          // provider receives the harness as its environment backend.
          const axis = harnessAxisOf(cellProfile)
          return {
            // naiveDriver = the no-signal retry floor: re-run the same case as
            // an independent attempt until one scores (>0) or the shot cap.
            driver: naiveDriver<LeaderboardScenario<TCase>, TArtifact>({
              continuation: '',
              applyContinuation: (task) => task,
              maxIterations: shots,
            }),
            agentRun: {
              profile: cellProfile,
              taskToPrompt: (s) => `${promptOf(s)}\n\n<!-- independent-attempt:${shotNonce++} -->`,
              ...(axis
                ? {
                    environment: {
                      backend: axis.harness,
                    },
                  }
                : {}),
            },
            output: {
              parse: (events) =>
                spec.parseOutput
                  ? spec.parseOutput(events, cellScenario.case)
                  : // The default decode produces string — the TArtifact
                    // default. A structured-TArtifact spec supplies parseOutput
                    // (documented on the field), so this cast never lies.
                    (collectEnvironmentResponseText(events) as TArtifact),
            },
            validator: {
              validate: async (output: TArtifact) => {
                const s = normalizeScore(spec.score(output, cellScenario.case))
                return { valid: s.composite > 0, score: s.composite }
              },
            },
            task: cellScenario,
            maxIterations: shots,
          }
        },
        toArtifact: (result: LoopResult<LeaderboardScenario<TCase>, TArtifact, unknown>) => {
          for (const iter of result.iterations) {
            spec.onCellEvents?.(iter.events, scenario.case, {
              index: iter.index,
              ...(iter.error ? { error: iter.error.message } : {}),
              ...(iter.verdict ? { verdict: { score: iter.verdict.score } } : {}),
            })
          }
          // Same as loopDispatch's default: no winner → undefined artifact
          // (judges skip the cell; usage is still reported).
          return result.winner?.output as TArtifact
        },
      })
      return cellDispatch(profile, scenario, dispatchCtx)
    })

    await spec.setup?.(ctx)
    try {
      const result = await runProfileMatrix<LeaderboardScenario<TCase>, TArtifact>({
        profiles,
        scenarios,
        dispatch,
        judges: spec.judges ?? [scoreJudge],
        runDir,
        commitSha: gitSha(),
        reps,
        ...spec.matrix,
      })

      if (spec.export) {
        await spec.export(result, ctx)
      } else {
        mkdirSync(exportDir, { recursive: true })
        writeFileSync(join(runDir, 'matrix-result.json'), `${JSON.stringify(result, null, 2)}\n`)
        const table = renderLeaderboardMarkdown(
          leaderboard(result.records, { title: spec.name, meta: { provider: providerName } }),
        )
        writeFileSync(join(exportDir, 'leaderboard.md'), table)
        console.log(table)
      }
      return result
    } finally {
      await spec.teardown?.(ctx)
    }
  }

  function toBenchmarkAdapter(): LeaderboardBenchmarkAdapter<TArtifact> {
    return {
      name: spec.name,
      async preflight(): Promise<void> {
        // Case-id integrity is the cheap, real check: duplicate or missing ids
        // corrupt every downstream join.
        const seen = new Set<string>()
        for (const c of spec.cases) {
          const id = caseId(c)
          if (seen.has(id)) {
            throw new Error(`defineLeaderboard(${spec.name}): duplicate case id "${id}"`)
          }
          seen.add(id)
        }
      },
      async loadTasks(opts): Promise<LeaderboardBenchTask[]> {
        const selected = selectCases(opts?.ids)
        const limited = opts?.limit !== undefined ? selected.slice(0, opts.limit) : selected
        return Promise.all(
          limited.map(async (c) => ({
            id: caseId(c),
            prompt: await spec.prompt(c),
            metadata: { case: c },
          })),
        )
      },
      async judge(task, artifact): Promise<LeaderboardBenchScore> {
        const [c] = selectCases([task.id])
        if (c === undefined)
          throw new Error(`defineLeaderboard(${spec.name}): no case "${task.id}"`)
        const s = normalizeScore(spec.score(artifact, c))
        return { resolved: s.composite > 0, score: s.composite, detail: s.notes }
      },
      async goldArtifact(): Promise<string | undefined> {
        return undefined
      },
    }
  }

  return { run, toBenchmarkAdapter }
}
