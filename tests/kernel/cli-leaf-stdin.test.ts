import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { withDriverExecutor } from '../../src/runtime/supervise/driver-executor'
import { createExecutor } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  ExecutorFactory,
  ExecutorRegistry,
  Scope,
} from '../../src/runtime/supervise/types'
import { testAgentProfile } from './test-agent-profile'

/** A child that closes its stdin before reading a byte, then prints and exits 0. */
const CLOSE_STDIN_THEN_PRINT = [
  '-e',
  "require('node:fs').closeSync(0); setTimeout(() => process.stdout.write('ok'), 300)",
]

/** Resolve every non-driver child to the raw `cli` executor, so the scope-seeded seam is used. */
function registryOf(factory: ExecutorFactory<unknown>): ExecutorRegistry {
  return withDriverExecutor({
    register(): void {
      throw new Error('registryOf: registration is not part of this case')
    },
    resolve<Out>() {
      return { succeeded: true as const, value: factory as unknown as ExecutorFactory<Out> }
    },
  })
}

describe('raw cli leaf task delivery', () => {
  it('settles a child that closes stdin before reading the task on its exit code, not on EPIPE', async () => {
    // The task is larger than a pipe buffer, so the write cannot complete before the child closes
    // its read end; the kernel then answers the rest of the write with EPIPE. Node raises that as
    // an `'error'` on the stdin stream, and a stream with no listener turns it into an uncaught
    // exception — which took down a full serialized kernel run once on 2026-09-11 after every
    // test in it had passed. A closed read end is not this leaf's failure: the child's exit code
    // is the verdict.
    const uncaught: unknown[] = []
    const onUncaught = (error: unknown) => {
      uncaught.push(error)
    }
    process.on('uncaughtException', onUncaught)
    try {
      const leaf = {
        name: 'printer',
        executorSpec: { profile: testAgentProfile('printer'), harness: null },
        act: () => Promise.resolve(undefined),
      } as unknown as Agent<unknown, unknown>
      const root: Agent<unknown, unknown> = {
        name: 'root',
        async act(task, scope: Scope<unknown>): Promise<unknown> {
          const spawned = scope.spawn(leaf, task, {
            budget: { maxIterations: 8, maxTokens: 5_000 },
            label: 'printer',
          })
          if (!spawned.ok) throw new Error(`spawn refused: ${spawned.reason}`)
          const settled = await scope.next()
          return settled?.kind === 'done' ? settled.out : undefined
        },
      }
      const result = await createSupervisor<unknown, unknown>().run(root, 'x'.repeat(2 << 20), {
        budget: { maxIterations: 100, maxTokens: 100_000 },
        runId: 'cli-stdin-closed',
        journal: new InMemorySpawnJournal(),
        blobs: new InMemoryResultBlobStore(),
        executors: registryOf(
          createExecutor({ backend: 'cli', bin: process.execPath, args: CLOSE_STDIN_THEN_PRINT }),
        ),
        maxDepth: 4,
      })
      expect(result.kind).toBe('winner')
      if (result.kind === 'winner') expect(result.out).toEqual({ content: 'ok' })
      expect(uncaught).toEqual([])
    } finally {
      process.off('uncaughtException', onUncaught)
    }
  })
})
