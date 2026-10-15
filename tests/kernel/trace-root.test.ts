import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import {
  canonicalString,
  jsonDocument,
  type LedgerHash,
  merkleInclusionProof,
  merkleLeafHash,
  merkleRoot,
  verifyMerkleInclusion,
} from '@tangle-network/agent-eval/ledger-core'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import {
  TRACE_ROOT_SCHEMA,
  TRACE_SUMMARY_SCHEMA,
  type TraceRootArtifact,
  type TraceRootReceipt,
} from '@tangle-network/agent-runtime/kernel'
import { afterEach, describe, expect, it } from 'vitest'
import { captureAgentCandidateWorkspaceFiles } from '../../src/candidate-execution'
import {
  contentAddress,
  FileSpawnJournal,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  replaySpawnTree,
} from '../../src/durable/spawn-journal'
import { type ProviderLeafOut, providerAsExecutor } from '../../src/runtime/environment-provider'
import { createPrivateCasArtifactPort } from '../../src/runtime/private-cas'
import type { ProviderWorkspaceRetentionPort } from '../../src/runtime/provider-workspace-retention'
import { createBudgetPool } from '../../src/runtime/supervise/budget'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createScope } from '../../src/runtime/supervise/scope'
import { supervise } from '../../src/runtime/supervise/supervise'
import type {
  Agent,
  AgentSpec,
  Executor,
  ResultBlobStore,
  SpawnEvent,
} from '../../src/runtime/supervise/types'
import { completeCapture } from '../helpers/complete-workspace-capture'
import { testContinuation } from '../helpers/continuation'
import { coordinationProxy } from '../helpers/coordination-proxy'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

const directories: string[] = []
const proxies: Awaited<ReturnType<typeof coordinationProxy>>[] = []
afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()))
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

// ── The streamed turn ───────────────────────────────────────────────────────────

function partUpdate(id: string, type: 'text' | 'reasoning', text: string): AgentEnvironmentEvent {
  const part = { id, sessionID: 'ses-1', messageID: 'msg-1', type, text }
  return {
    type: 'message.part.updated',
    data: { part },
    normalized: { type: 'message.part.updated', part },
  }
}

function toolPart(
  callID: string,
  tool: string,
  status: 'pending' | 'running' | 'completed',
): AgentEnvironmentEvent {
  const input = { path: `/work/${callID}` }
  const part = {
    id: `prt-${callID}`,
    sessionID: 'ses-1',
    messageID: 'msg-1',
    type: 'tool',
    tool,
    callID,
    state:
      status === 'completed'
        ? { status, input, output: 'ok', title: tool, metadata: {}, time: { start: 1, end: 2 } }
        : { status, input },
  }
  return {
    type: 'message.part.updated',
    data: { part },
    normalized: { type: 'message.part.updated', part } as AgentEnvironmentEvent['normalized'],
  }
}

/** Codex reports tools only as `item.*` events inside `raw`, measured on archived codex turns. */
function codexItem(phase: 'item.started' | 'item.completed', item: Record<string, unknown>) {
  return {
    type: 'raw',
    data: { type: 'raw', backend: 'codex', event: { type: phase, item } },
  } as AgentEnvironmentEvent
}

const mcpCall = {
  id: 'item_1',
  type: 'mcp_tool_call',
  server: 'agent-runtime-coordination',
  tool: 'read_journal',
  arguments: { sinceRow: 0, limit: 100 },
  result: null,
  error: null,
  status: 'in_progress',
}
const command = {
  id: 'item_2',
  type: 'command_execution',
  command: "/bin/bash -lc 'node check.mjs'",
  aggregated_output: '',
  exit_code: null,
  status: 'in_progress',
}

/** One turn as a provider streams it: superseded reasoning frames, tool parts that restate one
 *  call across frames, liveness frames, codex tool items, and an opencode raw echo of a tool. */
