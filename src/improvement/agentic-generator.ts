/**
 *
 * `agenticGenerator` — the full-agentic `CandidateGenerator`: the
 * `shots=N, sandbox=on` setting of the one `improvementDriver`. It runs a real
 * coding harness (claude / codex / opencode) inside the candidate worktree the
 * driver already created, letting the agent read the codebase + the research
 * report and make the change in place. The driver then commits the worktree
 * into a `CodeSurface`.
 *
 * Mechanism: identical to the proven Phase-2.8 in-process executor — spawn the
 * harness as a subprocess with `cwd` = the worktree, on the same filesystem,
 * so edits land in place (no sandbox-mount round-trip). `runLocalHarness` is
 * the verified primitive. The OUTER sandbox is the improvement loop's own
 * execution context; the generator does not nest a second sandbox per
 * candidate (which would reintroduce a host↔sandbox worktree-transport
 * problem that does not need solving here).
 *
 * `maxShots` is the DEPTH dial — a multi-shot verify-in-session loop, NOT the
 * kernel `runLoop`. Each shot runs one full harness session in the (persistent)
 * worktree; between shots the loop refines based on what the last shot produced:
 *   - empty tree   → "you changed nothing, make the edits" → retry
 *   - dirty + `verify` fails → feed the verifier's failure into the next shot
 *       (the worktree persists, so the harness RESUMES atop its own failing
 *       edits with the error in hand — no `--resume` session plumbing needed,
 *       and harness-agnostic across claude/codex/opencode)
 *   - dirty + `verify` ok (or no verifier configured) → return the candidate
 * A candidate that never verifies within `maxShots` is discarded (`applied:
 * false`), never shipped — if you configured a verifier, a non-passing tree is
 * not a candidate. With no verifier the legacy behavior holds: first dirty shot
 * is the candidate.
 *
 * @experimental
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type {
  AnalystFinding,
  CostReceipt,
  CostReceiptInput,
  MaximumCharge,
} from '@tangle-network/agent-eval'
import type { AgentProfile, ReasoningEffort } from '@tangle-network/agent-interface'
import {
  applyWorkspacePlan,
  materializeProfile,
  type WorkspacePlan,
  type WorkspacePlanReceipt,
} from '@tangle-network/agent-profile-materialize'
import {
  type CodexExecutionEvidence,
  type CodexTokenUsage,
  harnessInvocation,
  type LocalHarness,
  type LocalHarnessResult,
  runLocalHarness,
} from '../mcp/local-harness'
import type { CandidateGenerator } from './improvement-driver'

const RAW_TRACE_ANALYST_ID = 'raw-trace-distiller'
const RAW_TRACE_AREA = 'raw-trace-context'
const RAW_TRACE_DIAGNOSIS_PATH = '.improve/raw-trace-diagnosis.md'

/** Dedicated ephemeral root for generic author-profile files. Every declared
 * file must live below this root so cleanup cannot alter candidate-owned files. */
export const AGENTIC_PROFILE_RESOURCE_ROOT = '.agent-runtime-profile-resources'

/** Outcome of verifying a candidate worktree. `feedback` (compiler errors,
 *  failing test output) is fed into the next shot when `ok` is false. */
export interface VerifyResult {
  ok: boolean
  feedback?: string
}

/** Verifies the edited worktree. Sync or async; throws only on a setup fault
 *  (a candidate that fails verification returns `{ok:false}`, it does not
 *  throw). */
export type Verifier = (worktreePath: string) => Promise<VerifyResult> | VerifyResult

export interface AgenticGeneratorShotReceipt {
  readonly generation: number | null
  readonly candidateIndex: number | null
  /** One-based shot number within this candidate. */
  readonly shot: number
  readonly maxShots: number
  readonly harness: LocalHarness
  readonly model: string | null
  readonly reasoningEffort: ReasoningEffort | null
  readonly promptSha256: `sha256:${string}`
  readonly startedAt: string
  readonly completedAt: string
  readonly durationMs: number
  readonly exitCode: number | null
  readonly timedOut: boolean
  readonly killedBySignal: NodeJS.Signals | null
  readonly stdoutBytes: number | null
  readonly stdoutSha256: `sha256:${string}` | null
  readonly stderrBytes: number | null
  readonly stderrSha256: `sha256:${string}` | null
  readonly usage: CodexTokenUsage | null
  /** Digest of the exact profile-file workspace plan applied for this shot. */
  readonly profileWorkspacePlanDigest: string | null
  readonly profileWorkspaceFileCount: number
  /** Shared run-ledger call id for this exact shot. */
  readonly costCallId: string | null
  /** Whether dollars came from the provider, the pricing table, or are unknown. */
  readonly costBasis: 'provider-reported' | 'estimated-pricing' | 'unknown'
  readonly costUsd: number | null
  /** True only for a provider-reported amount, never for a pricing estimate. */
  readonly costUsdKnown: boolean
  readonly evidence: CodexExecutionEvidence | null
  readonly error: { readonly name: string; readonly message: string } | null
}

