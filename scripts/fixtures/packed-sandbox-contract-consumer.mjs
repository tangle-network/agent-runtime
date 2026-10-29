import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as current from '@tangle-network/agent-interface'
import { materializeCandidateProfile } from '@tangle-network/agent-profile-materialize'
import { ValidationError } from '@tangle-network/agent-runtime'
import { assertProfileMaterializes } from '@tangle-network/agent-runtime/agent'
import {
  agentCandidateProfileAsAgentProfile,
  assertCandidateProfileBinding,
  buildAgentCandidateBundle,
  sealAgentCandidateBundle,
  verifyAgentCandidateBundle,
  freezeGenericAgentCandidateProfile,
} from '@tangle-network/agent-runtime/candidate-execution'
// Runtime refuses execution-owned knowledge references that are not owner-authorized and
// resolved, before a profile reaches Sandbox; it never drops them.
let unresolvedKnowledgeRefusals = 0
let candidateKnowledgeConversionRefusals = 0
let candidateKnowledgeAdmissionRefusals = 0
const knowledge = [{ sourceId: 'source_1', generation: `kg_${'a'.repeat(64)}` }]
if (current.agentProfileSchema.safeParse({ resources: { knowledge } }).success) {
  for (const harness of ['codex', 'claude-code', 'opencode', 'kimi-code', 'pi']) {
    for (const failOnError of [true, false]) {
      const profile = { resources: { knowledge, failOnError } }
      assert.equal(current.agentProfileSchema.safeParse(profile).success, true)
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

// Private profile config that Sandbox cannot carry remains an explicit refusal.
const proxySecrets = [
  {
    hosts: ['api.example.com'],
    envName: 'EXAMPLE_API_KEY',
    secretRef: { kind: 'secret-ref', key: 'example' },
    presentation: { type: 'bearer' },
  },
]
const secretRefServer = {
  command: 'search-mcp',
  env: { SEARCH_REGION: { kind: 'secret-ref', key: 'example' } },
}
const uncarried = [
  ['mcp.search.env.SEARCH_REGION (secret-ref)', { name: 'secret-ref-boundary', mcp: { search: secretRefServer } }],
]
const interfaceVersion = JSON.parse(
  readFileSync(new URL('./node_modules/@tangle-network/agent-interface/package.json', import.meta.url), 'utf8'),
).version
const interfaceAdmitsProxySecrets = current.agentProfileSchema.safeParse({ proxySecrets }).success
let uncarriedFieldRefusals = 0
for (const [field, profile] of uncarried) {
  if (interfaceAdmitsProxySecrets) {
    // Both inputs are valid profiles and candidates under the Interface that admits them.
    assert.equal(current.agentProfileSchema.safeParse(profile).success, true, field)
    assert.equal(current.agentCandidateProfileSchema.safeParse(profile).success, true, field)
  }
  for (const convert of [
    () => freezeGenericAgentCandidateProfile(profile),
    () => agentCandidateProfileAsAgentProfile(profile),
  ]) {
    assert.throws(convert, (error) => {
      assert.ok(error instanceof ValidationError, `${field}: ${error}`)
      assert.equal(
        error.message,
        `candidate profile field ${field} is refused: Sandbox's Interface 4.0.0 cannot carry it yet, and Runtime does not drop it`,
      )
      return true
    })
    uncarriedFieldRefusals += 1
  }
}
// Supported profile data keeps identical canonical bytes across admitted Interface releases.
const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : value !== null && typeof value === 'object'
      ? `{${Object.keys(value)
          .filter((key) => value[key] !== undefined)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(',')}}`
      : JSON.stringify(value)
const baseline = {
  name: 'conversion-baseline',
  ...(interfaceAdmitsProxySecrets ? { proxySecrets } : {}),
  description: 'Synthetic conversion baseline',
  version: '1.0.0',
  tags: ['packed'],
  harness: 'codex',
  prompt: { systemPrompt: 'Synthetic system prompt' },
  model: { default: 'synthetic/model' },
  mcp: {
    search: {
      command: 'search-mcp',
      args: [{ kind: 'public', value: '--region' }, { kind: 'public', value: 'eu' }],
      env: { SEARCH_REGION: { kind: 'public', value: 'eu' } },
    },
  },
  resources: { failOnError: true, instructions: 'Synthetic resource instructions' },
}
const frozen = freezeGenericAgentCandidateProfile(baseline)
const restored = agentCandidateProfileAsAgentProfile(frozen)
assert.equal(canonical(restored), canonical(baseline))
assertCandidateProfileBinding(baseline, frozen)
const conversionCanonicalSha256 = createHash('sha256')
  .update(canonical({ frozen, restored }))
  .digest('hex')

const result = {
  kind: 'packed-sandbox-contract-boundary',
  interfaceVersion,
  interfaceAdmitsProxySecrets,
  uncarriedFieldRefusals,
  conversionCanonicalSha256,
  unresolvedKnowledgeRefusals,
  candidateKnowledgeConversionRefusals,
  candidateKnowledgeAdmissionRefusals,
  liveProviderCalls: 0,
}
console.log(JSON.stringify(result))
