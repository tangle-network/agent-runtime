import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { canonicalString, merkleLeafHash } from '@tangle-network/agent-eval/ledger-core'
import { agentCandidateWorkspaceSnapshotEvidenceSchema } from '@tangle-network/agent-interface'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { verifyWorkspaceSnapshotArtifacts } from '../../src/candidate-execution/artifacts'
import { contentAddress } from '../../src/durable/content-address'
import { replaySpawnTree } from '../../src/durable/spawn-journal/replay'
import {
  createFileRunContext,
  FileResultBlobStore,
  FileSpawnJournal,
  type SpawnEvent,
} from '../../src/runtime'
import { createPrivateCasArtifactPort } from '../../src/runtime/private-cas'
import { createBudgetPool } from '../../src/runtime/supervise/budget'
import { createExecutor } from '../../src/runtime/supervise/runtime'
import { createScope } from '../../src/runtime/supervise/scope'
import { verifyCitation, verifyStoredTrace } from '../helpers/trace-root-verifier'
import { testAgentProfile } from '../kernel/test-agent-profile'
import {
  type Executables,
  prepareExecutables,
  withFixture,
} from './fixtures/uncertain-create-harness'
import { object, readRecords, type Scenario } from './fixtures/uncertain-create-protocol'

let bundle: string
let executables: Executables
beforeAll(async () => {
  ;({ bundle, executables } = await prepareExecutables())
})
afterAll(async () => {
  if (bundle) await rm(bundle, { recursive: true, force: true })
})

