import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { stripVTControlCharacters } from 'node:util'

/** Bounded, credential-redacted process context attached when reproducible Codex output fails
 * validation. The process still fails closed; this only preserves enough evidence to diagnose it. */
export interface CodexExecutionFailureDiagnostic {
  exitCode: number | null
  killedBySignal: NodeJS.Signals | null
  timedOut: boolean
  aborted?: boolean
  durationMs: number
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
}

/** Thrown when reproducible Codex exits without one valid terminal usage event. */
export class CodexExecutionDiagnosticError extends Error {
  readonly code = 'CODEX_EXECUTION_DIAGNOSTIC'

  constructor(
    readonly reason: string,
    readonly diagnostic: CodexExecutionFailureDiagnostic,
    cause?: unknown,
  ) {
    super(
      `runLocalHarness: reproducible Codex execution failed: ${reason}; diagnostic=${JSON.stringify(diagnostic)}`,
      { cause },
    )
    this.name = 'CodexExecutionDiagnosticError'
  }
}

const CODEX_FAILURE_STREAM_MAX_CHARS = 4096
const CODEX_AUTH_MAX_BYTES = 1024 * 1024
const CODEX_REDACTED = '<REDACTED_CREDENTIAL>'
export const codexSensitiveEnvironmentName = /(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|AUTH|COOKIE)/i

export function createCodexExecutionDiagnosticError(opts: {
  reason: string
  exitCode: number | null
  killedBySignal: NodeJS.Signals | null
  timedOut: boolean
  aborted?: boolean
  durationMs: number
  stdout: string
  stderr: string
  codexHome: string | undefined
  redactionValues: string[]
  cause: unknown
}): CodexExecutionDiagnosticError {
  const redact = (value: string) =>
    redactCodexDiagnostic(value, opts.codexHome, opts.redactionValues)
  const boundedStdout = boundCodexDiagnostic(redact(opts.stdout))
  const boundedStderr = boundCodexDiagnostic(redact(opts.stderr))
  const diagnostic: CodexExecutionFailureDiagnostic = {
    exitCode: opts.exitCode,
    killedBySignal: opts.killedBySignal,
    timedOut: opts.timedOut,
    ...(opts.aborted !== undefined ? { aborted: opts.aborted } : {}),
    durationMs: opts.durationMs,
    stdout: boundedStdout.value,
    stderr: boundedStderr.value,
    stdoutTruncated: boundedStdout.truncated,
    stderrTruncated: boundedStderr.truncated,
  }
  const safeReason = boundCodexDiagnostic(redact(opts.reason), 1024).value
  return new CodexExecutionDiagnosticError(
    safeReason,
    diagnostic,
    redactCodexErrorCause(opts.cause, safeReason, redact),
  )
}

export function redactCodexHome(value: string, codexHome: string | undefined): string {
  return codexHome ? value.replaceAll(codexHome, '<ISOLATED_CODEX_HOME>') : value
}

export function collectCodexDiagnosticRedactionValues(
  env: NodeJS.ProcessEnv,
  authText: string,
): string[] {
  const values = Object.entries(env)
    .filter(
      ([name, value]) => codexSensitiveEnvironmentName.test(name) && typeof value === 'string',
    )
    .map(([, value]) => value as string)
  try {
    collectStringLeaves(JSON.parse(authText), values)
  } catch {
    // Invalid auth JSON is diagnosed by Codex; generic credential patterns still redact it.
  }
  const encoded = values
    .filter((value) => value.length >= 8)
    .flatMap((value) => [
      Buffer.from(value, 'utf8').toString('base64'),
      Buffer.from(value, 'utf8').toString('base64url'),
      encodeURIComponent(value),
      JSON.stringify(value).slice(1, -1),
    ])
  return [...new Set([...values, ...encoded])]
}

export async function readCodexAuthRedactionText(path: string): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const stats = await handle.stat()
    if (!stats.isFile() || !Number.isSafeInteger(stats.size) || stats.size > CODEX_AUTH_MAX_BYTES) {
      throw new Error('Codex auth.json must be a regular file no larger than 1 MiB')
    }
    const buffer = Buffer.alloc(stats.size)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    return buffer.subarray(0, offset).toString('utf8')
  } finally {
    await handle.close()
  }
}

function boundCodexDiagnostic(
  value: string,
  maxChars = CODEX_FAILURE_STREAM_MAX_CHARS,
): { value: string; truncated: boolean } {
  if (value.length <= maxChars) return { value, truncated: false }
  const marker = '\n<... OUTPUT TRUNCATED ...>\n'
  const contentChars = maxChars - marker.length
  const headChars = Math.floor(contentChars / 2)
  const tailChars = contentChars - headChars
  return {
    value: `${value.slice(0, headChars)}${marker}${value.slice(-tailChars)}`,
    truncated: true,
  }
}

function redactCodexDiagnostic(
  value: string,
  codexHome: string | undefined,
  protectedValues: ReadonlyArray<string>,
): string {
  let redacted = redactCodexHome(stripVTControlCharacters(value), codexHome)
  const exactValues = [...new Set(protectedValues.filter((item) => item.length >= 6))].sort(
    (a, b) => b.length - a.length,
  )
  for (const secret of exactValues) redacted = redacted.replaceAll(secret, CODEX_REDACTED)
  redacted = redacted
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi, `$1${CODEX_REDACTED}`)
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9._-]{8,}\b/g, CODEX_REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, CODEX_REDACTED)
    .replace(
      /((?:["']?(?:api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|private[-_]?key|session[-_]?(?:id|token)|secret|password|passwd|authorization|credential|cookie)["']?)\s*[:=]\s*)(["'])[^"'\r\n]*\2/gi,
      `$1$2${CODEX_REDACTED}$2`,
    )
    .replace(
      /((?:["']?(?:api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|private[-_]?key|session[-_]?(?:id|token)|secret|password|passwd|authorization|credential|cookie)["']?)\s*[:=]\s*)([^\s,;}]+)/gi,
      `$1${CODEX_REDACTED}`,
    )
  for (const secret of exactValues) redacted = redacted.replaceAll(secret, CODEX_REDACTED)
  return redacted
}

function redactCodexErrorCause(
  cause: unknown,
  safeReason: string,
  redact: (value: string) => string,
): Error | undefined {
  if (!(cause instanceof Error)) return undefined
  const safeCause = new Error(safeReason)
  safeCause.name = cause.name
  if (cause.stack) safeCause.stack = boundCodexDiagnostic(redact(cause.stack)).value
  return safeCause
}

function collectStringLeaves(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    output.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringLeaves(item, output)
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectStringLeaves(item, output)
  }
}