export interface AgenticGeneratorOptions {
  /** Local coding harness to run in the worktree. Default `claude`. */
  harness?: LocalHarness
  /** Author profile rendered through the canonical harness mapper. Required
   *  for reproducible Codex so model and reasoning settings are explicit. */
  profile?: AgentProfile
  /** Run Codex with isolated configuration, exact prompt evidence, and required
   *  terminal token usage. Requires `harness: 'codex'` and `profile`. */
  codexReproducible?: boolean
  /** Absolute paths reproducible Codex must not read. A function can derive
   *  candidate-specific paths after the driver creates its worktree. */
  codexReadDeniedPaths?: ReadonlyArray<string> | ((worktreePath: string) => ReadonlyArray<string>)
  /** Awaited once for every attempted author shot, including process failures.
   *  Throwing aborts the candidate so receipt persistence can fail closed. */
  onShotCompleted?: (receipt: AgenticGeneratorShotReceipt) => void | Promise<void>
  /** Optional hard upper bound passed to the run-wide CostLedger before each
   *  author shot. This MUST be enforced by the provider or executor; a planning
   *  estimate is not an admissible bound. Omit for an uncapped ledger. A capped
   *  ledger rejects before model dispatch when this is absent. */
  maximumCharge?: MaximumCharge
  /** Per-shot wall-clock timeout (ms). Default = `runLocalHarness` default (5m). */
  timeoutMs?: number
  /** Build the harness task prompt from the report + findings. Override for
   *  domain phrasing; the default turns findings into a concrete coder task. */
  buildPrompt?: (args: { report: unknown; findings: AnalystFinding[] }) => string
  /** Verify the worktree after each dirtying shot. When set, a candidate that
   *  fails verification is NOT returned — the failure feeds the next shot
   *  (verify-in-session), up to `maxShots`; a candidate that never verifies is
   *  discarded (`applied:false`), never shipped. Omitted ⇒ legacy behavior:
   *  the first dirty shot is the candidate. See `commandVerifier`. */
  verify?: Verifier
  /** Test seam — inject the harness runner (defaults to `runLocalHarness`). */
  runHarness?: typeof runLocalHarness
  /** Test seam — inject the worktree-dirty check (defaults to `git status`). */
  isDirty?: (worktreePath: string) => boolean
}

