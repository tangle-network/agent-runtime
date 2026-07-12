/**
 *
 * Subprocess wrappers for the local coding-harness CLIs installed in the
 * sandbox image (claude-code, codex, opencode). Used by the in-process
 * delegation executor (`createInProcessExecutor`) so a delegated coding task
 * spawns a real harness on a real git worktree instead of provisioning a
 * sibling sandbox.
 *
 * All harness invocations:
 *   - run with `cwd` set to the worktree
 *   - inherit env from the parent (the MCP server inside the sandbox has
 *     the harness's auth already)
 *   - capture stdout/stderr
 *   - support cancellation via AbortSignal
 *   - enforce a wall-clock timeout
 *
 * @experimental
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'

/** Local coding harness available inside the sandbox. */
export type LocalHarness = 'claude' | 'codex' | 'opencode'

type ReasoningEffort = NonNullable<NonNullable<AgentProfile['model']>['reasoningEffort']>

const codexReasoningEffort: Record<ReasoningEffort, string> = {
  none: 'none',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  ultracode: 'xhigh',
}

function codexReasoningArgs(reasoningEffort: ReasoningEffort): string[] {
  const mapped = codexReasoningEffort[reasoningEffort]
  if (mapped === undefined) {
    throw new Error(
      `harnessInvocation: unsupported Codex reasoning effort ${String(reasoningEffort)}`,
    )
  }
  return ['-c', `model_reasoning_effort="${mapped}"`]
}

/**
 * Default per-harness command + arg shape. `buildArgs` takes ONLY the task prompt and
 * emits the prompt-only invocation (no model, no system prompt) — the safe default shape
 * the in-process executor's `streamPrompt` drives. `modelArgs` maps a resolved model to
 * the harness's selector flag (every supported harness takes `-m <model>`). The §1.5
 * profile-aware mapper `harnessInvocation` composes these to thread the full
 * supervisor-authored profile (systemPrompt + model) into argv.
 */
const HARNESS_INVOCATIONS: Record<
  LocalHarness,
  {
    command: string
    buildArgs: (taskPrompt: string) => string[]
    /** Map a resolved model to the harness's model-selector flag. */
    modelArgs: (model: string) => string[]
    /** Map portable reasoning effort when the harness exposes a native control. */
    reasoningArgs?: (reasoningEffort: ReasoningEffort) => string[]
  }
> = {
  claude: {
    command: 'claude',
    // `-p` IS headless/print mode; the old `--headless` flag was removed from the CLI.
    // Permission bypass is an explicit per-run opt-in below, never the public default.
    buildArgs: (taskPrompt) => ['-p', taskPrompt],
    modelArgs: (model) => ['-m', model],
  },
  codex: {
    command: 'codex',
    buildArgs: (taskPrompt) => ['exec', taskPrompt],
    modelArgs: (model) => ['-m', model],
    reasoningArgs: codexReasoningArgs,
  },
  opencode: {
    command: 'opencode',
    buildArgs: (taskPrompt) => ['run', taskPrompt],
    modelArgs: (model) => ['-m', model],
  },
}

/** Result of mapping an `AgentProfile` + task prompt onto a harness invocation. */
export interface HarnessInvocation {
  command: string
  args: string[]
}

export interface HarnessInvocationOptions {
  /** Allow an unattended Claude process to edit its isolated candidate worktree.
   *  Ignored by harnesses that do not use Claude's permission prompt. */
  dangerouslySkipPermissions?: boolean
  /** Run Codex with benchmark-safe process controls and JSONL usage output.
   *  Valid only for the Codex harness. */
  codexReproducible?: boolean
}

const CODEX_REPRODUCIBLE_ARGS = [
  '--ephemeral',
  '--ignore-rules',
  '--json',
  '-c',
  'approval_policy="never"',
  '-c',
  'web_search="disabled"',
  '-c',
  'project_doc_max_bytes=0',
  '-c',
  'skills.include_instructions=false',
  '-c',
  'include_apps_instructions=false',
  '--disable',
  'tool_suggest',
  '-c',
  'features.multi_agent_v2.root_agent_usage_hint_text=""',
  '-c',
  'features.multi_agent_v2.subagent_usage_hint_text=""',
  '-c',
  'features.multi_agent_v2.multi_agent_mode_hint_text=""',
  '--strict-config',
] as const