function streamedTurn(): AgentEnvironmentEvent[] {
  const events: AgentEnvironmentEvent[] = [
    { type: 'execution.started', data: {} },
    partUpdate('prt-reasoning', 'reasoning', 'Read the journal'),
    partUpdate('prt-reasoning', 'reasoning', 'Read the journal, then check.'),
    toolPart('call-bash', 'bash', 'pending'),
    toolPart('call-bash', 'bash', 'running'),
    {
      type: 'tool-heartbeat',
      data: { toolName: 'bash', partId: 'prt-call-bash', elapsedMs: 5_000, thresholdMs: 10_000 },
    },
    toolPart('call-bash', 'bash', 'completed'),
    toolPart('call-read', 'read', 'completed'),
    {
      type: 'raw',
      data: {
        type: 'raw',
        backend: 'opencode',
        event: { type: 'tool_use', part: { tool: 'bash', callID: 'call-bash' } },
      },
    },
    codexItem('item.started', mcpCall),
    codexItem('item.completed', {
      ...mcpCall,
      result: { content: [{ type: 'text', text: '{"entries":[]}' }] },
      status: 'completed',
    }),
    codexItem('item.started', command),
    codexItem('item.completed', {
      ...command,
      aggregated_output: 'all checks pass\n',
      exit_code: 0,
      status: 'completed',
    }),
    partUpdate('prt-text', 'text', 'The checks pass.'),
    {
      type: 'result',
      data: { finalText: 'The checks pass.', usage: { inputTokens: 7, outputTokens: 11 } },
    },
    { type: 'done', data: {} },
  ]
  // The sidecar stamps `id:` only on frames that hold a replay-buffer position, so the terminal
  // `result` and `done` frames arrive without one: 346 of 346 archived turns on 2026-10-15.
  return events.map((event, index) =>
    event.type === 'result' || event.type === 'done'
      ? event
      : { ...event, id: String(100 + index) },
  )
}

/** One call per distinct call id, by tool name: four calls, whatever the frame count. */
const STREAMED_TOOL_CALLS = {
  bash: 1,
  read: 1,
  'agent-runtime-coordination/read_journal': 1,
  command_execution: 1,
}

// ── An independent verifier, written from the contract alone ─────────────────────

interface Verified {
  readonly artifact: TraceRootArtifact
  readonly events: readonly unknown[]
}

/** Recompute every leaf and the root from the stored output and artifact, as a reader would. */
async function verifyStoredTrace(
  blobs: ResultBlobStore,
  record: { outRef?: string; traceRoot?: TraceRootReceipt },
): Promise<Verified> {
  const receipt = record.traceRoot
  if (receipt === undefined || record.outRef === undefined) throw new Error('no trace root')
  const artifact = (await blobs.get(receipt.ref)) as TraceRootArtifact
  const out = (await blobs.get(record.outRef)) as ProviderLeafOut
  expect(contentAddress(artifact)).toBe(receipt.ref)
  const n = out.events.length
  expect(artifact).toMatchObject({
    schema: TRACE_ROOT_SCHEMA,
    outRef: record.outRef,
    root: receipt.root,
    leafCount: n + 1,
  })
  expect(receipt.leafCount).toBe(n + 1)
  expect(artifact.salts).toHaveLength(n + 1)
  expect(artifact.leaves).toHaveLength(n + 1)
  out.events.forEach((event, index) => {
    expect(merkleLeafHash(canonicalString(jsonDocument(event)), artifact.salts[index])).toBe(
      artifact.leaves[index],
    )
  })
  expect(artifact.summary).toMatchObject({ schema: TRACE_SUMMARY_SCHEMA, events: n })
  expect(
    merkleLeafHash(
      canonicalString({
        schema: artifact.summary.schema,
        events: artifact.summary.events,
        toolCalls: artifact.summary.toolCalls,
      }),
      artifact.salts[n],
    ),
  ).toBe(artifact.leaves[n])
  expect(merkleRoot(artifact.leaves as LedgerHash[])).toBe(receipt.root)
  return { artifact, events: out.events }
}