/** Full-agentic `CandidateGenerator` (the `shots=N, sandbox=on` setting): run a real coding harness inside the candidate worktree so the agent makes the change in place. */
export function agenticGenerator(opts: AgenticGeneratorOptions = {}): CandidateGenerator {
  const harness = opts.harness ?? 'claude'
  if (opts.codexReproducible && harness !== 'codex') {
    throw new Error("agenticGenerator: codexReproducible requires harness 'codex'")
  }
  if (opts.codexReproducible && !opts.profile) {
    throw new Error('agenticGenerator: codexReproducible requires an explicit author profile')
  }
  if (opts.codexReadDeniedPaths && !opts.codexReproducible) {
    throw new Error('agenticGenerator: codexReadDeniedPaths requires codexReproducible')
  }
  if (opts.maximumCharge && !opts.codexReproducible) {
    throw new Error('agenticGenerator: maximumCharge requires codexReproducible')
  }
  const profileResourcePlan = opts.codexReproducible
    ? authorProfileResourcePlan(opts.profile as AgentProfile)
    : null
  const buildPrompt = opts.buildPrompt ?? defaultBuildPrompt
  const run = opts.runHarness ?? runLocalHarness
  const dirty = opts.isDirty ?? worktreeDirty
  const verify = opts.verify

  return {
    kind: `agentic:${harness}`,
    // The seed repo + (in rawTraceContext mode) the raw-trace filesystem context
    // are the change signal — an agentic coder proposes from them even when the
    // distiller yielded zero findings. Without this, the improvementDriver's
    // empty-findings guard short-circuits and generates ZERO candidates on the
    // first (and, for a single-generation run, only) proposal round.
    proposesWithoutFindings: true,
    async generate({
      worktreePath,
      report,
      findings,
      maxShots,
      signal,
      generation,
      candidateIndex,
      costLedger,
      costPhase,
    }) {
      const basePrompt = appendProfileResourcePaths(
        buildPrompt({ report, findings }),
        profileResourcePlan,
      )
      const needsRawTraceEvidence = requiresRawTraceEvidence(findings)
      const shots = Math.max(1, maxShots)
      // Feedback appended to the base prompt for the NEXT shot — empty on shot 0.
      let attemptNote = ''

      for (let shot = 0; shot < shots; shot++) {
        if (signal.aborted) break
        const taskPrompt = attemptNote ? `${basePrompt}\n\n${attemptNote}` : basePrompt
        const invocation = opts.profile
          ? harnessInvocation(harness, opts.profile, taskPrompt, {
              dangerouslySkipPermissions: harness === 'claude',
              ...(opts.codexReproducible ? { codexReproducible: true } : {}),
            })
          : undefined
        const exactPrompt = invocation?.prompt ?? taskPrompt
        const readDeniedPaths =
          typeof opts.codexReadDeniedPaths === 'function'
            ? opts.codexReadDeniedPaths(worktreePath)
            : opts.codexReadDeniedPaths
        const startedAt = new Date()
        let harnessResult: LocalHarnessResult | null = null
        let profileWorkspaceReceipt: WorkspacePlanReceipt | null = null
        let costReceipt: CostReceipt | null = null
        let costCallId: string | null = null
        let shotError: Error | null = null
        try {
          const execute = async (executionSignal: AbortSignal): Promise<LocalHarnessResult> => {
            harnessResult = await withAuthorProfileResources(
              profileResourcePlan,
              worktreePath,
              async (receipt) => {
                profileWorkspaceReceipt = receipt
                const result = await run({
                  harness,
                  cwd: worktreePath,
                  taskPrompt,
                  ...(invocation
                    ? { invocation: { command: invocation.command, args: invocation.args } }
                    : {}),
                  // The candidate worktree is isolated and must be editable without an
                  // interactive permission prompt. Other runLocalHarness callers remain
                  // permission-safe by default.
                  dangerouslySkipPermissions: harness === 'claude',
                  ...(opts.codexReproducible ? { codexReproducible: true } : {}),
                  ...(readDeniedPaths ? { codexReadDeniedPaths: readDeniedPaths } : {}),
                  timeoutMs: opts.timeoutMs,
                  signal: executionSignal,
                })
                // Assign before profile cleanup so a cleanup failure still
                // settles the model usage already returned by the harness.
                harnessResult = result
                return result
              },
            )
            const failure = shotFailure(harnessResult, exactPrompt, opts.codexReproducible === true)
            if (failure) throw failure
            return harnessResult
          }

          if (opts.codexReproducible) {
            const ledger = costLedger
            if (!ledger) {
              throw new Error(
                'agenticGenerator: reproducible Codex requires the run-wide CostLedger supplied by agent-eval',
              )
            }
            const model = opts.profile?.model?.default
            if (!model) {
              throw new Error('agenticGenerator: reproducible Codex requires profile.model.default')
            }
            const paid = await ledger.runPaidCall({
              channel: 'driver',
              phase: costPhase ?? 'search.proposal',
              actor: `agentic-generator:${harness}`,
              model,
              tags: {
                generation: String(generation ?? -1),
                candidateIndex: String(candidateIndex ?? -1),
                shot: String(shot + 1),
              },
              signal,
              ...(opts.maximumCharge ? { maximumCharge: opts.maximumCharge } : {}),
              execute,
              receipt: (result) => costReceiptFromHarness(result, model),
              receiptFromError: () =>
                harnessResult?.usage ? costReceiptFromHarness(harnessResult, model) : undefined,
            })
            costCallId = paid.callId ?? null
            costReceipt = paid.receipt ?? null
            if (!paid.succeeded) throw paid.error
            harnessResult = paid.value
          } else {
            harnessResult = await execute(signal)
          }
        } catch (cause) {
          shotError = cause instanceof Error ? cause : new Error(String(cause))
        }
        await emitShotReceipt(
          opts.onShotCompleted,
          shotReceipt({
            generation,
            candidateIndex,
            shot,
            maxShots: shots,
            harness,
            profile: opts.profile,
            prompt: exactPrompt,
            startedAt,
            completedAt: new Date(),
            result: harnessResult,
            profileWorkspaceReceipt,
            costCallId,
            costReceipt,
            error: shotError,
          }),
          shotError,
        )

        if (!harnessResult) {
          throw new Error('agenticGenerator: author shot completed without a harness result')
        }

        // The worktree IS the signal: no edits ⇒ tell the next shot to act.
        if (!dirty(worktreePath)) {
          attemptNote = EMPTY_TREE_NOTE
          continue
        }

        if (needsRawTraceEvidence) {
          const problem = rawTraceEvidenceProblem(worktreePath, findings)
          if (problem) {
            attemptNote = problem
            continue
          }
        }

        // Dirty: with no verifier the diff IS the candidate (we trust the diff,
        // not the harness's stdout). With a verifier the candidate must pass it.
        if (!verify) {
          return { applied: true, summary: summarize(findings) }
        }
        const result = await verify(worktreePath)
        if (result.ok) {
          return { applied: true, summary: summarize(findings) }
        }
        // Dirty but failing — resume next shot atop these edits with the error.
        attemptNote = failureNote(result.feedback)
      }

      // Shots exhausted: no verified candidate (or, sans verifier, no edits).
      return { applied: false, summary: '' }
    },
  }
}

