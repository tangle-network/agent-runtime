/**
 * Gen-3 proposer fan-out — N configured proposers author candidates
 * CONCURRENTLY, each as an `AgentProfile`-pinned harness invocation in its own
 * scratch loops worktree, followed by a CHEAP PRE-FILTER so only survivors
 * reach the expensive full evaluation (reps × instances arm cells).
 *
 * Shape (gen3_design, supervisor-lab/.evolve/state.json):
 *   stage 1 — parallel authoring. The improvement driver calls
 *     `generate()` once per candidate index, serially. The FIRST call of a
 *     generation triggers the fan-out barrier: every proposer authors at once
 *     (Promise.all) in scratch worktrees created from the incumbent commit;
 *     later calls consume the finished outcomes and apply each proposer's
 *     patch onto the driver-owned candidate worktree. Authoring parallelism is
 *     free; eval bandwidth stays the binding resource.
 *   stage 2 — pre-filter per candidate BEFORE arm spend: change-space check +
 *     `tsc` run inside the authoring loop's verifier (existing), plus ONE
 *     smoke cell (cheapest instance, 1 rep) through the injected
 *     `SmokeRunner`. Killed candidates never become surfaces (the driver
 *     discards their worktree — zero arm cells); each kill is recorded and
 *     drained into a staircase dot with verdict `rejected-prefilter`.
 *   stage 3 — survivors proceed through the unchanged pinned-baseline
 *     reps-fail-closed gate.
 *
 * Proposer identity: each proposer is an `AgentProfile` invocation
 * (`agenticGenerator`'s `profile` option → `harnessInvocation`, which threads
 * `prompt.systemPrompt`/`instructions` into the composed prompt and
 * `model.default` into the harness's `-m` flag — verified supported for the
 * claude CLI; a bare profile is byte-identical to the legacy prompt-only
 * invocation). Profile `resources` are only materialized on the reproducible
 * Codex path, so a non-codex proposer with resources fails loud here instead
 * of silently dropping them.
 *
 * NOTE on the import cycle with outer-loop.mts: outer-loop imports this
 * module's generator factory; this module imports outer-loop's change-space +
 * verifier primitives. Every cross-reference is inside a function body (never
 * at module-evaluation time), which ESM resolves correctly.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile as readFilePromise, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  agenticGenerator,
  type CandidateGenerator,
  type AgenticGeneratorShotExecution,
  type AgenticGeneratorShotReceipt,
} from '@tangle-network/agent-runtime'
import { runLocalHarness } from '@tangle-network/agent-runtime/mcp'
import type { AgentProfile } from '@tangle-network/agent-interface'
import type { AnalystFinding, CostLedgerHandle } from '@tangle-network/agent-eval'
import {
  changeSpaceViolations,
  loopsCandidateVerifier,
  proposerShotEnv,
  purgeIgnoredArtifacts,
  round4BuildPrompt,
  type OuterLoopConfig,
} from './outer-loop.mts'
import {
  ACTIVATION_PREDICATE_RELPATH,
  activationPredicateInstruction,
  parseActivationPredicate,
} from './activation.mts'
import { briefingPromptSection, type BriefingContext } from './briefing.mts'
import {
  gepaSeatAuthor,
  isGepaSeat,
  validateGepaSeat,
  type GepaMethodFactory,
  type GepaSeatDeps,
} from './gepa-seat.mts'
import type { ScoreSplit } from './score-split.mts'
import { run, runOk } from './proc.ts'

// ---------------------------------------------------------------------------
// Config types.
// ---------------------------------------------------------------------------

export interface ProposerSpec {
  /** Unique short name — becomes the candidate's staircase `label`. */
  name: string
  /** Path to an `AgentProfile` JSON. Absolute, or relative to this module's
   *  `profiles/` directory. Omitted = bare profile (legacy invocation). */
  profile?: string
  /** Required for harness-authored seats. Absent on an engine seat
   *  (`engine` set) — enforced both ways at generator construction. */
  harness?: 'claude' | 'codex' | 'opencode'
  /** GEN-4 pinned model id, threaded to the harness CLI as `-m <model>` via
   *  the author profile's `model.default` (harnessInvocation maps it for all
   *  three harnesses). Unset = the CLI's own resolved model (its login/settings
   *  default) — recorded per run by the proposer-provenance capture, so the
   *  seat identity is pinned in provenance even when the flag is absent. */
  model?: string
  /** GEN-4 merge seat: this proposer's task is to MERGE the configured
   *  Pareto parents' diffs into one coherent surface (see
   *  `mergeAuthorPrompt`). Requires ≥2 materialized parents — enforced at
   *  generator construction. */
  merge?: boolean
  /** Free-text authoring lens appended to the task prompt (e.g. a mechanics
   *  or reviewer stance). Never overrides the protocol change-space text. */
  lens?: string
  /** Which diagnosis findings this proposer sees. Protocol/steering and
   *  raw-trace-context findings always pass through. Default 'all'. */
  diagnosisSlice?: 'all' | 'mechanics' | 'prompts'
  /** GEPA seat: this seat is an engine invocation (agent-eval's
   *  external-GEPA adapter), not a harness CLI. `gepa` = one bounded engine
   *  run; `omni` = GEPA's official Omni recipe. Validation +
   *  authoring live in gepa-seat.mts. */
  engine?: 'gepa' | 'omni'
  /** GEPA seat: the one repo-relative change-space file GEPA optimizes
   *  as a string; the rest of the loops repo stays at the incumbent commit. */
  surface?: string
  /** GEPA seat: total inner-evaluation budget (each inner call is one
   *  real smoke arm cell). Default 10. */
  maxMetricCalls?: number
  /** GEPA seat: hard cap for metered optimizer-model spend. */
  maxProposerCostUsd?: number
  /** GEPA seat: Python executable for the bridge. Default 'python3'. */
  python?: string
}

