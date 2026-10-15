import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentEnvironmentProvider,
  ProxySecretBinding,
  ProxySecretParents,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import { providerAsSandboxClient } from '../../src/runtime/environment-provider'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'

const adapterProxyBinding: ProxySecretBinding = {
  envName: 'REPORTS_TOKEN',
  secretRef: { kind: 'secret-ref', key: 'reporting-api' },
  hosts: ['reports.example.com'],
  presentation: { type: 'bearer' },
  methods: ['POST'],
  paths: ['/v1/events'],
  ttlSeconds: 60,
}

describe('public provider adapter proxy-secret parent admission', () => {
  it.each(['map', 'hook'] as const)(
    'refuses a protected public adapter without an explicit %s before allocation',
    async (missing) => {
      const directory = await mkdtemp(join(tmpdir(), 'protected-adapter-missing-'))
      const base = durableRetainedProvider(join(directory, 'provider.json'))
      let creates = 0
      const provider: AgentEnvironmentProvider = {
        ...base,
        async create() {
          creates++
          throw new Error('unexpected allocation before admission')
        },
      }
      const options = {
        defaults: {
          profile: { name: 'protected' },
          proxySecrets: [adapterProxyBinding],
          ...(missing === 'map' ? {} : { proxySecretParents: { REPORTS_TOKEN: null } }),
        },
        ...(missing === 'hook' ? {} : { onAdmission: async () => {} }),
      }
      try {
        await expect(providerAsSandboxClient(provider, options).create()).rejects.toThrow(
          'requires explicit proxySecretParents and an awaited onAdmission hook',
        )
        expect(creates, 'protected adapter admission must precede provider allocation').toBe(0)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  )

  it('awaits durable public adapter admission and preserves its captured parent map through readback', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'protected-adapter-'))
    const base = durableRetainedProvider(join(directory, 'provider.json'))
    const entered = deferred()
    const durable = deferred()
    const callerParents: ProxySecretParents = { REPORTS_TOKEN: null }
    let admitted: unknown
    let creates = 0
    let createdParents: unknown
    let createdBindings: unknown
    const provider: AgentEnvironmentProvider = {
      ...base,
      async create(input) {
        creates++
        createdParents = input.proxySecretParents
        createdBindings = input.proxySecrets
        return base.create(input)
      },
    }
    const options = {
      defaults: {
        profile: { name: 'protected' },
        proxySecrets: [adapterProxyBinding],
        proxySecretParents: callerParents,
        idempotencyKey: 'protected-adapter',
      },
      async onAdmission(admission: { readonly proxySecretParents: ProxySecretParents }) {
        admitted = admission.proxySecretParents
        entered.resolve()
        await durable.promise
      },
    }
    const creating = providerAsSandboxClient(provider, options).create()
    try {
      const first = await Promise.race([
        entered.promise.then(() => 'admission'),
        creating.then(
          () => 'allocation',
          () => 'failure',
        ),
      ])
      expect(first, 'protected adapter must await durable admission before allocation').toBe(
        'admission',
      )
      expect(creates).toBe(0)
      callerParents.REPORTS_TOKEN = 'caller-mutated-after-admission'
      durable.resolve()
      const box = await creating
      expect(creates).toBe(1)
      expect(admitted).toEqual({ REPORTS_TOKEN: null })
      expect(createdParents).toEqual({ REPORTS_TOKEN: null })
      expect(createdBindings).toEqual([adapterProxyBinding])
      const current = await base.get!(box.id)
      expect(current?.proxySecretParents).toEqual({ REPORTS_TOKEN: null })
    } finally {
      durable.resolve()
      await creating.catch(() => {})
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('refuses dropped parent readback from the protected public adapter and cleans its created environment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'protected-adapter-readback-'))
    const base = durableRetainedProvider(join(directory, 'provider.json'))
    let admissions = 0
    let creates = 0
    let dispatches = 0
    let destroys = 0
    const provider: AgentEnvironmentProvider = {
      ...base,
      async create(input) {
        creates++
        const environment = await base.create(input)
        return {
          ...environment,
          creation: 'created',
          proxySecretParents: undefined,
          async *stream() {
            dispatches++
            yield* []
          },
          async destroy() {
            destroys++
            await environment.destroy?.()
          },
        }
      },
    }
    const options = {
      defaults: {
        profile: { name: 'protected' },
        proxySecrets: [adapterProxyBinding],
        proxySecretParents: { REPORTS_TOKEN: null },
        idempotencyKey: 'missing-parent-readback',
      },
      async onAdmission() {
        admissions++
      },
    }
    try {
      await expect(providerAsSandboxClient(provider, options).create()).rejects.toThrow(
        'provider proxySecretParents readback differs from admitted pins',
      )
      expect(admissions).toBe(1)
      expect(creates).toBe(1)
      expect(dispatches).toBe(0)
      expect(destroys).toBe(1)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('refuses protected public adapter forks before allocation even after receipt removal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'protected-adapter-fork-'))
    const base = durableRetainedProvider(join(directory, 'provider.json'))
    let forks = 0
    let hideReceipt = false
    const provider: AgentEnvironmentProvider = {
      ...base,
      async create(input) {
        const environment = await base.create(input)
        return {
          ...environment,
          get proxySecretReceipt() {
            return hideReceipt ? undefined : environment.proxySecretReceipt
          },
          async fork() {
            forks++
            return base.create({
              profile: { name: 'forked' },
              idempotencyKey: 'protected-adapter-fork-child',
            })
          },
        }
      },
    }
    try {
      const box = await providerAsSandboxClient(provider, {
        defaults: {
          profile: { name: 'protected' },
          proxySecrets: [adapterProxyBinding],
          proxySecretParents: { REPORTS_TOKEN: null },
          idempotencyKey: 'protected-adapter-fork',
        },
        onAdmission: async () => {},
      }).create()
      await expect(box.fork!(1)).rejects.toThrow(
        'protected provider adapter fork requires a trusted durable parent admission port',
      )
      expect(forks, 'protected adapter fork must refuse before provider allocation').toBe(0)
      hideReceipt = true
      await expect(box.fork!(1)).rejects.toThrow(
        'protected provider adapter fork requires a trusted durable parent admission port',
      )
      expect(forks, 'receipt disappearance must not permit protected fork allocation').toBe(0)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

})

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