function authorProfileResourcePlan(profile: AgentProfile): WorkspacePlan | null {
  const resources = profile.resources
  if (!resources) return null
  const unsupportedKinds = [
    resources.tools?.length ? 'tools' : null,
    resources.skills?.length ? 'skills' : null,
    resources.agents?.length ? 'agents' : null,
  ].filter((kind): kind is string => kind !== null)
  if (unsupportedKinds.length > 0) {
    throw new Error(
      `agenticGenerator: reproducible Codex author resources support files only; unsupported: ${unsupportedKinds.join(', ')}`,
    )
  }
  if (!resources.files || resources.files.length === 0) return null

  const plan = materializeProfile(
    {
      name: profile.name,
      resources: { files: resources.files },
    },
    'codex',
  )
  if (plan.unsupported.length > 0) {
    throw new Error(
      `agenticGenerator: author profile files could not be materialized: ${plan.unsupported.map((item) => item.reason).join('; ')}`,
    )
  }
  if (Object.keys(plan.env).length > 0 || plan.flags.length > 0) {
    throw new Error(
      'agenticGenerator: generic author profile files unexpectedly changed spawn values',
    )
  }

  const virtualRoot = resolve('/', AGENTIC_PROFILE_RESOURCE_ROOT)
  const seen = new Set<string>()
  for (const file of plan.files) {
    const target = resolve('/', file.relPath)
    if (!target.startsWith(`${virtualRoot}${sep}`)) {
      throw new Error(
        `agenticGenerator: author profile file must be below ${AGENTIC_PROFILE_RESOURCE_ROOT}: ${file.relPath}`,
      )
    }
    if (seen.has(target)) {
      throw new Error(`agenticGenerator: duplicate author profile file path: ${file.relPath}`)
    }
    seen.add(target)
  }
  return plan
}

function appendProfileResourcePaths(prompt: string, plan: WorkspacePlan | null): string {
  if (!plan) return prompt
  return [
    prompt,
    '',
    'Profile resource files available for this shot:',
    ...plan.files.map((file) => `- ${file.relPath}`),
  ].join('\n')
}

