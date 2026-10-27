import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { startRetainedRun } from '../../src/runtime/retained-run-start'
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
