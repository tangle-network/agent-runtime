import { createHash } from 'node:crypto'
import { closeSync, fsyncSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs'

export type Scenario =
  | 'dispatch-refused'
  | 'dispatch-lost-reply'
  | 'terminal-ceiling'
  | 'create-408'
  | 'create-503'
  | 'older-lost'
  | 'current-lost'
  | 'cancel-unknown'
  | 'cancel-requested'
  | 'unsupported-intent'
  | 'unsupported-environment'
  | 'unsupported-descendant'
  | 'accepted'
  | 'historical'
export interface Configuration {
  scenario: Scenario
  directory: string
  url: string
  resolver: string
}
export interface WireRecord {
  kind: string
  at: string
  [field: string]: unknown
}
export interface NativeRun {
  environmentId: string
  sessionId: string
  executionId: string
  runControlRef: Record<string, unknown>
  backend: Record<string, unknown>
  status: 'running' | 'completed' | 'cancelled'
  turnId?: string
  actionStarted?: boolean
  terminalReads: number
}
export interface ServiceState {
  scenario: Scenario
  createStatus: number
  finish: boolean
  cancelEffect: 'unknown' | 'cancel_requested' | 'cancelled' | 'not_live'
  lost: string[]
  routes: Record<string, string>
  boxes: Array<{
    id: string
    key: string
    backend: Record<string, unknown>
    metadata: Record<string, unknown>
    env: Record<string, string>
  }>
  provisions: Array<{ id: string; key: string; publicDigest: string }>
  runs: NativeRun[]
  requests: WireRecord[]
  failures: string[]
}
/**
 * Bound for an event one of the fixture's processes will cause. It only detects a hang: these
 * processes share a loaded host with a full suite, so a bound that measures speed fails
 * whichever case the load happens to slow.
 */
export const HANG_GUARD_MS = 120_000
/** One case runs several such waits in sequence. */
export const CASE_TIMEOUT_MS = 300_000
/** Run-level deadlines (budget, continuation) must outlive the case that drives them. */
export const RUN_DEADLINE_MS = 600_000
/**
 * The Tangle provider's per-create budget. A create the service refuses on purpose needs the SDK
 * to give up quickly so the Runtime sees its unresolved-create cadence; a create the service is
 * expected to accept must not race a loaded host's scheduler, or a spurious timeout becomes a
 * failed attempt the case never asked for.
 */
export function createReadyTimeoutMs(scenario: Scenario): number {
  const refusesCreates =
    scenario.startsWith('create-') ||
    ['historical', 'older-lost', 'current-lost', 'unsupported-descendant'].includes(scenario)
  return refusesCreates ? 250 : HANG_GUARD_MS
}
export function record(path: string, value: object): void {
  const descriptor = openSync(path, 'a', 0o600)
  try {
    writeSync(descriptor, `${JSON.stringify(value)}\n`)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}
export function durableBytes(path: string, bytes: string | Buffer): void {
  const descriptor = openSync(path, 'w', 0o600)
  try {
    writeFileSync(descriptor, bytes)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}
export function readRecords(path: string): WireRecord[] {
  try {
    // `record` appends one line per write while a reader may be mid-read. A write larger than a
    // page is visible in page-sized pieces, so only newline-terminated lines are whole records.
    const text = readFileSync(path, 'utf8')
    return text
      .slice(0, text.lastIndexOf('\n') + 1)
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}
export function sha256Bytes(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}
export function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
}
export function publicCreateMaterial(value: unknown, field = ''): unknown {
  if (field === 'env' || field === 'runtimeSecrets') return Object.keys(object(value)).sort()
  if (Array.isArray(value)) return value.map((child) => publicCreateMaterial(child))
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(object(value))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [
          key,
          field === 'headers' &&
          typeof child === 'string' &&
          ['authorization', 'cookie'].includes(key.toLowerCase())
            ? '<opaque>'
            : publicCreateMaterial(child, key),
        ]),
    )
  return value
}
export function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('expected object')
  return value as Record<string, unknown>
}
export function localUrl(raw: string): URL {
  const url = new URL(raw)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1')
    throw new Error('fixture forbids remote I/O')
  return url
}
export const runtimeCapabilities = {
  schema: 1,
  cliAuthReferences: true,
  codexCredentialContinuations: true,
  agentInterface: 'local-http-fixture',
  sidecarVersion: 'local-http-fixture',
  image: 'local-http-fixture',
  dispatch: { runControlRef: true, executionIdOnAdmission: true },
  cancel: { canonicalRunCancellation: true, digestBound: true, idempotent: true },
  runs: { executionScopedStatus: true, eventReplay: true },
  interactions: { responseDedupe: false },
}
export const registry = {
  timestamp: new Date().toISOString(),
  backends: ['opencode', 'codex'].map((type) => ({
    type,
    name: 'local service process',
    description: 'No model is invoked',
    capabilities: {
      streaming: true,
      toolUse: true,
      reasoning: false,
      multimodal: false,
      imageInput: false,
      contextWindow: 100000,
      mcp: true,
      runtimeAttachments: { mcp: true },
      sessions: true,
      configurable: true,
      interactions: [],
    },
  })),
}
export function attachments(
  value: unknown,
  secrets: Record<string, string>,
): Array<{ url: string; headers: Record<string, string> }> {
  const found: Array<{ url: string; headers: Record<string, string> }> = []
  function visit(node: unknown): void {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    const row = object(node)
    if (typeof row.url === 'string' && row.url.includes('/coordination/')) {
      localUrl(row.url)
      const headers: Record<string, string> = {}
      for (const [name, value] of Object.entries(object(row.headers ?? {}))) {
        if (typeof value === 'string') {
          headers[name] = value
          continue
        }
        const reference = object(value)
        if (reference.kind !== 'secret-ref' || typeof reference.key !== 'string')
          throw new Error('unsupported runtime header')
        const secret = secrets[reference.key]
        if (typeof secret !== 'string')
          throw new Error(`runtime header reference was not delivered: ${reference.key}`)
        if (reference.format !== 'bearer') throw new Error('unsupported runtime header format')
        headers[name] = `Bearer ${secret}`
      }
      found.push({ url: row.url, headers })
      return
    }
    for (const child of Object.values(row)) visit(child)
  }
  visit(value)
  return found
}
