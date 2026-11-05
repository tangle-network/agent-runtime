import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { expect, it } from 'vitest'
import { providerAsExecutor } from '../../src/runtime/environment-provider/provider-executor-admission'
import type { BudgetReadout } from '../../src/runtime/supervise/budget'
import {
  retainedExecutorContext,
  retainedExecutorSeamKey,
} from '../../src/runtime/supervise/retained-executor'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  ExecutorFactory,
  ExecutorResult,
  SpawnJournal,
} from '../../src/runtime/supervise/types'
import { isAsyncIterable } from '../../src/runtime/util'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { testAgentProfile } from '../kernel/test-agent-profile'

function barrier() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const native = `
const fs = require('node:fs'), http = require('node:http');
fs.writeFileSync('payload.bin', 'io');
const server = http.createServer((request, response) => {
  response.setHeader('content-type', 'application/json'); response.setHeader('connection','close');
  if (request.url === '/usage') return response.end(JSON.stringify({resource:{unit:'bytes', amount:fs.statSync('payload.bin').size, known:process.env.KNOWN === 'true'},usage:{inputTokens:3,outputTokens:2}}));
  if (process.env.REFUSE === 'true') { response.statusCode=409; return response.end(JSON.stringify({error:'physical release refused'})); }
  response.end(JSON.stringify({destroyed:true,pid:process.pid})); server.close();
});
server.listen(0,'127.0.0.1',()=>fs.writeFileSync('native.json',JSON.stringify({port:server.address().port,pid:process.pid})));
`

