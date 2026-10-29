import { appendFile, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentProfileSchema } from '@tangle-network/agent-interface'
import { expect, test } from 'vitest'
import { FileSpawnJournal } from '../../src/durable/spawn-journal/journal-store'
import { FileResultBlobStore } from '../../src/durable/spawn-journal/result-blob-store'
import { startRetainedRun } from '../../src/runtime/retained-run-start'
import {
  knownMaterializationReceipt,
  unknownExecutionBindingReceipt,
} from '../../src/runtime/supervise/materialization'
import { appendExactMaterializationEvent } from '../../src/runtime/supervise/scope-owner-materialization'
import { serveTopWeb, type TopSnapshotFrame } from '../../src/tui/top-web'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'

test('web and HTTP snapshots reconcile a real workflow journal, reconnect, and close', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-top-web-'))
  const run = join(root, 'workflow')
  const assets = join(root, 'assets')
  const workspace = join(root, 'workspace')
  const supervisor = join(workspace, '.agent', 'supervisor', 'root')
  await mkdir(run)
  await mkdir(assets)
  await mkdir(supervisor, { recursive: true })
  await writeFile(
    join(supervisor, 'state.json'),
    JSON.stringify({
      id: 'root',
      status: 'done',
      task: 'Recorded supervisor',
      workspaceDir: workspace,
      budget: 0,
    }),
  )
  await writeFile(join(assets, 'workspace-viewer.js'), 'export {};')
  await writeFile(join(assets, 'styles.css'), 'body { color: black; }')
  await writeFile(
    join(workspace, 'root-stream.jsonl'),
    JSON.stringify({
      at: new Date().toISOString(),
      event: {
        kind: 'tool_call',
        toolCallId: 'root-tool',
        toolName: 'read',
        args: { path: 'recorded.txt' },
      },
    }) + '\n',
  )
  const web = await serveTopWeb({ roots: [run, workspace], assets })
  const controller = new AbortController()
  try {
    const page = await fetch(web.url)
    expect(page.status).toBe(200)
    await expect(
      serveTopWeb({ roots: [run], assets, port: Number(new URL(web.url).port) }),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' })
    expect(await page.text()).toContain('data-mode="live"')
    expect((await fetch(`${web.url}assets/styles.css`)).status).toBe(200)
    expect(
      (await fetch(`${web.url}api/top`, { headers: { origin: 'https://other.example' } })).status,
    ).toBe(403)
    expect((await fetch(`${web.url}api/top`, { method: 'POST' })).status).toBe(405)
    const rootTranscript = await fetch(`${web.url}api/top/agents/1/root/root/stream`)
    expect(rootTranscript.status).toBe(200)
    const rootCapture = await rootTranscript.text()
    expect(rootCapture).toContain('event: end')
    expect(rootCapture).toContain('"kind":"tool-call"')
    expect(rootCapture).toContain('recorded.txt')
    const stream = await fetch(`${web.url}api/top/events`, { signal: controller.signal })
    expect(stream.headers.get('content-type')).toBe('text/event-stream')
    const reader = stream.body!.getReader()
    let text = ''
    const frame = async (): Promise<TopSnapshotFrame> => {
      const deadline = Date.now() + 4000
      while (Date.now() < deadline) {
        const boundary = text.indexOf('\n\n')
        if (boundary !== -1) {
          const packet = text.slice(0, boundary)
          text = text.slice(boundary + 2)
          const data = packet.split('\n').find((line) => line.startsWith('data: '))
          if (data) return JSON.parse(data.slice(6)) as TopSnapshotFrame
        } else {
          const chunk = await reader.read()
          if (chunk.done) throw new Error('SSE ended')
          text += new TextDecoder().decode(chunk.value)
        }
      }
      throw new Error('No snapshot within deadline')
    }
    expect((await frame()).reset).toBe(true)
    // The CLI creates its run directory before supervision creates a journal.
    await writeFile(join(run, 'journal.jsonl'), '{"type":"launched"}\n')
    const at = new Date().toISOString()
    await writeFile(
      join(run, 'agent-one.jsonl'),
      JSON.stringify({
        type: 'assistant',
        timestamp: at,
        message: { role: 'assistant', content: 'Inspecting the work' },
      }) + '\n',
    )
    await appendFile(
      join(run, 'agent-one.jsonl'),
      Array.from({ length: 12 }, () => JSON.stringify({ type: 'attachment', timestamp: at })).join(
        '\n',
      ) + '\n',
    )
    const writtenAt = Date.now()
    await appendFile(
      join(run, 'journal.jsonl'),
      '{"type":"started","agentId":"one","label":"Research"}\n',
    )
    let updated = await frame()
    while (!updated.snapshots[0]?.supervisors[0]?.workers.length) updated = await frame()
    expect(Date.now() - writtenAt).toBeLessThan(1000)
    const worker = updated.snapshots[0]!.supervisors[0]!.workers[0]!
    expect(worker).toMatchObject({ id: 'one', label: 'Research', status: 'running', startedAt: at })
    expect(worker.liveTail.length).toBeLessThanOrEqual(8)
    expect(updated.snapshots[0]!.supervisors[0]!.totals.usdKnown).toBe(false)
    const transcript = await fetch(`${web.url}api/top/agents/0/workflow/one/stream`, {
      signal: controller.signal,
    })
    expect(transcript.status).toBe(200)
    const transcriptReader = transcript.body!.getReader()
    let transcriptText = ''
    while (!transcriptText.includes('Inspecting the work'))
      transcriptText += new TextDecoder().decode((await transcriptReader.read()).value)
    expect(transcriptText).toContain('"kind":"text"')
    await appendFile(
      join(run, 'journal.jsonl'),
      '{"type":"result","agentId":"one","result":"Complete"}\n',
    )
    let settled = await frame()
    while (settled.snapshots[0]?.supervisors[0]?.workers[0]?.status !== 'done')
      settled = await frame()
    expect(settled.sequence).toBeGreaterThan(updated.sequence)
    const current = (await (await fetch(`${web.url}api/top`)).json()) as TopSnapshotFrame
    expect(current.reset).toBe(true)
    expect(current.snapshots[0]!.supervisors[0]!.workers[0]!.status).toBe('done')
    controller.abort()
    await reader.cancel().catch(() => {})
    await transcriptReader.cancel().catch(() => {})
  } finally {
    controller.abort()
    await web.close()
    await web.close()
    await expect(fetch(web.url)).rejects.toThrow()
    await rm(root, { recursive: true, force: true })
  }
}, 15000)