function buildHarnessArgs(
  harness: LocalHarness,
  taskPrompt: string,
  options: HarnessInvocationOptions = {},
): string[] {
  const args = HARNESS_INVOCATIONS[harness].buildArgs(taskPrompt)
  if (harness === 'claude' && options.dangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions')
  }
  if (options.codexReproducible) {
    if (harness !== 'codex') {
      throw new Error('harnessInvocation: codexReproducible requires the Codex harness')
    }
    args.push(...CODEX_REPRODUCIBLE_ARGS)
  }
  return args
}

/**
 * Map a supervisor-authored `AgentProfile` + the per-task prompt onto a concrete harness
 * `command` + `args` (the §1.5 fix). UNLIKE the prompt-only `HARNESS_INVOCATIONS.buildArgs`
 * — which drops both the authored model and the system prompt — this threads the FULL
 * profile payload into argv:
 *
 *  - `profile.prompt.systemPrompt` → the PROMPT channel: a portable, harness-agnostic
 *    default that prepends the system prompt above the task prompt (`<system>\n\n<task>`),
 *    so the authored standing instructions reach EVERY harness (none of the three CLIs
 *    expose a portable replace-system-prompt flag for a one-shot non-interactive run).
 *  - `profile.prompt.instructions[]` → appended prompt sections in authored order.
 *  - `profile.model.default` → the harness's `-m <model>` selector.
 *
 * The task prompt alone is the floor; an empty/absent profile yields exactly the legacy
 * `buildArgs(taskPrompt)` shape so existing callers are byte-identical.
 */
export function harnessInvocation(
  harness: LocalHarness,
  profile: AgentProfile,
  taskPrompt: string,
  options: HarnessInvocationOptions = {},
): HarnessInvocation {
  const invocation = HARNESS_INVOCATIONS[harness]
  if (!invocation) {
    throw new Error(`harnessInvocation: unknown harness ${String(harness)}`)
  }

  if (options.codexReproducible) {
    const model = profile.model?.default
    if (typeof model !== 'string' || model.trim().length === 0) {
      throw new Error('harnessInvocation: codexReproducible requires profile.model.default')
    }
    if (profile.model?.reasoningEffort === undefined) {
      throw new Error('harnessInvocation: codexReproducible requires profile.model.reasoningEffort')
    }
  }

  const systemPrompt = profile.prompt?.systemPrompt
  const instructions = profile.prompt?.instructions
  if (
    instructions !== undefined &&
    (!Array.isArray(instructions) ||
      instructions.some((instruction) => typeof instruction !== 'string'))
  ) {
    throw new Error('harnessInvocation: profile.prompt.instructions must be an array of strings')
  }
  const promptSections = [
    ...(typeof systemPrompt === 'string' && systemPrompt.trim().length > 0 ? [systemPrompt] : []),
    ...(instructions?.filter((instruction) => instruction.trim().length > 0) ?? []),
    taskPrompt,
  ]
  const composedPrompt = promptSections.join('\n\n')

  const args = buildHarnessArgs(harness, composedPrompt, options)

  const model = profile.model?.default
  if (typeof model === 'string' && model.length > 0) {
    args.push(...invocation.modelArgs(model))
  }

  const reasoningEffort = profile.model?.reasoningEffort
  if (reasoningEffort !== undefined && invocation.reasoningArgs) {
    args.push(...invocation.reasoningArgs(reasoningEffort))
  }

  return { command: invocation.command, args }
}

