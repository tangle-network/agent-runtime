import { fork } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { FileObserverJournal } from '../../src/durable/observer-journal'
import { interactiveControlServer, ref } from '../helpers/interactive-control-network'

async function client(endpoint: string, journalRoot: string) {
  const child = fork(new URL('../helpers/interactive-control-child.ts', import.meta.url), [], {
    execArgv: ['--import', 'tsx'],
    env: { ...process.env, CONTROL_ENDPOINT: endpoint, CONTROL_JOURNAL_ROOT: journalRoot },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  let readyResolve!: () => void
  let readyReject!: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  const pending = new Map<
    number,
    { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }
  >()
  let id = 0
  child.on(
    'message',
    (message: {
      ready?: boolean
      id?: number
      error?: string
      result: Record<string, unknown>
    }) => {
      if (message.ready) {
        readyResolve()
        return
      }
      const waiter = pending.get(message.id ?? -1)
      pending.delete(message.id ?? -1)
      if (message.error) waiter?.reject(new Error(message.error))
      else waiter?.resolve(message.result)
    },
  )
  const exit = once(child, 'exit')
  child.on('exit', () => {
    const error = new Error(`control process exited: ${stderr}`)
    readyReject(error)
    for (const waiter of pending.values()) waiter.reject(error)
    pending.clear()
  })
  await ready
  return {
    request: (action: string, operationId = `op-${action}-${++id}`, prompt?: string) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const correlation = ++id
        pending.set(correlation, { resolve, reject })
        child.send({ id: correlation, action, operationId, prompt })
      }),
    kill: async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await exit
    },
  }
}

it('delegates the real holder lease across processes without changing terminal input/resize, and repairs replayed turns', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-delegation-'))
  const server = await interactiveControlServer()
  const children: Awaited<ReturnType<typeof client>>[] = []
  const open = async (scope = join(root, 'journal')) => {
    const value = await client(server.endpoint, scope)
    children.push(value)
    return value
  }
  try {
    const owner = await open()
    const offered = await owner.request('offer')
    const originalGeneration = server.generation()
    await expect(owner.request('offer-unscoped')).rejects.toThrow('journal scope')
    expect(server.generation()).toBe(originalGeneration)
    const control = await open()
    await expect(control.request('invalid-generation')).rejects.toThrow('non-negative integer')
    const accepted = await control.request('steer', 'steer-once', 'inspect once')
    expect(accepted).toMatchObject({
      status: 'accepted',
      generation: originalGeneration,
      holderId: offered.holderId,
    })
    const replay = await open()
    expect(await replay.request('steer', 'steer-once', 'inspect once')).toMatchObject({
      status: 'replayed',
      generation: originalGeneration,
    })
    await owner.request('terminal')
    expect(server.writes).toEqual(['still attached'])
    expect(server.sizes).toEqual([{ cols: 120, rows: 40 }])
    expect(server.generation()).toBe(originalGeneration)
    await Promise.all([
      control.request('steer', 'parallel-a', 'A'),
      replay.request('steer', 'parallel-b', 'B'),
    ])
    await expect(
      control.request('cancelled-steer', 'cancelled', 'never delivered'),
    ).rejects.toThrow('cancelled')
    expect(server.prompts.has('cancelled')).toBe(false)
    const wrongScope = await open(join(root, 'other-journal'))
    await expect(wrongScope.request('steer', 'wrong-scope')).rejects.toThrow('non-advancing')
    const privateRoot = join(root, '.agent-runtime-control')
    const scope = (
      await Promise.all(
        (
          await readdir(privateRoot)
        ).map(async (entry) =>
          readFile(join(privateRoot, entry, 'delegation.json')).then(
            () => entry,
            () => undefined,
          ),
        ),
      )
    ).find(Boolean)
    expect(scope).toBeTruthy()
    const grant = join(privateRoot, scope!, 'delegation.json')
    const publication = join(privateRoot, scope!, 'publication.jsonl')
    await chmod(publication, 0o400)
    await expect(owner.request('offer')).rejects.toThrow()
    expect(server.generation()).toBe(originalGeneration)
    await chmod(publication, 0o600)
    const saved = await readFile(grant, 'utf8')
    await chmod(grant, 0o644)
    await expect(replay.request('steer', 'unsafe-grant')).rejects.toThrow('private')
    await chmod(grant, 0o600)
    await writeFile(grant, saved.replace(/"refDigest":"[^"]+"/u, '"refDigest":"sha256:wrong"'), {
      mode: 0o600,
    })
    await expect(replay.request('steer', 'wrong-ref')).rejects.toThrow('another process')
    await writeFile(grant, saved, { mode: 0o600 })
    const crashing = await open()
    await expect(
      crashing.request('crash-after-prompt', 'lost-ack', 'delivered before death'),
    ).rejects.toThrow('exited')
    expect(server.prompts.has('lost-ack')).toBe(true)
    expect(await replay.request('steer', 'lost-ack', 'delivered before death')).toMatchObject({
      status: 'replayed',
    })
    const journalPath = join(root, 'journal', ref.run.sessionId, 'observer.jsonl')
    const records = await new FileObserverJournal(journalPath, ref.run.sessionId).read()
    const turns = records
      .filter((record) => record.event?.target === 'agent.turn')
      .map((record) => record.event?.payload?.operationId)
    expect(turns.sort()).toEqual(['lost-ack', 'parallel-a', 'parallel-b', 'steer-once'])
    expect(server.prompts.size).toBe(4)
    expect(await readFile(journalPath, 'utf8')).not.toContain(String(offered.holderId))
    await owner.request('detach')
    await expect(readFile(grant)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await replay.request('stop', 'stop-exact')).toMatchObject({ status: 'accepted' })
  } finally {
    await Promise.all(children.map((child) => child.kill()))
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)

