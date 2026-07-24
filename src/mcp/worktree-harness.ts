/**
 *
 * The ONE worktree-harness execution core. The physical act — run a supervisor-authored
 * `AgentProfile` on a local coding-harness CLI (claude / codex / opencode) against a fresh git
 * worktree off `repoRoot`, capture the diff, derive the test/typecheck PASS signals, then clean
 * up — lives here ONCE. Two executors adapt it to two ports without re-implementing it:
 *   - `createWorktreeCliExecutor` — the `Scope`/`Supervisor` leaf `Executor`.
 *   - `createInProcessExecutor`   — the `runLoop` `SandboxClient` / coder-delegate path.
 *
 * §1.5 by construction: prompt + model reach the direct invocation, while file-backed resources
 * are lowered by the shared profile materializer and applied before spawn. Resource instructions
 * join the direct prompt because reproducible Codex intentionally disables ambient project docs.
 *
 * Lifecycle: `createWorktree` → materialize profile inputs → `harnessInvocation` +
 * `runLocalHarness` → `captureWorktreeDiff` excluding those inputs (BEFORE checks, so the patch is
 * the harness's output, not polluted by files a test run writes) → configured checks → return the
 * result + caller-owned `cleanup`. A throw cleans up before propagating.
 *
 * @experimental
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  applyWorkspacePlan,
  materializeProfile,
  type WorkspacePlan,
  type WorkspacePlanReceipt,
} from '@tangle-network/agent-profile-materialize'
import {
  type CodexExecutionPolicy,
  type CodexTokenUsage,
  harnessInvocation,
  type LocalHarness,
  type LocalHarnessResult,
  runLocalHarness,
  terminateProcessTreeAndConfirm,
} from './local-harness'
import {
  captureWorktreeDiff,
  createWorktree,
  type GitRunner,
  removeWorktree,
  type WorktreeHandle,
} from './worktree'

/** Outcome of one verification command run in the worktree (test or typecheck). */
export interface WorktreeCommandResult {
  /** The shell command line that was run. */
  command: string
  /** Did the command exit 0? The PASS signal a deliverable gate / coder output reads. */
  passed: boolean
  /** OS exit code, or `null` when killed before exit. */
  exitCode: number | null
  /** Combined stdout+stderr (capped) — surfaced in traces for diagnosis. */
  output: string
}

/** Proof of the profile inputs delivered before the worker process started. */
export interface WorktreeProfileMaterializationReceipt {
  /** Digest of the exact materializer plan: files, modes, environment, flags, and unsupported rows. */
  workspacePlanDigest: string
  /** Repository-relative profile input files written into the worker worktree. */
  writtenPaths: string[]
  /** Must be empty on a successful run because this path fails closed. */
  unsupported: WorkspacePlanReceipt['unsupported']
  /** Environment variable names added to the worker process. Values remain out of telemetry. */
  environmentNames: string[]
  /** Exact additional CLI arguments emitted by the materializer. */
  flags: string[]
  /** `resources.instructions` bypasses native project files so reproducible Codex cannot drop it. */
  resourceInstructions: {
    delivery: 'none' | 'invocation-prompt'
    sha256: string | null
    byteLength: number
  }
}

