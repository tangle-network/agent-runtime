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
const biomePath = resolve(repoRoot, 'node_modules/.bin/biome')
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
  version?: unknown
}
if (typeof packageJson.version !== 'string' || !packageJson.version) {
  throw new Error('package.json must contain a Runtime version')
}

const args = process.argv.slice(2)
if (args.some((arg) => arg !== '--check') || args.length > 1) {
  throw new Error('usage: generate-agent-improvement-proposal-fixture.ts [--check]')
}

const fixedNowMs = Date.parse('2026-07-10T00:00:00.000Z')
const originalDateNow = Date.now
const originalRandomBytes = crypto.randomBytes
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

function formatFixture(serialized: string): string {
  return execFileSync(biomePath, ['format', `--stdin-file-path=${fixturePath}`], {
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
  const [runtime, experimentFixtures, executionFixtures] = await Promise.all([
    import('../src/intelligence/improvement-cycle'),
    import('../tests/helpers/candidate-experiment-fixture'),
    import('../tests/helpers/candidate-execution-fixture'),
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
    `${JSON.stringify(runtime.verifyAgentImprovementProposal(proposal), null, 2)}\n`,
  )

  if (args[0] === '--check') {
    if (readFileSync(fixturePath, 'utf8') !== serialized) {
      throw new Error(
        'agent improvement proposal fixture is stale; run pnpm generate:testing-fixture',
      )
    }
    process.stdout.write('agent improvement proposal fixture is current\n')
  } else {
    mkdirSync(dirname(fixturePath), { recursive: true })
    writeFileSync(fixturePath, serialized)
    process.stdout.write(`wrote ${fixturePath}\n`)
  }
} finally {
  cleanupCandidateExperimentFixtures?.()
  cleanupCandidateFixtures?.()
  Date.now = originalDateNow
  crypto.randomBytes = originalRandomBytes
  syncBuiltinESMExports()
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}
