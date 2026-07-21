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
import { mkdir, rm, writeFile } from 'node:fs/promises'
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
  harness: 'claude' | 'codex' | 'opencode'
  /** Free-text authoring lens appended to the task prompt (e.g. a mechanics
   *  or reviewer stance). Never overrides the protocol change-space text. */
  lens?: string
  /** Which diagnosis findings this proposer sees. Protocol/steering and
   *  raw-trace-context findings always pass through. Default 'all'. */
  diagnosisSlice?: 'all' | 'mechanics' | 'prompts'
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
  stage: 'change-space' | 'smoke'
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

/** The proposer's task prompt: the shared round prompt plus this proposer's
 *  authoring lens (appended so the protocol change-space text stays intact). */
export function proposerBuildPrompt(
  args: { report: unknown; findings: Array<Record<string, unknown>> },
  spec: ProposerSpec,
): string {
  const base = round4BuildPrompt(args)
  if (!spec.lens) return base
  return `${base}\n\nYOUR AUTHORING LENS (${spec.name}):\n${spec.lens}`
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
  return (proposer, args) => {
    let inner = inners.get(proposer.name)
    const slot = ledgers.get(proposer.name) ?? {}
    ledgers.set(proposer.name, slot)
    if (!inner) {
      const profile = loadAuthorProfile(proposer)
      inner = agenticGenerator({
        harness: proposer.harness,
        ...(profile ? { profile } : {}),
        timeoutMs: config.proposerTimeoutMs,
        buildPrompt: (a) =>
          proposerBuildPrompt(a as unknown as { report: unknown; findings: Array<Record<string, unknown>> }, proposer),
        verify: loopsCandidateVerifier(config.loopsRepo),
        runHarness: (options) => runLocalHarness({ ...options, env: proposerShotEnv(proposer.harness) }),
        onShotCompleted: proposerShotHooks({
          shotDir: join(config.outDir, 'proposer-shots', sanitize(proposer.name)),
          harness: proposer.harness,
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
    kind: `gen3-fanout:${proposers.map((p) => `${p.name}@${p.harness}`).join('+')}`,
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
          `proposer ${outcome.proposer.name} (${outcome.proposer.harness}` +
          `${outcome.proposer.profile ? `, profile ${outcome.proposer.profile}` : ''}` +
          `${outcome.proposer.diagnosisSlice && outcome.proposer.diagnosisSlice !== 'all' ? `, slice ${outcome.proposer.diagnosisSlice}` : ''}` +
          `): ${outcome.summary || 'authored change'}`,
      }
    },
  }
}