/** @experimental */
export interface RunLocalHarnessOptions {
  harness: LocalHarness
  /** Working directory for the subprocess (typically a worktree path). */
  cwd: string
  /** Prompt forwarded as the harness CLI's task argument. */
  taskPrompt: string
  /**
   * Pre-built command + args (e.g. from `harnessInvocation` so the full authored
   * `AgentProfile` — systemPrompt + model — reaches the harness). When set it OVERRIDES the
   * default prompt-only `buildArgs(taskPrompt)` path; `command` defaults to the harness's
   * default binary when only `args` is supplied. When absent the legacy prompt-only shape
   * is used unchanged.
   */
  invocation?: { command?: string; args: ReadonlyArray<string> }
  /** Allow autonomous Claude edits without an interactive permission prompt.
   *  Use only when `cwd` is an isolated candidate worktree. */
  dangerouslySkipPermissions?: boolean
  /** Isolate Codex from ambient configuration/instructions and require JSONL token usage.
   *  The invocation should come from `harnessInvocation(..., { codexReproducible: true })`. */
  codexReproducible?: boolean
  /** Wall-clock kill deadline (ms). Default 5 min. Subprocess SIGTERMed on expiry. */
  timeoutMs?: number
  /** Caller cancellation. SIGTERM is sent on abort. */
  signal?: AbortSignal
  /** Override env (defaults to inheriting from the parent). */
  env?: NodeJS.ProcessEnv
  /**
   * Test seam — inject a custom spawner so unit tests can mock the
   * subprocess without touching the OS. Defaults to node's `child_process.spawn`.
   */
  spawn?: (
    command: string,
    args: ReadonlyArray<string>,
    opts: {
      cwd: string
      env: NodeJS.ProcessEnv
      stdio: 'pipe'
    },
  ) => ChildProcess
}

/** Exact aggregate usage emitted by Codex's terminal `turn.completed` JSONL event. */
export interface CodexTokenUsage {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
}

/** Isolation settings asserted before a reproducible Codex run is allowed to start. */
export interface CodexExecutionPolicy {
  sessionPersistence: 'ephemeral'
  userConfig: false
  rules: false
  projectInstructions: false
  skillInstructions: false
  appInstructions: false
  toolSuggestions: false
  multiAgentInstructions: false
  sandbox: 'workspace-write'
  permissionProfile: 'agent_runtime_reproducible'
  approvalPolicy: 'never'
  shellNetwork: false
  webSearch: false
  serviceTier: 'default'
  shellEnvironment: 'core-filtered'
  loginShell: false
  credentialsReadable: false
  parentRepoRead: false
  gitMetadata: false
  temporaryDirectory: 'workspace-private'
  containerSockets: false
}

/** Zero-model-call evidence for the exact Codex process about to run. */
export interface CodexExecutionEvidence {
  cliVersion: string
  effectivePromptSha256: string
  nonPromptArgsSha256: string
  controlledConfigSha256: string
  policy: CodexExecutionPolicy
}

