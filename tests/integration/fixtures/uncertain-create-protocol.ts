import { createHash } from 'node:crypto'
import { closeSync, fsyncSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs'

export type Scenario =
  | 'trace-owner'
  | 'trace-owner-cancel'
  | 'trace-owner-evidence'
  | `trace-tree-${number}`
  | 'json-incomplete'
  | 'json-owner-capture'
  | 'json-output'
  | 'json-authority'
  | 'json-overflow'
  | 'json-no-terminal'
  | 'json-malformed'
  | 'json-malformed-always-true'
  | 'json-tool-only'
  | 'json-ambiguous'
  | 'json-native-failed'
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
  processResult?: { output: string; exitCode: number; startedAt: number; closedAt: number }
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
    return readFileSync(path, 'utf8')
      .trim()
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

export function terminal(run: NativeRun, scenario: Scenario) {
  const processResult = run.processResult
  if (
    (scenario.startsWith('json-') || scenario.startsWith('trace-')) &&
    processResult !== undefined
  ) {
    const answer = {
      type: 'message.part.updated',
      data: { part: { id: 'final-answer', type: 'text', text: processResult.output } },
    }
    const tools = scenario === 'json-tool-only' || scenario === 'json-ambiguous'
    const success = processResult.exitCode === 0
    return [
      {
        type: 'execution.started',
        data: {
          sessionId: run.sessionId,
          executionId: run.executionId,
          runControlRef: run.runControlRef,
          ...(scenario === 'json-output' ? { eventStreamComplete: false } : {}),
        },
      },
      {
        type: 'message.part.updated',
        data: {
          part: {
            id: 'narration',
            type: 'text',
            text: tools ? processResult.output : 'Reading evidence.\n',
          },
        },
      },
      {
        type: 'message.part.updated',
        data: {
          part: {
            id: 'native-node-call',
            type: 'tool',
            tool: 'node-process',
            callID: run.executionId,
            state: {
              status: 'completed',
              input: { executable: process.execPath },
              output: processResult.output,
              title: 'Finite fixture process',
              metadata: {},
              time: { start: processResult.startedAt, end: processResult.closedAt },
            },
          },
        },
      },
      ...(tools ? [] : [answer]),
      {
        type: 'result',
        data: {
          sessionId: run.sessionId,
          executionId: run.executionId,
          success,
          status: success ? 'success' : 'failed',
          finalText:
            scenario === 'json-incomplete'
              ? processResult.output
              : tools
                ? scenario === 'json-ambiguous'
                  ? processResult.output
                  : 'Reading evidence.\n'
                : `Reading evidence.\n${processResult.output}`,
          ...(success
            ? {}
            : {
                error: 'fixture native process exited 7',
                errorCode: 'NATIVE_PROCESS_EXIT',
                statusCode: 502,
              }),
          usage: { inputTokens: 3, outputTokens: 2 },
        },
      },
      {
        type: 'done',
        data: {
          success,
          status: success ? 'success' : 'failed',
          ...(success ? { outcome: { type: 'completed' } } : {}),
        },
      },
    ]
  }
  return [
    {
      type: 'execution.started',
      data: {
        sessionId: run.sessionId,
        executionId: run.executionId,
        runControlRef: run.runControlRef,
      },
    },
    ...(scenario.startsWith('create-')
      ? [
          {
            type: 'message.part.updated',
            data: {
              sessionId: run.sessionId,
              executionId: run.executionId,
              part: { type: 'reasoning', text: run.executionId },
              delta: run.executionId,
            },
          },
        ]
      : []),
    {
      type: 'result',
      data: {
        sessionId: run.sessionId,
        executionId: run.executionId,
        success: true,
        status: 'success',
        response: '{"answer":"delivered"}',
        text: '{"answer":"delivered"}',
        usage: { inputTokens: 3, outputTokens: 2 },
      },
    },
    {
      type: 'done',
      data: {
        sessionId: run.sessionId,
        executionId: run.executionId,
        success: true,
        status: 'success',
        outcome: { type: 'completed' },
        usage: { inputTokens: 3, outputTokens: 2 },
      },
    },
  ]
}

export function nativeEventFile(executionId: string): string {
  return 'native-' + sha256Bytes(executionId) + '.sse'
}
export function encodeFrame(frame: { type: string; data: object }, id: number): string {
  return 'id: ' + id + '\nevent: ' + frame.type + '\ndata: ' + JSON.stringify(frame.data) + '\n\n'
}
