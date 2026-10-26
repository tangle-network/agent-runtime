import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import {
  discoverDurableSupervisionRun,
  FileObserverJournal,
  superviseGraphPursuit,
} from '../../src/durable/index'
import type {
  Agent,
  AgentGraph,
  AgentSpec,
  Executor,
  ExecutorResult,
} from '../../src/runtime/index'
import { loadTopSnapshot, type TopSnapshot } from '../../src/tui/index'
import { renderTopFrame } from '../../src/tui/top-frame'

const runProcess = promisify(execFile)
const budget = { maxIterations: 10, maxTokens: 10000, deadlineMs: 10000 }
const profile = {
  name: 'stage',
  harness: 'claude-code' as const,
  model: { provider: 'anthropic', default: 'requested-process-model' },
  prompt: { systemPrompt: 'Execute the caller-owned process stage.' },
}
const graph: AgentGraph = {
  nodes: [{ id: 'stage', profile }],
  edges: [],
  entry: [{ node: 'stage', task: 'hold' }],
  budget,
  deliverable: { check: () => true },
}

// Real OS execution through the public leaf port: no provider protocol or model is emulated.
function processLeaf(cwd: string, known: boolean, fail: boolean) {
  return () => {
    const stop = new AbortController()
    let pending: Promise<ExecutorResult<string>> | undefined
    let result: ExecutorResult<string> | undefined
    const executor: Executor<string> = {
      runtime: 'durable-reader-process',
      execute(_task, signal) {
        const script =
          "const fs=require('node:fs');fs.writeFileSync('started',String(process.pid));" +
          "const poll=setInterval(()=>{if(fs.existsSync('release')){clearInterval(poll);" +
          (fail
            ? "process.stderr.write('actual-process-refusal');process.exit(7)"
            : "process.stdout.write('delivered')") +
          ' }},10)'
        const started = performance.now()
        pending = runProcess(process.execPath, ['-e', script], {
          cwd,
          signal: AbortSignal.any([signal, stop.signal]),
          timeout: 5000,
        }).then(({ stdout }) => {
          result = {
            out: stdout,
            outRef: `sha256:${createHash('sha256').update(JSON.stringify(stdout)).digest('hex')}`,
            verdict: { valid: true, score: 1 },
            spent: {
              iterations: 1,
              tokens: { input: 0, output: 0 },
              usd: 0,
              tokensKnown: known,
              usdKnown: known,
              ms: performance.now() - started,
            },
          }
          return result
        })
        return pending
      },
      resultArtifact() {
        if (!result) throw new Error('process has no accepted result')
        return result
      },
      async teardown() {
        stop.abort()
        await pending?.catch(() => undefined)
        return { destroyed: true }
      },
    }
    const executorSpec: AgentSpec = { profile, harness: null, executor }
    return {
      name: profile.name,
      act: async () => {
        throw new Error('executor owns execution')
      },
      executorSpec,
    } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
  }
}

function expectUnavailableHeader(snapshot: TopSnapshot) {
  const header = renderTopFrame(snapshot, { color: false, width: 320 }).split('\n')[0]
  expect(header).toContain('unknown  tok ?/?')
  expect(header).not.toContain('$0')
}

function expectUnknownWorkerLog(
  snapshot: TopSnapshot,
  workerId: string | undefined,
  status: 'done' | 'down',
) {
  expect(workerId).toBeDefined()
  const supervisor = snapshot.supervisors.find((row) =>
    row.workers.some((worker) => worker.id === workerId),
  )
  // This real process graph has one worker, so the selected terminal row is unambiguous.
  expect(supervisor?.workers.map((worker) => worker.id)).toEqual([workerId])
  expect(
    supervisor?.journalTail.find((event) => event.kind === 'settled' && event.id === workerId),
  ).toMatchObject({ kind: 'settled', id: workerId, status })
  const log = renderTopFrame(snapshot, {
    color: false,
    mode: 'log',
    selectedSupervisorId: supervisor?.id,
    width: 320,
    height: 120,
  }).split('JOURNAL TAIL')[1]
  const terminal = log
    ?.split('\n')
    .find((line) => line.includes(` ${status.toUpperCase()} `) && line.includes('unknown'))
  expect(terminal).toContain('?/?')
}