/** @experimental */
export interface LocalHarnessResult {
  /** OS exit code. `null` when killed before exit. */
  exitCode: number | null
  /** Concatenated stdout. */
  stdout: string
  /** Concatenated stderr. */
  stderr: string
  /** Set when the process exited via signal (timeout / abort). */
  killedBySignal: NodeJS.Signals | null
  /** Wall-clock duration ms (spawn → exit). */
  durationMs: number
  /** Set when timeoutMs elapsed before exit. */
  timedOut: boolean
  /** Present for a reproducible Codex run; parsed from the real terminal JSONL event. */
  usage?: CodexTokenUsage
  /** Present for reproducible Codex runs; generated and checked before model execution. */
  evidence?: CodexExecutionEvidence
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Spawn a local coding harness CLI as a subprocess + collect its output.
 *
 * NOT responsible for parsing the harness's output or extracting a diff —
 * the in-process executor's `streamPrompt` orchestrates `git diff` against
 * the worktree after this resolves. This function is intentionally narrow:
 * spawn, wait, capture, return.
 *
 * Fails loud — throws when:
 *   - `cwd` doesn't exist (subprocess emits ENOENT; surfaced as Error)
 *   - the harness binary is not on PATH (ENOENT)
 *
 * Does NOT throw when:
 *   - the subprocess exits non-zero (`result.exitCode` carries the code)
 *   - the subprocess is aborted / timed out (`result.killedBySignal` /
 *     `result.timedOut` carries the reason)
 *
 * @experimental
 */
export async function runLocalHarness(
  options: RunLocalHarnessOptions,
): Promise<LocalHarnessResult> {
  const { harness, cwd, taskPrompt } = options
  if (options.codexReproducible && harness !== 'codex') {
    throw new Error('runLocalHarness: codexReproducible requires the Codex harness')
  }
  if (options.codexReproducible && process.platform !== 'linux') {
    throw new Error('runLocalHarness: codexReproducible currently requires Linux')
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const spawnImpl = options.spawn ?? spawn

  const invocation = HARNESS_INVOCATIONS[harness]
  if (!invocation) {
    throw new Error(`runLocalHarness: unknown harness ${String(harness)}`)
  }

  const startedAt = Date.now()
  const command = options.invocation?.command ?? invocation.command
  const args = options.invocation
    ? [...options.invocation.args]
    : buildHarnessArgs(harness, taskPrompt, options)
  if (options.codexReproducible) assertCodexReproducibleInvocation(command, args)

  const baseEnv = options.env ?? process.env
  const isolated = options.codexReproducible
    ? await isolateCodexHome(baseEnv, cwd)
    : {
        env: baseEnv,
        cleanup: async () => undefined,
        controlledConfigSha256: '',
        ambientAuth: '',
        isolatedAuth: '',
        writeProbe: '',
      }
  const env = isolated.env

  try {
    const evidence = options.codexReproducible
      ? await collectCodexExecutionEvidence({
          command,
          args,
          cwd,
          env,
          spawn: spawnImpl,
          controlledConfigSha256: isolated.controlledConfigSha256,
          ambientAuth: isolated.ambientAuth,
          isolatedAuth: isolated.isolatedAuth,
          writeProbe: isolated.writeProbe,
          ...(options.signal ? { signal: options.signal } : {}),
        })
      : undefined
    return await new Promise<LocalHarnessResult>((resolve, reject) => {
      let child: ChildProcess
      try {
        child = spawnImpl(command, args, { cwd, env, stdio: 'pipe' })
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
        return
      }

      // The harness takes its task as an argv arg, not on stdin. Leaving stdin
      // OPEN makes a non-TTY `opencode run` (and likely the other harnesses)
      // BLOCK forever waiting on input — zero output, SIGTERM at the wall cap,
      // empty patch -> "no candidate passed validation". Close stdin so the
      // subprocess sees EOF and proceeds (the `cliExecutor` leaf does the same).
      child.stdin?.end()

      let stdout = ''
      let stderr = ''
      let timedOut = false
      let settled = false

      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true
              if (!child.killed) child.kill('SIGTERM')
            }, timeoutMs)
          : null
      if (timer && typeof (timer as { unref?: () => void }).unref === 'function') {
        ;(timer as { unref: () => void }).unref()
      }

      const onAbort = () => {
        if (!child.killed) child.kill('SIGTERM')
      }
      if (options.signal) {
        if (options.signal.aborted) onAbort()
        else options.signal.addEventListener('abort', onAbort, { once: true })
      }

      child.stdout?.on('data', (chunk) => {
        stdout += String(chunk)
      })
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk)
      })

      const finalize = (result: LocalHarnessResult) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
        resolve(result)
      }

      child.on('error', (err) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
        reject(err)
      })

      child.on('close', (code, signal) => {
        try {
          const usage = options.codexReproducible ? parseCodexTokenUsage(stdout) : undefined
          finalize({
            exitCode: code,
            stdout,
            stderr: redactCodexHome(stderr, env.CODEX_HOME),
            killedBySignal: signal,
            durationMs: Date.now() - startedAt,
            timedOut,
            ...(usage ? { usage } : {}),
            ...(evidence ? { evidence } : {}),
          })
        } catch (err) {
          if (settled) return
          settled = true
          if (timer) clearTimeout(timer)
          options.signal?.removeEventListener('abort', onAbort)
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      })
    })
  } finally {
    await isolated.cleanup()
  }
}

