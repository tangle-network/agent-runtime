import { appendFile, cp, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, test } from 'vitest'
import { nodeStreamFile } from '../../src/runtime/supervise/root-stream'
import { serveTopWeb, type TopSnapshotFrame } from '../../src/tui/top-web'

test('HTTP snapshots retain full recorded activity across every journal adapter and live append', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-top-activity-'))
  const assets = join(root, 'assets')
  const workspace = join(root, 'workspace')
  const legacy = join(workspace, '.agent', 'supervisor', 'legacy')
  const native = join(root, 'native')
  const durable = join(root, 'durable')
  const journal = join(root, 'journal')
  const recorded = join(__dirname, '..', 'fixtures', 'durable', 'supervised-nested-turns')
  const iso = (at: number) => new Date(at).toISOString()
  const progress = (at: number, kind = 'text_delta') =>
    JSON.stringify({ at: iso(at), event: { kind, text: 'Recorded output' } }) + '\n'
  const noise = Array.from({ length: 12 }, () => progress(9_000_000, 'heartbeat')).join('')
  const history = [0, 0, 100, 1100].map((at) => progress(at)).join('') + noise
  await mkdir(assets)
  await mkdir(join(legacy, 'workers'), { recursive: true })
  await mkdir(native)
  await cp(recorded, durable, { recursive: true })
  await mkdir(journal)
  await cp(join(recorded, 'spawn-journal.jsonl'), join(journal, 'spawn-journal.jsonl'))
  await writeFile(join(assets, 'workspace-viewer.js'), 'export {};')
  await writeFile(join(assets, 'styles.css'), '')
  await writeFile(
    join(legacy, 'state.json'),
    JSON.stringify({
      id: 'legacy',
      status: 'running',
      task: 'Recorded run',
      workspaceDir: workspace,
      budget: 0,
    }),
  )
  await writeFile(
    join(legacy, 'spawn-journal.jsonl'),
    [
      { kind: 'spawned', id: 'worker', label: 'worker', at: iso(0) },
      {
        kind: 'settled',
        id: 'worker',
        status: 'down',
        at: iso(2000),
        reason: 'Exact child failure',
      },
      { kind: 'spawned', id: 'unknown', label: 'unknown', at: iso(0) },
      {
        kind: 'settled',
        id: 'unknown',
        status: 'down',
        at: iso(2000),
        verdict: 'Not a failure cause',
      },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n') + '\n',
  )
  const files: string[] = [join(legacy, 'workers', 'worker.ndjson')]
  await writeFile(files[0]!, history)
  // A down-leg instruction is not evidence that an executor emitted progress.
  await writeFile(join(legacy, 'workers', 'unknown.inbox.ndjson'), progress(8_000_000))
  for (const dir of [durable, journal]) {
    const file = join(dir, nodeStreamFile('liverun-proof-2:s0'))
    await mkdir(dirname(file), { recursive: true })
    await mkdir(join(dir, 'workers'), { recursive: true })
    await writeFile(file, history)
    await writeFile(join(dir, 'workers', 'haiku-a.ndjson'), progress(8_000_000))
    files.push(file)
  }
  await writeFile(
    join(native, 'journal.jsonl'),
    '{"type":"started","agentId":"one","label":"Recorded native agent"}\n',
  )
  const nativeFile = join(native, 'agent-one.jsonl')
  const nativeRow = (at: number) =>
    JSON.stringify({
      timestamp: iso(at),
      message: { role: 'assistant', content: 'Native output' },
    }) + '\n'
  await writeFile(
    nativeFile,
    [0, 0, 100, 1100].map(nativeRow).join('') +
      Array.from({ length: 12 }, () =>
        JSON.stringify({ type: 'attachment', timestamp: iso(9_000_000) }),
      ).join('\n') +
      '\n',
  )
  for (const dir of [legacy, durable, journal])
    await writeFile(
      join(dir, 'root-stream.jsonl'),
      [0, 100, 600].map((at) => progress(at)).join('') + noise,
    )
  const web = await serveTopWeb({ roots: [workspace, durable, journal, native], assets })
  const snapshot = async () => (await (await fetch(`${web.url}api/top`)).json()) as TopSnapshotFrame
  const selected = (frame: TopSnapshotFrame) =>
    frame.snapshots.map(
      (snap, i) =>
        snap.supervisors[0]!.workers.find(
          (worker) => worker.id === (i === 0 ? 'worker' : i === 3 ? 'one' : 'liverun-proof-2:s0'),
        )!,
    )
  try {
    const initial = await snapshot()
    for (const worker of selected(initial)) {
      expect(worker).toMatchObject({ lastActivityAt: 1100, medianEventGapMs: 100 })
      expect(worker.liveTail.length).toBeLessThanOrEqual(8)
    }
    for (const snap of initial.snapshots.slice(0, 3))
      expect(snap.supervisors[0]).toMatchObject({ lastActivityAt: 600, medianEventGapMs: 300 })
    expect(initial.snapshots[3]!.supervisors[0]).not.toHaveProperty('lastActivityAt')
    const legacyWorkers = initial.snapshots[0]!.supervisors[0]!.workers
    expect(legacyWorkers.find((worker) => worker.id === 'worker')!.reason).toBe(
      'Exact child failure',
    )
    expect(legacyWorkers.find((worker) => worker.id === 'unknown')).not.toHaveProperty(
      'lastActivityAt',
    )
    expect(legacyWorkers.find((worker) => worker.id === 'unknown')).not.toHaveProperty('reason')
    // Touching the file and appending transport/metadata rows cannot reset the activity clock.
    for (const file of [...files, nativeFile]) await utimes(file, new Date(), new Date())
    for (const file of files) await appendFile(file, progress(10_000_000, 'awaiting-result'))
    // A torn append stays invisible until its newline commits; UTF-8 can split between writes.
    for (const file of files) await appendFile(file, progress(2200).trimEnd())
    await appendFile(nativeFile, nativeRow(2200).trimEnd())
    for (const worker of selected(await snapshot()))
      expect(worker).toMatchObject({ lastActivityAt: 1100, medianEventGapMs: 100 })
    for (const file of [...files, nativeFile]) await appendFile(file, '\n')
    let updated: TopSnapshotFrame | undefined
    const deadline = Date.now() + 3000
    do {
      updated = await snapshot()
      if (
        selected(updated).every(
          (worker) => (worker as unknown as { lastActivityAt?: number }).lastActivityAt === 2200,
        )
      )
        break
      await new Promise((resolve) => setTimeout(resolve, 20))
    } while (Date.now() < deadline)
    for (const worker of selected(updated!))
      expect(worker).toMatchObject({ lastActivityAt: 2200, medianEventGapMs: 550 })
    // Replacement/truncation starts a new recorded stream, including a real epoch-zero instant.
    for (const file of files) await writeFile(file, progress(0) + progress(0))
    await writeFile(nativeFile, nativeRow(0) + nativeRow(0))
    const resetDeadline = Date.now() + 3000
    do {
      updated = await snapshot()
      if (
        selected(updated).every(
          (worker) => (worker as unknown as { lastActivityAt?: number }).lastActivityAt === 0,
        )
      )
        break
      await new Promise((resolve) => setTimeout(resolve, 20))
    } while (Date.now() < resetDeadline)
    for (const worker of selected(updated!))
      expect(worker).toMatchObject({ lastActivityAt: 0, medianEventGapMs: 0 })
    expect(await readFile(files[1]!, 'utf8')).toBe(progress(0) + progress(0))
  } finally {
    await web.close()
    await rm(root, { recursive: true, force: true })
  }
}, 15000)