it('does not delegate a dead owner even while its old provider lease remains active', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-delegation-death-'))
  const server = await interactiveControlServer()
  let owner: Awaited<ReturnType<typeof client>> | undefined
  let reader: Awaited<ReturnType<typeof client>> | undefined
  try {
    owner = await client(server.endpoint, join(root, 'journal'))
    await owner.request('offer')
    await owner.kill()
    reader = await client(server.endpoint, join(root, 'journal'))
    await expect(reader.request('steer', 'after-owner-death')).rejects.toThrow('non-advancing')
    expect(server.prompts.size).toBe(0)
  } finally {
    await owner?.kill()
    await reader?.kill()
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

it('hands off expired leases with the old owner alive, fences stale close, and revokes on delegated stop', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-delegation-handoff-'))
  const server = await interactiveControlServer()
  const children: Awaited<ReturnType<typeof client>>[] = []
  const open = async () => {
    const value = await client(server.endpoint, join(root, 'journal'))
    children.push(value)
    return value
  }
  try {
    const old = await open()
    const first = await old.request('offer')
    server.expire()
    const successor = await open()
    const second = await successor.request('offer')
    expect(Number(second.generation)).toBeGreaterThan(Number(first.generation))
    const reader = await open()
    expect(await reader.request('steer', 'successor')).toMatchObject({ holderId: second.holderId })
    const barrier = server.pauseDetach()
    const closing = successor.request('detach')
    await barrier.released
    const newest = await open()
    const third = await newest.request('offer')
    barrier.resume()
    await closing
    expect(await reader.request('steer', 'after-stale-close')).toMatchObject({
      holderId: third.holderId,
    })
    const renewalBarrier = server.pauseDetach()
    const staleClosing = newest.request('detach')
    await renewalBarrier.released
    const renewed = await newest.request('offer')
    renewalBarrier.resume()
    await staleClosing
    expect(await reader.request('steer', 'after-same-handle-renewal')).toMatchObject({
      generation: renewed.generation,
    })
    await newest.request('terminal')
    expect(await reader.request('stop', 'delegated-stop')).toMatchObject({ status: 'accepted' })
    const [scope] = (await readdir(join(root, '.agent-runtime-control'))).filter(
      (entry) => entry.length === 64,
    )
    await expect(
      readFile(join(root, '.agent-runtime-control', scope!, 'delegation.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await newest.request('status')
    await expect(
      readFile(
        join(root, '.agent-runtime-control', scope!, String(renewed.generation), 'supervise.lock'),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await Promise.all(children.map((child) => child.kill()))
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)

it('accepts before the first offer without poisoning the private publication writer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-delegation-order-'))
  const server = await interactiveControlServer()
  let reader: Awaited<ReturnType<typeof client>> | undefined
  let owner: Awaited<ReturnType<typeof client>> | undefined
  try {
    reader = await client(server.endpoint, join(root, 'journal'))
    expect(await reader.request('steer', 'before-offer')).toMatchObject({ status: 'accepted' })
    server.expire()
    owner = await client(server.endpoint, join(root, 'journal'))
    const offered = await owner.request('offer')
    expect(await reader.request('steer', 'after-first-offer')).toMatchObject({
      status: 'accepted',
      generation: offered.generation,
      holderId: offered.holderId,
    })
    await owner.request('terminal')
  } finally {
    await owner?.kill()
    await reader?.kill()
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