test('a retained run started with journalRoot appears in GET /api/top within 2 s', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-top-web-retained-'))
  const journalRoot = join(root, 'runtime-journal')
  const assets = join(root, 'assets')
  await mkdir(journalRoot)
  await mkdir(assets)
  await writeFile(join(assets, 'workspace-viewer.js'), 'export {};')
  await writeFile(join(assets, 'styles.css'), 'body { color: black; }')
  const web = await serveTopWeb({ roots: [journalRoot], assets })
  try {
    const startedAt = Date.now()
    // The card is keyed by Runtime's intent run id, which exists before the provider does.
    let runId: string | undefined
    await startRetainedRun({
      provider: durableRetainedProvider(join(root, 'provider.json')),
      environment: { profile: { name: 'worker' }, idempotencyKey: 'top-web-retained' },
      turn: { prompt: 'start', turnId: 'top-web-retained' },
      onAdmission: async (admission) => {
        if (admission.phase === 'intent') runId = admission.runId
      },
      journalRoot,
    })
    let card: TopSnapshotFrame['snapshots'][number]['supervisors'][number] | undefined
    while (!card && Date.now() - startedAt < 2000) {
      const current = (await (await fetch(`${web.url}api/top`)).json()) as TopSnapshotFrame
      card = current.snapshots[0]?.supervisors.find((supervisor) => supervisor.id === runId)
      if (!card) await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(card).toMatchObject({ id: runId, status: 'running' })
    expect(Date.now() - startedAt).toBeLessThan(2000)
  } finally {
    await web.close()
    await rm(root, { recursive: true, force: true })
  }
}, 15000)