export interface PrefilterConfig {
  enabled: boolean
  /** Instance for the single smoke cell: an explicit iid (e.g.
   *  'pallets__flask-5014' once its verify fixture is committed) or
   *  'cheapest-of-set' — the improvement-set instance with the smallest
   *  measured baseline wall time. */
  smokeInstance: string
  /** When true the smoke cell must RESOLVE to survive (right for a designated
   *  easy instance). Default false: the mechanism bar — the arm must complete,
   *  deliver a non-empty patch, and draw a conclusive judge verdict — so a
   *  hard cheapest-of-set instance cannot kill every candidate. */
  requireResolved?: boolean
}

export interface SmokeVerdict {
  iid: string
  pass: boolean
  reason: string
  resolved: boolean | null
  patchLines: number
  wallS: number
  /** Committed verify fixture passed, used as the GEPA seat's inner-score
   *  tiebreak. Absent on errored smokes and older records. */
  verifyPass?: boolean
}

export type SmokeRunner = (args: {
  scratchPath: string
  generation: number
  proposer: ProposerSpec
  costLedger?: CostLedgerHandle
}) => Promise<SmokeVerdict>

export interface PrefilterKill {
  generation: number
  candidateIndex: number
  proposer: string
  harness: ProposerSpec['harness']
  stage: 'change-space' | 'activation-predicate' | 'smoke'
  reason: string
  diffSha256: string | null
  /** Persisted kill-forensics patch under `<outDir>/proposer-patches/`. */
  patchPath: string | null
  smoke?: SmokeVerdict
}

// ---------------------------------------------------------------------------
// Author profiles.
// ---------------------------------------------------------------------------

export const PROFILES_DIR = fileURLToPath(new URL('./profiles', import.meta.url))

/** Load + validate a proposer's `AgentProfile`. Fail-closed on resources for
 *  non-codex harnesses: `agenticGenerator` only materializes profile resource
 *  files on the reproducible Codex path, so accepting them here would drop
 *  them silently. */
export function loadAuthorProfile(spec: ProposerSpec): AgentProfile | undefined {
  if (!spec.profile) return undefined
  const path = spec.profile.startsWith('/') ? spec.profile : join(PROFILES_DIR, spec.profile)
  const profile = JSON.parse(readFileSync(path, 'utf8')) as AgentProfile
  if (typeof profile.name !== 'string' || profile.name.length === 0) {
    throw new Error(`proposer ${spec.name}: profile ${path} has no name`)
  }
  if (profile.resources && spec.harness !== 'codex') {
    throw new Error(
      `proposer ${spec.name}: profile ${path} declares resources, which only materialize on the ` +
        `reproducible codex path — the ${spec.harness} harness would silently drop them`,
    )
  }
  return profile
}

/** The gen-2 author, codified: one bare-profile claude proposer. */
export function defaultProposers(): ProposerSpec[] {
  return [{ name: 'default-author', profile: 'default-author.profile.json', harness: 'claude' }]
}

/** The profile the author shot actually runs: the loaded profile (if any) with
 *  the spec's PINNED MODEL merged into `model.default` — harnessInvocation
 *  turns that into the CLI's `-m <model>` flag (claude/codex/opencode all map
 *  it). Without a pinned model this is byte-identical to `loadAuthorProfile`,
 *  so gen-3 seats keep their exact invocation. A pinned model with no profile
 *  path synthesizes a minimal named profile carrying only the pin. */
