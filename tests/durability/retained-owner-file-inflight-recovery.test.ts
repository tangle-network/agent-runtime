import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { expect, it } from 'vitest'
import {
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
} from '../../src/durable/in-memory-spawn-stores'
import { providerAsExecutor } from '../../src/runtime/environment-provider/provider-executor-admission'
import { retainedExecutorSeamKey } from '../../src/runtime/supervise/retained-executor'
import {
  bindScopeRetainedOwnerProvider,
  prepareScopeRetainedOwnerTask,
  registerScopeRetainedOwner,
  scopeRetainedOwnerContext,
} from '../../src/runtime/supervise/retained-scope-owner'
import type { Scope, SpawnJournal } from '../../src/runtime/supervise/types'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'

const ROOT = 'root'
const OWNER = 'owner'

const profile: AgentProfile = {
  name: 'file-owner',
  harness: 'opencode',
  model: { provider: 'fixture', default: 'fixture/model' },
  outputFile: { name: 'report', path: 'report.txt' },
}

class ProcessCrash extends Error {}

/** The durable test provider with exact retained-file publication declared. */
function fileProvider(stateFile: string, dispatched: string[]): AgentEnvironmentProvider {
  const base = durableRetainedProvider(stateFile)
  const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
    ...environment,
    async dispatch(input) {
      dispatched.push(input.executionId ?? '?')
      return environment.dispatch!(input)
    },
    async retainFileOutput() {
      return { status: 'unavailable', reason: 'no submission asked for the file' }
    },
  })
  return {
    ...base,
    async capabilities() {
      const capabilities = await base.capabilities()
      return { ...capabilities, workspace: { ...capabilities.workspace, retainFileOutput: true } }
    },
    async create(input) {
      return wrap(await base.create(input))
    },
    async get(id) {
      const environment = await base.get!(id)
      return environment ? wrap(environment) : null
    },
  }
}

/** One coordinator process for the owner; `crashAfterDispatch` ends it once the run is sent. */
async function runProcess(
  journal: SpawnJournal,
  blobs: InMemoryResultBlobStore,
  provider: AgentEnvironmentProvider,
  crashAfterDispatch: boolean,
): Promise<void> {
  const controller = new AbortController()
  const scope = { signal: controller.signal } as unknown as Scope<unknown>
  const durable: SpawnJournal = {
    loadTree: (root) => journal.loadTree(root),
    beginTree: (root, at) => journal.beginTree(root, at),
    async appendEvent(root, event) {
      await journal.appendEvent(root, event)
      if (
        crashAfterDispatch &&
        event.kind === 'execution-admitted' &&
        event.admission.phase === 'dispatched'
      ) {
        const crash = new ProcessCrash('process crashed after its dispatch was durable')
        controller.abort(crash)
        throw crash
      }
    },
  }
  registerScopeRetainedOwner(scope, {
    rootId: ROOT,
    nodeId: OWNER,
    journal: durable,
    blobs,
    priorEvents: (await journal.loadTree(ROOT)) ?? [],
    now: () => 0,
  })
  bindScopeRetainedOwnerProvider(scope, provider)
  const context = scopeRetainedOwnerContext(scope)!
  // A restarted coordinator re-enters through the same preparation the driver uses.
  const task = await prepareScopeRetainedOwnerTask(scope, 'write the report').catch(
    (error: unknown) => {
      throw new Error('prepare refused', { cause: error })
    },
  )
  const executor = providerAsExecutor(provider, { destroyOnSettle: false })(
    { profile, harness: 'opencode' },
    {
      signal: controller.signal,
      node: { rootId: ROOT, parentId: OWNER, nodeId: OWNER },
      seams: { [retainedExecutorSeamKey]: context },
    },
  )
  const run =
    context.admissions.length > 0 && executor.recover
      ? executor.recover(task, controller.signal)
      : executor.execute(task, controller.signal)
  for await (const _event of run) {
    // Consume the production provider executor through its result or failure.
  }
}

it('reconnects an in-flight file-mode owner turn after a coordinator restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'retained-owner-file-recovery-'))
  try {
    const journal = new InMemorySpawnJournal()
    const at = new Date(0).toISOString()
    await journal.beginTree(ROOT, at)
    await journal.appendEvent(ROOT, {
      kind: 'spawned',
      id: OWNER,
      parent: ROOT,
      label: OWNER,
      runtime: 'cli',
      budget: { maxIterations: 1_000, maxTokens: 1_000_000 },
      seq: 0,
      at,
    })
    const blobs = new InMemoryResultBlobStore()
    const dispatched: string[] = []
    const provider = fileProvider(join(directory, 'provider.json'), dispatched)
    const first = await runProcess(journal, blobs, provider, true).then(
      () => undefined,
      (error: unknown) => error,
    )
    // The executor reports the lost process as pending work; its cause is the crash.
    const causes: unknown[] = []
    for (let error = first; error instanceof Error; error = error.cause) causes.push(error)
    expect(causes.some((error) => error instanceof ProcessCrash), String(first)).toBe(true)
    expect(dispatched).toHaveLength(1)
    // The restart observes the same native run again: no file custody proof is owed for it yet.
    await runProcess(journal, blobs, provider, false).catch((error: unknown) => {
      const chain: string[] = []
      for (let e = error; e instanceof Error; e = e.cause) chain.push(`${e.name}: ${e.message}`)
      expect.fail(`restart refused the in-flight file turn: ${chain.join(' <- ')}`)
    })
    expect(dispatched).toHaveLength(1)
    const events = ((await journal.loadTree(ROOT)) ?? []).filter((event) => event.id === OWNER)
    expect(events.filter((event) => event.kind === 'execution-input')).toHaveLength(1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
