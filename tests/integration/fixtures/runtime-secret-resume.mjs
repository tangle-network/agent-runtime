import assert from 'node:assert/strict'
import {
  createTangleProvider,
  defaultTangleSandboxCapabilities,
} from '@tangle-network/agent-provider-tangle'
import { supervise } from '@tangle-network/agent-runtime/kernel'
import { Sandbox } from '@tangle-network/sandbox'

const [baseUrl, publicUrl, runDir, phase] = process.argv.slice(2)
const capabilities = defaultTangleSandboxCapabilities('opencode')
delete capabilities.nativeContinuation
delete capabilities.branching
capabilities.create.workspaceCheckpoint = false
const provider = createTangleProvider({
  capabilities,
  client: new Sandbox({
    apiKey: 'fixture-api-key',
    baseUrl,
    platformUrl: baseUrl,
    trustLocalCliAuth: false,
    directExec: false,
  }),
})
console.error(JSON.stringify({ phase: 'restart-helper-ready' }))
const result = await supervise(
  {
    name: 'custody-resume',
    harness: 'opencode',
    model: { provider: 'openai', default: 'fixture-model' },
    tools: { agent_runtime_coordination_submit_result: true },
  },
  'Deliver the checked result after the coordinator restarts.',
  {
    runId: 'custody-resume',
    runDir,
    backend: { backend: 'provider', provider },
    budget: { maxIterations: 10, maxTokens: 10000, deadlineMs: 15000 },
    perWorker: { maxIterations: 1, maxTokens: 100 },
    deliverable: { check: (value) => value?.answer === 'custody-resume-delivered' },
    continuation: {
      maxBarren: 5,
      failures: 'verbatim',
      panel: 'off',
      bar: 'off',
      profile: {
        id: 'custody-resume',
        opening: 'The checked result is still due.',
        plan: 'Submit the checked result.',
        rules: 'Use the provided coordination tool.',
        headings: {
          failures: 'Failures',
          protected: 'Passing',
          changed: 'Changes',
          findings: 'Findings',
          bar: 'Bar',
          plan: 'Plan',
          rules: 'Rules',
        },
      },
    },
    onDriverAttempt: async (record) => {
      console.error(JSON.stringify({ phase: 'restart-helper-attempt', failed: record.error !== undefined }))
      if (phase === 'first') {
        if (record.error !== undefined)
          console.error(
            String(record.error)
              .replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]')
              .slice(0, 600),
          )
        assert.equal(record.error === undefined, true)
        await fetch(`${baseUrl}/fixture/hold-after-commit`)
      }
    },
    coordination: {
      authentication: true,
      publicUrl: async ({ port }) => {
        await fetch(`${baseUrl}/fixture/coordination`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ upstream: `http://127.0.0.1:${port}/coordination` }),
        })
        return publicUrl
      },
    },
  },
)
console.log(
  JSON.stringify({
    resumed: result.kind === 'winner',
    resultKind: result.kind,
    resultReason: result.reason,
  }),
)
