import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import * as current from '@tangle-network/agent-interface'
const sdkRequire = createRequire(createRequire(import.meta.url).resolve('@tangle-network/sandbox'))
const sdk = await import(pathToFileURL(sdkRequire.resolve('@tangle-network/agent-interface')).href)
import { readTokenUsage, readTokenCostUsd } from '@tangle-network/agent-core'
const { readTokenUsage: sdkUsage, readTokenCostUsd: sdkCost } = await import(
  pathToFileURL(sdkRequire.resolve('@tangle-network/agent-core')).href
)
const profiles = [
  { name: 'boundary', harness: 'opencode' },
  {
    name: 'boundary',
    harness: 'codex',
    prompt: {
      instructions: ['Synthetic instructions'],
      appendSystemPrompt: 'Synthetic privileged addition',
    },
    resources: {
      instructions: { kind: 'inline', name: 'proof.txt', content: 'Synthetic resource' },
    },
  },
]
for (const profile of profiles) {
  assert.deepEqual(sdk.agentProfileSchema.parse(profile), current.agentProfileSchema.parse(profile))
  assert.equal(
    sdk.canonicalAgentProfileDigest(profile),
    current.canonicalAgentProfileDigest(profile),
  )
  assert.equal(sdk.canonicalCandidateDigest(profile), current.canonicalCandidateDigest(profile))
}
const run = {
  provider: 'tangle-sandbox',
  environmentId: 'e',
  sessionId: 's',
  executionId: 'x',
  runId: 'r',
  requestDigest: `sha256:${'a'.repeat(64)}`,
}
assert.deepEqual(
  sdk.AgentExactRunControlRefSchema.parse(run),
  current.AgentExactRunControlRefSchema.parse(run),
)
const cancel = { operationId: 'cancel', run, reason: 'synthetic' }
assert.equal(
  sdk.agentRunCancellationRequestDigest(cancel),
  current.agentRunCancellationRequestDigest(cancel),
)
const claim = {
  refDigest: `sha256:${'b'.repeat(64)}`,
  generation: 1,
  leaseId: 'l',
  holderId: 'h',
  expiresAt: '2026-10-12T23:00:00.000Z',
}
for (const [name, value] of [
  ['AgentInteractiveSessionControlClaimSchema', claim],
  ['TerminalInputSchema', { data: 'synthetic' }],
  ['TerminalResizeSchema', { cols: 80, rows: 24 }],
]) {
  assert.deepEqual(sdk[name].parse(value), current[name].parse(value))
  assert.equal(sdk[name].safeParse({ ...value, unrecognized: true }).success, false)
  assert.equal(current[name].safeParse({ ...value, unrecognized: true }).success, false)
}
for (const event of [
  { usage: { input_tokens: 100, output_tokens: 20 } },
  {
    usage: {
      prompt_tokens: 100,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 30 },
    },
    costUsd: 0.012,
  },
  { usage: { inputTokens: 0, outputTokens: 0 } },
  {},
]) {
  assert.deepEqual(sdkUsage(event), readTokenUsage(event))
  assert.deepEqual(sdkCost(event), readTokenCostUsd(event))
}
const result = {
  kind: 'packed-sandbox-contract-boundary',
  profileParsingAndDigest: true,
  runCancellationAndControl: true,
  terminalAdmissionAndUnknownKeyRefusal: true,
  usageAndCostReadParity: true,
  providerConsumerTypesCompiled: true,
  liveProviderCalls: 0,
}
console.log(JSON.stringify(result))
