import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import * as current from '@tangle-network/agent-interface'
import {
  applyWorkspacePlan,
  applyWorkspacePlanWithSecretProvider,
  materializeCandidateProfile,
  materializeProfile,
} from '@tangle-network/agent-profile-materialize'
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
// Planning preserves declarations; application needs trusted placement and acknowledgement.
const proxySecrets = current.ProxySecretsSchema.parse([{
  envName: 'PACKED_MATERIALIZER_TOKEN',
  secretRef: { kind: 'secret-ref', key: 'packed-materializer-reference' },
  hosts: ['service.packed.invalid'],
  presentation: { type: 'bearer' },
  methods: ['POST'],
  paths: ['/mcp'],
  ttlSeconds: 60,
}])
const proxyProfile = current.agentProfileSchema.parse({
  name: 'packed-materializer',
  harness: 'codex',
  prompt: { systemPrompt: 'Synthetic instructions for the protected native plan.' },
  proxySecrets,
  mcp: {
    service: {
      transport: 'http', url: 'https://service.packed.invalid/mcp',
      headers: { Authorization: { ...proxySecrets[0].secretRef, format: 'bearer' } },
    },
  },
})
const proxyPlan = materializeProfile(proxyProfile, 'codex')
const materializerProxySupported = proxyPlan.proxySecrets !== undefined
const materializerVersion = JSON.parse(
  readFileSync(new URL('./node_modules/@tangle-network/agent-profile-materialize/package.json', import.meta.url), 'utf8'),
).version
if (process.argv.includes('--require-proxy-materializer')) {
  assert.equal(materializerProxySupported, true, 'the selected materializer must preserve canonical proxy declarations')
}
let missingProxyContextRefusals = 0
let unsupportedProxyWrapperRefusals = 0
let proxyPrivateSecretReads = 0
if (materializerProxySupported) {
  assert.deepEqual(proxyPlan.proxySecrets, proxySecrets)
  assert.deepEqual(assertProfileMaterializes(proxyProfile, 'codex', 'packed proxy plan').proxySecrets, proxySecrets)
  assert.ok(proxyPlan.files.length > 0, 'the refusing application must have native files to protect')
  assert.ok(proxyPlan.files.some(file => file.content === proxyProfile.prompt.systemPrompt))
  const workspace = await mkdtemp(join(tmpdir(), 'packed-proxy-plan-'))
  try {
    assert.throws(() => applyWorkspacePlan(proxyPlan, workspace), /executor-bound placeholder environment/)
    missingProxyContextRefusals += 1
    await assert.rejects(applyWorkspacePlanWithSecretProvider(proxyPlan, workspace, {
      async get() { proxyPrivateSecretReads += 1; throw new Error('private fallback must not run') },
    }), /trusted placement receipt and acknowledgement/)
    missingProxyContextRefusals += 1
    assert.equal(proxyPrivateSecretReads, 0)
    assert.deepEqual(await readdir(workspace), [])
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
} else {
  const declarationOnlyProfile = current.agentProfileSchema.parse({
    name: 'packed-proxy-declaration', harness: 'codex', proxySecrets,
  })
  assert.equal(materializeProfile(declarationOnlyProfile, 'codex').proxySecrets, undefined)
  assert.throws(
    () => assertProfileMaterializes(declarationOnlyProfile, 'codex', 'packed proxy declaration'),
    (error) => error instanceof ValidationError && /proxySecrets|proxy-held/.test(error.message),
    `protected planning must refuse an omitted proxySecrets plan (materializer ${materializerVersion})`,
  )
  unsupportedProxyWrapperRefusals += 1
}
let candidateProxyAdmissionRefusals = 0
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
  const proxyCandidateBundle = sealAgentCandidateBundle({
    ...baselineMaterial,
    profile: { ...baselineBundle.profile, proxySecrets },
  })
  await assert.rejects(verifyAgentCandidateBundle(proxyCandidateBundle, {
    artifacts: { read: forbiddenRead }, repositories: { resolve: forbiddenRead },
  }), (error) => error instanceof ValidationError && error.message.startsWith('candidate profile field proxySecrets is refused:'))
  candidateProxyAdmissionRefusals += 1
  assert.equal(artifactReads, 0)
  assert.throws(
    () => materializeCandidateProfile({ resources: { knowledge, failOnError: true } }, 'codex'),
    /must be owner-authorized and resolved/,
  )
}

// Interface 5.3 admits profile proxySecrets and candidate secret-ref config values that the
// SDK's private Interface 4 cannot carry. Runtime refuses them by name and never drops them.
const uncarriedProxySecrets = [
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
  ['proxySecrets', { name: 'proxy-boundary', harness: 'codex', proxySecrets: uncarriedProxySecrets }],
  ['mcp.search.env.SEARCH_REGION (secret-ref)', { name: 'secret-ref-boundary', mcp: { search: secretRefServer } }],
]
const interfaceVersion = JSON.parse(
  readFileSync(new URL('./node_modules/@tangle-network/agent-interface/package.json', import.meta.url), 'utf8'),
).version
const interfaceAdmitsProxySecrets = current.agentProfileSchema.safeParse(uncarried[0][1]).success
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
// A profile without those fields must convert to the same canonical bytes under every
// Interface this gate installs; verify-package-exports compares the digests across apps.
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
  materializerVersion,
  materializerProxySupported,
  unsupportedProxyMaterializer: !materializerProxySupported,
  proxyPlanPreserved: materializerProxySupported,
  missingProxyContextRefusals,
  unsupportedProxyWrapperRefusals,
  proxyPrivateSecretReads,
  candidateProxyAdmissionRefusals,
  interfaceVersion,
  interfaceAdmitsProxySecrets,
  uncarriedFieldRefusals,
  conversionCanonicalSha256,
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