const CODEX_EXECUTION_POLICY: CodexExecutionPolicy = {
  sessionPersistence: 'ephemeral',
  userConfig: false,
  rules: false,
  projectInstructions: false,
  skillInstructions: false,
  appInstructions: false,
  toolSuggestions: false,
  multiAgentInstructions: false,
  sandbox: 'workspace-write',
  permissionProfile: 'agent_runtime_reproducible',
  approvalPolicy: 'never',
  shellNetwork: false,
  webSearch: false,
  serviceTier: 'default',
  shellEnvironment: 'core-filtered',
  loginShell: false,
  credentialsReadable: false,
  parentRepoRead: false,
  gitMetadata: false,
  temporaryDirectory: 'workspace-private',
  containerSockets: false,
}

const FORBIDDEN_CODEX_PROMPT_MARKERS = [
  '<skills_instructions>',
  '# AGENTS.md instructions',
  '<apps_instructions>',
  '<recommended_plugins>',
  '<multi_agent_mode>',
  'You are `/root`, the primary agent',
] as const

async function collectCodexExecutionEvidence(opts: {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  spawn: NonNullable<RunLocalHarnessOptions['spawn']>
  controlledConfigSha256: string
  ambientAuth: string
  isolatedAuth: string
  writeProbe: string
  signal?: AbortSignal
}): Promise<CodexExecutionEvidence> {
  assertCodexReproducibleInvocation(opts.command, opts.args)
  const prompt = opts.args[1]
  if (opts.args[0] !== 'exec' || typeof prompt !== 'string' || prompt.length === 0) {
    throw new Error('runLocalHarness: reproducible Codex invocation must be codex exec <prompt>')
  }
  const cliVersion = (await runCodexProbe(opts, ['--version'])).stdout.trim()
  if (!/^codex-cli \d+\.\d+\.\d+(?:[-+].+)?$/.test(cliVersion)) {
    throw new Error(
      `runLocalHarness: unexpected Codex CLI version output ${JSON.stringify(cliVersion)}`,
    )
  }

  const hiddenEnvironmentChecks = [
    'CODEX_HOME',
    'CODEX_ACCESS_TOKEN',
    'CODEX_API_KEY',
    'OPENAI_API_KEY',
  ]
    .map((name) => `test -z "\${${name}:-}"`)
    .join(' && ')
  const sandboxProof = [
    hiddenEnvironmentChecks,
    'test -r .',
    'touch "$1"',
    'rm "$1"',
    '! test -r "$2"',
    '! test -r "$3"',
    '! test -r "$4"',
    'touch "$TMPDIR/.agent-runtime-tmp-proof"',
    'rm "$TMPDIR/.agent-runtime-tmp-proof"',
  ].join(' && ')
  await runCodexProbe(opts, [
    'sandbox',
    '-P',
    CODEX_PERMISSION_PROFILE,
    '-C',
    opts.cwd,
    'sh',
    '-c',
    sandboxProof,
    'sh',
    opts.writeProbe,
    opts.ambientAuth,
    opts.isolatedAuth,
    join(homedir(), 'code'),
  ])
  await runCodexProbe(opts, [
    'sandbox',
    '-P',
    CODEX_PERMISSION_PROFILE,
    '-C',
    opts.cwd,
    'python3',
    '-c',
    'import socket,sys\nfor path in sys.argv[1:]:\n s=socket.socket(socket.AF_UNIX)\n try: s.connect(path)\n except OSError: continue\n raise SystemExit(1)',
    '/var/run/docker.sock',
    '/run/docker.sock',
    '/var/run/containerd/containerd.sock',
    '/run/containerd/containerd.sock',
  ])

  const debugArgs = codexPromptDebugArgs(opts.args, prompt)
  const renderedPrompt = (await runCodexProbe(opts, debugArgs)).stdout
  let parsedPrompt: unknown
  try {
    parsedPrompt = JSON.parse(renderedPrompt)
  } catch {
    throw new Error('runLocalHarness: codex debug prompt-input returned invalid JSON')
  }
  if (!Array.isArray(parsedPrompt) || !jsonTextContains(parsedPrompt, prompt)) {
    throw new Error('runLocalHarness: Codex prompt evidence did not contain the exact task prompt')
  }
  const promptContextWithoutTask = JSON.stringify(redactJsonText(parsedPrompt, prompt))
  for (const marker of FORBIDDEN_CODEX_PROMPT_MARKERS) {
    if (promptContextWithoutTask.includes(marker)) {
      throw new Error(`runLocalHarness: Codex prompt evidence contains forbidden marker ${marker}`)
    }
  }
  for (const marker of ['<permissions instructions>', '<environment_context>']) {
    if (!renderedPrompt.includes(marker)) {
      throw new Error(`runLocalHarness: Codex prompt evidence is missing required marker ${marker}`)
    }
  }

  const nonPromptArgs = [
    opts.command,
    ...opts.args.map((arg, index) => (index === 1 ? '<PROMPT>' : arg)),
  ]
  return {
    cliVersion,
    effectivePromptSha256: sha256(renderedPrompt),
    nonPromptArgsSha256: sha256(JSON.stringify(nonPromptArgs)),
    controlledConfigSha256: opts.controlledConfigSha256,
    policy: { ...CODEX_EXECUTION_POLICY },
  }
}