it.each([
  { known: true, fail: false },
  { known: false, fail: false },
  { known: false, fail: true },
])(
  'reads live and settled actual durable process history: %j',
  async ({ known, fail }) => {
    const root = await mkdtemp(join(tmpdir(), 'durable-top-reader-'))
    const runDir = join(root, 'durable')
    const runId = 'actual-runtime-run'
    const pursuitId = 'different-pursuit-identity'
    const stop = new AbortController()
    const pending = superviseGraphPursuit(graph, {
      runDir,
      runId,
      pursuitId,
      signal: stop.signal,
      makeLeafAgent: processLeaf(root, known, fail),
      perWorker: { maxIterations: 1, maxTokens: 1000 },
      driverRetry: { enabled: false },
    })
    try {
      await Promise.race([
        pending,
        expect
          .poll(async () => Number(await readFile(join(root, 'started'), 'utf8')), {
            timeout: 5000,
          })
          .toBeGreaterThan(0),
      ])
      const live = await loadTopSnapshot(root, { runDir })
      expect(live.completeness).toBe('complete')
      expect(live.pursuit?.pursuitId).toBe(pursuitId)
      expect(live.supervisors.map((row) => row.id)).toContain(runId)
      const liveWorker = live.supervisors
        .flatMap((row) => row.workers)
        .find((row) => row.runtime === 'durable-reader-process')
      expect(liveWorker?.status).toBe('running')
      expect(liveWorker?.spend.usdKnown).toBe(false)
      expect(renderTopFrame(live, { color: false, width: 180 })).toContain('unknown')
      await writeFile(join(root, 'release'), '')
      const finished = await pending
      const snapshot = await loadTopSnapshot(root, { runDir })
      expect(snapshot.pursuit).toEqual(finished.pursuit)
      const worker = snapshot.supervisors
        .flatMap((row) => row.workers)
        .find((row) => row.id === liveWorker?.id)
      expect(worker?.status).toBe(fail ? 'down' : 'done')
      const observed = snapshot.pursuit?.nodes.find((node) => node.id === worker?.id)
      expect(observed?.runId).toBe(runId)
      expect(observed?.identity).toBeDefined()
      expect(observed?.materialization).toMatchObject({ status: 'unknown' })
      expect(observed?.model).toBeUndefined()
      if (fail) expect(observed?.reason).toContain('actual-process-refusal')
      else {
        expect(observed?.cost?.usdKnown).toBe(known)
        expect(worker?.spend.usdKnown).toBe(known)
        expect(snapshot.supervisors.find((row) => row.id === runId)?.totals.usdKnown).toBe(known)
      }
      const frame = renderTopFrame(snapshot, { color: false, width: 180 })
      expect(frame).not.toContain('NaN')
      if (!known || fail) {
        expect(frame).toContain('unknown')
        expectUnknownWorkerLog(snapshot, worker?.id, fail ? 'down' : 'done')
      }
      const clipped = renderTopFrame(snapshot, { color: true, width: 88 })
      // Actual process data must remain bounded without emitting a partial terminal escape.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: strip complete ANSI sequences
      const plain = clipped.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
      expect(plain).not.toContain('\x1b')
      expect(plain.split('\n').every((line) => line.length <= 88)).toBe(true)
      const discovery = await discoverDurableSupervisionRun(runDir)
      expect(discovery.roots).toContain(finished.result.result.tree.root)
      expect(finished.result.result.tree.root).toBe(runId)
      expect(worker?.id).not.toBe(runId)
      expect(snapshot.supervisors.find((row) => row.id === runId)).toMatchObject({
        budget: graph.budget.maxTokens,
        budgetKnown: true,
      })
      const spawnBytes = await readFile(discovery.spawnJournalPath, 'utf8')
      for (const broken of [`${spawnBytes}{corrupt}\n`, '']) {
        await writeFile(discovery.spawnJournalPath, broken)
        const partial = await loadTopSnapshot(root, { runDir })
        expect(partial).toMatchObject({
          completeness: 'partial',
          loaded: 0,
          pursuit: finished.pursuit,
        })
        expectUnavailableHeader(partial)
      }
      await writeFile(discovery.spawnJournalPath, spawnBytes)
      const coordinationBytes = await readFile(discovery.coordinationLogPath, 'utf8').catch(
        (error) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
          throw error
        },
      )
      await writeFile(discovery.coordinationLogPath, `${coordinationBytes}{corrupt}\n`)
      const partialCoordination = await loadTopSnapshot(root, { runDir })
      expect(partialCoordination).toMatchObject({
        completeness: 'partial',
        loaded: 0,
        pursuit: finished.pursuit,
      })
      expectUnavailableHeader(partialCoordination)
      await writeFile(discovery.coordinationLogPath, coordinationBytes)
      const observer = await FileObserverJournal.open(join(runDir, 'observer.jsonl'))
      expect(observer?.pursuitId).toBe(pursuitId)
      const bytes = await readFile(join(runDir, 'observer.jsonl'), 'utf8')
      await writeFile(join(runDir, 'observer.jsonl'), `${bytes}{torn`)
      expect((await loadTopSnapshot(root, { runDir })).pursuit).toEqual(finished.pursuit)
      await writeFile(join(runDir, 'observer.jsonl'), `${bytes}{corrupt}\n`)
      const corruptObserver = await loadTopSnapshot(root, { runDir })
      expect(corruptObserver).toMatchObject({ completeness: 'partial', loaded: 0 })
      expectUnavailableHeader(corruptObserver)
      await rm(join(runDir, 'observer.jsonl'))
      const missingObserver = await loadTopSnapshot(root, { runDir })
      expect(missingObserver).toMatchObject({
        completeness: 'partial',
        diagnostics: [{ reason: 'missing', source: 'observer-journal' }],
      })
      expectUnavailableHeader(missingObserver)
      expect(await FileObserverJournal.open(join(root, 'absent.jsonl'))).toBeUndefined()
      await expect(readFile(join(root, 'absent.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' })
      const legacyDir = join(root, '.agent', 'supervisor', 'legacy')
      await mkdir(legacyDir, { recursive: true })
      await writeFile(
        join(legacyDir, 'state.json'),
        JSON.stringify({
          id: 'legacy',
          status: 'done',
          task: 'old snapshot',
          workspaceDir: root,
          budget: 100,
        }),
      )
      const legacy = loadTopSnapshot(root, 1234)
      expect(legacy).not.toBeInstanceOf(Promise)
      expect(legacy.generatedAt).toBe(1234)
      expect(legacy.supervisors.map((row) => row.id)).toEqual(['legacy'])
      expect(legacy).not.toHaveProperty('pursuit')
      expect(renderTopFrame(legacy, { color: false })).toContain('$0')
      // Feed the actual process journal through the legacy fold as well as the canonical reader.
      await writeFile(join(legacyDir, 'spawn-journal.jsonl'), spawnBytes)
      const legacyRecorded = loadTopSnapshot(root)
      expect(legacyRecorded.supervisors[0]?.totals.usdKnown !== false).toBe(known && !fail)
      expect(legacyRecorded.supervisors[0]?.totals.tokensKnown !== false).toBe(known && !fail)
      if (!known || fail) expectUnknownWorkerLog(legacyRecorded, worker?.id, fail ? 'down' : 'done')
    } finally {
      stop.abort()
      await writeFile(join(root, 'release'), '')
      await pending.catch(() => undefined)
      await rm(root, { recursive: true, force: true })
    }
  },
  20000,
)