it.each<Scenario>(['trace-owner', 'trace-owner-evidence', 'trace-owner-cancel'])(
  'roots actual retained process %s, with durable replay, integrity and cleanup',
  async (scenario) => {
    await withFixture(scenario, executables, async (fixture) => {
      await fixture.acknowledgeNativeReplay(0)
      await fixture.wait('retained process result committed', async () =>
        (await fixture.events()).some((row) => row.kind === 'execution-result'),
      )
      if (scenario === 'trace-owner-evidence') {
        await fixture.wait('full host capture held', async () =>
          (await fixture.state()).requests.some(
            (row) =>
              row.kind === 'successful-attempt-observer-barrier' &&
              row.phase === 'workspace-capture',
          ),
        )
        expect(fixture.outcomes().some((row) => row.kind === 'settled')).toBe(false)
        expect(
          (await fixture.state()).requests.filter((row) => row.kind === 'delete'),
        ).toHaveLength(0)
        const blobs = new FileResultBlobStore(join(fixture.directory, 'run', 'blobs'))
        for (const row of (await fixture.events()).filter(
          (row) => row.kind === 'execution-evidence',
        )) {
          const out = object(await blobs.get(row.outRef))
          expect(object(out.workspaceCapture).provenance).not.toHaveProperty(
            'workspaceScope',
            'environment',
          )
        }
        await fixture.control({ finish: true })
      }
      if (scenario !== 'trace-owner-cancel')
        await fixture.wait('owner settled', async () =>
          fixture.outcomes().some((row) => row.kind === 'settled'),
        )
      const events = await fixture.events()
      const results = events.filter((row) => row.kind === 'execution-result')
      expect(results).toHaveLength(1)
      const committed = results[0]!
      expect(committed.id).toBe('uncertain-create-proof')
      expect(committed).not.toHaveProperty('outputFormat')
      const blobs = new FileResultBlobStore(join(fixture.directory, 'run', 'blobs'))
      const verified = await verifyStoredTrace(blobs, committed)
      expect(verified.artifact.nodeId).toBe(committed.id)
      expect(verified.artifact.summary.toolCalls).toEqual({ 'node-process': 1 })
      const index = verified.events.findIndex((event) =>
        JSON.stringify(event).includes('node-process'),
      )
      const text = JSON.stringify(verified.events[index])
      expect(verifyCitation(verified, committed.traceRoot!.root, text, index, 'node-process')).toBe(
        true,
      )
      expect(
        verifyCitation(verified, committed.traceRoot!.root, text, index - 1, 'node-process'),
      ).toBe(false)
      expect(
        verifyCitation(verified, committed.traceRoot!.root, text, index, 'unreported-tool'),
      ).toBe(false)
      // A one-byte change that is still valid JSON cannot claim the original event.
      expect(
        verifyCitation(
          verified,
          committed.traceRoot!.root,
          text.replace('node-process', 'node-procest'),
          index,
          '',
        ),
      ).toBe(false)
      const summary = { ...verified.artifact.summary, toolCalls: { 'node-process': 0 } }
      expect(
        merkleLeafHash(canonicalString(summary), verified.artifact.salts[verified.events.length]),
      ).not.toBe(verified.artifact.leaves.at(-1))
      const idless = verified.events.findIndex((event) => object(event).id === undefined)
      expect(idless).toBeGreaterThanOrEqual(0)
      expect(
        verifyCitation(
          verified,
          committed.traceRoot!.root,
          JSON.stringify(verified.events[idless]),
          idless,
          'result',
        ),
      ).toBe(true)
      const cold = await new FileSpawnJournal(
        join(fixture.directory, 'run', 'spawn-journal.jsonl'),
      ).loadTree('uncertain-create-proof')
      expect(cold?.filter((row) => row.kind === 'execution-result')).toEqual(results)
      const native = readRecords(join(fixture.directory, 'json-worker-processes.jsonl'))
      expect(native).toHaveLength(1)
      expect(() => process.kill(Number(native[0]!.pid), 0)).toThrow(
        expect.objectContaining({ code: 'ESRCH' }),
      )
      if (scenario === 'trace-owner-cancel') {
        expect(readRecords(join(fixture.directory, 'cancelled-while-hashing.jsonl'))).toHaveLength(
          1,
        )
        expect(
          events.filter(
            (row) => row.kind === 'reconciled' && row.retainedPendingCause !== undefined,
          ),
        ).toHaveLength(0)
      } else {
        expect(
          object(object(fixture.outcomes().find((row) => row.kind === 'settled')!.result).result)
            .kind,
        ).toBe('winner')
      }
      if (scenario === 'trace-owner-evidence') {
        const evidence = events.filter((row) => row.kind === 'execution-evidence')
        let copies = 0
        const original = object(await blobs.get(committed.outRef))
        for (const row of evidence) {
          const out = object(await blobs.get(row.outRef))
          if (
            out.workspaceSnapshot === undefined ||
            !isDeepStrictEqual(original.events, out.events)
          )
            continue
          expect(row.outRef).not.toBe(committed.outRef)
          expect(row).not.toHaveProperty('traceRoot')
          const receipt = object(out.workspaceCapture)
          expect(receipt.coverageComplete).toBe(false)
          const provenance = object(receipt.provenance)
          if (provenance.workspaceScope === 'environment') {
            const intent = events.find(
              (event) => event.kind === 'execution-admitted' && event.admission.phase === 'intent',
            )
            const bound = events.find((event) => event.kind === 'execution-bound')
            if (
              intent?.kind !== 'execution-admitted' ||
              intent.admission.phase !== 'intent' ||
              bound?.kind !== 'execution-bound'
            )
              throw new Error('actual retained admission missing')
            const capture = readRecords(join(fixture.directory, 'capture-attempts.jsonl')).at(-1)!
            expect(receipt.executionId).toBe(capture.executionId)
            expect(receipt.environmentId).toBe(capture.environmentId)
            const dispatched = events.find(
              (event) =>
                event.kind === 'execution-admitted' && event.admission.phase === 'dispatched',
            )
            if (
              dispatched?.kind !== 'execution-admitted' ||
              dispatched.admission.phase !== 'dispatched'
            )
              throw new Error('actual dispatched reference missing')
            expect(receipt.controlRef).toEqual(dispatched.admission.controlRef)
            expect(receipt.profileDigest).toBe(intent.admission.requestedProfileDigest)
            expect(receipt.node).toMatchObject({
              rootId: committed.id,
              nodeId: committed.id,
              depth: 0,
              attemptId: bound.binding.attemptId,
            })
            expect(provenance.status).toBe('unavailable')
            expect(provenance.missing).toContain(
              'local process fixture has no native harness capture',
            )
            expect(provenance.controlRef).toEqual(receipt.controlRef)
            expect(receipt.snapshot).toEqual(out.workspaceSnapshot)
            const snapshot = agentCandidateWorkspaceSnapshotEvidenceSchema.parse(
              out.workspaceSnapshot,
            )
            const verified = await verifyWorkspaceSnapshotArtifacts(
              snapshot,
              createPrivateCasArtifactPort(
                join(fixture.directory, 'workspace-cas'),
                'provider-json',
              ),
            )
            expect(verified.archive.byteLength).toBeGreaterThan(0)
            expect(events.indexOf(row)).toBeGreaterThan(events.indexOf(committed))
            copies++
          }
        }
        expect(copies).toBeGreaterThan(0)
        expect(
          events.filter((row) => 'traceRoot' in row && row.traceRoot !== undefined),
        ).toHaveLength(1)
      }
    })
  },
  45000,
)