function assertCodexReproducibleInvocation(command: string, args: string[]): void {
  const executable = basename(command)
  if (executable !== 'codex' && executable !== 'codex.exe') {
    throw new Error('runLocalHarness: reproducible Codex invocation must use the Codex executable')
  }
  const prompt = args[1]
  const expectedPrefix = ['exec', prompt, ...CODEX_REPRODUCIBLE_ARGS]
  const hasExactPrefix = expectedPrefix.every((arg, index) => args[index] === arg)
  const tail = args.slice(expectedPrefix.length)
  const validModel =
    tail[0] === '-m' &&
    typeof tail[1] === 'string' &&
    tail[1].length > 0 &&
    !tail[1].startsWith('-')
  const validReasoning =
    tail[2] === '-c' &&
    typeof tail[3] === 'string' &&
    /^model_reasoning_effort="(?:none|minimal|low|medium|high|xhigh)"$/.test(tail[3])
  if (!hasExactPrefix || tail.length !== 4 || !validModel || !validReasoning) {
    throw new Error(
      'runLocalHarness: reproducible Codex invocation does not match the required isolated argv',
    )
  }
}

function codexPromptDebugArgs(execArgs: string[], prompt: string): string[] {
  const debugArgs = ['debug', 'prompt-input']
  for (let index = 2; index < execArgs.length; index += 1) {
    const arg = execArgs[index]
    const value = execArgs[index + 1]
    if (arg === '-c' && value !== undefined) {
      debugArgs.push('-c', value)
      index += 1
    } else if (arg === '--disable' && value !== undefined) {
      debugArgs.push('--disable', value)
      index += 1
    } else if (arg === '-m' && value !== undefined) {
      debugArgs.push('-c', `model=${JSON.stringify(value)}`)
      index += 1
    } else if (arg === '-s' && value !== undefined) {
      debugArgs.push('-c', `sandbox_mode=${JSON.stringify(value)}`)
      index += 1
    }
  }
  debugArgs.push(prompt)
  return debugArgs
}

