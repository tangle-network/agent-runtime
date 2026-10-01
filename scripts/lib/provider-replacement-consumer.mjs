import assert from 'node:assert/strict'

/** Exercise the packed Runtime replacement without network or model calls. */
export async function verifyProviderReplacementConsumer(kernel) {
  assert.equal(kernel.sandboxClientAsProvider, undefined)
  assert.equal(kernel.DEFAULT_SANDBOX_IDLE_TIMEOUT_SECONDS, undefined)
  const profile = {
    name: 'packed-shared-worker',
    harness: 'opencode',
    model: { provider: 'tangle-router', default: 'deepseek/deepseek-v4.1-flash' },
    prompt: { instructions: ['Keep the exact fixture instructions.'] },
  }
  let boxes = 0
  let deleted = 0
  let modelProcesses = 0
  const files = new Map()
  const client = {
    async create() {
      boxes += 1
      return {
        id: 'packed-shared-box',
        async exec() { return { exitCode: 0, stdout: '', stderr: '' } },
        fs: {
          async write(path, content) { files.set(path, content) },
          async read(path) { return files.get(path) ?? '' },
        },
        process: {
          async list() { return [] },
          async get() { return null },
          async spawnExact(_executable, args) {
            const modelRun = args.includes('run')
            if (modelRun) modelProcesses += 1
            const exported = args.indexOf('export-session')
            if (exported !== -1) files.set(args[exported + 2], '{"info":{"id":"ses_fixture"}}')
            return {
              pid: 1, async wait() { return 0 }, async kill() {},
              async *stderr() {},
              async *stdout() {
                if (!modelRun) return
                yield JSON.stringify({ sessionID: 'ses_fixture', part: {
                  type: 'text', messageID: 'message', text: 'packed worker answer',
                } }) + '\n'
                yield JSON.stringify({ sessionID: 'ses_fixture', part: {
                  id: 'step', type: 'step-finish', messageID: 'message',
                  tokens: { input: 12, output: 4 },
                } }) + '\n'
              },
            }
          },
        },
        async delete() { deleted += 1 },
      }
    },
  }
  const shared = kernel.sharedBoxPlacement({ client, retryDelayMs: 0 })
  for (const credentialSource of ['managed', 'subscription']) {
    const selected = {
      ...profile,
      model: { ...profile.model, metadata: { credentialSource } },
    }
    await assert.rejects(
      shared.providerFor().create({ profile: selected }),
      /credentialSource requires a dedicated provider/,
    )
  }
  await assert.rejects(
    shared.providerFor().create({ profile: 'catalog/worker' }),
    /exact AgentProfile is required/,
  )
  for (const fields of [
    { idempotencyKey: 'unsupported-key' },
    { providerOptions: { sandboxCreateOptions: { ownerContext: 'isolated' } } },
  ]) {
    await assert.rejects(shared.providerFor().create({ profile, ...fields }), /sharedBoxPlacement/)
  }
  assert.equal(boxes, 0)
  for (const connection of [{ client }, { sandboxClient: client }, {
    endpoint: 'https://sandbox.invalid', apiKey: 'fixture-not-a-key',
  }]) {
    await assert.rejects(kernel.provisionSupervisor({
      invocationId: 'packed-refused-connection', task: 'fixture', profile, connection,
    }), /requires connection.provider/)
  }
  assert.equal(boxes, 0)
  const dedicated = {
    name: 'packed-dedicated',
    capabilities: shared.providerFor().capabilities,
    async create() { throw new Error('accepted shared profile reached dedicated create') },
  }
  const signal = new AbortController().signal
  const executor = kernel.createExecutor({ backend: 'provider', provider: dedicated, shared })(
    { profile, harness: null }, { signal, seams: {} },
  )
  for await (const _ of executor.execute('answer the fixture', signal)) {}
  const result = executor.resultArtifact()
  assert.equal(result.out.content, 'packed worker answer')
  assert.equal(result.spent.tokens.input, 12)
  assert.equal(result.spent.tokens.output, 4)
  assert.equal(result.spent.usdKnown, false)
  assert.equal(modelProcesses, 1)
  assert.equal(boxes, 1)
  assert.equal(deleted, 1)
  assert.equal(shared.stats().workersLive, 0)
  assert([...files.values()].some(value => value.includes('Keep the exact fixture instructions.')))
  const inverse = kernel.providerAsSandboxClient(shared.providerFor(), { defaults: { profile } })
  const inverseBox = await inverse.create()
  const answer = await inverseBox.prompt('answer through the client')
  assert.equal(answer.response, 'packed worker answer')
  assert.equal(answer.usage.inputTokens, 12)
  assert.equal(answer.usage.outputTokens, 4)
  assert.equal(answer.usage.cost, undefined)
  await inverseBox.delete()
  assert.equal(modelProcesses, 2)
  assert.equal(boxes, 2)
  assert.equal(deleted, 2)
  return {
    obsoleteExportsAbsent: true, unsupportedCreates: 8, unsupportedBoxes: 0,
    sharedExecutions: 1, answer: result.out.content,
    meteredInputTokens: 12, meteredOutputTokens: 4, usdKnown: false,
    privateProfileMaterialization: true, releasedWorkers: 2, deletedFixtureBoxes: 2,
    inversePromptUsage: { inputTokens: 12, outputTokens: 4, costKnown: false },
    realSandboxAllocations: 0, realModelCalls: 0,
  }
}
