import type {
  AgentExactProcessProvider,
  CreateAgentExactProcessEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import type {
  CreateSandboxOptions,
  EgressPolicy,
  SandboxClient,
  SandboxInstance,
} from '@tangle-network/sandbox'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import { createTangleSandboxExactProcessProvider } from './tangle-sandbox-exact-process-provider'

describe('Tangle Sandbox exact-process provider', () => {
  it('accepts the published Sandbox client directly', () => {
    expectTypeOf(createTangleSandboxExactProcessProvider)
      .parameter(0)
      .toEqualTypeOf<SandboxClient>()
  })

  it('creates an agent-free Sandbox with exact resources, egress, and identity', async () => {
    const sandbox = fakeSandbox()
    const client = fakeClient(sandbox)
    const provider = createTangleSandboxExactProcessProvider(client)
    const signal = new AbortController().signal

    const environment = await exactProvider(provider).create({
      ...createInput({ egress: { mode: 'strict', allowDomains: ['api.example.com'] } }),
      provisionTimeoutMs: 12_000,
      signal,
    })

    expect(client.create).toHaveBeenCalledWith(
      {
        image: 'ghcr.io/example/runner@sha256:abc',
        agent: false,
        bare: false,
        publicEdge: false,
        ephemeral: true,
        egressPolicy: {
          mode: 'strict',
          allowDomains: ['api.example.com'],
          includeImplicitDomains: false,
        },
        resources: { cpuCores: 2, memoryMB: 2048, diskGB: 2 },
        maxLifetimeSeconds: 30,
        metadata: expect.objectContaining({
          run: 'candidate-1',
          'agent-runtime.exact-process-provider': 'tangle-sandbox-exact-process',
          'agent-runtime.exact-process-egress':
            '{"mode":"strict","allowDomains":["api.example.com"],"includeImplicitDomains":false}',
        }),
        idempotencyKey: 'candidate-1',
      },
      { timeoutMs: 12_000, signal },
    )
    expect(environment).toMatchObject({
      id: 'sandbox-1',
      provider: 'tangle-sandbox-exact-process',
      metadata: expect.objectContaining({ run: 'candidate-1' }),
    })
    expect(provider.capabilities()).toMatchObject({
      exactProcess: { egress: ['blocked', 'strict'] },
      workspace: { read: false, write: false, exec: false },
    })
    await expect(provider.create({ profile: 'not-supported' })).rejects.toThrow(
      /exactProcess\.create\(\) only/,
    )
  })

  it('adapts byte-safe files and shell-free process control', async () => {
    const sandbox = fakeSandbox({
      readFiles: [
        {
          path: '/work/output.bin',
          content: Buffer.from([0, 255]).toString('base64'),
          encoding: 'base64',
          size: 2,
        },
      ],
    })
    const provider = createTangleSandboxExactProcessProvider(fakeClient(sandbox))
    const environment = await exactProvider(provider).create(createInput())

    await environment.writeFile('/work/input.bin', Uint8Array.of(0, 255), { mode: 0o755 })
    expect(sandbox.fs.write).toHaveBeenCalledWith('/work/input.bin', 'AP8=', {
      encoding: 'base64',
      mode: 0o755,
    })
    await expect(environment.readFile('/work/output.bin', { maxBytes: 2 })).resolves.toEqual(
      Uint8Array.of(0, 255),
    )
    await expect(environment.readFile('/work/output.bin', { maxBytes: 1 })).rejects.toThrow(
      /exceeds the 1-byte/,
    )
    expect(sandbox.fs.readBatch).toHaveBeenCalledTimes(1)

    const process = await environment.process.spawn({
      executable: '/usr/bin/runner',
      args: ['--task', 'one'],
      cwd: '/work',
      env: { LANG: 'C' },
      stdin: 'payload',
      timeoutMs: 321,
    })
    expect(sandbox.process.spawnExact).toHaveBeenCalledWith('/usr/bin/runner', ['--task', 'one'], {
      cwd: '/work',
      env: { LANG: 'C' },
      inheritEnv: false,
      stdin: 'payload',
      timeoutMs: 321,
    })
    await expect(process.status()).resolves.toMatchObject({
      pid: 41,
      running: false,
      exitCode: 0,
      termination: { kind: 'exit', exitCode: 0 },
    })
    await expect(process.wait()).resolves.toEqual({ kind: 'exit', exitCode: 0 })
    await expect(collect(process.stdout())).resolves.toEqual(['stdout'])
    await expect(collect(process.stderr())).resolves.toEqual(['stderr'])
    await process.kill()
    expect(sandbox.processHandle.kill).toHaveBeenCalledWith('SIGKILL', { tree: true })
    await expect(environment.process.list()).resolves.toMatchObject([
      { pid: 41, termination: { kind: 'exit', exitCode: 0 } },
    ])
    await expect(environment.process.get(41)).resolves.toMatchObject({ pid: 41 })
    await environment.destroy()
    expect(sandbox.delete).toHaveBeenCalledOnce()
  })

  it('rejects malformed binary payloads and invalid running process states', async () => {
    const sandbox = fakeSandbox({
      readFiles: [
        {
          path: '/work/output.bin',
          content: '!',
          encoding: 'base64',
          size: 0,
        },
      ],
    })
    vi.mocked(sandbox.process.list).mockResolvedValue([{ pid: 41, running: true, exitCode: 0 }])
    const environment = await exactProvider(
      createTangleSandboxExactProcessProvider(fakeClient(sandbox)),
    ).create(createInput())

    await expect(environment.readFile('/work/output.bin', { maxBytes: 1 })).rejects.toThrow(
      /invalid binary payload/,
    )
    await expect(environment.process.list()).rejects.toThrow(/must report exit code -1/)
  })

  it('uses the persisted provider marker for get and client-side metadata filtering', async () => {
    const exact = fakeSandbox({
      id: 'exact',
      metadata: {
        run: 'candidate-1',
        'agent-runtime.exact-process-provider': 'tangle-sandbox-exact-process',
        'agent-runtime.exact-process-egress': '{"mode":"blocked"}',
      },
    })
    const ordinary = fakeSandbox({ id: 'ordinary', metadata: { run: 'candidate-1' } })
    const client = fakeClient(exact, ordinary)
    const provider = createTangleSandboxExactProcessProvider(client)
    const exactProcess = exactProvider(provider)

    await expect(exactProcess.get('exact')).resolves.toMatchObject({ id: 'exact' })
    await expect(exactProcess.get('ordinary')).resolves.toBeNull()
    await expect(exactProcess.list({ metadata: { run: 'candidate-1' } })).resolves.toMatchObject([
      { id: 'exact' },
    ])
    await expect(exactProcess.list({ providerOptions: { teamId: 'unsupported' } })).rejects.toThrow(
      /does not accept providerOptions/,
    )
  })

  it('destroys a newly-created Sandbox when its egress proof is not exact', async () => {
    const sandbox = fakeSandbox()
    vi.mocked(sandbox.egress.get).mockResolvedValue({ policy: { mode: 'open' } as never })
    const provider = createTangleSandboxExactProcessProvider(fakeClient(sandbox))

    await expect(exactProvider(provider).create(createInput())).rejects.toThrow(/egress mismatch/)
    expect(sandbox.delete).toHaveBeenCalledOnce()
  })

  it('destroys a newly-created Sandbox that retains implicit strict-egress domains', async () => {
    const sandbox = fakeSandbox()
    vi.mocked(sandbox.egress.get).mockResolvedValue({
      policy: {
        mode: 'strict',
        allowDomains: ['api.example.com'],
        includeImplicitDomains: true,
      } as never,
    })
    const provider = createTangleSandboxExactProcessProvider(fakeClient(sandbox))

    await expect(
      exactProvider(provider).create(
        createInput({ egress: { mode: 'strict', allowDomains: ['api.example.com'] } }),
      ),
    ).rejects.toThrow(/retained implicit domains/)
    expect(sandbox.delete).toHaveBeenCalledOnce()
  })

  it('rejects recovered environments whose egress no longer matches their creation record', async () => {
    const sandbox = fakeSandbox({
      metadata: {
        'agent-runtime.exact-process-provider': 'tangle-sandbox-exact-process',
        'agent-runtime.exact-process-egress': '{"mode":"blocked"}',
      },
    })
    vi.mocked(sandbox.egress.get).mockResolvedValue({
      policy: {
        mode: 'strict',
        allowDomains: ['api.example.com'],
        includeImplicitDomains: false,
      },
    })
    const provider = createTangleSandboxExactProcessProvider(fakeClient(sandbox))

    await expect(exactProvider(provider).get(sandbox.id)).rejects.toThrow(/egress mismatch/)
  })

  it('rejects unsupported Sandbox mappings before creating a partial environment', async () => {
    const sandbox = fakeSandbox()
    const client = fakeClient(sandbox)
    const provider = createTangleSandboxExactProcessProvider(client)
    const exactProcess = exactProvider(provider)

    await expect(
      exactProcess.create(createInput({ resources: { cpu: 1, memoryMb: 1024, diskMb: 1536 } })),
    ).rejects.toThrow(/whole GiB/)
    await expect(
      exactProcess.create(
        createInput({ metadata: { 'agent-runtime.exact-process-provider': 'spoof' } }),
      ),
    ).rejects.toThrow(/must not set/)
    await expect(
      exactProcess.create(
        createInput({ metadata: { 'agent-runtime.exact-process-egress': 'spoof' } }),
      ),
    ).rejects.toThrow(/must not set/)
    await expect(exactProcess.create(createInput({ maxLifetimeMs: 30_001 }))).rejects.toThrow(
      /whole number of seconds/,
    )
    expect(client.create).not.toHaveBeenCalled()
  })

  it('does not start file or process work after cancellation or without file-mode support', async () => {
    const sandbox = fakeSandbox()
    const provider = createTangleSandboxExactProcessProvider(fakeClient(sandbox))
    const environment = await exactProvider(provider).create(createInput())
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))

    await expect(
      environment.writeFile('/work/input', Uint8Array.of(1), {
        mode: 0o644,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled/)
    await expect(
      environment.process.spawn(
        {
          executable: '/usr/bin/runner',
          args: [],
          cwd: '/work',
          env: {},
          timeoutMs: 0,
        },
        { signal: controller.signal },
      ),
    ).rejects.toThrow(/cancelled/)
    expect(sandbox.fs.write).not.toHaveBeenCalled()
    expect(sandbox.process.spawnExact).not.toHaveBeenCalled()

    sandbox.fs.supportsWriteMode = undefined
    await expect(
      environment.writeFile('/work/input', Uint8Array.of(1), { mode: 0o644 }),
    ).rejects.toThrow(/does not declare exact file-mode support/)
  })
})

function createInput(
  overrides: Partial<CreateAgentExactProcessEnvironmentInput> = {},
): CreateAgentExactProcessEnvironmentInput {
  return {
    image: 'ghcr.io/example/runner@sha256:abc',
    egress: { mode: 'blocked' },
    maxLifetimeMs: 30_000,
    resources: { cpu: 2, memoryMb: 2048, diskMb: 2048 },
    metadata: { run: 'candidate-1' },
    idempotencyKey: 'candidate-1',
    ...overrides,
  }
}

function exactProvider(
  provider: ReturnType<typeof createTangleSandboxExactProcessProvider>,
): AgentExactProcessProvider {
  if (!provider.exactProcess) throw new Error('expected exact-process provider')
  return provider.exactProcess
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const value of iterable) result.push(value)
  return result
}