function runCodexProbe(
  opts: {
    command: string
    cwd: string
    env: NodeJS.ProcessEnv
    spawn: NonNullable<RunLocalHarnessOptions['spawn']>
    signal?: AbortSignal
  },
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = opts.spawn(opts.command, args, { cwd: opts.cwd, env: opts.env, stdio: 'pipe' })
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }
    child.stdin?.end()
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (!child.killed) child.kill('SIGTERM')
    }, 10_000)
    timer.unref?.()
    const onAbort = () => {
      if (!child.killed) child.kill('SIGTERM')
    }
    if (opts.signal) {
      if (opts.signal.aborted) onAbort()
      else opts.signal.addEventListener('abort', onAbort, { once: true })
    }
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      if (code !== 0) {
        const safeStderr = redactCodexHome(stderr, opts.env.CODEX_HOME)
        reject(
          new Error(
            `runLocalHarness: Codex evidence probe failed (exit ${String(code)}, signal ${String(signal)}): ${safeStderr.trim()}`,
          ),
        )
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

function redactCodexHome(value: string, codexHome: string | undefined): string {
  return codexHome ? value.replaceAll(codexHome, '<ISOLATED_CODEX_HOME>') : value
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function jsonTextContains(value: unknown, needle: string): boolean {
  if (typeof value === 'string') return value.includes(needle)
  if (Array.isArray(value)) return value.some((item) => jsonTextContains(item, needle))
  if (isRecord(value)) return Object.values(value).some((item) => jsonTextContains(item, needle))
  return false
}

function redactJsonText(value: unknown, text: string): unknown {
  if (typeof value === 'string') return value.replaceAll(text, '')
  if (Array.isArray(value)) return value.map((item) => redactJsonText(item, text))
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactJsonText(item, text)]),
    )
  }
  return value
}

const CODEX_AUTH_ENV = ['CODEX_ACCESS_TOKEN', 'CODEX_API_KEY', 'OPENAI_API_KEY'] as const

const CODEX_PERMISSION_PROFILE = 'agent_runtime_reproducible'

