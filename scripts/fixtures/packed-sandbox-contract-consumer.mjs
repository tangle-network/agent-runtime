import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import * as current from '@tangle-network/agent-interface'
import { materializeCandidateProfile } from '@tangle-network/agent-profile-materialize'
import { assertProfileMaterializes } from '@tangle-network/agent-runtime/agent'
import {
  agentCandidateProfileAsAgentProfile,
  assertCandidateProfileBinding,
  buildAgentCandidateBundle,
  sealAgentCandidateBundle,
  verifyAgentCandidateBundle,
  freezeGenericAgentCandidateProfile,
} from '@tangle-network/agent-runtime/candidate-execution'
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
// Knowledge schema support follows the installed peer. Runtime still requires owner
// authorization and resolution before materialization, including peers that parse the pins.
let knowledgeSchemaParityChecks = 0
let unsupportedSdkKnowledgeRefusals = 0
let unresolvedKnowledgeRefusals = 0
let candidateKnowledgeConversionRefusals = 0
let candidateKnowledgeAdmissionRefusals = 0
const knowledge = [{ sourceId: 'source_1', generation: `kg_${'a'.repeat(64)}` }]
if (current.agentProfileSchema.safeParse({ resources: { knowledge } }).success) {
  for (const harness of ['codex', 'claude-code', 'opencode', 'kimi-code', 'pi']) {
    for (const failOnError of [true, false]) {
      const profile = { resources: { knowledge, failOnError } }
      assert.equal(current.agentProfileSchema.safeParse(profile).success, true)
      const sdkProfile = sdk.agentProfileSchema.safeParse(profile)
      if (sdkProfile.success) {
        assert.deepEqual(sdkProfile.data, current.agentProfileSchema.parse(profile))
        assert.equal(sdk.canonicalAgentProfileDigest(profile), current.canonicalAgentProfileDigest(profile))
        knowledgeSchemaParityChecks += 1
      } else {
        assert.throws(() => sdk.agentProfileSchema.parse(profile))
        unsupportedSdkKnowledgeRefusals += 1
      }
      assert.throws(
        () => assertProfileMaterializes(profile, harness, 'packed SDK boundary'),
        /must be owner-authorized and resolved/,
      )
      unresolvedKnowledgeRefusals += 1
    }
  }
  const baselineBundle = buildAgentCandidateBundle({
    profile: { kind: 'profile', profile: { name: 'knowledge-boundary', harness: 'codex' } },
    code: { kind: 'disabled' },
    execution: {
      harness: 'codex',
      harnessVersion: '1.0.0',
      launch: { kind: 'container-command', executable: 'codex' },
      instructionDelivery: { kind: 'stdin-utf8' },
      cwd: { workspace: 'task', path: '.' },
      env: { PATH: { kind: 'public', value: '/usr/local/bin:/usr/bin:/bin' } },
      environment: { kind: 'evaluator-task-container' },
      isolation: {
        network: 'disabled',
        remoteIntegrations: 'disabled',
        candidateSecrets: 'disabled',
      },
    },
    memory: { mode: 'disabled' },
  })
  const { digest: _digest, ...baselineMaterial } = baselineBundle
  let artifactReads = 0
  const forbiddenRead = async () => { artifactReads += 1; throw new Error('unexpected artifact read') }
  for (const pins of [[], knowledge]) {
    for (const failOnError of [true, false]) {
      const profile = { resources: { knowledge: pins, failOnError } }
      const stripped = { resources: { failOnError: true } }
      for (const convert of [
        () => freezeGenericAgentCandidateProfile(profile),
        () => agentCandidateProfileAsAgentProfile(profile),
        () => assertCandidateProfileBinding(profile, stripped),
      ]) {
        assert.throws(convert, /must be owner-authorized and resolved/)
        candidateKnowledgeConversionRefusals += 1
      }
    }
    const bundle = sealAgentCandidateBundle({
      ...baselineMaterial,
      profile: { ...baselineBundle.profile, resources: { knowledge: pins, failOnError: true } },
    })
    await assert.rejects(
      verifyAgentCandidateBundle(bundle, {
        artifacts: { read: forbiddenRead },
        repositories: { resolve: forbiddenRead },
      }),
      /must be owner-authorized and resolved/,
    )
    candidateKnowledgeAdmissionRefusals += 1
  }
  assert.equal(artifactReads, 0)
  assert.throws(
    () => materializeCandidateProfile({ resources: { knowledge, failOnError: true } }, 'codex'),
    /must be owner-authorized and resolved/,
  )
}

const result = {
  kind: 'packed-sandbox-contract-boundary',
  profileParsingAndDigest: true,
  runCancellationAndControl: true,
  terminalAdmissionAndUnknownKeyRefusal: true,
  usageAndCostReadParity: true,
  knowledgeSchemaParityChecks,
  unsupportedSdkKnowledgeRefusals,
  unresolvedKnowledgeRefusals,
  candidateKnowledgeConversionRefusals,
  candidateKnowledgeAdmissionRefusals,
  liveProviderCalls: 0,
}
console.log(JSON.stringify(result))