function fakeClient(primary: FakeSandbox, ...others: FakeSandbox[]): SandboxClient {
  const sandboxes = [primary, ...others]
  const client = {
    create: vi.fn(async (options: CreateSandboxOptions = {}) => {
      const sandbox = primary
      sandbox.metadata = { ...options.metadata }
      sandbox.egressPolicy = options.egressPolicy ?? { mode: 'open' }
      return sandbox as unknown as SandboxInstance
    }),
    get: vi.fn(async (id: string) => {
      const sandbox = sandboxes.find((candidate) => candidate.id === id)
      return sandbox ? (sandbox as unknown as SandboxInstance) : null
    }),
    list: vi.fn(async () => sandboxes as unknown as SandboxInstance[]),
  }
  // The SDK client has unrelated service trees; this fake supplies the adapter's three calls.
  return client as unknown as SandboxClient
}

type ExactEgressPolicy =
  | { mode: 'blocked' }
  | { mode: 'strict'; allowDomains: string[]; includeImplicitDomains: false }

interface FakeFile {
  path: string
  content: string
  encoding: 'base64'
  size: number
}

interface FakeSandbox {
  readonly id: string
  metadata?: Record<string, unknown>
  egressPolicy: EgressPolicy
  readonly egress: {
    get: ReturnType<typeof vi.fn>
  }
  readonly fs: {
    supportsWriteMode?: true
    write: ReturnType<typeof vi.fn>
    readBatch: ReturnType<typeof vi.fn>
    stat: ReturnType<typeof vi.fn>
  }
  readonly process: {
    spawnExact: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
    get: ReturnType<typeof vi.fn>
  }
  readonly processHandle: {
    kill: ReturnType<typeof vi.fn>
  }
  readonly delete: ReturnType<typeof vi.fn>
}