async function isolateCodexHome(
  baseEnv: NodeJS.ProcessEnv,
  cwd: string,
): Promise<{
  env: NodeJS.ProcessEnv
  cleanup: () => Promise<void>
  controlledConfigSha256: string
  ambientAuth: string
  isolatedAuth: string
  writeProbe: string
}> {
  const isolatedHome = await mkdtemp(join(tmpdir(), 'agent-runtime-codex-'))
  await chmod(isolatedHome, 0o700)
  let workspaceTemp = ''
  const writeProbe = join(cwd, '.agent-runtime-sandbox-write-proof')
  const cleanup = async () => {
    await Promise.all([
      rm(writeProbe, { force: true }),
      ...(workspaceTemp ? [rm(workspaceTemp, { recursive: true, force: true })] : []),
      rm(isolatedHome, { recursive: true, force: true }),
    ])
  }
  try {
    workspaceTemp = await mkdtemp(join(cwd, '.agent-runtime-tmp-'))
    await chmod(workspaceTemp, 0o700)
    const ambientHome = baseEnv.CODEX_HOME?.trim() || join(homedir(), '.codex')
    const ambientAuth = join(ambientHome, 'auth.json')
    const isolatedAuth = join(isolatedHome, 'auth.json')
    let linkedAuth = false
    try {
      await access(ambientAuth, constants.R_OK)
      await symlink(ambientAuth, isolatedAuth)
      linkedAuth = true
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    if (!linkedAuth && !CODEX_AUTH_ENV.some((name) => Boolean(baseEnv[name]))) {
      throw new Error(
        'runLocalHarness: reproducible Codex mode requires readable auth.json or an API token environment variable',
      )
    }
    const controlledConfig = codexControlledConfig({
      ambientHome,
      ambientTmp: baseEnv.TMPDIR?.trim() || tmpdir(),
      workspaceTemp,
    })
    await writeFile(join(isolatedHome, 'config.toml'), controlledConfig, { mode: 0o600 })
    return {
      env: { ...baseEnv, CODEX_HOME: isolatedHome },
      cleanup,
      controlledConfigSha256: sha256(controlledConfig),
      ambientAuth,
      isolatedAuth,
      writeProbe,
    }
  } catch (err) {
    await cleanup()
    throw err
  }
}

function codexControlledConfig(opts: {
  ambientHome: string
  ambientTmp: string
  workspaceTemp: string
}): string {
  const home = homedir()
  const deniedPaths = [
    opts.ambientHome,
    opts.ambientTmp,
    join(home, 'code'),
    join(home, 'company'),
    join(home, '.ssh'),
    join(home, '.aws'),
    join(home, '.config'),
    join(home, '.cache'),
    join(home, '.docker'),
    join(home, '.kube'),
    join(home, '.gnupg'),
    join(home, '.pki'),
    join(home, '.npmrc'),
    join(home, '.netrc'),
    join(home, '.git-credentials'),
    '/run/docker',
    '/run/containerd',
    opts.workspaceTemp,
  ]
  const filesystemRules = deniedPaths
    .map(
      (path) => `${JSON.stringify(path)} = ${path === opts.workspaceTemp ? '"write"' : '"deny"'}`,
    )
    .join('\n')
  return `default_permissions = "${CODEX_PERMISSION_PROFILE}"
approval_policy = "never"
allow_login_shell = false
service_tier = "default"

[shell_environment_policy]
inherit = "core"
ignore_default_excludes = false
exclude = ["^CODEX_HOME$", "(?i).*TOKEN.*", "(?i).*KEY.*", "(?i).*SECRET.*", "(?i).*PASSWORD.*", "(?i).*CREDENTIAL.*", "(?i).*AUTH.*", "(?i).*COOKIE.*"]
set = { TMPDIR = ${JSON.stringify(opts.workspaceTemp)} }

[permissions.${CODEX_PERMISSION_PROFILE}]
extends = ":workspace"

[permissions.${CODEX_PERMISSION_PROFILE}.filesystem]
${filesystemRules}
":slash_tmp" = "deny"

[permissions.${CODEX_PERMISSION_PROFILE}.filesystem.":workspace_roots"]
"." = "write"

[permissions.${CODEX_PERMISSION_PROFILE}.network]
enabled = false

[permissions.${CODEX_PERMISSION_PROFILE}.network.unix_sockets]
"/var/run/docker.sock" = "deny"
"/run/docker.sock" = "deny"
"/var/run/containerd/containerd.sock" = "deny"
"/run/containerd/containerd.sock" = "deny"
`
}

/** Parse and validate the one terminal usage event emitted by `codex exec --json`. */
export function parseCodexTokenUsage(stdout: string): CodexTokenUsage {
  const completed: unknown[] = []
  for (const [index, line] of stdout.split(/\r?\n/).entries()) {
    if (line.trim().length === 0) continue
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      throw new Error(`runLocalHarness: Codex JSONL line ${index + 1} is not valid JSON`)
    }
    if (isRecord(event) && event.type === 'turn.completed') completed.push(event)
  }
  if (completed.length !== 1) {
    throw new Error(
      `runLocalHarness: expected exactly one Codex turn.completed usage event, received ${completed.length}`,
    )
  }
  const event = completed[0]
  if (!isRecord(event) || !isRecord(event.usage)) {
    throw new Error('runLocalHarness: Codex turn.completed event is missing usage')
  }
  const usage = event.usage
  const inputTokens = naturalNumber(usage.input_tokens, 'input_tokens')
  const cachedInputTokens = naturalNumber(usage.cached_input_tokens, 'cached_input_tokens')
  const outputTokens = naturalNumber(usage.output_tokens, 'output_tokens')
  const reasoningOutputTokens = naturalNumber(
    usage.reasoning_output_tokens,
    'reasoning_output_tokens',
  )
  if (cachedInputTokens > inputTokens) {
    throw new Error('runLocalHarness: Codex cached_input_tokens exceeds input_tokens')
  }
  if (reasoningOutputTokens > outputTokens) {
    throw new Error('runLocalHarness: Codex reasoning_output_tokens exceeds output_tokens')
  }
  return { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function naturalNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`runLocalHarness: Codex usage.${field} must be a non-negative safe integer`)
  }
  return value
}