test('a supervised run with metered child turns, and one that has only begun, both render as cards', async () => {
  // Recorded from a real supervise() run (router brain, three router workers) under Runtime 2.0.1.
  const recorded = join(__dirname, '..', 'fixtures', 'durable', 'supervised-nested-turns')
  const root = await mkdtemp(join(tmpdir(), 'runtime-top-web-supervised-'))
  const finished = join(root, 'finished')
  const begun = join(root, 'begun')
  const assets = join(root, 'assets')
  await mkdir(assets)
  await writeFile(join(assets, 'workspace-viewer.js'), 'export {};')
  await writeFile(join(assets, 'styles.css'), 'body { color: black; }')
  await cp(recorded, join(finished, 'liverun-proof-2'), { recursive: true })
  // supervise() writes its spawn journal at begin and its first observer record after a turn.
  await mkdir(join(begun, 'liverun-proof-2'), { recursive: true })
  await cp(
    join(recorded, 'spawn-journal.jsonl'),
    join(begun, 'liverun-proof-2', 'spawn-journal.jsonl'),
  )
  const web = await serveTopWeb({ roots: [finished, begun], assets })
  try {
    const current = (await (await fetch(`${web.url}api/top`)).json()) as TopSnapshotFrame
    const [whole, early] = current.snapshots
    expect(whole?.diagnostics).toEqual([])
    expect(whole?.supervisors).toHaveLength(1)
    expect(whole?.supervisors[0]).toMatchObject({ id: 'liverun-proof-2' })
    expect(whole?.supervisors[0]?.workers).toHaveLength(3)
    expect(early?.supervisors.map((supervisor) => supervisor.id)).toEqual(['liverun-proof-2'])
  } finally {
    await web.close()
    await rm(root, { recursive: true, force: true })
  }
}, 15000)

test('closing the viewer right after a terminal record still delivers that settled frame', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-top-web-close-'))
  const run = join(root, 'workflow')
  const assets = join(root, 'assets')
  await mkdir(run)
  await mkdir(assets)
  await writeFile(join(assets, 'workspace-viewer.js'), 'export {};')
  await writeFile(join(assets, 'styles.css'), 'body { color: black; }')
  await writeFile(
    join(run, 'journal.jsonl'),
    '{"type":"launched"}\n{"type":"started","agentId":"one","label":"Research"}\n',
  )
  const web = await serveTopWeb({ roots: [run], assets })
  const stream = await fetch(`${web.url}api/top/events`)
  const reader = stream.body!.getReader()
  let text = ''
  const statusOf = () =>
    text
      .split('\n\n')
      .filter((packet) => packet.includes('event: snapshot'))
      .flatMap((packet) => packet.split('\n').filter((line) => line.startsWith('data: ')))
      .map((line) => JSON.parse(line.slice(6)) as TopSnapshotFrame)
      .map((frame) => frame.snapshots[0]?.supervisors[0]?.workers[0]?.status)
  while (!statusOf().includes('running'))
    text += new TextDecoder().decode((await reader.read()).value)
  // The caller settles and closes at once: no wait for the watcher or the reconcile tick.
  await appendFile(
    join(run, 'journal.jsonl'),
    '{"type":"result","agentId":"one","result":"Complete"}\n',
  )
  await web.close()
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read())
    text += new TextDecoder().decode(chunk.value)
  expect(statusOf().at(-1)).toBe('done')
  // The stream says it is over, so a client stops instead of reconnecting to a closed server.
  expect(text.endsWith('event: end\ndata: {}\n\n')).toBe(true)
  await rm(root, { recursive: true, force: true })
}, 15000)