async function custodyFixture(known: boolean, refuse: boolean) {
  const directory = await mkdtemp(join(tmpdir(), 'recovered-leaf-custody-'))
  const runDir = join(directory, 'run')
  const context = createFileRunContext(runDir)
  const destroying = barrier(),
    allowDestroy = barrier(),
    confirming = barrier(),
    allowConfirmation = barrier()
  let processChild: ChildProcess | undefined
  let address = '',
    nativeStarts = 0,
    injected = false
  const base = durableRetainedProvider(join(directory, 'provider.json'))
  const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
    ...environment,
    session: (id, options) => {
      const session = environment.session!(id, options)
      return {
        ...session,
        result: async () => ({
          ...(await session.result()),
          usage: (await (await fetch(`${address}/usage`)).json()).usage,
        }),
      }
    },
    dispatch: async (input) => {
      nativeStarts++
      processChild = spawn(process.execPath, ['-e', native], {
        cwd: directory,
        env: { ...process.env, KNOWN: String(known), REFUSE: String(refuse) },
        stdio: 'ignore',
      })
      for (let attempt = 0; attempt < 200; attempt++) {
        const receipt = await readFile(join(directory, 'native.json'), 'utf8').catch(
          () => undefined,
        )
        if (receipt) {
          address = `http://127.0.0.1:${JSON.parse(receipt).port}`
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      if (!address) throw new Error('native process did not listen')
      return environment.dispatch!(input)
    },
    destroy: async () => {
      destroying.resolve()
      await allowDestroy.promise
      const response = await fetch(`${address}/destroy`, { method: 'POST' })
      if (!response.ok) throw new Error(`native teardown HTTP${response.status}`)
      expect(await response.json()).toMatchObject({ destroyed: true, pid: processChild!.pid })
      if (processChild!.exitCode === null) await once(processChild!, 'exit')
      await environment.destroy?.()
    },
  })
  const provider: AgentEnvironmentProvider = {
    ...base,
    create: async (input) => wrap(await base.create(input)),
    get: async (id) => {
      const receipt = JSON.parse(await readFile(join(directory, 'native.json'), 'utf8'))
      expect(receipt.pid).toBe(processChild!.pid)
      address = `http://127.0.0.1:${receipt.port}`
      const environment = await base.get!(id)
      return environment ? wrap(environment) : null
    },
  }
  const factory: ExecutorFactory<unknown> = (spec, ctx) => {
    const retained = retainedExecutorContext(ctx)!
    const measured = async (result: ExecutorResult<unknown>) => ({
      ...result,
      spent: {
        ...result.spent,
        resources: { io: (await (await fetch(`${address}/usage`)).json()).resource },
      },
    })
    const inner = providerAsExecutor(provider, { destroyOnSettle: false })(spec, {
      ...ctx,
      seams: {
        ...ctx.seams,
        [retainedExecutorSeamKey]: {
          ...retained,
          onResult: async (result: ExecutorResult<unknown>) =>
            retained.onResult(await measured(result)),
        },
      },
    })
    const execute = inner.execute.bind(inner)
    const recover = inner.recover!.bind(inner)
    const teardown = inner.teardown.bind(inner)
    const finish = async (task: unknown, signal: AbortSignal, recovering = false) => {
      const running = recovering ? recover(task, signal) : execute(task, signal)
      if (!isAsyncIterable(running)) return measured(await running)
      for await (const _event of running) {
        /* The one-shot adapter commits the terminal native receipt. */
      }
      return measured(inner.resultArtifact!())
    }
    // Keep the actual provider executor's private materialization identity while adapting its receipt.
    inner.execute = finish
    inner.recover = (task, signal) => finish(task, signal, true)
    inner.teardown = async (grace) => {
      const result = await teardown(grace)
      return { ...result, permanent: !result.destroyed }
    }
    return inner
  }
  const profile = testAgentProfile('native-custody')
  const worker: Agent<unknown, unknown> = Object.assign(
    {
      name: 'native-custody',
      act: async () => {
        throw new Error('executor required')
      },
    },
    { executorSpec: { profile, harness: profile.harness, executorFactory: factory } },
  )
  const journal: SpawnJournal = {
    beginTree: context.journal.beginTree.bind(context.journal),
    loadTree: context.journal.loadTree.bind(context.journal),
    appendEvent: async (root, event) => {
      if (event.kind === 'teardown-confirmed' && event.id === 'root:s0') {
        confirming.resolve()
        await allowConfirmation.promise
      }
      await context.journal.appendEvent(root, event)
      if (
        !injected &&
        event.kind === 'execution-admitted' &&
        event.admission.phase === 'dispatched'
      ) {
        injected = true
        throw new Error('lost native admission ACK')
      }
    },
  }
  const options = {
    runId: 'root',
    budget: {
      maxIterations: 10,
      maxTokens: 100,
      deadlineMs: 10000,
      resources: { io: { unit: 'bytes', limit: 20 } },
    },
    workerSlots: 1,
    teardownConfirmMs: 0,
    rootIdentity: {
      profileDigest: canonicalCandidateDigest({ name: 'root' }),
      taskDigest: canonicalCandidateDigest('task'),
    },
  }
  return {
    directory,
    runDir,
    context,
    journal,
    factory,
    worker,
    options,
    destroying,
    allowDestroy,
    confirming,
    allowConfirmation,
    forgetVolatileAddress: () => {
      address = ''
    },
    nativeStarts: () => nativeStarts,
    child: () => processChild,
  }
}