export function resolveAuthorProfile(spec: ProposerSpec): AgentProfile | undefined {
  const profile = loadAuthorProfile(spec)
  if (!spec.model) return profile
  const base: AgentProfile = profile ?? { name: `${spec.name}-pinned` }
  return { ...base, model: { ...base.model, default: spec.model } }
}

// ---------------------------------------------------------------------------
// GEN-4 Pareto parents — cross-run seeding at the buildPrompt seam.
//
// The LIB's own `ctx.paretoParents` (runOptimization → SurfaceProposer) only
// accumulates surfaces scored WITHIN one run: the frontier starts from this
// run's baseline and generations, and a prior campaign's surfaces cannot be
// injected without replaying that campaign's runDir + cost ledger (the cached
// cells refuse to load without their ledger receipts). Gen-4 runs in a fresh
// outDir, so the gen-3 winners are seeded HERE — their diffs + per-instance
// results enter every author's task prompt, and the merge seat gets both
// diffs as its explicit merge input. This is our seam, not the lib path;
// noted in the gen-4 config docs.
// ---------------------------------------------------------------------------

/** One prior-run frontier member, as configured (commits live in loopsRepo). */
export interface ParetoParentSeed {
  /** Loops commit of the parent candidate (must exist in `loopsRepo`). */
  commit: string
  /** Staircase label, e.g. 'default-author'. */
  label: string
  /** Instances the parent resolved under the fail-closed all-reps rule. */
  resolvedInstances: string[]
  /** Free-text evidence note (discordant replicates, mechanism summary). */
  note?: string
}

/** A seed materialized against the loops repo: the parent's full diff. */
export interface ParetoParentContext extends ParetoParentSeed {
  diff: string
}

export const PARENT_DIFF_MAX_CHARS = 60_000

/** Materialize parent seeds: verify each commit exists in `loopsRepo` and
 *  capture its full diff (`git show`). Fails loud on a missing commit — a
 *  silently absent parent would turn the merge seat into a no-op. */
export async function materializeParetoParents(
  loopsRepo: string,
  seeds: ParetoParentSeed[],
  maxDiffChars = PARENT_DIFF_MAX_CHARS,
): Promise<ParetoParentContext[]> {
  const parents: ParetoParentContext[] = []
  for (const seed of seeds) {
    const exists = await run('git', ['-C', loopsRepo, 'cat-file', '-e', `${seed.commit}^{commit}`])
    if (exists.code !== 0) {
      throw new Error(`pareto parent ${seed.label}: commit ${seed.commit} not found in ${loopsRepo}`)
    }
    const show = await runOk('git', ['-C', loopsRepo, 'show', '--no-color', seed.commit])
    const diff =
      show.stdout.length > maxDiffChars
        ? `${show.stdout.slice(0, maxDiffChars)}\n[... diff truncated at ${maxDiffChars} chars ...]`
        : show.stdout
    parents.push({ ...seed, diff })
  }
  return parents
}

function parentEvidenceLine(parent: ParetoParentContext): string {
  const resolved = parent.resolvedInstances.length > 0 ? parent.resolvedInstances.join(', ') : 'none'
  return `${parent.label} (${parent.commit.slice(0, 10)}) — resolved: ${resolved}${parent.note ? `; ${parent.note}` : ''}`
}

/** The parents section appended to every NON-merge author's prompt: measured
 *  evidence of what worked, never an instruction to copy. */
export function parentsPromptSection(parents: ParetoParentContext[]): string {
  const lines: string[] = [
    'PARETO PARENTS — the prior generation’s frontier candidates, measured on the SAME 6-instance set.',
    'Each beat the baseline on different instances; treat their diffs as measured evidence of what works.',
    'You may build on either (or both), but your candidate is measured on the full set — do not blindly copy.',
  ]
  for (const parent of parents) {
    lines.push('', `--- parent: ${parentEvidenceLine(parent)}`, parent.diff.trimEnd())
  }
  return lines.join('\n')
}

/** The merge seat's task prompt: the change-space contract + findings context
 *  stay (round4BuildPrompt), and the TASK is replaced with an explicit
 *  coherent-union merge of the parents' diffs. */