async function withAuthorProfileResources<T>(
  plan: WorkspacePlan | null,
  worktreePath: string,
  run: (receipt: WorkspacePlanReceipt | null) => Promise<T>,
): Promise<T> {
  if (!plan) return run(null)

  const rootPath = resolve(worktreePath, AGENTIC_PROFILE_RESOURCE_ROOT)
  if (existsSync(rootPath)) {
    throw new Error(
      `agenticGenerator: ephemeral author profile root already exists: ${AGENTIC_PROFILE_RESOURCE_ROOT}`,
    )
  }

  let value: T | undefined
  let primaryError: unknown
  try {
    const receipt = applyWorkspacePlan(plan, worktreePath)
    value = await run(receipt)
  } catch (cause) {
    primaryError = cause
  }

  let cleanupError: unknown
  try {
    rmSync(rootPath, { recursive: true, force: true })
    if (existsSync(rootPath)) {
      throw new Error(
        `agenticGenerator: ephemeral author profile root survived cleanup: ${AGENTIC_PROFILE_RESOURCE_ROOT}`,
      )
    }
  } catch (cause) {
    cleanupError = cause
  }

  if (primaryError !== undefined && cleanupError !== undefined) {
    throw new AggregateError(
      [primaryError, cleanupError],
      'agenticGenerator: author shot and profile resource cleanup both failed',
    )
  }
  if (primaryError !== undefined) throw primaryError
  if (cleanupError !== undefined) throw cleanupError
  return value as T
}

async function emitShotReceipt(
  callback: AgenticGeneratorOptions['onShotCompleted'],
  receipt: AgenticGeneratorShotReceipt,
  primaryError: Error | null,
): Promise<void> {
  try {
    await callback?.(receipt)
  } catch (callbackError) {
    if (primaryError !== null) {
      throw new AggregateError(
        [primaryError, callbackError],
        'agenticGenerator: author shot failed and its receipt could not be persisted',
      )
    }
    throw callbackError
  }
  if (primaryError !== null) throw primaryError
}

function shotReceipt(input: {
  readonly generation: number | undefined
  readonly candidateIndex: number | undefined
  readonly shot: number
  readonly maxShots: number
  readonly harness: LocalHarness
  readonly profile: AgentProfile | undefined
  readonly prompt: string
  readonly startedAt: Date
  readonly completedAt: Date
  readonly result: LocalHarnessResult | null
  readonly profileWorkspaceReceipt: WorkspacePlanReceipt | null
  readonly costCallId: string | null
  readonly costReceipt: CostReceipt | null
  readonly error: unknown
}): AgenticGeneratorShotReceipt {
  const error = input.error
    ? {
        name: input.error instanceof Error ? input.error.name : 'Error',
        message: input.error instanceof Error ? input.error.message : String(input.error),
      }
    : null
  const result = input.result
  const costBasis = costBasisFor(input.costReceipt)
  return {
    generation: input.generation ?? null,
    candidateIndex: input.candidateIndex ?? null,
    shot: input.shot + 1,
    maxShots: input.maxShots,
    harness: input.harness,
    model: input.profile?.model?.default ?? null,
    reasoningEffort: input.profile?.model?.reasoningEffort ?? null,
    promptSha256: sha256(input.prompt),
    startedAt: input.startedAt.toISOString(),
    completedAt: input.completedAt.toISOString(),
    durationMs: result?.durationMs ?? input.completedAt.getTime() - input.startedAt.getTime(),
    exitCode: result?.exitCode ?? null,
    timedOut: result?.timedOut ?? false,
    killedBySignal: result?.killedBySignal ?? null,
    stdoutBytes: result ? Buffer.byteLength(result.stdout) : null,
    stdoutSha256: result ? sha256(result.stdout) : null,
    stderrBytes: result ? Buffer.byteLength(result.stderr) : null,
    stderrSha256: result ? sha256(result.stderr) : null,
    usage: result?.usage ? { ...result.usage } : null,
    profileWorkspacePlanDigest: input.profileWorkspaceReceipt?.workspacePlanDigest ?? null,
    profileWorkspaceFileCount: input.profileWorkspaceReceipt?.written.length ?? 0,
    costCallId: input.costCallId,
    costBasis,
    costUsd: costBasis === 'unknown' ? null : (input.costReceipt?.costUsd ?? null),
    costUsdKnown: costBasis === 'provider-reported',
    evidence: result?.evidence
      ? {
          ...result.evidence,
          readDeniedPaths: [...result.evidence.readDeniedPaths],
          policy: { ...result.evidence.policy },
        }
      : null,
    error,
  }
}

