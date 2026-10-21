import type { ChildProcess } from 'node:child_process'
import { basename } from 'node:path'
import { sha256 } from '../content-digest'
import { isRecord } from '../record-value'
import { processGroupExists, terminateProcessTreeAndConfirm } from '../runtime/process-tree'
import { redactCodexHome } from './codex-diagnostics'
import {
  CODEX_EXECUTION_POLICY,
  CODEX_PERMISSION_PROFILE,
  CODEX_REPRODUCIBLE_ARGS,
  type CodexExecutionPolicy,
} from './codex-execution-policy'
import type { RunLocalHarnessOptions } from './local-harness-process'

/** Zero-model-call evidence for the exact Codex process about to run. */
export interface CodexExecutionEvidence {
  cliVersion: string
  executableSha256: string
  /** SHA-256 of the exact composed prompt argument proved present in the rendered prompt. */
  requestedPromptSha256: string
  effectivePromptSha256: string
  nonPromptArgsSha256: string
  controlledConfigSha256: string
  /** Sorted normalized paths compiled into the permission profile. */
  readDeniedPaths: string[]
  readDeniedPathsSha256: string
  readDeniedPathCount: number
  policy: CodexExecutionPolicy
}

const FORBIDDEN_CODEX_PROMPT_MARKERS = [
  '<skills_instructions>',
  '# AGENTS.md instructions',
  '<apps_instructions>',
  '<recommended_plugins>',
  '<multi_agent_mode>',
  'You are `/root`, the primary agent',
] as const

export async function collectCodexExecutionEvidence(opts: {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  spawn: NonNullable<RunLocalHarnessOptions['spawn']>
  controlledConfigSha256: string
  readDeniedPaths: string[]
  executableSha256: string
  readDeniedPathsSha256: string
  readDeniedPathCount: number
  ambientAuth: string
  isolatedAuth: string
  writeProbe: string
  stagedWriteProbe: string
  deniedProbePaths: string[]
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
    '! test -r .git',
    'touch "$1"',
    'rm "$1"',
    'staged_dir=$(dirname "$2")',
    'test -x "$staged_dir/codex"',
    '! chmod 700 "$staged_dir" 2>/dev/null',
    '! rm "$staged_dir/codex" 2>/dev/null',
    '! touch "$2" 2>/dev/null',
    'shift 2',
    'for path in "$@"; do ! test -r "$path" || exit 1; done',
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
    opts.stagedWriteProbe,
    ...opts.deniedProbePaths,
  ])
  await runCodexProbe(opts, [
    'sandbox',
    '-P',
    CODEX_PERMISSION_PROFILE,
    '-C',
    opts.cwd,
    'python3',
    '-c',
    `import os,re
pattern=re.compile(br'(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|AUTH|COOKIE|CODEX_HOME)', re.I)
paths=('/proc/1/environ', '/proc/self/environ', f'/proc/{os.getppid()}/environ')
for path in dict.fromkeys(paths):
 data=open(path,'rb').read().split(b'\\0')
 names=(item.split(b'=',1)[0] for item in data if b'=' in item)
 assert not any(pattern.search(name) for name in names), path`,
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
  const promptEvidenceText = normalizeCodexDebugPromptNewlines(prompt)
  if (!Array.isArray(parsedPrompt) || !jsonTextContains(parsedPrompt, promptEvidenceText)) {
    throw new Error('runLocalHarness: Codex prompt evidence did not contain the exact task prompt')
  }
  const promptContextWithoutTask = JSON.stringify(redactJsonText(parsedPrompt, promptEvidenceText))
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
    'codex',
    ...opts.args.map((arg, index) => (index === 1 ? '<PROMPT>' : arg)),
  ]
  return {
    cliVersion,
    executableSha256: opts.executableSha256,
    requestedPromptSha256: sha256(prompt),
    effectivePromptSha256: sha256(renderedPrompt),
    nonPromptArgsSha256: sha256(JSON.stringify(nonPromptArgs)),
    controlledConfigSha256: opts.controlledConfigSha256,
    readDeniedPathsSha256: opts.readDeniedPathsSha256,
    readDeniedPathCount: opts.readDeniedPathCount,
    readDeniedPaths: [...opts.readDeniedPaths],
    policy: { ...CODEX_EXECUTION_POLICY },
  }
}

export function assertCodexReproducibleInvocation(command: string, args: string[]): void {
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
      child = opts.spawn(opts.command, args, {
        cwd: opts.cwd,
        env: opts.env,
        stdio: 'pipe',
        detached: process.platform !== 'win32',
      })
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }
    child.stdin?.end()
    let stdout = ''
    let stderr = ''
    let settled = false
    let leaderClosed = false
    let termination: Promise<void> | null = null
    let terminationReason: 'aborted' | 'timed out' | null = null
    const clearLifecycle = () => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }
    const rejectOnce = (err: unknown) => {
      if (settled) return
      settled = true
      clearLifecycle()
      reject(err instanceof Error ? err : new Error(String(err)))
    }
    const terminate = (reason?: 'aborted' | 'timed out'): Promise<void> => {
      if (reason) terminationReason ??= reason
      if (!termination) {
        termination = terminateProcessTreeAndConfirm(child, () => leaderClosed)
        void termination.catch(rejectOnce)
      }
      return termination
    }
    const timer = setTimeout(() => {
      void terminate('timed out')
    }, 10_000)
    timer.unref?.()
    const onAbort = () => {
      void terminate('aborted')
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
      leaderClosed = true
      clearTimeout(timer)
      void (async () => {
        try {
          if (termination) await termination
          rejectOnce(err)
        } catch (terminationError) {
          rejectOnce(terminationError)
        }
      })()
    })
    child.on('close', (code, signal) => {
      leaderClosed = true
      clearTimeout(timer)
      void (async () => {
        try {
          if (
            !termination &&
            process.platform !== 'win32' &&
            typeof child.pid === 'number' &&
            processGroupExists(child.pid)
          ) {
            await terminate()
          }
          if (termination) await termination
          if (settled) return
          settled = true
          clearLifecycle()
          if (code !== 0 || terminationReason) {
            const safeStderr = redactCodexHome(stderr, opts.env.CODEX_HOME)
            reject(
              new Error(
                `runLocalHarness: Codex evidence probe ${terminationReason ?? 'failed'} (exit ${String(code)}, signal ${String(signal)}): ${safeStderr.trim()}`,
              ),
            )
            return
          }
          resolve({ stdout, stderr })
        } catch (err) {
          rejectOnce(err)
        }
      })()
    })
  })
}

/** Codex's debug renderer converts CRLF pairs to LF. No other whitespace is equivalent. */
function normalizeCodexDebugPromptNewlines(value: string): string {
  return value.replaceAll('\r\n', '\n')
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