test("a run under a runs root opens an agent's input and result when its conversation was not captured", async () => {
  // Recorded from a native Codex poet -> critic graph run whose bridge captured no conversation.
  const recorded = join(__dirname, '..', 'fixtures', 'durable', 'native-graph-poet-critic')
  const runId = '78ecc202-8364-4bdb-be3e-56e2f57c0820'
  const root = await mkdtemp(join(tmpdir(), 'runtime-top-web-detail-'))
  const runs = join(root, 'runs')
  const assets = join(root, 'assets')
  await mkdir(assets)
  await writeFile(join(assets, 'workspace-viewer.js'), 'export {};')
  await writeFile(join(assets, 'styles.css'), 'body { color: black; }')
  await cp(recorded, join(runs, runId), { recursive: true })
  const web = await serveTopWeb({ roots: [runs], assets })
  try {
    const critic = encodeURIComponent(`${runId}:s1`)
    const body = await (await fetch(`${web.url}api/top/agents/0/${runId}/${critic}/stream`)).text()
    const rows = body
      .split('\n\n')
      .filter((packet) => packet.startsWith('event: rows'))
      .flatMap(
        (packet) =>
          (
            JSON.parse(packet.split('data: ')[1]!) as {
              events: { event: Record<string, string> }[]
            }
          ).events,
      )
      .map(({ event }) => event)
    expect(rows.map((event) => event.provenance)).toEqual([
      'delegated-input',
      'capture-unavailable',
      'recorded-result',
    ])
    expect(rows[0]?.text).toContain('Dawn rain taps the leaves')
    expect(JSON.parse(rows[2]!.text!)).toMatchObject({ approved: true, syllables: [5, 7, 5] })
    expect(body.endsWith('event: end\ndata: {}\n\n')).toBe(true)
  } finally {
    await web.close()
    await rm(root, { recursive: true, force: true })
  }
}, 15000)