/** The canonical result of one worktree-harness run, projected by each port to its own shape. */
export interface WorktreeHarnessResult {
  /** The branch the worktree was cut on (`delegate/<runId>`). */
  branch: string
  /** `git diff` of the worktree against its base — the unified patch the harness produced. */
  patch: string
  /** Shortstat-derived change counts. */
  stats: { filesChanged: number; insertions: number; deletions: number }
  /**
   * Exact profile materialization applied before the harness launched.
   * Absent on transports that cannot return a materializer receipt; never fabricated.
   */
  profileMaterialization?: WorktreeProfileMaterializationReceipt
  /** The harness subprocess outcome. */
  harness: {
    name: LocalHarness | 'bridge'
    exitCode: number | null
    timedOut: boolean
    killedBySignal: NodeJS.Signals | null
    durationMs: number
    stdout: string
    stderr: string
    /** Exact Codex JSONL usage when reproducible mode is enabled. */
    usage?: CodexTokenUsage
    /** Installed CLI version captured immediately before execution. */
    cliVersion?: string
    /** SHA-256 of the native Codex executable staged read-only in the candidate worktree. */
    executableSha256?: string
    /** SHA-256 of the exact composed prompt argument proved present in Codex's rendered prompt. */
    requestedPromptSha256?: string
    /** SHA-256 of `codex debug prompt-input` output for the exact isolated prompt. */
    effectivePromptSha256?: string
    /** SHA-256 of the exact executable + argv with prompt content replaced by `<PROMPT>`. */
    nonPromptArgsSha256?: string
    /** SHA-256 of the isolated config that fixes permissions and shell environment. */
    controlledConfigSha256?: string
    /** SHA-256 of the normalized caller-supplied host read-denial paths. */
    readDeniedPathsSha256?: string
    /** Sorted normalized caller-supplied host read-denial paths. */
    readDeniedPaths?: string[]
    /** Number of normalized caller-supplied host read-denial paths. */
    readDeniedPathCount?: number
    /** Explicit isolation claims checked before model execution. */
    executionPolicy?: CodexExecutionPolicy
  }
  /** Verification signals derived in the live worktree (present only when commands were given). */
  checks?: {
    tests?: WorktreeCommandResult
    typecheck?: WorktreeCommandResult
  }
}

/** The single shell-command-in-worktree runner seam (replaces the per-executor copies). */
export type WorktreeCheckRunner = (opts: {
  command: string
  cwd: string
  timeoutMs: number
  signal?: AbortSignal
}) => Promise<{ exitCode: number | null; output: string }>

/** @experimental */
export interface RunWorktreeHarnessOptions {
  /** Absolute path to the git checkout the worktree is cut from. */
  repoRoot: string
  /**
   * Supervisor-authored prompt/model plus structural resources materialized into the worktree.
   * `model.default` selects the one-shot model; `small`, `provider`, and `metadata` remain hints.
   * Resource failures are always fatal here, regardless of `resources.failOnError`.
   */
  profile: AgentProfile
  /** Local harness for this run. This explicit choice overrides `profile.harness`. */
  harness: LocalHarness
  /** The per-task instruction handed to the harness (composed under the system prompt). */
  taskPrompt: string
  /** Unique id for the worktree path + branch. */
  runId: string
  /** Override the base ref the worktree is cut from (default `HEAD`). */
  baseRef?: string
  /** Shell command run in the live worktree to derive the tests-PASS signal. Omit to skip. */
  testCmd?: string
  /** Shell command run in the live worktree to derive the typecheck-PASS signal. Omit to skip. */
  typecheckCmd?: string
  /** Wall-clock cap per harness subprocess (ms). */
  harnessTimeoutMs?: number
  /** Run Codex in isolated, network-off JSONL mode and require real token usage. */
  codexReproducible?: boolean
  /** Absolute host paths the reproducible Codex process must not read. */
  codexReadDeniedPaths?: ReadonlyArray<string>
  /** Wall-clock cap per verification command (ms). Default = `harnessTimeoutMs` or 5 min. */
  checkTimeoutMs?: number
  /** Cap on each check's captured output. Default 16k. */
  checkOutputCap?: number
  /** Abort signal — linked into the harness subprocess and the check commands. */
  signal?: AbortSignal
  /** Test seam — inject a git runner so unit tests drive the worktree helpers without git. */
  runGit?: GitRunner
  /** Test seam — inject the harness runner so unit tests script a `LocalHarnessResult`. */
  runHarness?: typeof runLocalHarness
  /** Test seam — inject the verification-command runner. Defaults to a `/bin/sh -c` spawn. */
  runCommand?: WorktreeCheckRunner
}

/** One worktree-harness run: the result + the worktree handle + caller-owned `cleanup`. */
export interface WorktreeHarnessRun {
  worktree: WorktreeHandle
  result: WorktreeHarnessResult
  /** Remove the worktree. The caller invokes this at its own teardown point (the leaf in its
   *  `Executor.teardown`, the SandboxClient in its `streamPrompt` finally). On a thrown run the
   *  core already cleaned up, so the caller never double-removes. */
  cleanup: () => Promise<void>
}

