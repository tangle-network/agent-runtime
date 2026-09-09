import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, describe, expect, it } from 'vitest'
import { providerAsExecutor } from '../../src/runtime/environment-provider'
import type { ProviderPlacement } from '../../src/runtime/provider-placement'
import type { RetainedRunAdmission } from '../../src/runtime/retained-run-types'
import {
  type RetainedExecutorContext,
  retainedExecutorSeamKey,
} from '../../src/runtime/supervise/retained-executor'
import type { ExecutorContext } from '../../src/runtime/supervise/types'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const profile: AgentProfile = {
  name: 'placed-worker',
  harness: 'opencode',
  model: { provider: 'fixture', default: 'fixture/model' },
}
const placement: ProviderPlacement = {
  id: 'opencode-seat',
  match: { harness: 'opencode', provider: 'fixture', model: 'fixture/model' },
  create: {
    backend: 'opencode',
    secrets: ['opencode-credential'],
    env: { SEAT_TOKEN: 'credential-v1' },
    resources: { cpu: 2 },
    providerOptions: { region: 'us-east' },
  },
  promptOptions: { backend: { type: 'opencode', model: { apiKeyEnv: 'SEAT_TOKEN' } } },
}

describe('provider placement retained restart', () => {
  it('reconstructs admissions and provider state, then reconnects without another create or dispatch', async () => {
    const fixture = await interruptAfterDispatch()
    const executor = await fixture.recover(structuredClone(placement))
    expect(executor.resultArtifact().out).toMatchObject({ content: 'durable result' })
    expect(fixture.counts).toMatchObject({ creates: 1, dispatches: 1 })
    expect(fixture.counts.gets).toBeGreaterThan(0)
  })

  it.each([
    [
      'identity',
      (changed: ProviderPlacement) => {
        changed.id = 'other-seat'
      },
    ],
    [
      'public provider configuration',
      (changed: ProviderPlacement) => {
        changed.create.providerOptions = { region: 'eu-west' }
      },
    ],
    [
      'resources',
      (changed: ProviderPlacement) => {
        changed.create.resources = { cpu: 4 }
      },
    ],
    [
      'credential reference',
      (changed: ProviderPlacement) => {
        changed.create.secrets = ['other-credential']
      },
    ],
  ] as const)('refuses changed %s before reconnecting or creating', async (_name, change) => {
    const fixture = await interruptAfterDispatch()
    const changed = structuredClone(placement)
    change(changed)
    const before = { ...fixture.counts }
    await expect(fixture.recover(changed)).rejects.toMatchObject({
      cause: { message: 'retained run intent conflicts with replay material' },
    })
    expect(fixture.counts).toEqual(before)
  })

  it('permits opaque credential rotation when reconnecting the already-created environment', async () => {
    const fixture = await interruptAfterDispatch()
    const rotated = structuredClone(placement)
    rotated.create.env = { SEAT_TOKEN: 'credential-v2' }
    const executor = await fixture.recover(rotated)
    expect(executor.resultArtifact().out).toMatchObject({ content: 'durable result' })
    // Reconnection preserves the remote execution; it does not apply the rotated value to a new box.
    expect(fixture.counts).toMatchObject({ creates: 1, dispatches: 1 })
    expect(await readFile(fixture.admissionsFile, 'utf8')).not.toContain('credential-v1')
    expect(await readFile(fixture.admissionsFile, 'utf8')).not.toContain('credential-v2')
  })
})

async function interruptAfterDispatch() {
  const root = await mkdtemp(join(tmpdir(), 'runtime-placement-recovery-'))
  roots.push(root)
  const stateFile = join(root, 'provider.json')
  const admissionsFile = join(root, 'admissions.json')
  const counts = { creates: 0, gets: 0, dispatches: 0 }
  const provider = (): AgentEnvironmentProvider => {
    const base = durableRetainedProvider(stateFile)
    const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
      ...environment,
      async dispatch(input) {
        counts.dispatches++
        return environment.dispatch!(input)
      },
    })
    return {
      ...base,
      async create(input) {
        counts.creates++
        return wrap(await base.create(input))
      },
      async get(id) {
        counts.gets++
        const environment = await base.get!(id)
        return environment ? wrap(environment) : null
      },
    }
  }
  const context = (retained: RetainedExecutorContext): ExecutorContext => ({
    signal: new AbortController().signal,
    seams: { [retainedExecutorSeamKey]: retained },
  })
  const admissions: RetainedRunAdmission[] = []
  const initialContext = context({
    executionId: 'placed-execution',
    admissions: [],
    async onAdmission(admission) {
      admissions.push(admission)
      await writeFile(admissionsFile, JSON.stringify(admissions))
      if (admission.phase === 'dispatched') throw new Error('lost local acknowledgement')
    },
    async onResult() {},
  })
  const initial = providerAsExecutor(provider(), {
    placements: [placement],
    destroyOnSettle: false,
  })({ profile, harness: 'opencode' }, initialContext)
  await expect(drain(initial.execute('produce result', initialContext.signal))).rejects.toThrow(
    'requires reconciliation',
  )
  expect(admissions.map((admission) => admission.phase)).toEqual([
    'intent',
    'environment',
    'dispatched',
  ])
  expect(counts).toMatchObject({ creates: 1, dispatches: 1 })
  return {
    counts,
    admissionsFile,
    async recover(selected: ProviderPlacement) {
      // Both durable inputs are read by new objects; no original executor or admission array is reused.
      const reloaded: RetainedRunAdmission[] = JSON.parse(await readFile(admissionsFile, 'utf8'))
      const resumedContext = context({
        executionId: 'placed-execution',
        admissions: reloaded,
        async onAdmission(admission) {
          reloaded.push(admission)
          await writeFile(admissionsFile, JSON.stringify(reloaded))
        },
        async onResult() {},
      })
      const resumed = providerAsExecutor(provider(), {
        placements: [selected],
        destroyOnSettle: false,
      })({ profile: structuredClone(profile), harness: 'opencode' }, resumedContext)
      await drain(resumed.recover!('produce result', resumedContext.signal))
      return resumed
    },
  }
}

async function drain(events: unknown) {
  for await (const _event of events as AsyncIterable<unknown>) {
    // Drain the actual executor stream through retained result acceptance.
  }
}
