import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { contentAddress } from '../../src/durable/content-address'
import { FileSpawnJournal } from '../../src/durable/spawn-journal/journal-store'
import { FileResultBlobStore } from '../../src/durable/spawn-journal/result-blob-store'
import type { CoordinationEvent } from '../../src/mcp/tools/coordination-events'
import { runSettledCommand } from '../../src/mcp/worktree-harness'
import { serveCoordinationMcpForManager } from '../../src/runtime/supervise/coordination-mcp'
import { driverChild, withDriverExecutor } from '../../src/runtime/supervise/driver-executor'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Agent } from '../../src/runtime/supervise/types'
import { jsonRpc, wakeInput } from '../helpers/coordination-http'
import { testAgentProfile } from '../kernel/test-agent-profile'

it('delivers a same-process keyed completion once after observing its durable result over MCP', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coordination-eager-'))
  const journalPath = join(directory, 'spawn-journal.jsonl')
  let releaseTerminal!: () => void
  const heldTerminal = new Promise<void>((resolve) => {
    releaseTerminal = resolve
  })
  let terminalWritten!: () => void
  const writtenTerminal = new Promise<void>((resolve) => {
    terminalWritten = resolve
  })
  class PublicationBarrierJournal extends FileSpawnJournal {
    override async appendEvent(
      ...args: Parameters<FileSpawnJournal['appendEvent']>
    ): Promise<void> {
      await super.appendEvent(...args)
      if (args[1].kind === 'settled' && args[1].id === 'observe-pending:s1') {
        terminalWritten()
        await heldTerminal
      }
    }
  }
  let published!: () => void
  const publication = new Promise<void>((resolve) => {
    published = resolve
  })
  const journal = new PublicationBarrierJournal(journalPath)
  const blobs = new FileResultBlobStore(join(directory, 'blobs'))
  const executions = join(directory, 'executions')
  const profile = testAgentProfile('quick')
  const budget = { maxIterations: 4, maxTokens: 1000 }
  const child = driverChild(
    profile,
    {
      name: 'quick',
      async act(_task, scope) {
        const result = await runSettledCommand({
          command: process.execPath,
          args: [
            '-e',
            `require('node:fs').appendFileSync(process.argv[1], 'executed\\n'); process.stdout.write('checked result')`,
            executions,
          ],
          cwd: directory,
          timeoutMs: 5000,
          signal: scope.signal,
        })
        if (result.exitCode !== 0) throw new Error(result.stderr)
        return result.stdout
      },
    },
    journal,
  )
  const sourceProfile = testAgentProfile('source')
  const source = driverChild(
    sourceProfile,
    { name: 'source', act: async () => ({ items: ['go'] }) },
    journal,
  )
  const joinChild = driverChild(
    testAgentProfile('join'),
    { name: 'join', act: async () => 'joined' },
    journal,
  )
  const root: Agent<unknown, unknown> = {
    name: 'poller',
    async act(_task, scope) {
      const events: CoordinationEvent[] = []
      const { handle: mcp, controls } = await serveCoordinationMcpForManager({
        scope,
        blobs,
        perWorker: budget,
        makeWorkerAgent: (profile) =>
          profile.name === 'source' ? source : profile.name === 'quick' ? child : joinChild,
        toolNames: ['spawn_worker', 'observe_agent'],
        authentication: true,
        mapOnSettle: [
          {
            edge: 'checked',
            from: 'source',
            pointer: '/items',
            item: { profile },
            join: testAgentProfile('join'),
            maxItems: 1,
            concurrency: 1,
            onItemFailure: 'settled-subset',
          },
        ],
        onEvent: (event) => {
          events.push(event)
        },
      })
      scope.signal.addEventListener('abort', published, { once: true })
      const coldJournal = new FileSpawnJournal(journalPath)
      const terminalCount = async (id: string) =>
        ((await coldJournal.loadTree('observe-pending')) ?? []).filter(
          (event) => event.kind === 'settled' && event.id === id,
        ).length
      try {
        const started = await jsonRpc(
          mcp.url,
          'tools/call',
          {
            name: 'spawn_worker',
            arguments: { profile: sourceProfile, task: 'find' },
          },
          mcp.headers,
        )
        const sourceId = JSON.parse(started.result.content[0].text).workerId
        await expect.poll(() => terminalCount(sourceId), { timeout: 5000 }).toBe(1)
        const spawned = scope.spawn(child, 'go', {
          budget,
          label: 'quick#0',
          key: 'map:checked#1:0',
          assignmentId: 'key:map:checked#1:0',
        })
        if (!spawned.ok) throw new Error(`spawn refused: ${spawned.reason}`)
        const workerId = spawned.handle.id
        await expect.poll(() => terminalCount(workerId), { timeout: 5000 }).toBe(1)
        const observe = async () =>
          JSON.parse(
            (
              await jsonRpc(
                mcp.url,
                'tools/call',
                {
                  name: 'observe_agent',
                  arguments: { workerId },
                },
                mcp.headers,
              )
            ).result.content[0].text,
          ) as Record<string, unknown>
        await writtenTerminal
        expect(mcp.settled()).toEqual([])
        const observed = await observe()
        await writeFile(join(directory, 'observed-before-ack.json'), JSON.stringify(observed))
        expect(observed).toMatchObject({ status: 'running', outRef: null, output: null })
        expect(observed).not.toHaveProperty('settlementPending')
        expect(await blobs.get(contentAddress('checked result'))).toBe('checked result')
        releaseTerminal()
        await publication
        scope.signal.throwIfAborted()
        expect(mcp.settled()).toEqual([])
        expect(await observe()).toMatchObject({
          status: 'done',
          output: 'checked result',
          settlementPending: { kind: 'done' },
        })
        for (let wake = 0; wake < 3 && mcp.settled().length < 3; wake++) {
          await controls.awaitWake(wakeInput())
        }
        expect(mcp.settled()).toHaveLength(3)
        expect(await mcp.drainResolved()).toBe(0)
        expect(await observe()).not.toHaveProperty('settlementPending')
        expect(
          events.filter((event) => event.type === 'settled' && event.worker.id === workerId),
        ).toHaveLength(1)
        expect(
          events.filter((event) => event.type === 'map' && event.map.phase === 'join'),
        ).toHaveLength(1)
        expect(await readFile(executions, 'utf8')).toBe('executed\n')
        expect(await terminalCount(workerId)).toBe(1)
        return 'checked result'
      } finally {
        scope.signal.removeEventListener('abort', published)
        releaseTerminal()
        await mcp.close()
      }
    },
  }
  let passed = false
  try {
    const result = await createSupervisor<unknown, unknown>().run(root, 'poll', {
      budget: { maxIterations: 100, maxTokens: 100_000, deadlineMs: 10000 },
      runId: 'observe-pending',
      journal,
      blobs,
      executors: withDriverExecutor(createExecutorRegistry()),
      hooks: {
        onEvent(event) {
          if (
            event.target === 'agent.child' &&
            event.phase === 'after' &&
            event.id === 'observe-pending:s1:settled'
          )
            published()
        },
      },
    })
    await writeFile(join(directory, 'parent-result.json'), JSON.stringify(result))
    expect(result.kind, JSON.stringify(result)).toBe('winner')
    passed = true
  } finally {
    releaseTerminal()
    if (passed) await rm(directory, { recursive: true, force: true })
    else console.error('Keyed publication proof artifacts:', directory)
  }
})