function costBasisFor(receipt: CostReceipt | null): AgenticGeneratorShotReceipt['costBasis'] {
  if (receipt === null || receipt.costUnknown) return 'unknown'
  return receipt.actualCostUsd === undefined ? 'estimated-pricing' : 'provider-reported'
}

function shotFailure(
  result: LocalHarnessResult,
  exactPrompt: string,
  codexReproducible: boolean,
): Error | null {
  if (result.timedOut) {
    return new Error('agenticGenerator: author shot timed out')
  }
  if (result.killedBySignal) {
    return new Error(`agenticGenerator: author shot was killed by ${result.killedBySignal}`)
  }
  if (result.exitCode !== 0) {
    return new Error(`agenticGenerator: author shot exited with code ${String(result.exitCode)}`)
  }
  if (!codexReproducible) return null
  if (!result.usage || !result.evidence) {
    return new Error(
      'agenticGenerator: reproducible Codex shot completed without usage or execution evidence',
    )
  }
  const expectedPromptSha256 = sha256(exactPrompt).slice('sha256:'.length)
  if (result.evidence.requestedPromptSha256 !== expectedPromptSha256) {
    return new Error(
      'agenticGenerator: reproducible Codex prompt evidence does not match the exact authored prompt',
    )
  }
  return null
}

function costReceiptFromHarness(result: LocalHarnessResult, model: string): CostReceiptInput {
  if (!result.usage) {
    throw new Error('agenticGenerator: author shot did not report terminal token usage')
  }
  return {
    model,
    inputTokens: result.usage.inputTokens - result.usage.cachedInputTokens,
    outputTokens: result.usage.outputTokens,
    ...(result.usage.cachedInputTokens > 0 ? { cachedTokens: result.usage.cachedInputTokens } : {}),
  }
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

/** Turn the analyst's findings (+ optional report) into a concrete coder task. */
function defaultBuildPrompt(args: { report: unknown; findings: AnalystFinding[] }): string {
  const lines: string[] = [
    'You are improving this codebase based on an evaluation analysis.',
    'Make the smallest set of edits that addresses the findings below, then stop.',
    'Do not change unrelated code. Do not commit — leave changes in the working tree.',
    '',
    'Findings:',
  ]
  for (const f of args.findings) {
    const where = f.subject ? ` [${f.subject}]` : ''
    lines.push(`- (${f.severity})${where} ${f.claim}`)
    if (f.recommended_action) lines.push(`    → ${f.recommended_action}`)
  }
  if (requiresRawTraceEvidence(args.findings)) {
    lines.push(
      '',
      'Raw trace evidence requirement:',
      `- Inspect at least one raw trace path named above before editing.`,
      `- Write ${RAW_TRACE_DIAGNOSIS_PATH} in this worktree.`,
      '- Include the exact trace path(s) inspected, the failure mechanism, and the code change made.',
      '- A candidate without this file, or with only this file changed, is discarded.',
    )
  }
  return lines.join('\n')
}

const EMPTY_TREE_NOTE =
  'NOTE: your previous attempt left the working tree unchanged. Make the concrete file edits now.'

/** Next-shot feedback when the worktree is dirty but failed verification. The
 *  edits persist on disk, so the harness resumes atop them — tell it to fix in
 *  place, not start over. Verifier detail is truncated to keep the prompt bounded. */
function failureNote(feedback?: string): string {
  const detail = feedback?.trim()
  return [
    'NOTE: your edits are in the working tree but verification FAILED.',
    'Fix the problem in place — build on your existing edits, do not revert them.',
    detail ? `Verifier output:\n${truncate(detail, 4000)}` : 'No verifier detail was captured.',
  ].join('\n')
}

function rawTraceEvidenceProblem(worktreePath: string, findings: AnalystFinding[]): string | null {
  const changedPaths = worktreeChangedPaths(worktreePath)
  const substantive = changedPaths.filter((path) => path !== RAW_TRACE_DIAGNOSIS_PATH)
  if (substantive.length === 0) {
    return [
      `NOTE: raw-trace mode requires a real code/config edit in addition to ${RAW_TRACE_DIAGNOSIS_PATH}.`,
      'Your previous attempt only changed the diagnosis artifact. Inspect the cited traces and make the causal code change.',
    ].join('\n')
  }

  const diagnosisPath = join(worktreePath, RAW_TRACE_DIAGNOSIS_PATH)
  if (!existsSync(diagnosisPath)) {
    return [
      `NOTE: raw-trace mode requires ${RAW_TRACE_DIAGNOSIS_PATH}.`,
      'Before retrying, inspect at least one cited spans.jsonl/cached-result.json/artifact path, then write the diagnosis file with the exact path, failure mechanism, and code change.',
    ].join('\n')
  }

  const body = readFileSync(diagnosisPath, 'utf8')
  const evidencePaths = traceEvidencePaths(findings)
  if (evidencePaths.length > 0 && !evidencePaths.some((path) => body.includes(path))) {
    return [
      `${RAW_TRACE_DIAGNOSIS_PATH} exists, but it does not cite any exact raw trace path from the findings.`,
      `Cite at least one of these inspected paths exactly: ${evidencePaths.slice(0, 5).join(', ')}`,
    ].join('\n')
  }

  return null
}

function requiresRawTraceEvidence(findings: AnalystFinding[]): boolean {
  return findings.some((finding) => {
    const f = finding as unknown as Record<string, unknown>
    return f.analyst_id === RAW_TRACE_ANALYST_ID || f.area === RAW_TRACE_AREA
  })
}

function traceEvidencePaths(findings: AnalystFinding[]): string[] {
  const out: string[] = []
  for (const finding of findings) {
    const refs = (finding as unknown as { evidence_refs?: unknown }).evidence_refs
    if (!Array.isArray(refs)) continue
    for (const ref of refs) {
      if (!ref || typeof ref !== 'object') continue
      const uri = (ref as { uri?: unknown }).uri
      if (typeof uri === 'string' && uri.length > 0) out.push(uri)
    }
  }
  return [...new Set(out)]
}

/** A `Verifier` that runs a command in the worktree: exit 0 ⇒ ok, any other
 *  exit ⇒ failed with stdout+stderr as feedback. The common case — verify by
 *  `tsc --noEmit`, `pnpm build`, or a test command. A timeout is treated as a
 *  FAILED candidate (a change that hangs the build is a bad change); a missing
 *  binary or spawn fault throws (a setup bug, not a failed candidate — no
 *  silent fallback). */
export function commandVerifier(
  command: string,
  args: string[] = [],
  timeoutMs = 300_000,
): Verifier {
  return (worktreePath: string): VerifyResult => {
    const result = spawnSync(command, args, {
      cwd: worktreePath,
      encoding: 'utf-8',
      timeout: timeoutMs,
    })
    if (result.signal) {
      return {
        ok: false,
        feedback: `verifier '${command}' killed by ${result.signal} (likely timeout after ${timeoutMs}ms)`,
      }
    }
    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        throw new Error(
          `commandVerifier: '${command}' not found in PATH (setup bug, not a failed candidate)`,
        )
      }
      throw new Error(`commandVerifier: '${command}' failed to spawn: ${result.error.message}`)
    }
    if (result.status === 0) return { ok: true }
    const out = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    return { ok: false, feedback: out.length > 0 ? out : `exit ${result.status}` }
  }
}