it.each([3, 4, 5, 7, 8, 9, 16, 17, 31, 32, 33, 255, 256, 257, 513])(
  'checks Runtime incremental Merkle shape at %i leaves from actual HTTP/process events',
  async (leaves) => {
    await withFixture(`trace-tree-${leaves}`, executables, async (fixture) => {
      await fixture.acknowledgeNativeReplay(0, true)
      await fixture.wait('graph settled', async () =>
        fixture.outcomes().some((row) => row.kind === 'settled'),
      )
      const blobs = new FileResultBlobStore(join(fixture.directory, 'run', 'blobs'))
      const evidence = (await fixture.events()).filter((row) => row.kind === 'execution-evidence')
      expect(evidence).toHaveLength(1)
      for (const row of evidence) {
        const verified = await verifyStoredTrace(blobs, row)
        expect(verified.artifact.leafCount).toBe(leaves)
      }
      expect((await fixture.state()).runs).toHaveLength(1)
      const result = (await fixture.events()).find((row) => row.kind === 'execution-result')
      expect(result?.kind === 'execution-result' && result.outcome?.errorCode).toBe(
        'RUNTIME_OUTPUT_FORMAT_INVALID',
      )
      const graph = object(
        object(fixture.outcomes().find((row) => row.kind === 'settled')!.result).result,
      )
      expect(object(graph.result).kind).toBe('no-winner')
    })
  },
  45000,
)

async function fileCase(body: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(
    join(process.env.RUNTIME_CREATE_PROOF_DIR ?? tmpdir(), 'trace-files-'),
  )
  try {
    await body(directory)
  } catch (error) {
    console.error(`Trace filesystem proof retained: ${directory}`)
    throw error
  }
  if (!process.env.RUNTIME_CREATE_PROOF_DIR) await rm(directory, { recursive: true, force: true })
}

it('leaves a real CLI process without native events unrooted in its file journal', async () => {
  await fileCase(async (directory) => {
    const context = createFileRunContext(directory)
    await context.journal.beginTree('root', new Date().toISOString())
    const scope = createScope({
      ...context,
      parentId: 'root',
      root: 'root',
      pool: createBudgetPool({ maxIterations: 2, maxTokens: 100 }, 0),
      seams: {},
      depth: 0,
      signal: new AbortController().signal,
    })
    const executorFactory = createExecutor({
      backend: 'cli',
      bin: process.execPath,
      cwd: directory,
      args: [
        '-e',
        "require('node:fs').writeFileSync('process.pid', String(process.pid)); process.stdout.write('patched')",
      ],
    })
    expect(
      scope.spawn(
        {
          name: 'printer',
          act: async () => {
            throw new Error('maintained executor owns execution')
          },
          executorSpec: { profile: testAgentProfile('printer'), harness: null, executorFactory },
        },
        'task',
        {
          label: 'printer',
          budget: { maxIterations: 1, maxTokens: 100 },
        },
      ).ok,
    ).toBe(true)
    expect(await scope.next()).toBeDefined()
    const pid = Number(await readFile(join(directory, 'process.pid'), 'utf8'))
    expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }))
    const row = (await context.journal.loadTree('root'))?.find((event) => event.kind === 'settled')
    if (row?.kind !== 'settled' || row.outRef === undefined)
      throw new Error('real CLI result was not retained')
    expect(await context.blobs.get(row.outRef)).toEqual({ content: 'patched' })
    expect(row).not.toHaveProperty('traceRoot')
  })
})

it('cold-replays actual pre-trace journal bytes and refuses malformed trace receipts', async () => {
  await fileCase(async (directory) => {
    const context = createFileRunContext(directory)
    const out = { content: 'old', events: [{ type: 'done', data: {} }] }
    const outRef = contentAddress(out)
    await context.blobs.put(outRef, out)
    const at = '2026-10-01T00:00:00.000Z'
    const path = join(directory, 'spawn-journal.jsonl')
    await context.journal.beginTree('root', at)
    await context.journal.appendEvent('root', {
      kind: 'spawned',
      id: 'root:s0',
      parent: 'root',
      label: 'old worker',
      runtime: 'router',
      budget: { maxIterations: 1, maxTokens: 10 },
      seq: 0,
      at,
    })
    const settled: SpawnEvent = {
      kind: 'settled',
      id: 'root:s0',
      status: 'done',
      outRef,
      spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 1 },
      seq: 1,
      at,
    }
    const prefix = await readFile(path)
    await context.journal.appendEvent('root', settled)
    expect(await replaySpawnTree(new FileSpawnJournal(path), context.blobs, 'root')).toMatchObject([
      { kind: 'done', out, outRef },
    ])
    const receipt = {
      root: `sha256:${'a'.repeat(64)}`,
      ref: contentAddress('artifact'),
      leafCount: 2,
    }
    const malformed = [
      { ...receipt, root: 'sha256:short' },
      { ...receipt, ref: 'artifact' },
      { ...receipt, leafCount: 0 },
      { ...receipt, leafCount: 1.5 },
    ]
    for (const [index, traceRoot] of [...malformed, receipt].entries()) {
      const invalid = join(directory, `malformed-${index}.jsonl`)
      await writeFile(invalid, prefix)
      await appendFile(
        invalid,
        `${JSON.stringify({ kind: 'event', root: 'root', event: { ...settled, outRef: index === malformed.length ? undefined : outRef, traceRoot } })}\n`,
      )
      await expect(new FileSpawnJournal(invalid).loadTree('root')).rejects.toThrow(
        /malformed trace root/,
      )
    }
  })
})