/** A citation `{eventIndex, quote}` checked the way the contract states: leaf, inclusion, quote. */
function verifyCitation(
  verified: Verified,
  root: string,
  eventText: string,
  eventIndex: number,
  quote: string,
): boolean {
  let event: unknown
  try {
    event = JSON.parse(eventText)
  } catch {
    return false
  }
  let canonical: string
  try {
    canonical = canonicalString(jsonDocument(event))
  } catch {
    return false
  }
  const salt = verified.artifact.salts[eventIndex]
  if (salt === undefined) return false
  const leaf = merkleLeafHash(canonical, salt)
  if (leaf !== verified.artifact.leaves[eventIndex]) return false
  const proof = merkleInclusionProof(verified.artifact.leaves as LedgerHash[], eventIndex)
  return (
    verifyMerkleInclusion(leaf, proof, root as LedgerHash).verified && canonical.includes(quote)
  )
}

// ── Runs through the public execution paths ─────────────────────────────────────

/** A non-retained provider child settled through `Scope`: its `settled` record holds the outRef. */
async function settledProviderChild(events: AgentEnvironmentEvent[]) {
  const provider: AgentEnvironmentProvider = {
    name: 'trace-root-fixture',
    capabilities: () => ({}),
    create: async () => ({
      id: 'env-1',
      provider: 'trace-root-fixture',
      status: async () => 'running',
      destroy: async () => {},
      stream: async function* () {
        yield* events
      },
    }),
  }
  const journal = new InMemorySpawnJournal()
  const blobs = new InMemoryResultBlobStore()
  await journal.beginTree('root', new Date(0).toISOString())
  const scope = createScope({
    parentId: 'root',
    root: 'root',
    journal,
    blobs,
    pool: createBudgetPool({ maxIterations: 2, maxTokens: 1_000 }, 0),
    executors: createExecutorRegistry(),
    seams: {},
    depth: 0,
    signal: new AbortController().signal,
  })
  const profile = testAgentProfile('trace-worker', { harness: 'claude-code' })
  const spawned = scope.spawn(
    Object.assign(
      { name: 'trace-worker', act: async () => 'unused' },
      { executorSpec: { profile, harness: null, executorFactory: providerAsExecutor(provider) } },
    ),
    'task',
    { label: 'trace', budget: { maxIterations: 1, maxTokens: 1_000 } },
  )
  expect(spawned.ok).toBe(true)
  expect((await scope.next())?.kind).toBe('done')
  const settled = (await journal.loadTree('root'))?.find((event) => event.kind === 'settled')
  if (settled?.kind !== 'settled') throw new Error('expected a settled record')
  return { settled, blobs }
}

/** A retained provider root whose one turn streams `events` and submits the deliverable. Its
 *  `execution-result` is written by the retained owner, the path Discovery roots take.
 *  `deferredCapture` gives it the workspace retention Discovery roots run with: a native session
 *  copy, so the owner commits the turn first and stores it again with its workspace capture.
 *  `abortWhileHashing` cancels the run as the first turn's trace root is stored. */