/** A one-line summary for the commit message, derived from the findings. */
function summarize(findings: AnalystFinding[]): string {
  if (findings.length === 0) return 'agentic improvement'
  if (findings.length === 1) return `agentic: ${truncate(findings[0]!.claim, 64)}`
  return `agentic: ${findings.length} findings addressed`
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}

/** Non-empty `git status --porcelain` ⇒ the harness changed the worktree.
 *  Fails loud: the worktree is a fresh checkout, so a git error here means
 *  something is genuinely broken (git missing, corrupt index, killed mid-run).
 *  Folding that into `false` would silently discard a candidate and mask the
 *  real failure — forbidden by the no-silent-fallbacks doctrine. */
function worktreeDirty(worktreePath: string): boolean {
  return worktreeChangedPaths(worktreePath).length > 0
}

function worktreeChangedPaths(worktreePath: string): string[] {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: worktreePath,
    encoding: 'utf-8',
  })
  if (result.error) {
    throw new Error(
      `agenticGenerator: git status failed to spawn in ${worktreePath}: ${result.error.message}`,
    )
  }
  if (result.status !== 0) {
    throw new Error(
      `agenticGenerator: git status exited ${result.status} in ${worktreePath}: ${result.stderr.trim()}`,
    )
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3).trim())
}
