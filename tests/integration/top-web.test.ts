import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { serveTopWeb, type TopSnapshotFrame } from '../../src/tui/top-web'

test('web and HTTP snapshots reconcile a real workflow journal, reconnect, and close', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-top-web-'))
  const run = join(root, 'workflow')
  const assets = join(root, 'assets')
  await mkdir(run); await mkdir(assets)
  await writeFile(join(run, 'journal.jsonl'), '{"type":"launched"}\n')
  await writeFile(join(assets, 'workspace-viewer.js'), 'export {};')
  await writeFile(join(assets, 'styles.css'), 'body { color: black; }')
  const web = await serveTopWeb({ roots: [run], assets })
  const controller = new AbortController()
  try {
    const page = await fetch(web.url)
    expect(await page.text()).toContain('data-mode="live"')
    expect((await fetch(`${web.url}assets/styles.css`)).status).toBe(200)
    expect((await fetch(`${web.url}api/top`, { headers: { origin: 'https://other.example' } })).status).toBe(403)
    expect((await fetch(`${web.url}api/top`, { method: 'POST' })).status).toBe(405)
    const stream = await fetch(`${web.url}api/top/events`, { signal: controller.signal })
    expect(stream.headers.get('content-type')).toBe('text/event-stream')
    const reader = stream.body!.getReader()
    let text = ''
    const frame = async (): Promise<TopSnapshotFrame> => {
      const deadline = Date.now() + 4000
      while (Date.now() < deadline) {
        const boundary = text.indexOf('\n\n')
        if (boundary !== -1) {
          const packet = text.slice(0, boundary); text = text.slice(boundary + 2)
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
    const at = new Date().toISOString()
    await writeFile(join(run, 'agent-one.jsonl'), JSON.stringify({ type: 'assistant', timestamp: at, message: { role: 'assistant', content: 'Inspecting the work' } }) + '\n')
    const writtenAt = Date.now()
    await appendFile(join(run, 'journal.jsonl'), '{"type":"started","agentId":"one","label":"Research"}\n')
    let updated = await frame()
    while (!updated.snapshots[0]?.supervisors[0]?.workers.length) updated = await frame()
    expect(Date.now() - writtenAt).toBeLessThan(1000)
    const worker = updated.snapshots[0]!.supervisors[0]!.workers[0]!
    expect(worker).toMatchObject({ id: 'one', label: 'Research', status: 'running', startedAt: at })
    expect(worker.liveTail.join('\n')).toContain('Inspecting the work')
    expect(updated.snapshots[0]!.supervisors[0]!.totals.usdKnown).toBe(false)
    await appendFile(join(run, 'journal.jsonl'), '{"type":"result","agentId":"one","result":"Complete"}\n')
    let settled = await frame()
    while (settled.snapshots[0]?.supervisors[0]?.workers[0]?.status !== 'done') settled = await frame()
    expect(settled.sequence).toBeGreaterThan(updated.sequence)
    const current = await (await fetch(`${web.url}api/top`)).json() as TopSnapshotFrame
    expect(current.reset).toBe(true)
    expect(current.snapshots[0]!.supervisors[0]!.workers[0]!.status).toBe('done')
    controller.abort()
    await reader.cancel().catch(() => {})
  } finally {
    controller.abort()
    await web.close()
    await rm(root, { recursive: true, force: true })
  }
}, 15000)
