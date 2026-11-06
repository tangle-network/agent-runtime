import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
import { Sandbox } from '@tangle-network/sandbox'
import { createExecutor, createFileRunContext, createSupervisor } from '../../../dist/kernel.js'

const [directory, url] = process.argv.slice(2)
const provider = createTangleProvider({
  client: new Sandbox({
    apiKey: 'offline-not-a-secret',
    baseUrl: url,
    platformUrl: url,
    trustLocalCliAuth: false,
    directExec: false,
  }),
})
const executorFactory = createExecutor({ backend: 'provider', provider })
const profile = {
  name: 'fetch-pr',
  harness: 'opencode',
  model: { provider: 'offline', default: 'offline-test-model' },
}
let delivered
let budget
const deadlineMs = 8000
if (process.send) {
  const start = new Promise((resolve) => process.once('message', resolve))
  process.send({ phase: 'ready', deadlineMs })
  assert.equal(await start, 'start')
}
const result = await createSupervisor().run(
  {
    name: 'root',
    async act(_task, scope) {
      assert.equal(
        scope.spawn(
          {
            name: 'fetch-pr',
            act: async () => {
              throw new Error('executor owns native execution')
            },
            executorSpec: { profile, harness: null, executorFactory },
          },
          'read local evidence',
          { budget: { maxIterations: 1, maxTokens: 100 } },
        ).ok,
        true,
      )
      delivered = await scope.next()
      budget = scope.budget
      return 'observed'
    },
  },
  null,
  {
    ...createFileRunContext(join(directory, 'run')),
    runId: 'http-observation',
    rootIdentity: {
      profileDigest: canonicalCandidateDigest({ name: 'root' }),
      taskDigest: canonicalCandidateDigest(null),
    },
    retainedAtSettlement: 'keep',
    workerSlots: 1,
    teardownConfirmMs: 0,
    budget: { maxIterations: 2, maxTokens: 200, deadlineMs },
  },
)
await writeFile(join(directory, 'observed.json'), JSON.stringify({ delivered, budget, result }))
if (process.send) {
  process.send({ phase: 'observed' }, () => process.disconnect())
}