async function retainedRoot(
  runId: string,
  events: AgentEnvironmentEvent[],
  options: { deferredCapture?: boolean; abortWhileHashing?: boolean } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'trace-root-'))
  directories.push(directory)
  const proxy = await coordinationProxy()
  proxies.push(proxy)
  const context = createFileRunContext(join(directory, 'run'))
  const abort = new AbortController()
  let abortedWhileHashing = false
  const blobs: ResultBlobStore = options.abortWhileHashing
    ? {
        get: (ref) => context.blobs.get(ref),
        async put(ref, value) {
          if (
            !abort.signal.aborted &&
            (value as TraceRootArtifact | null)?.schema === TRACE_ROOT_SCHEMA
          ) {
            abortedWhileHashing = true
            abort.abort(new Error('the run was cancelled while its turn hashed'))
          }
          await context.blobs.put(ref, value)
        },
      }
    : context.blobs
  const artifacts = createPrivateCasArtifactPort(join(directory, 'cas'), runId)
  const workspaceRetention: ProviderWorkspaceRetentionPort | undefined = options.deferredCapture
    ? {
        artifacts,
        timeoutMs: 5_000,
        capture: (captureContext) => completeCapture(captureContext, artifacts),
        // No running copy: only the copy each turn takes as it ends.
        nativeIntervalMs: 3_600_000,
        async captureNative(captureContext) {
          const { snapshot } = await captureAgentCandidateWorkspaceFiles(
            [{ path: 'native.jsonl', mode: 0o600, bytes: new TextEncoder().encode('{}\n') }],
            {
              artifactPersistence: {
                executionId: captureContext.executionId,
                outputArtifacts: artifacts,
              },
            },
          )
          return {
            snapshot,
            provenance: {
              status: 'reported',
              environmentId: captureContext.environment.id,
              executionId: captureContext.executionId,
              workspaceScope: 'none',
              missing: [],
            },
          }
        },
      }
    : undefined
  let port = 0
  let token = ''
  const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
    ...environment,
    session: (id, sessionOptions) => {
      const session = environment.session!(id, sessionOptions)
      return {
        ...session,
        async *events(options) {
          const start =
            options?.since === undefined
              ? 0
              : events.findIndex((event) => event.id === options.since) + 1
          for (const event of events.slice(start)) yield structuredClone(event)
        },
        result: async () => ({
          ...(await session.result()),
          usage: { inputTokens: 3, outputTokens: 2 },
        }),
      }
    },
    dispatch: async (turn) => {
      const dispatched = await environment.dispatch!(turn)
      const response = await fetch(`http://127.0.0.1:${port}/manager`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'submit',
          method: 'tools/call',
          params: { name: 'submit_result', arguments: { result: { answer: 'done' } } },
        }),
      })
      if (!response.ok) throw new Error(`submit_result returned ${response.status}`)
      return dispatched
    },
  })
  const base = durableRetainedProvider(join(directory, 'provider.json'))
  const provider: AgentEnvironmentProvider = {
    ...base,
    capabilities: async () => ({
      ...(await base.capabilities()),
      create: { runtimeAttachments: { mcp: true } },
    }),
    create: async (input) => {
      token ||= input.env?.AGENT_RUNTIME_COORDINATION_TOKEN ?? ''
      return wrap(await base.create(input))
    },
    get: async (id) => {
      const environment = await base.get!(id)
      return environment ? wrap(environment) : null
    },
  }
  const timer = setTimeout(() => abort.abort(new Error('test run timed out')), 20_000)
  const result = await supervise(
    testAgentProfile('root', {
      harness: 'opencode',
      tools: runtimeToolDeclarations('submit_result'),
    }),
    'Produce the answer.',
    {
      runDir: join(directory, 'run'),
      runId,
      journal: context.journal,
      blobs,
      signal: abort.signal,
      backend: { backend: 'provider', provider, workspaceRetention },
      driverBackend: { backend: 'provider', provider, workspaceRetention },
      budget: { maxIterations: 20, maxTokens: 1_000, deadlineMs: 60_000 },
      driverRetry: { maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
      retainedAtSettlement: 'release',
      deliverable: {
        describe: 'the submitted answer',
        check: (value) => (value as { answer?: unknown }).answer === 'done',
      },
      continuation: testContinuation(),
      coordination: {
        authentication: {
          signingKeys: { activeKeyId: 'test', keys: { test: 'trace-root-secret-'.repeat(3) } },
        },
        publicUrl: (address) => {
          port = address.port
          proxy.forwardTo(port)
          return `${proxy.url}/manager`
        },
      },
    },
  )
    .catch((error: unknown) => ({ kind: 'threw' as const, error }))
    .finally(() => clearTimeout(timer))
  return {
    result,
    journal: context.journal,
    blobs: context.blobs,
    journalPath: join(directory, 'run', 'spawn-journal.jsonl'),
    abortedWhileHashing,
  }
}