test('Router canonical records preserve user messages and tool pairs without a native parser', async () => {
  // agent-record liverun-proof-7 on Runtime 2.3.0: three router-tools haiku workers. Their
  // executor retained its conversation. Its progress tail is not a canonical native decoder;
  // the retained ref remains available, and a missing source stays explicit.
  const recorded = join(__dirname, '..', 'fixtures', 'durable', 'router-tools-haiku-run')
  const runId = 'liverun-proof-7'
  const root = await mkdtemp(join(tmpdir(), 'runtime-top-web-router-'))
  const runs = join(root, 'runs')
  const assets = join(root, 'assets')
  await mkdir(assets)
  await writeFile(join(assets, 'workspace-viewer.js'), 'export {};')
  await writeFile(join(assets, 'styles.css'), 'body { color: black; }')
  await cp(recorded, join(runs, runId), { recursive: true })
  const web = await serveTopWeb({ roots: [runs], assets })
  try {
    // haiku-c answered through submit_result; haiku-a answered in plain text, with no tool call.
    const worker = encodeURIComponent(`${runId}:s2`)
    const body = await (await fetch(`${web.url}api/top/agents/0/${runId}/${worker}/stream`)).text()
    const events = body
      .split('\n\n')
      .filter((packet) => packet.startsWith('event: rows'))
      .flatMap(
        (packet) =>
          (
            JSON.parse(packet.split('data: ')[1]!) as {
              events: { event: Record<string, unknown> }[]
            }
          ).events,
      )
      .map(({ event }) => event)
    expect(events.map((event) => event.provenance)).not.toContain('capture-unavailable')
    expect(events.map((event) => event.kind)).toEqual(
      expect.arrayContaining(['user', 'text', 'tool-call', 'tool-result']),
    )
    expect(events.find((event) => event.kind === 'tool-call')).toMatchObject({
      toolName: 'submit_result',
    })
    expect(String(events.find((event) => event.kind === 'text')?.text)).toContain('READY')
    expect(
      (await (await fetch(`${web.url}api/top/agents/0/${runId}/${worker}`)).json()).coverage.status,
    ).toBe('partial')
    // A later attempt must not inherit the old result, transcript or completion time.
    const journal = new FileSpawnJournal(join(runs, runId, 'spawn-journal.jsonl'))
    const prior = (await journal.loadTree(runId))!
    const materialized = prior.find(
      (event) => event.kind === 'materialized' && event.id === `${runId}:s2`,
    )!
    const bound = prior.find(
      (event) => event.kind === 'execution-bound' && event.id === `${runId}:s2`,
    )!
    if (materialized.kind !== 'materialized' || bound.kind !== 'execution-bound')
      throw new Error('Recorded worker lacks its materialization or attempt binding')
    const attemptId = `${bound.binding.attemptId}:reopened`
    await journal.appendEvent(runId, {
      kind: 'spawned',
      id: `${runId}:s2`,
      parent: runId,
      label: 'haiku-c',
      runtime: 'driver',
      budget: { maxIterations: 10, maxTokens: 100000 },
      seq: 100000,
      at: new Date().toISOString(),
    })
    // The kernel reuses the immutable node receipt and publishes only the new binding.
    await appendExactMaterializationEvent(journal, runId, materialized)
    await appendExactMaterializationEvent(journal, runId, {
      ...bound,
      binding: { ...bound.binding, attemptId },
    })
    const selected = async () => {
      const frame = (await (await fetch(`${web.url}api/top`)).json()) as TopSnapshotFrame
      return frame.snapshots[0]!.supervisors[0]!.workers.find(
        (entry) => entry.id === `${runId}:s2`,
      )!
    }
    await expect.poll(async () => (await selected()).status).toBe('running')
    await expect
      .poll(async () => (await selected()).executionBindings?.at(-1)?.attemptId)
      .toBe(attemptId)
    expect((await selected()).materialization).toEqual(materialized.receipt)
    expect(
      (await journal.loadTree(runId))!.filter(
        (event) => event.kind === 'materialized' && event.id === `${runId}:s2`,
      ),
    ).toHaveLength(1)
    for (const key of ['endedAt', 'outRef', 'harnessTranscript', 'transcript'])
      expect(await selected()).not.toHaveProperty(key)
    expect(
      (await (await fetch(`${web.url}api/top/agents/0/${runId}/${worker}`)).json()).coverage.status,
    ).toBe('missing')
    // An authorized later seat publishes a new receipt on the same node, not a new node.
    const profile = agentProfileSchema.parse(
      await new FileResultBlobStore(join(runs, runId, 'blobs')).get(
        materialized.receipt.authoredProfileDigest!,
      ),
    )
    const receipt = knownMaterializationReceipt({
      authoredProfileDigest: materialized.receipt.authoredProfileDigest!,
      runtime: 'driver',
      declaration: {
        authoredProfile: profile,
        effectiveProfile: { ...profile, model: { ...profile.model, default: 'later-seat' } },
        backend: 'recorded-journal-fixture',
        model: { status: 'known', id: 'later-seat' },
        execution: { kind: 'session', id: 'later-seat-session' },
        materializer: 'recorded-journal-fixture',
        plan: { segment: 1 },
      },
    })
    const binding = unknownExecutionBindingReceipt(
      receipt,
      `${attemptId}:seat`,
      'executor-did-not-report',
    )
    await appendExactMaterializationEvent(journal, runId, {
      kind: 'seat-materialized',
      id: `${runId}:s2`,
      segmentIndex: 1,
      receipt,
      seq: 0,
      at: new Date().toISOString(),
    })
    await appendExactMaterializationEvent(journal, runId, {
      ...bound,
      binding,
    })
    await expect
      .poll(async () => (await selected()).executionBindings?.at(-1)?.attemptId)
      .toBe(binding.attemptId)
    expect((await selected()).materialization).toEqual(receipt)
  } finally {
    await web.close()
    await rm(root, { recursive: true, force: true })
  }
}, 15000)