const defaultCheckOutputCap = 16_000

/**
 * Run the one worktree-harness operation. A failed run attempts cleanup before propagating; if
 * cleanup also fails, both errors are preserved. The caller cleans up a successful run.
 */
export async function runWorktreeHarness(
  opts: RunWorktreeHarnessOptions,
): Promise<WorktreeHarnessRun> {
  opts.signal?.throwIfAborted()
  const runHarness = opts.runHarness ?? runLocalHarness
  const runCommand = opts.runCommand ?? defaultRunCommand
  const checkTimeoutMs = opts.checkTimeoutMs ?? opts.harnessTimeoutMs ?? 5 * 60 * 1000
  const cap = opts.checkOutputCap ?? defaultCheckOutputCap

  const worktree = await createWorktree({
    repoRoot: opts.repoRoot,
    runId: opts.runId,
    ...(opts.baseRef ? { baseRef: opts.baseRef } : {}),
    ...(opts.runGit ? { runGit: opts.runGit } : {}),
  })

  const cleanup = (): Promise<void> =>
    removeWorktree({
      worktree,
      repoRoot: opts.repoRoot,
      ...(opts.runGit ? { runGit: opts.runGit } : {}),
    })

  try {
    assertSupportedWorktreeProfile(opts.profile, opts.harness)
    assertSafeProfileResourcePaths(opts.profile)
    const resourceInstructions = resolveResourceInstructions(opts.profile)
    const workspaceProfile = materializationOnlyProfile(opts.profile)
    const plan = materializeProfile(workspaceProfile, opts.harness)
    if (plan.unsupported.length > 0) {
      throw new Error(
        `runWorktreeHarness: profile cannot be materialized for ${opts.harness}: ${plan.unsupported
          .map(({ dimension, reason }) => `${dimension}: ${reason}`)
          .join('; ')}`,
      )
    }
    assertSafeMaterializedPaths(plan)
    const applied = applyWorkspacePlan(plan, worktree.path, { existingFiles: 'reject' })
    if (applied.unsupported.length > 0) {
      throw new Error('runWorktreeHarness: applied profile unexpectedly retained unsupported rows')
    }

    // §1.5: the authored prompt + model reach the harness directly. Resource instructions use
    // the same explicit channel because reproducible Codex deliberately disables native project
    // instructions; the workspace projection therefore omits both prompt sources.
    const invocationProfile = profileWithResourceInstructions(opts.profile, resourceInstructions)
    const { command, args } = harnessInvocation(opts.harness, invocationProfile, opts.taskPrompt, {
      // This helper created the candidate worktree above; autonomous Claude
      // edits are permitted only inside that isolated checkout.
      dangerouslySkipPermissions: opts.harness === 'claude',
      ...(opts.codexReproducible ? { codexReproducible: true } : {}),
    })
    const harnessResult: LocalHarnessResult = await runHarness({
      harness: opts.harness,
      cwd: worktree.path,
      taskPrompt: opts.taskPrompt,
      invocation: { command, args: [...args, ...applied.flags] },
      env: { ...process.env, ...applied.env },
      ...(opts.codexReproducible ? { codexReproducible: true } : {}),
      ...(opts.codexReadDeniedPaths ? { codexReadDeniedPaths: opts.codexReadDeniedPaths } : {}),
      ...(opts.harnessTimeoutMs !== undefined ? { timeoutMs: opts.harnessTimeoutMs } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    })

    if (harnessResult.aborted || opts.signal?.aborted) {
      throw new Error('runWorktreeHarness: harness was cancelled by the caller', {
        cause: opts.signal?.reason,
      })
    }
    opts.signal?.throwIfAborted()

    // Diff BEFORE checks — the patch is the harness's output, not whatever a test run left behind.
    const diff = await captureWorktreeDiff({
      worktree,
      excludePaths: applied.written,
      ...(opts.runGit ? { runGit: opts.runGit } : {}),
    })
    opts.signal?.throwIfAborted()

    const checks = await runWorktreeChecks({
      worktreePath: worktree.path,
      ...(opts.testCmd !== undefined ? { testCmd: opts.testCmd } : {}),
      ...(opts.typecheckCmd !== undefined ? { typecheckCmd: opts.typecheckCmd } : {}),
      timeoutMs: checkTimeoutMs,
      cap,
      runCommand,
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    opts.signal?.throwIfAborted()

    const result: WorktreeHarnessResult = {
      branch: worktree.branch,
      patch: diff.patch,
      stats: diff.stats,
      profileMaterialization: profileMaterializationReceipt(applied, resourceInstructions),
      harness: {
        name: opts.harness,
        exitCode: harnessResult.exitCode,
        timedOut: harnessResult.timedOut,
        killedBySignal: harnessResult.killedBySignal,
        durationMs: harnessResult.durationMs,
        stdout: harnessResult.stdout,
        stderr: harnessResult.stderr,
        ...(harnessResult.usage ? { usage: harnessResult.usage } : {}),
        ...(harnessResult.evidence
          ? {
              cliVersion: harnessResult.evidence.cliVersion,
              executableSha256: harnessResult.evidence.executableSha256,
              requestedPromptSha256: harnessResult.evidence.requestedPromptSha256,
              effectivePromptSha256: harnessResult.evidence.effectivePromptSha256,
              nonPromptArgsSha256: harnessResult.evidence.nonPromptArgsSha256,
              controlledConfigSha256: harnessResult.evidence.controlledConfigSha256,
              readDeniedPaths: [...harnessResult.evidence.readDeniedPaths],
              readDeniedPathsSha256: harnessResult.evidence.readDeniedPathsSha256,
              readDeniedPathCount: harnessResult.evidence.readDeniedPathCount,
              executionPolicy: harnessResult.evidence.policy,
            }
          : {}),
      },
      ...(checks ? { checks } : {}),
    }
    return { worktree, result, cleanup }
  } catch (err) {
    try {
      await cleanup()
    } catch (cleanupError) {
      throw new AggregateError(
        [err, cleanupError],
        'runWorktreeHarness: run failed and worktree cleanup also failed',
      )
    }
    throw err
  }
}

function resolveResourceInstructions(profile: AgentProfile): string | undefined {
  const instructions = profile.resources?.instructions
  if (instructions === undefined) return undefined
  if (typeof instructions === 'string')
    return instructions.trim().length > 0 ? instructions : undefined
  if (instructions.kind === 'inline' && typeof instructions.content === 'string') {
    return instructions.content.trim().length > 0 ? instructions.content : undefined
  }
  throw new Error(
    'runWorktreeHarness: resources.instructions must be a string or inline resource; remote refs require pre-resolution',
  )
}

function profileWithResourceInstructions(
  profile: AgentProfile,
  resourceInstructions: string | undefined,
): AgentProfile {
  let resources: AgentProfile['resources'] | undefined
  if (profile.resources) {
    const { instructions: _instructions, ...structuralResources } = profile.resources
    resources = structuralResources
  }
  return {
    ...profile,
    ...(resources ? { resources } : {}),
    ...(resourceInstructions === undefined
      ? {}
      : {
          prompt: {
            ...profile.prompt,
            instructions: [...(profile.prompt?.instructions ?? []), resourceInstructions],
          },
        }),
  }
}

function materializationOnlyProfile(profile: AgentProfile): AgentProfile {
  const {
    prompt: _prompt,
    model: _model,
    resources: profileResources,
    ...structuralProfile
  } = profile
  let resources: AgentProfile['resources'] | undefined
  if (profileResources) {
    const { instructions: _instructions, ...fileBackedResources } = profileResources
    resources = fileBackedResources
  }
  return {
    ...structuralProfile,
    ...(resources ? { resources } : {}),
  }
}

function assertSupportedWorktreeProfile(profile: AgentProfile, harness: LocalHarness): void {
  // `profile.harness` is only a preference and the explicit run option wins. Model small/provider/
  // metadata fields are routing or descriptive hints; this fixed one-shot path only selects the
  // concrete `model.default`. `resources.failOnError` never weakens this path's fail-closed policy.
  const unsupportedAxes = [
    hasEntries(profile.tools) ? 'tools' : null,
    hasEntries(profile.permissions) ? 'permissions' : null,
    profile.connections && profile.connections.length > 0 ? 'connections' : null,
    hasEntries(profile.confidential) ? 'confidential' : null,
    hasEntries(profile.modes) ? 'modes' : null,
    hasEntries(profile.extensions) ? 'extensions' : null,
  ].filter((axis): axis is string => axis !== null)
  if (profile.model?.reasoningEffort !== undefined && harness !== 'codex') {
    unsupportedAxes.push('model.reasoningEffort')
  }
  for (const [name, server] of Object.entries(profile.mcp ?? {})) {
    const path = `mcp[${JSON.stringify(name)}]`
    if (server.enabled === false && harness !== 'opencode') {
      unsupportedAxes.push(`${path}.enabled`)
    }
    if (hasEntries(server.headers) && harness === 'codex') {
      unsupportedAxes.push(`${path}.headers`)
    }
    if (server.cwd !== undefined && harness === 'opencode') {
      unsupportedAxes.push(`${path}.cwd`)
    }
  }
  if (harness === 'claude') {
    for (const [event, commands] of Object.entries(profile.hooks ?? {})) {
      for (const [index, command] of commands.entries()) {
        const path = `hooks[${JSON.stringify(event)}][${index}]`
        if (hasEntries(command.env)) unsupportedAxes.push(`${path}.env`)
        if (command.blocking !== undefined) unsupportedAxes.push(`${path}.blocking`)
      }
    }
  }
  for (const [name, subagent] of Object.entries(profile.subagents ?? {})) {
    const path = `subagents[${JSON.stringify(name)}]`
    if (hasEntries(subagent.permissions)) unsupportedAxes.push(`${path}.permissions`)
    if (subagent.maxSteps !== undefined) unsupportedAxes.push(`${path}.maxSteps`)
    if (hasEntries(subagent.tools) && harness !== 'claude') {
      unsupportedAxes.push(`${path}.tools`)
    }
  }
  if (unsupportedAxes.length > 0) {
    throw new Error(
      `runWorktreeHarness: profile requests unsupported worktree behavior: ${unsupportedAxes.join(', ')}`,
    )
  }
}

function hasEntries(value: object | undefined): boolean {
  return value !== undefined && Object.keys(value).length > 0
}

function assertSafeMaterializedPaths(plan: WorkspacePlan): void {
  for (const file of plan.files) {
    if (file.relPath.split('/').some(isGitMetadataSegment)) {
      throw new Error(
        `runWorktreeHarness: profile file cannot target reserved Git metadata: ${file.relPath}`,
      )
    }
  }
}

function assertSafeProfileResourcePaths(profile: AgentProfile): void {
  for (const file of profile.resources?.files ?? []) {
    if (file.path.split('/').some(isGitMetadataSegment)) {
      throw new Error(
        `runWorktreeHarness: profile file cannot target reserved Git metadata: ${file.path}`,
      )
    }
  }
}

function isGitMetadataSegment(segment: string): boolean {
  const windowsCanonical = segment.replace(/[ .]+$/u, '').toLowerCase()
  return windowsCanonical === '.git' || windowsCanonical.startsWith('.git:')
}

function profileMaterializationReceipt(
  applied: WorkspacePlanReceipt,
  resourceInstructions: string | undefined,
): WorktreeProfileMaterializationReceipt {
  const instructionBytes =
    resourceInstructions === undefined ? null : Buffer.from(resourceInstructions, 'utf8')
  return {
    workspacePlanDigest: applied.workspacePlanDigest,
    writtenPaths: [...applied.written],
    unsupported: [...applied.unsupported],
    environmentNames: Object.keys(applied.env).sort(),
    flags: [...applied.flags],
    resourceInstructions: instructionBytes
      ? {
          delivery: 'invocation-prompt',
          sha256: `sha256:${createHash('sha256').update(instructionBytes).digest('hex')}`,
          byteLength: instructionBytes.byteLength,
        }
      : { delivery: 'none', sha256: null, byteLength: 0 },
  }
}

/** Run the configured test + typecheck commands in the live worktree, projecting exit codes into
 *  `checks`. Returns `undefined` when neither was configured (so the result omits `checks`). */
export async function runWorktreeChecks(opts: {
  worktreePath: string
  testCmd?: string
  typecheckCmd?: string
  timeoutMs: number
  cap: number
  runCommand?: WorktreeCheckRunner
  signal?: AbortSignal
}): Promise<WorktreeHarnessResult['checks'] | undefined> {
  opts.signal?.throwIfAborted()
  if (opts.testCmd === undefined && opts.typecheckCmd === undefined) return undefined
  const runCommand = opts.runCommand ?? defaultRunCommand
  const run = async (command: string): Promise<WorktreeCommandResult> => {
    opts.signal?.throwIfAborted()
    const res = await runCommand({
      command,
      cwd: opts.worktreePath,
      timeoutMs: opts.timeoutMs,
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    opts.signal?.throwIfAborted()
    return {
      command,
      passed: res.exitCode === 0,
      exitCode: res.exitCode,
      output: res.output.length > opts.cap ? res.output.slice(-opts.cap) : res.output,
    }
  }
  const checks: NonNullable<WorktreeHarnessResult['checks']> = {}
  if (opts.testCmd !== undefined) checks.tests = await run(opts.testCmd)
  opts.signal?.throwIfAborted()
  if (opts.typecheckCmd !== undefined) checks.typecheck = await run(opts.typecheckCmd)
  opts.signal?.throwIfAborted()
  return checks
}

interface SettledCommandResult {
  exitCode: number | null
  stdout: string
  stderr: string
  killedBySignal: NodeJS.Signals | null
  timedOut: boolean
}

/** Internal argv-safe process runner shared by worktree checks and improvement verifiers. */
export async function runSettledCommand(opts: {
  command: string
  args?: string[]
  cwd: string
  timeoutMs: number
  signal?: AbortSignal
}): Promise<SettledCommandResult> {
  opts.signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(opts.command, opts.args ?? [], {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })
    const stdout: string[] = []
    const stderr: string[] = []
    let settled = false
    let leaderClosed = false
    let timedOut = false
    let termination: Promise<void> | null = null
    const terminate = (): Promise<void> => {
      termination ??= terminateProcessTreeAndConfirm(child, () => leaderClosed, 'defaultRunCommand')
      return termination
    }
    const timer = setTimeout(() => {
      timedOut = true
      void terminate().catch(fail)
    }, opts.timeoutMs)
    const onAbort = () => void terminate().catch(fail)
    if (opts.signal) {
      if (opts.signal.aborted) onAbort()
      else opts.signal.addEventListener('abort', onAbort, { once: true })
    }
    child.stdout?.on('data', (d) => stdout.push(String(d)))
    child.stderr?.on('data', (d) => stderr.push(String(d)))
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      fn()
    }
    function fail(err: unknown): void {
      finish(() => reject(err instanceof Error ? err : new Error(String(err))))
    }
    child.on('error', (err) => {
      leaderClosed = true
      void (termination ?? Promise.resolve()).then(() => fail(err), fail)
    })
    child.on('close', (code, killedBySignal) => {
      leaderClosed = true
      void (async () => {
        try {
          await (termination ?? terminate())
          opts.signal?.throwIfAborted()
          finish(() =>
            resolve({
              exitCode: code,
              stdout: stdout.join(''),
              stderr: stderr.join(''),
              killedBySignal,
              timedOut,
            }),
          )
        } catch (err) {
          fail(err)
        }
      })()
    })
  })
}

/** Default verification-command runner — `/bin/sh -c <command>` in the worktree, capturing
 *  combined stdout+stderr. Never throws on a non-zero exit (that IS the fail signal); spawn
 *  failures and caller cancellation reject. Timeout terminates and confirms the whole process
 *  group before returning. */
export async function defaultRunCommand(opts: {
  command: string
  cwd: string
  timeoutMs: number
  signal?: AbortSignal
}): Promise<{ exitCode: number | null; output: string }> {
  const result = await runSettledCommand({
    command: '/bin/sh',
    args: ['-c', opts.command],
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs,
    ...(opts.signal ? { signal: opts.signal } : {}),
  })
  return { exitCode: result.exitCode, output: result.stdout + result.stderr }
}