/** Seeded so a failing case names the same mutation on every run. */
function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('trace root', () => {
  it('commits a settled provider turn to one root over its archived events and tool summary', async () => {
    const { settled, blobs } = await settledProviderChild(streamedTurn())

    const verified = await verifyStoredTrace(blobs, settled)
    // The superseded reasoning frame is not archived, so it is not a leaf either.
    expect(verified.events).toHaveLength(streamedTurn().length - 1)
    expect(verified.artifact.nodeId).toBe(settled.id)
    expect(verified.artifact.summary.toolCalls).toEqual(STREAMED_TOOL_CALLS)

    // One event proven against the journal's root alone, with the quote it supports.
    const index = verified.events.findIndex(
      (event) =>
        JSON.stringify(event).includes('item.started') &&
        JSON.stringify(event).includes('read_journal'),
    )
    expect(index).toBeGreaterThan(0)
    const root = settled.traceRoot!.root
    expect(
      verifyCitation(
        verified,
        root,
        JSON.stringify(verified.events[index]),
        index,
        '"tool":"read_journal"',
      ),
    ).toBe(true)
    // The same event cited at another index, or for words it does not contain, is refused.
    expect(
      verifyCitation(
        verified,
        root,
        JSON.stringify(verified.events[index]),
        index - 1,
        'read_journal',
      ),
    ).toBe(false)
    expect(
      verifyCitation(
        verified,
        root,
        JSON.stringify(verified.events[index]),
        index,
        'write_journal',
      ),
    ).toBe(false)
  })

  it('proves a retained root turn from the execution-result that records its output', async () => {
    const { result, journal, blobs, journalPath } = await retainedRoot(
      'trace-root-retained',
      streamedTurn(),
    )
    expect(result).toMatchObject({ kind: 'winner' })
    const events = (await journal.loadTree('trace-root-retained')) ?? []
    const recorded = events.filter(
      (event): event is Extract<SpawnEvent, { kind: 'execution-result' }> =>
        event.kind === 'execution-result',
    )
    expect(recorded.length).toBeGreaterThan(0)
    for (const record of recorded) {
      expect(record.traceRoot).toBeDefined()
      const verified = await verifyStoredTrace(blobs, record)
      expect(verified.artifact.nodeId).toBe(record.id)
      expect(verified.artifact.summary.toolCalls).toEqual(STREAMED_TOOL_CALLS)
      // Events the session delivered without an id are archived like the rest, and are cited by
      // their index in the archive, never by an id they do not have (#1205). The retained turn
      // also appends its own terminal `result` projection, which carries no id either.
      const idless = verified.events.flatMap((event, index) =>
        (event as { id?: unknown }).id === undefined ? [index] : [],
      )
      expect(
        new Set(idless.map((index) => (verified.events[index] as { type: string }).type)),
      ).toEqual(new Set(['result', 'done']))
      const streamed = idless[0]!
      expect(
        verifyCitation(
          verified,
          record.traceRoot!.root,
          JSON.stringify(verified.events[streamed]),
          streamed,
          '"finalText":"The checks pass."',
        ),
      ).toBe(true)
      const projected = idless.at(-1)!
      expect(
        verifyCitation(
          verified,
          record.traceRoot!.root,
          JSON.stringify(verified.events[projected]),
          projected,
          '"type":"result"',
        ),
      ).toBe(true)
    }
    // A cold reader of the same journal finds the same receipts: they are journal facts.
    const cold = await new FileSpawnJournal(journalPath).loadTree('trace-root-retained')
    expect(
      cold?.filter((event) => event.kind === 'execution-result').map((event) => event.traceRoot),
    ).toEqual(recorded.map((record) => record.traceRoot))
  })

  it("roots a retained owner's turn once when its deferred capture stores the turn again", async () => {
    // A Discovery root commits each turn before its workspace capture, then journals the capture
    // as evidence: the same events with the workspace added, under another outRef. A second root
    // over them gave the turn two count candidates and two run-root leaves.
    const runId = 'trace-root-deferred'
    const { result, journal, blobs } = await retainedRoot(runId, streamedTurn(), {
      deferredCapture: true,
    })
    expect(result).toMatchObject({ kind: 'winner' })
    const events = (await journal.loadTree(runId)) ?? []
    const results = events.filter(
      (event): event is Extract<SpawnEvent, { kind: 'execution-result' }> =>
        event.kind === 'execution-result',
    )
    const evidence = events.filter(
      (event): event is Extract<SpawnEvent, { kind: 'execution-evidence' }> =>
        event.kind === 'execution-evidence',
    )
    expect(results.length).toBeGreaterThan(0)
    const turns = await Promise.all(
      results.map(async (record) => ({
        outRef: record.outRef,
        out: (await blobs.get(record.outRef)) as ProviderLeafOut,
      })),
    )
    let recaptured = 0
    for (const record of evidence) {
      const out = (await blobs.get(record.outRef)) as ProviderLeafOut & {
        workspaceSnapshot?: unknown
      }
      const turn = turns.find((committed) => isDeepStrictEqual(committed.out.events, out.events))
      if (turn === undefined || out.workspaceSnapshot === undefined) continue
      expect(turn.outRef).not.toBe(record.outRef)
      expect(record).not.toHaveProperty('traceRoot')
      recaptured += 1
    }
    expect(recaptured).toBeGreaterThan(0)
    // One root per turn, each on the record that committed it.
    const roots = new Set(
      events.flatMap((event) =>
        'traceRoot' in event && event.traceRoot !== undefined ? [event.traceRoot.ref] : [],
      ),
    )
    expect(roots).toEqual(new Set(results.map((record) => record.traceRoot?.ref)))
    expect(roots.size).toBe(results.length)
    for (const record of results) await verifyStoredTrace(blobs, record)
  })

  it('builds the root merkleRoot gives its leaves, at every tree shape', async () => {
    // The root is built as the leaves arrive. Leaf counts on both sides of each power of two
    // cover every arrangement of its perfect subtrees.
    const leafCounts = [3, 4, 5, 7, 8, 9, 16, 17, 31, 32, 33, 255, 256, 257, 513]
    const built: number[] = []
    for (const leafCount of leafCounts) {
      // The stream's terminal `result` and `done` frames are two of the events.
      const parts = Array.from({ length: leafCount - 3 }, (_, index) =>
        partUpdate(`prt-${index}`, 'text', `part ${index}`),
      )
      const { settled, blobs } = await settledProviderChild([
        ...parts,
        { type: 'result', data: { finalText: 'done' } },
        { type: 'done', data: {} },
      ])
      // Recomputes merkleRoot(leaves) and checks it is the journal's root.
      const verified = await verifyStoredTrace(blobs, settled)
      built.push(verified.artifact.leafCount)
    }
    expect(built).toEqual(leafCounts)
  })

  it('refuses any single-byte change to a stored event that changes or breaks it', async () => {
    const { settled, blobs } = await settledProviderChild(streamedTurn())
    const verified = await verifyStoredTrace(blobs, settled)
    const root = settled.traceRoot!.root
    const random = mulberry32(0x7ace)
    const decoder = new TextDecoder()
    let changed = 0
    for (let trial = 0; trial < 600; trial += 1) {
      const index = Math.floor(random() * verified.events.length)
      const original = JSON.stringify(verified.events[index])
      expect(verifyCitation(verified, root, original, index, '')).toBe(true)
      const bytes = new TextEncoder().encode(original)
      const at = Math.floor(random() * bytes.length)
      const replacement = (bytes[at]! + 1 + Math.floor(random() * 255)) % 256
      bytes[at] = replacement
      const mutated = decoder.decode(bytes)
      let sameValue = false
      try {
        sameValue =
          canonicalString(jsonDocument(JSON.parse(mutated))) ===
          canonicalString(jsonDocument(verified.events[index]))
      } catch {
        sameValue = false
      }
      // A byte change that leaves the same JSON value (`\u001f` read as `\u001F`) changes no fact.
      if (sameValue) continue
      changed += 1
      expect(verifyCitation(verified, root, mutated, index, ''), `${index}@${at}`).toBe(false)
    }
    expect(changed).toBeGreaterThan(550)

    // The summary leaf commits to the counts: a changed count no longer hashes to its leaf.
    const n = verified.events.length
    const forged = {
      ...verified.artifact.summary,
      toolCalls: { ...verified.artifact.summary.toolCalls, bash: 0 },
    }
    expect(merkleLeafHash(canonicalString(forged), verified.artifact.salts[n])).not.toBe(
      verified.artifact.leaves[n],
    )
  })

  it('is absent for an output that archived no events', async () => {
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    await journal.beginTree('root', new Date(0).toISOString())
    const scope = createScope<unknown>({
      parentId: 'root',
      root: 'root',
      journal,
      blobs,
      pool: createBudgetPool({ maxIterations: 2, maxTokens: 1_000 }, 0),
      executors: createExecutorRegistry(),
      seams: {},
      depth: 0,
      signal: new AbortController().signal,
    })
    const out = { content: 'patched', toolCalls: [{ name: 'bash' }] }
    const executor: Executor<unknown> = {
      runtime: 'router',
      execute: async () => ({
        outRef: contentAddress(out),
        out,
        spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 1 },
      }),
      teardown: async () => ({ destroyed: true }),
    }
    const agent: Agent<unknown, unknown> & { executorSpec: AgentSpec } = {
      name: 'bridge',
      act: async () => out,
      executorSpec: { profile: testAgentProfile('bridge'), harness: null, executor },
    }
    expect(
      (
        await scope.spawn(agent, 'task', {
          label: 'bridge',
          budget: { maxIterations: 1, maxTokens: 100 },
        })
      ).ok,
    ).toBe(true)
    expect((await scope.next())?.kind).toBe('done')
    const settled = (await journal.loadTree('root'))?.find((event) => event.kind === 'settled')
    expect(settled).toMatchObject({ outRef: contentAddress(out) })
    expect(settled).not.toHaveProperty('traceRoot')
  })

  it('replays a journal written before trace roots and refuses a malformed one', async () => {
    const out = { content: 'old', events: [{ type: 'done', data: {} }] }
    const blobs = new InMemoryResultBlobStore()
    const outRef = contentAddress(out)
    await blobs.put(outRef, out)
    const at = '2026-10-01T00:00:00.000Z'
    const spawned: SpawnEvent = {
      kind: 'spawned',
      id: 'root:s0',
      parent: 'root',
      label: 'old worker',
      runtime: 'router',
      budget: { maxIterations: 1, maxTokens: 10 },
      seq: 0,
      at,
    }
    const settled: SpawnEvent = {
      kind: 'settled',
      id: 'root:s0',
      status: 'done',
      outRef,
      spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 1 },
      seq: 1,
      at,
    }
    const directory = await mkdtemp(join(tmpdir(), 'trace-root-replay-'))
    directories.push(directory)
    const path = join(directory, 'spawn-journal.jsonl')
    const written = new FileSpawnJournal(path)
    await written.beginTree('root', at)
    await written.appendEvent('root', spawned)
    await written.appendEvent('root', settled)
    const replayed = await replaySpawnTree(new FileSpawnJournal(path), blobs, 'root')
    expect(replayed).toMatchObject([{ kind: 'done', out, outRef }])

    const journal = new InMemorySpawnJournal()
    await journal.beginTree('root', at)
    await journal.appendEvent('root', spawned)
    const receipt = {
      root: `sha256:${'a'.repeat(64)}`,
      ref: contentAddress('artifact'),
      leafCount: 2,
    }
    for (const traceRoot of [
      { ...receipt, root: 'sha256:short' },
      { ...receipt, ref: 'artifact' },
      { ...receipt, leafCount: 0 },
      { ...receipt, leafCount: 1.5 },
    ]) {
      await expect(
        journal.appendEvent('root', { ...settled, traceRoot } as SpawnEvent),
      ).rejects.toThrow(/malformed trace root/)
    }
    const withoutOutput: SpawnEvent = {
      kind: 'settled',
      id: 'root:s0',
      status: 'done',
      traceRoot: receipt,
      spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 1 },
      seq: 1,
      at,
    }
    await expect(journal.appendEvent('root', withoutOutput)).rejects.toThrow(/malformed trace root/)
    await journal.appendEvent('root', { ...settled, traceRoot: receipt } as SpawnEvent)
  })
})