it.each([
  { known: true, refuse: false },
  { known: true, refuse: true },
  { known: false, refuse: false },
])(
  'preserves recovered leaf backing through native and journal teardown ACKs ($known, refused=$refuse)',
  async ({ known, refuse }) => {
    const f = await custodyFixture(known, refuse)
    try {
      await expect(
        createSupervisor().run(
          {
            name: 'root',
            act: async (_task, scope) => {
              expect(
                scope.spawn(f.worker, 'task', {
                  key: 'native',
                  budget: {
                    maxIterations: 1,
                    maxTokens: 10,
                    resources: { io: { unit: 'bytes', limit: 8 } },
                  },
                }).ok,
              ).toBe(true)
              await scope.next()
            },
          },
          'task',
          { ...f.context, ...f.options, journal: f.journal },
        ),
      ).rejects.toThrow('durable state unavailable')
      f.forgetVolatileAddress()
      let finalBudget: BudgetReadout | undefined
      let phase = 'before-root'
      let observedBudget: BudgetReadout | undefined
      const result = await createSupervisor().run(
        {
          name: 'root',
          act: async (_task, scope) => {
            phase = 'waiting-for-native-teardown'
            await f.destroying.promise
            phase = 'checking-live-reservation'
            observedBudget = scope.budget
            expect(scope.budget).toMatchObject({
              reservedTokens: 0,
              tokensLeft: 95,
              resources: {
                io: { unit: 'bytes', reserved: known ? 6 : 8, committed: known ? 2 : 12, known },
              },
            })
            expect(f.child()!.exitCode).toBeNull()
            f.allowDestroy.resolve()
            if (!refuse) {
              phase = 'waiting-for-journal-confirmation'
              await f.confirming.promise
              // Physical retirement alone cannot refund backing before Runtime's journal ACK.
              expect(scope.budget.resources?.io?.reserved).toBe(known ? 6 : 8)
              f.allowConfirmation.resolve()
            }
            phase = 'waiting-for-settlement'
            const settled = await scope.next()
            expect(settled?.kind).toBe(known ? 'done' : 'down')
            finalBudget = scope.budget
            expect(finalBudget).toMatchObject({
              reservedTokens: 0,
              tokensLeft: 95,
              resources: {
                io: {
                  reserved: known && !refuse ? 0 : known ? 6 : 8,
                  committed: known ? 2 : 12,
                  known,
                },
              },
            })
            return 'observed'
          },
        },
        'task',
        {
          ...createFileRunContext(f.runDir),
          ...f.options,
          journal: f.journal,
          recoverExecutor: f.factory,
        },
      )
      if (known) {
        expect(result.kind).toBe('winner')
        expect(result.spentTotal.resources?.io).toEqual({ unit: 'bytes', amount: 2, known: true })
      } else expect(result.spentTotal.resources?.io?.known).toBe(false)
      expect(finalBudget, JSON.stringify({ phase, observedBudget, result })).toBeDefined()
      expect(f.nativeStarts()).toBe(1)
      const events = (await f.context.journal.loadTree('root'))!
      expect(
        events.filter((event) => event.kind === 'execution-result' && event.id === 'root:s0'),
      ).toMatchObject([{ spent: { resources: { io: { unit: 'bytes', amount: 2, known } } } }])
      expect(
        events.filter((event) => event.kind === 'execution-input' && event.id === 'root:s0'),
      ).toHaveLength(1)
      expect(
        events.filter((event) => event.kind === 'teardown-confirmed' && event.id === 'root:s0'),
      ).toHaveLength(refuse ? 0 : 1)
      let coldBudget: BudgetReadout | undefined
      const coldResult = await createSupervisor().run(
        {
          name: 'root',
          act: async (_task, scope) => {
            coldBudget = scope.budget
            return 'cold'
          },
        },
        'task',
        { ...createFileRunContext(f.runDir), ...f.options },
      )
      if (known)
        expect(coldResult.spentTotal.resources?.io).toEqual({
          unit: 'bytes',
          amount: 2,
          known: true,
        })
      expect(coldBudget).toMatchObject({
        reservedTokens: 0,
        tokensLeft: 95,
        // Once physical custody is gone, unknown past remains an irreversible conservative
        // debit on cold restore. It must not reopen capacity or masquerade as measured usage.
        resources: known
          ? finalBudget!.resources
          : {
              io: {
                unit: 'bytes',
                limit: 20,
                remaining: 0,
                reserved: 0,
                committed: 20,
                known: false,
              },
            },
      })
      expect(coldBudget!.resources!.io!.committed + coldBudget!.resources!.io!.reserved).toBe(
        finalBudget!.resources!.io!.committed + finalBudget!.resources!.io!.reserved,
      )
      expect(f.nativeStarts()).toBe(1)
    } finally {
      f.allowDestroy.resolve()
      f.allowConfirmation.resolve()
      f.child()?.kill('SIGKILL')
      await rm(f.directory, { recursive: true, force: true })
    }
  },
  20000,
)
