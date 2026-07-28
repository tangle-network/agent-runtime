import { execFileSync } from 'node:child_process'
import crypto, { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixturePath = resolve(
  repoRoot,
  'src/testing/fixtures/agent-improvement-proposal.json',
)
const profileFixturePath = resolve(
  repoRoot,
  'src/testing/fixtures/agent-profile-improvement-proposal.json',
)
const profileStateFixturePath = resolve(
  repoRoot,
  'src/testing/fixtures/agent-profile-improvement-state.json',
)
const biomePath = resolve(repoRoot, 'node_modules/.bin/biome')
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
  version?: unknown
}
if (typeof packageJson.version !== 'string' || !packageJson.version) {
  throw new Error('package.json must contain a Runtime version')
}

const args = process.argv.slice(2)
if (args.some((arg) => arg !== '--check') || args.length > 1) {
  throw new Error('usage: generate-agent-improvement-proposal-fixtures.ts [--check]')
}

const fixedNowMs = Date.parse('2026-07-10T00:00:00.000Z')
const originalDateNow = Date.now
const originalRandomBytes = crypto.randomBytes
const originalPerformanceNow = Object.getOwnPropertyDescriptor(performance, 'now')
const environmentKeys = [
  'GIT_AUTHOR_DATE',
  'GIT_COMMITTER_DATE',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_KEY_0',
  'GIT_CONFIG_VALUE_0',
  'LC_ALL',
  'TZ',
] as const
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]))
let cleanupCandidateExperimentFixtures: (() => void) | undefined
let cleanupCandidateFixtures: (() => void) | undefined
let monotonicTimeMs = 0

function deterministicBytes(size: number): Buffer {
  // Candidate arms start concurrently, so opaque fixture IDs cannot depend on call order.
  const output = Buffer.alloc(size)
  let offset = 0
  let block = 0
  while (offset < size) {
    const bytes = createHash('sha256')
      .update(`agent-runtime-testing-fixture:${size}:${block}`)
      .digest()
    offset += bytes.copy(output, offset)
    block += 1
  }
  return output
}

function formatFixture(path: string, serialized: string): string {
  return execFileSync(biomePath, ['format', `--stdin-file-path=${path}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
    input: serialized,
  })
}

crypto.randomBytes = ((
  size: number,
  callback?: (error: Error | null, bytes: Buffer) => void,
) => {
  const bytes = deterministicBytes(size)
  if (callback) {
    callback(null, bytes)
    return
  }
  return bytes
}) as typeof crypto.randomBytes
syncBuiltinESMExports()
Date.now = () => fixedNowMs
Object.defineProperty(performance, 'now', {
  configurable: true,
  value: () => {
    monotonicTimeMs += 100
    return monotonicTimeMs
  },
})
Object.assign(process.env, {
  GIT_AUTHOR_DATE: '2026-07-10T00:00:00.000Z',
  GIT_COMMITTER_DATE: '2026-07-10T00:00:00.000Z',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'commit.gpgsign',
  GIT_CONFIG_VALUE_0: 'false',
  LC_ALL: 'C',
  TZ: 'UTC',
})

try {
  const [runtime, experimentFixtures, executionFixtures, profileFixtures] = await Promise.all([
    import('../src/intelligence/improvement-cycle'),
    import('../tests/helpers/candidate-experiment-fixture'),
    import('../tests/helpers/candidate-execution-fixture'),
    import('../tests/helpers/profile-improvement-fixture'),
  ])
  cleanupCandidateExperimentFixtures = experimentFixtures.cleanupCandidateExperimentFixtures
  cleanupCandidateFixtures = executionFixtures.cleanupCandidateFixtures

  const runId = `agent-runtime-${packageJson.version}-proposal-fixture`
  const rig = experimentFixtures.createCandidateExperimentFixture()
  const measured = await runtime.runAgentCandidateExperiment({
    experiment: rig.experiment,
    runId,
    maxConcurrency: 1,
    placeCell: rig.placeCell,
    metadata: {
      fixture: 'agent-improvement-proposal',
      runtimeVersion: packageJson.version,
    },
  })
  const proposal = runtime.createAgentImprovementProposal({
    runId,
    findings: [
      {
        schema_version: '1.0.0',
        finding_id: 'runtime-testing-fixture-finding',
        analyst_id: 'runtime-testing-fixture',
        produced_at: '2026-07-10T00:30:00.000Z',
        severity: 'high',
        area: 'prompt',
        claim: 'The baseline omits the exact measured answer.',
        evidence_refs: [{ kind: 'span', id: 'runtime-testing-fixture-span' }],
        recommended_action: 'Return the exact measured answer.',
        confidence: 0.9,
        subject: 'agent-profile:prompt.systemPrompt',
      },
    ],
    evaluation: measured.evaluation,
    now: () => new Date('2026-07-10T01:00:00.000Z'),
  })
  const serialized = formatFixture(
    fixturePath,
    `${JSON.stringify(runtime.verifyAgentImprovementProposal(proposal), null, 2)}\n`,
  )
  const profileFixture = profileFixtures.createProfileImprovementFixture()
  const profileProposal = runtime.createAgentImprovementProposal({
    runId: profileFixture.evaluation.provenance.runId,
    findings: [],
    evaluation: {
      ...profileFixture.evaluation,
      metadata: {
        ...(profileFixture.evaluation.metadata ?? {}),
        fixture: 'agent-profile-improvement-proposal',
        runtimeVersion: packageJson.version,
      },
    },
    now: () => new Date('2026-07-10T01:30:00.000Z'),
  })
  const serializedProfileProposalFixture = formatFixture(
    profileFixturePath,
    `${JSON.stringify(runtime.verifyAgentImprovementProposal(profileProposal), null, 2)}\n`,
  )
  const serializedProfileStateFixture = formatFixture(
    profileStateFixturePath,
    `${JSON.stringify(
      {
        baselineProfile: profileFixture.baselineProfile,
        candidateProfile: profileFixture.candidateProfile,
        recommendedSize: profileFixture.recommendedSize,
      },
      null,
      2,
    )}\n`,
  )
  const fixtures = [
    { path: fixturePath, serialized },
    { path: profileFixturePath, serialized: serializedProfileProposalFixture },
    { path: profileStateFixturePath, serialized: serializedProfileStateFixture },
  ]

  if (args[0] === '--check') {
    const stale = fixtures
      .filter((fixture) => readFileSync(fixture.path, 'utf8') !== fixture.serialized)
      .map((fixture) => fixture.path)
    if (stale.length > 0) {
      throw new Error(
        `agent improvement proposal fixture(s) are stale: ${stale.join(', ')}; run pnpm generate:testing-fixture`,
      )
    }
    process.stdout.write('agent improvement proposal fixtures are current\n')
  } else {
    for (const fixture of fixtures) {
      mkdirSync(dirname(fixture.path), { recursive: true })
      writeFileSync(fixture.path, fixture.serialized)
      process.stdout.write(`wrote ${fixture.path}\n`)
    }
  }
} finally {
  cleanupCandidateExperimentFixtures?.()
  cleanupCandidateFixtures?.()
  Date.now = originalDateNow
  if (originalPerformanceNow) Object.defineProperty(performance, 'now', originalPerformanceNow)
  else delete (performance as { now?: () => number }).now
  crypto.randomBytes = originalRandomBytes
  syncBuiltinESMExports()
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}