function fakeSandbox(
  options: {
    id?: string
    metadata?: Record<string, unknown>
    egressPolicy?: ExactEgressPolicy
    readFiles?: FakeFile[]
  } = {},
): FakeSandbox {
  const egressPolicy = options.egressPolicy ?? ({ mode: 'blocked' } as const)
  const processHandle = {
    pid: 41,
    status: vi.fn(async () => ({ pid: 41, running: false, exitCode: 0 })),
    wait: vi.fn(async () => 0),
    kill: vi.fn(async () => undefined),
    stdout: async function* (): AsyncIterable<string> {
      yield 'stdout'
    },
    stderr: async function* (): AsyncIterable<string> {
      yield 'stderr'
    },
  }
  const sandbox: FakeSandbox = {
    id: options.id ?? 'sandbox-1',
    metadata: options.metadata,
    egressPolicy,
    egress: {
      get: vi.fn(async () => ({ policy: sandbox.egressPolicy })),
    },
    fs: {
      supportsWriteMode: true,
      write: vi.fn(async () => undefined),
      readBatch: vi.fn(async () => ({ files: options.readFiles ?? [], errors: [] })),
      stat: vi.fn(async (path: string) => {
        const file = options.readFiles?.find((entry) => entry.path === path)
        return { size: file?.size ?? 0 }
      }),
    },
    process: {
      spawnExact: vi.fn(async () => processHandle),
      list: vi.fn(async () => [await processHandle.status()]),
      get: vi.fn(async (pid: number) => (pid === processHandle.pid ? processHandle : null)),
    },
    processHandle,
    delete: vi.fn(async () => undefined),
  }
  return sandbox
}