export function mergeAuthorPrompt(
  args: { report: unknown; findings: Array<Record<string, unknown>> },
  spec: ProposerSpec,
  parents: ParetoParentContext[],
): string {
  if (parents.length < 2) {
    throw new Error(`merge proposer ${spec.name}: needs >=2 materialized pareto parents, got ${parents.length}`)
  }
  const lines: string[] = [
    round4BuildPrompt(args),
    '',
    `YOUR TASK (${spec.name} — MERGE SEAT):`,
    'The prior generation produced the frontier candidates below. Each beat the baseline on DIFFERENT',
    'instances, so their lessons are complementary. Produce ONE coherent surface that is the UNION of the',
    'parent diffs:',
    ...parents.map((p) => `  - ${parentEvidenceLine(p)}`),
    '',
    'Merge rules:',
    '- Apply BOTH parents’ behaviors. Where the diffs touch the same file/section (e.g. the supervisor',
    '  reviewer bullet or the worker self-test rules), resolve the conflict by KEEPING BOTH BEHAVIORS —',
    '  write one merged passage that carries every constraint from each side, never by dropping one side.',
    '- Keep each parent’s mechanical changes intact (code paths, exported helpers, threading) alongside the',
    '  other parent’s prompt/goal-authoring changes.',
    '- Do NOT invent new mechanisms beyond the union; the smallest coherent merge wins.',
    '- The merged surface must typecheck and stay inside the declared change-space above.',
    '',
    'Parent diffs (full):',
  ]
  for (const parent of parents) {
    lines.push('', `=== parent ${parent.label} (${parent.commit.slice(0, 10)}) ===`, parent.diff.trimEnd())
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Diagnosis slicing + prompt lens.
// ---------------------------------------------------------------------------

const PROMPTY = /prompt|instruction|wording|message text|phrasing/i

/** Findings that must reach EVERY proposer regardless of slice: the protocol
 *  steering finding and the raw-trace-context findings (they are contract +
 *  grounding, not diagnosis). */
function isSteeringOrRawTrace(f: Record<string, unknown>): boolean {
  return (
    f.analyst_id === 'round4-protocol' ||
    f.analyst_id === 'raw-trace-distiller' ||
    f.area === 'raw-trace-context' ||
    f.area === 'constraint'
  )
}

/** Slice the diagnosis findings for one proposer. Pure. */
export function sliceFindings(findings: AnalystFinding[], slice: ProposerSpec['diagnosisSlice']): AnalystFinding[] {
  if (slice === undefined || slice === 'all') return findings
  return findings.filter((finding) => {
    const f = finding as unknown as Record<string, unknown>
    if (isSteeringOrRawTrace(f)) return true
    const text = `${String(f.area ?? '')} ${String(f.subject ?? '')} ${String(f.claim ?? '')} ${String(f.recommended_action ?? '')}`
    return slice === 'prompts' ? PROMPTY.test(text) : !PROMPTY.test(text)
  })
}

/** GEN-5 prompt extensions shared by every seat (merge included): the
 *  MAP+TOOLBOX+PERMISSION briefing (briefing.mts) and the activation-predicate
 *  deliverable contract (activation.mts). */
export interface Gen5PromptExtras {
  briefing?: BriefingContext
  activationGate?: boolean
}

function appendGen5Sections(prompt: string, extras: Gen5PromptExtras): string {
  let out = prompt
  if (extras.briefing) out = `${out}\n\n${briefingPromptSection(extras.briefing)}`
  if (extras.activationGate) out = `${out}\n\n${activationPredicateInstruction()}`
  return out
}

/** The proposer's task prompt: the shared round prompt plus this proposer's
 *  authoring lens (appended so the protocol change-space text stays intact),
 *  plus the gen-4 Pareto-parents section when parents are seeded, plus the
 *  gen-5 briefing/activation sections when configured. A merge-seat spec gets
 *  the dedicated merge prompt instead (gen-5 sections still apply). */
export function proposerBuildPrompt(
  args: { report: unknown; findings: Array<Record<string, unknown>> },
  spec: ProposerSpec,
  parents: ParetoParentContext[] = [],
  extras: Gen5PromptExtras = {},
): string {
  if (spec.merge) return appendGen5Sections(mergeAuthorPrompt(args, spec, parents), extras)
  let prompt = round4BuildPrompt(args)
  if (spec.lens) prompt = `${prompt}\n\nYOUR AUTHORING LENS (${spec.name}):\n${spec.lens}`
  if (parents.length > 0) prompt = `${prompt}\n\n${parentsPromptSection(parents)}`
  return appendGen5Sections(prompt, extras)
}

// ---------------------------------------------------------------------------
// Shared shot persistence + spend settlement (used by the fan-out authors AND
// the legacy single-proposer generator in outer-loop.mts — one implementation).
// ---------------------------------------------------------------------------

export function proposerShotHooks(opts: {
  shotDir: string
  harness: ProposerSpec['harness']
  ledger: () => CostLedgerHandle | undefined
  phase: () => string | undefined
}): (receipt: AgenticGeneratorShotReceipt, execution: AgenticGeneratorShotExecution | null) => Promise<void> {
  return async (receipt, execution) => {
    const tail = (s: string | undefined): string | null =>
      s === undefined ? null : s.length > 20_000 ? s.slice(-20_000) : s
    await mkdir(opts.shotDir, { recursive: true })
    const name = `gen${receipt.generation ?? 'x'}-cand${receipt.candidateIndex ?? 'x'}-shot${receipt.shot}.json`
    await writeFile(
      join(opts.shotDir, name),
      JSON.stringify({ receipt, stdoutTail: tail(execution?.stdout), stderrTail: tail(execution?.stderr) }, null, 2),
    )
    // Proposer-shot spend → the lib's run ledger. The generator only settles
    // its own receipts on the codexReproducible path (costCallId non-null);
    // the claude/opencode author path otherwise leaves every shot as $0 in
    // the run's spend summary. Import the shot receipt's measured usage.
    const ledger = opts.ledger()
    if (ledger && receipt.costCallId === null && (receipt.usage || receipt.costUsdKnown)) {
      const usage = receipt.usage
      const paid = await ledger.runPaidCall({
        channel: 'driver',
        phase: opts.phase() ?? 'search.proposal',
        actor: `proposer-shot:${opts.harness}`,
        model: receipt.model ?? `${opts.harness}-cli`,
        tags: {
          generation: String(receipt.generation ?? -1),
          candidateIndex: String(receipt.candidateIndex ?? -1),
          shot: String(receipt.shot),
        },
        execute: async () => receipt,
        receipt: () => ({
          model: receipt.model ?? `${opts.harness}-cli`,
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage ? usage.outputTokens + usage.reasoningOutputTokens : 0,
          ...(usage ? { cachedTokens: usage.cachedInputTokens } : { usageUnknown: true }),
          ...(receipt.costUsdKnown && receipt.costUsd !== null ? { actualCostUsd: receipt.costUsd } : {}),
        }),
      })
      if (!paid.succeeded) throw paid.error
    }
  }
}

// ---------------------------------------------------------------------------
// Scratch authoring worktrees (no node_modules symlink — the verifier and the
// smoke runner link one in temporarily when they need it).
// ---------------------------------------------------------------------------

async function addAuthoringWorktree(loopsRepo: string, commit: string, dest: string): Promise<void> {
  await run('git', ['-C', loopsRepo, 'worktree', 'remove', '--force', '--', dest])
  await rm(dest, { recursive: true, force: true })
  await run('git', ['-C', loopsRepo, 'worktree', 'prune'])
  await runOk('git', ['-C', loopsRepo, 'worktree', 'add', '--detach', dest, commit])
}

async function removeAuthoringWorktree(loopsRepo: string, dest: string): Promise<void> {
  const res = await run('git', ['-C', loopsRepo, 'worktree', 'remove', '--force', '--', dest])
  if (res.code !== 0) {
    await rm(dest, { recursive: true, force: true })
    await run('git', ['-C', loopsRepo, 'worktree', 'prune'])
  }
}

const sanitize = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, '_')

// ---------------------------------------------------------------------------
// The fan-out generator.
// ---------------------------------------------------------------------------

/** One proposer's authoring + pre-filter outcome for a generation. */
interface AuthorOutcome {
  proposer: ProposerSpec
  applied: boolean
  summary: string
  /** Full staged diff (tracked edits + untracked deliverables) vs the
   *  incumbent commit. Null when not applied or killed. */
  patch: string | null
  kill: PrefilterKill | null
}

/** Authoring seam — test-injectable. The default runs the proposer's
 *  `agenticGenerator` (profile-pinned harness invocation) in the scratch
 *  worktree. */
export type AuthorFn = (
  proposer: ProposerSpec,
  args: Parameters<CandidateGenerator['generate']>[0],
) => Promise<{ applied: boolean; summary: string }>

export interface FanOutDeps {
  author?: AuthorFn
  smokeRunner?: SmokeRunner
  /** GEN-4: materialized Pareto parents seeded into every author's prompt (and
   *  the merge seat's explicit merge input). Empty/omitted = gen-3 behavior. */
  parents?: ParetoParentContext[]
  /** GEN-5: MAP+TOOLBOX briefing context threaded into every author prompt. */
  briefing?: BriefingContext
  /** The resolved public smoke instance used by the GEPA seat's inner
   *  evaluator target. Required (with `smokeRunner`) when a gepa seat is
   *  configured and no custom `author` is injected. */
  smokeInstanceId?: string
  /** The score split; private instance ids never reach the GEPA
   *  bridge (gepa-seat.mts asserts, fail-closed). Null/omitted = no split. */
  scoreSplit?: Pick<ScoreSplit, 'privateInstances'> | null
  /** GEPA method override for tests. Default: agent-eval's official GEPA method. */
  gepaMethodFactory?: GepaMethodFactory
  /** Explicit GEPA optimizer model override, primarily for isolated tests. */
  gepaOptimizer?: GepaSeatDeps['optimizer']
  log?: (msg: string) => void
}

export interface FanOutGenerator extends CandidateGenerator {
  /** Prefilter kills recorded so far; draining clears the buffer. The caller
   *  turns each into a `rejected-prefilter` staircase dot. */
  drainPrefilterKills(): PrefilterKill[]
}

function defaultAuthor(config: OuterLoopConfig, deps: FanOutDeps): AuthorFn {
  // One agenticGenerator per proposer, created lazily and cached: each carries
  // its own profile, lens prompt, and shot-receipt home.
  const inners = new Map<string, CandidateGenerator>()
  const ledgers = new Map<string, { ledger?: CostLedgerHandle; phase?: string }>()
  // The GEPA seat authors through the agent-eval adapter, not a
  // harness CLI. Its inner evaluator is the SAME injected smoke runner the
  // pre-filter uses (presence enforced at generator construction).
  let gepaAuthor: AuthorFn | undefined
  return (proposer, args) => {
    if (isGepaSeat(proposer)) {
      gepaAuthor ??= gepaSeatAuthor(config, {
        smokeRunner: deps.smokeRunner!,
        smokeInstanceId: deps.smokeInstanceId!,
        scoreSplit: deps.scoreSplit ?? null,
        ...(deps.gepaMethodFactory ? { methodFactory: deps.gepaMethodFactory } : {}),
        ...(deps.gepaOptimizer ? { optimizer: deps.gepaOptimizer } : {}),
        ...(deps.log ? { log: deps.log } : {}),
      })
      return gepaAuthor(proposer, args)
    }
    const harness = proposer.harness
    if (harness === undefined) {
      throw new Error(`proposer ${proposer.name}: harness is required for a non-engine seat`)
    }
    let inner = inners.get(proposer.name)
    const slot = ledgers.get(proposer.name) ?? {}
    ledgers.set(proposer.name, slot)
    if (!inner) {
      // GEN-4: the resolved profile carries the spec's pinned model
      // (`model.default` → the harness CLI's `-m` flag).
      const profile = resolveAuthorProfile(proposer)
      inner = agenticGenerator({
        harness,
        ...(profile ? { profile } : {}),
        timeoutMs: config.proposerTimeoutMs,
        buildPrompt: (a) =>
          proposerBuildPrompt(
            a as unknown as { report: unknown; findings: Array<Record<string, unknown>> },
            proposer,
            deps.parents ?? [],
            {
              ...(deps.briefing ? { briefing: deps.briefing } : {}),
              ...(config.activationGate === true ? { activationGate: true } : {}),
            },
          ),
        verify: loopsCandidateVerifier(config.loopsRepo),
        runHarness: (options) => runLocalHarness({ ...options, env: proposerShotEnv(harness) }),
        onShotCompleted: proposerShotHooks({
          shotDir: join(config.outDir, 'proposer-shots', sanitize(proposer.name)),
          harness,
          ledger: () => slot.ledger,
          phase: () => slot.phase,
        }),
      })
      inners.set(proposer.name, inner)
    }
    slot.ledger = args.costLedger
    slot.phase = args.costPhase
    return inner.generate(args)
  }
}

/**
 * Build the fan-out `CandidateGenerator` for `config.proposers`. The driver
 * still owns every candidate worktree; this generator authors in its OWN
 * scratch worktrees (in parallel, one per proposer) and applies each
 * surviving proposer's patch onto the driver worktree for that candidate
 * index. `populationSize` must equal `proposers.length` — enforced by the
 * caller (runRound) and re-checked per call here.
 */
export function fanOutLoopsGenerator(config: OuterLoopConfig, deps: FanOutDeps = {}): FanOutGenerator {
  const proposers = config.proposers ?? []
  if (proposers.length === 0) throw new Error('fanOutLoopsGenerator: config.proposers is empty')
  const names = new Set(proposers.map((p) => p.name))
  if (names.size !== proposers.length) throw new Error('fanOutLoopsGenerator: duplicate proposer names')
  const mergeSeats = proposers.filter((p) => p.merge === true)
  if (mergeSeats.length > 0 && (deps.parents ?? []).length < 2) {
    throw new Error(
      `fanOutLoopsGenerator: merge proposer(s) ${mergeSeats.map((p) => p.name).join(', ')} configured but ` +
        `only ${(deps.parents ?? []).length} pareto parent(s) materialized — a merge seat needs >=2`,
    )
  }
  // Engine seats are validated at construction, and the
  // default author path requires the pre-filter smoke runner — it IS the GEPA
  // seat's inner evaluator (spec: score = smoke resolve + verify-pass
  // tiebreak). A custom injected `author` owns its own evaluator.
  const gepaSeats = proposers.filter(isGepaSeat)
  for (const seat of gepaSeats) validateGepaSeat(seat)
  for (const seat of proposers) {
    if (!isGepaSeat(seat) && seat.harness === undefined) {
      throw new Error(`fanOutLoopsGenerator: proposer ${seat.name} has neither a harness nor an engine`)
    }
  }
  if (gepaSeats.length > 0 && deps.author === undefined && (deps.smokeRunner === undefined || deps.smokeInstanceId === undefined)) {
    throw new Error(
      `fanOutLoopsGenerator: gepa seat(s) ${gepaSeats.map((p) => p.name).join(', ')} need the pre-filter smoke ` +
        'cell as their inner evaluator — enable config.prefilter and provide smokeRunner + smokeInstanceId',
    )
  }
  const author = deps.author ?? defaultAuthor(config, deps)
  const log = deps.log ?? (() => {})
  const kills: PrefilterKill[] = []
  const byGeneration = new Map<number, Promise<AuthorOutcome[]>>()

  const runFanOut = async (
    generation: number,
    args: Parameters<CandidateGenerator['generate']>[0],
  ): Promise<AuthorOutcome[]> => {
    const head = await runOk('git', ['-C', args.worktreePath, 'rev-parse', 'HEAD'])
    const baseCommit = head.stdout.trim()
    const patchesDir = join(config.outDir, 'proposer-patches')
    await mkdir(patchesDir, { recursive: true })
    log(`fan-out gen ${generation}: ${proposers.length} proposer(s) authoring in parallel from ${baseCommit.slice(0, 10)}`)
    return Promise.all(
      proposers.map(async (proposer, index): Promise<AuthorOutcome> => {
        const scratch = join(config.outDir, 'proposer-wt', `gen${generation}-cand${index}-${sanitize(proposer.name)}`)
        await addAuthoringWorktree(config.loopsRepo, baseCommit, scratch)
        try {
          const authored = await author(proposer, {
            ...args,
            worktreePath: scratch,
            findings: sliceFindings(args.findings, proposer.diagnosisSlice),
            candidateIndex: index,
          })
          if (!authored.applied) {
            log(`fan-out gen ${generation} ${proposer.name}: no verified candidate (applied=false)`)
            return { proposer, applied: false, summary: authored.summary, patch: null, kill: null }
          }
          // Anti-tamper purge BEFORE the diff: ignored artifacts (dep installs)
          // must never reach the candidate worktree or the change-space check.
          await purgeIgnoredArtifacts(scratch)
          await runOk('git', ['-C', scratch, 'add', '-A'])
          const diff = (await runOk('git', ['-C', scratch, 'diff', '--cached'])).stdout
          if (diff.trim().length === 0) {
            return { proposer, applied: false, summary: authored.summary, patch: null, kill: null }
          }
          const namesOut = await runOk('git', ['-C', scratch, 'diff', '--cached', '--name-only'])
          const changed = namesOut.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
          const diffSha256 = `sha256:${createHash('sha256').update(diff).digest('hex')}`
          const patchPath = join(patchesDir, `gen${generation}-cand${index}-${sanitize(proposer.name)}.patch`)
          await writeFile(patchPath, diff)

          // Pre-filter stage A — change-space (defense-in-depth: the authoring
          // verifier already enforced it shot-by-shot; the final diff rules).
          const violations = changeSpaceViolations(changed)
          if (violations.length > 0) {
            const kill: PrefilterKill = {
              generation,
              candidateIndex: index,
              proposer: proposer.name,
              harness: proposer.harness,
              stage: 'change-space',
              reason: `out-of-space paths: ${violations.join(', ')}`,
              diffSha256,
              patchPath,
            }
            kills.push(kill)
            log(`prefilter KILL gen ${generation} ${proposer.name}: ${kill.reason}`)
            return { proposer, applied: false, summary: authored.summary, patch: null, kill }
          }

          // Pre-filter stage A.5 — GEN-5 activation gate: a candidate without
          // a parseable machine-checkable predicate is killed before any
          // evaluation spend (the post-eval quarantine needs it to exist).
          if (config.activationGate === true) {
            const raw = await readFilePromise(join(scratch, ACTIVATION_PREDICATE_RELPATH), 'utf8').catch(() => null)
            const parsed = raw === null ? null : parseActivationPredicate(raw)
            if (parsed === null || !parsed.ok) {
              const kill: PrefilterKill = {
                generation,
                candidateIndex: index,
                proposer: proposer.name,
                harness: proposer.harness,
                stage: 'activation-predicate',
                reason:
                  parsed === null
                    ? `missing ${ACTIVATION_PREDICATE_RELPATH} (required activation predicate)`
                    : `invalid ${ACTIVATION_PREDICATE_RELPATH}: ${parsed.error}`,
                diffSha256,
                patchPath,
              }
              kills.push(kill)
              log(`prefilter KILL gen ${generation} ${proposer.name}: ${kill.reason}`)
              return { proposer, applied: false, summary: authored.summary, patch: null, kill }
            }
          }

          // Pre-filter stage B — one smoke cell before any full-arm spend.
          if (config.prefilter?.enabled && deps.smokeRunner) {
            const smoke = await deps.smokeRunner({
              scratchPath: scratch,
              generation,
              proposer,
              ...(args.costLedger ? { costLedger: args.costLedger } : {}),
            })
            if (!smoke.pass) {
              const kill: PrefilterKill = {
                generation,
                candidateIndex: index,
                proposer: proposer.name,
                harness: proposer.harness,
                stage: 'smoke',
                reason: smoke.reason,
                diffSha256,
                patchPath,
                smoke,
              }
              kills.push(kill)
              log(`prefilter KILL gen ${generation} ${proposer.name}: ${kill.reason}`)
              return { proposer, applied: false, summary: authored.summary, patch: null, kill }
            }
            log(`prefilter pass gen ${generation} ${proposer.name}: ${smoke.reason}`)
          }
          return { proposer, applied: true, summary: authored.summary, patch: diff, kill: null }
        } finally {
          await removeAuthoringWorktree(config.loopsRepo, scratch)
        }
      }),
    )
  }

  return {
    kind: `gen3-fanout:${proposers.map((p) => `${p.name}@${p.engine ? `engine:${p.engine}` : p.harness}${p.model ? `:${p.model}` : ''}${p.merge ? ':merge' : ''}`).join('+')}`,
    proposesWithoutFindings: true,
    drainPrefilterKills() {
      return kills.splice(0, kills.length)
    },
    async generate(args) {
      const generation = args.generation ?? 0
      const index = args.candidateIndex ?? 0
      if (index >= proposers.length) {
        throw new Error(
          `fan-out: candidate index ${index} has no proposer (proposers=${proposers.length}) — ` +
            'config.populationSize must equal config.proposers.length',
        )
      }
      let pending = byGeneration.get(generation)
      if (!pending) {
        pending = runFanOut(generation, args)
        byGeneration.set(generation, pending)
      }
      const outcomes = await pending
      const outcome = outcomes[index]!
      if (!outcome.applied || outcome.patch === null) return { applied: false, summary: outcome.summary }

      // Apply the survivor's patch onto the driver-owned candidate worktree.
      const patchFile = join(config.outDir, 'proposer-patches', `.apply-gen${generation}-cand${index}.patch`)
      await writeFile(patchFile, outcome.patch)
      await runOk('git', ['-C', args.worktreePath, 'apply', '--whitespace=nowarn', patchFile])
      await rm(patchFile, { force: true })
      await purgeIgnoredArtifacts(args.worktreePath)
      return {
        applied: true,
        summary: outcome.summary,
        label: outcome.proposer.name,
        rationale:
          `proposer ${outcome.proposer.name} (${outcome.proposer.engine ? `engine ${outcome.proposer.engine}` : outcome.proposer.harness}` +
          `${outcome.proposer.profile ? `, profile ${outcome.proposer.profile}` : ''}` +
          `${outcome.proposer.diagnosisSlice && outcome.proposer.diagnosisSlice !== 'all' ? `, slice ${outcome.proposer.diagnosisSlice}` : ''}` +
          `): ${outcome.summary || 'authored change'}`,
      }
    },
  }
}
