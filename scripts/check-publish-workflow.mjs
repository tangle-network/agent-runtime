import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import { readReleaseCohort, releaseCohortOutputKey } from './release-cohort.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workflowPath = resolve(process.argv[2] || resolve(repoRoot, '.github/workflows/publish.yml'))
const workflow = readWorkflow(workflowPath, 'publish')
const jobs = workflow.jobs
if (!jobs || typeof jobs !== 'object') throw new Error('publish workflow has no jobs')
const qualificationPath = resolve(process.argv[3] || resolve(repoRoot, '.github/workflows/qualify-release.yml'))
const qualification = readWorkflow(qualificationPath, 'qualification')
const qualifierJobs = qualification.jobs
if (!qualifierJobs || typeof qualifierJobs !== 'object') throw new Error('qualification workflow has no jobs')
const qualifier = requireJob('qualify')
assertEqual(qualifier.uses, './.github/workflows/qualify-release.yml', 'qualification body frozen with the release workflow')
assertEqual(qualifier.with?.release_tag, '${{ inputs.release_tag }}', 'qualification release tag')
for (const [name, job] of Object.entries(qualifierJobs)) {
  assertEqual(job['runs-on']?.group, 'public-app-production', `${name} trusted runner group`)
  for (const label of ['self-hosted', 'ci-deploy']) {
    if (!job['runs-on']?.labels?.includes(label)) throw new Error(`${name} is missing trusted runner label ${label}`)
  }
}
for (const [prefix, jobName] of [['runtime', 'verify'], ['bench', 'verify-agent-bench']]) {
  for (const output of ['release-version', 'package-sha256', 'publication-pending']) {
    assertEqual(qualification.on?.workflow_call?.outputs?.[`${prefix}-${output}`]?.value,
      `\${{ jobs.${jobName}.outputs.${output} }}`, `${prefix} ${output} output forwarding`)
  }
}
const consumer = requireJob('verify-publication')
assertEqual(consumer.if, "!cancelled() && needs.qualify.result == 'success' && !contains(needs.*.result, 'failure') && !contains(needs.*.result, 'cancelled')", 'publication verifier success gating')
assertEqual(consumer.needs?.join(','), 'qualify,publish-npm,publish-agent-bench', 'publication verifier dependencies')
assertEqual(consumer.env?.EXPECTED_SHA256,
  "${{ startsWith(github.ref, 'refs/tags/agent-bench-v') && needs.qualify.outputs.bench-package-sha256 || needs.qualify.outputs.runtime-package-sha256 }}", 'publication verifier qualified hash')
const consumerCommand = requireSteps('verify-publication', consumer).find((step) => step.run)?.run ?? ''
if (!consumerCommand.includes('node scripts/check-npm-publication.mjs "$RUNNER_TEMP/publication-package" --require-published') || !consumerCommand.includes('[ "$status" -eq 3 ] || exit "$status"'))
  throw new Error('publication verifier must require actual bytes and fail closed on mismatches')
const releaseCohort = readReleaseCohort()

const publishJobs = {
  'publish-npm': 'verify',
  'publish-agent-bench': 'verify-agent-bench',
}

for (const [jobName, requiredJob] of Object.entries(publishJobs)) {
  const job = requireJob(jobName)
  assertEqual(job.permissions?.['id-token'], 'write', `${jobName} id-token permission`)
  assertEqual(job.needs, 'qualify', `${jobName} qualification dependency`)
  const prefix = requiredJob === 'verify' ? 'runtime' : 'bench'
  for (const [variable, output] of [['EXPECTED_VERSION', 'release-version'], ['EXPECTED_SHA256', 'package-sha256']]) {
    assertEqual(job.env?.[variable], `\${{ needs.qualify.outputs.${prefix}-${output} }}`, `${jobName} ${variable}`)
  }

  const verifier = requireJob(requiredJob, qualifierJobs)
  assertEqual(
    verifier.outputs?.['publication-pending'],
    '${{ steps.npm.outputs.pending }}',
    `${requiredJob} publication admission output`,
  )
  const admission = requireSteps(requiredJob, verifier).filter((step) => step.id === 'npm')
  assertEqual(admission.length, 1, `${requiredJob} publication admission step count`)
  assertEqual(
    admission[0].run,
    `node scripts/check-npm-publication.mjs "$RUNNER_TEMP/${prefix === 'runtime' ? 'agent-runtime' : 'agent-bench'}-package"`,
    `${requiredJob} exact archive admission`,
  )
  for (const flag of ['if', 'continue-on-error'])
    assertEqual(admission[0][flag], undefined, `${requiredJob} admission ${flag}`)

  const steps = requireSteps(jobName, job)
  const actionNames = steps.flatMap((step) => (typeof step.uses === 'string' ? [step.uses] : []))
  for (const action of ['setup-node', 'download-artifact'])
    assertCount(actionNames, new RegExp(`^actions/${action}@[a-f0-9]{40}$`), 1, `${jobName} ${action}`)

  for (const step of steps) {
    if (typeof step.uses === 'string') {
      if (/^actions\/checkout@|^pnpm\/action-setup@/.test(step.uses)) {
        throw new Error(`${jobName} may not check out source or install pnpm: ${step.uses}`)
      }
    }

    if (typeof step.run === 'string') {
      const forbidden = [
        /(^|\s)pnpm(\s|$)/m,
        /(^|\s)npm\s+(ci|install|pack|rebuild|run)(\s|$)/m,
        /(^|\s)(npx|corepack)(\s|$)/m,
      ]
      for (const pattern of forbidden) {
        if (pattern.test(step.run)) {
          throw new Error(`${jobName} runs dependency or build tooling: ${pattern}`)
        }
      }
    }
  }

  const commands = steps.map((step) => step.run ?? '').join('\n')
  for (const required of [
    'sha256sum',
    'npm publish',
    '--ignore-scripts',
    '--provenance',
    'registered with npm',
  ]) {
    if (!commands.includes(required)) {
      throw new Error(`${jobName} publish command is missing ${required}`)
    }
  }
}

for (const [group, defaults] of [[jobs, workflow.permissions], [qualifierJobs, qualification.permissions]]) {
  for (const [jobName, job] of Object.entries(group)) {
    const permissions = job.permissions === undefined && job !== qualifier ? defaults : job.permissions
    const publisher = group === jobs && jobName in publishJobs
    assertEqual(permissions?.contents, 'read', `${jobName} contents permission`)
    if (job === qualifier) assertEqual(permissions?.statuses, 'read', 'qualification status permission')
    if (permissions?.['id-token'] === 'write' && !publisher)
      throw new Error(`unexpected job can mint a package identity token: ${jobName}`)
    for (const step of job.steps ?? []) {
      if (step.uses && !/@[a-f0-9]{40}$/.test(step.uses)) throw new Error(`${jobName} action is not pinned`)
      if (step.uses?.startsWith('actions/checkout@'))
        assertEqual(step.with?.['persist-credentials'], false, `${jobName} checkout credentials`)
      if (!publisher && (job.env?.NPM_TOKEN || job.env?.NODE_AUTH_TOKEN || step.env?.NPM_TOKEN || step.env?.NODE_AUTH_TOKEN))
        throw new Error(`${jobName} must not receive publishing credentials`)
    }
  }
}

for (const jobName of ['verify', 'verify-agent-bench']) {
  const steps = requireSteps(jobName, requireJob(jobName, qualifierJobs))
  assertCount(
    steps.flatMap((step) => (typeof step.uses === 'string' ? [step.uses] : [])),
    /^actions\/upload-artifact@[a-f0-9]{40}$/,
    1,
    `${jobName} artifact upload`,
  )
}

// All release checks consume the same validated commit, including manual tag retries.
const source = requireJob('release-source', qualifierJobs)
assertEqual(source.outputs?.sha, '${{ steps.release.outputs.sha }}', 'release source SHA output')
assertEqual(
  source.outputs?.version,
  '${{ steps.release.outputs.version }}',
  'release source version output',
)
assertEqual(
  source.if,
  "github.repository == 'tangle-network/agent-runtime' && (startsWith(github.ref, 'refs/tags/v') || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'))",
  'release source event selection',
)
assertEqual(source['continue-on-error'], undefined, 'release source cannot ignore failure')
const sourceSteps = requireSteps('release-source', source)
const sourceCheckout = sourceSteps.find((step) => step.uses?.startsWith('actions/checkout@'))
assertEqual(
  sourceCheckout?.with?.ref,
  "${{ github.event_name == 'workflow_dispatch' && inputs.release_tag || github.ref }}",
  'release source tag selection',
)
const sourceGuard = sourceSteps.find((step) => step.id === 'release')
assertEqual(
  sourceGuard?.env?.RELEASE_TAG,
  "${{ github.event_name == 'workflow_dispatch' && inputs.release_tag || github.ref_name }}",
  'release source tag validation',
)
for (const step of sourceSteps.filter((step) => typeof step.run === 'string')) {
  assertEqual(step.if, undefined, 'release source guard cannot be conditional')
  assertEqual(step['continue-on-error'], undefined, 'release source guard cannot ignore failure')
}

const sourceCommands = sourceSteps.map((step) => step.run ?? '').join('\n')
for (const required of [
  'sha=$CHECKOUT_SHA',
  '"$CHECKOUT_SHA" != "$TAG_SHA"',
  '"$TAG_VERSION" != "$NPM_VERSION"',
  'refs/remotes/origin/main',
  'release/${VERSION%.*}.x',
]) {
  if (!sourceCommands.includes(required))
    throw new Error(`release source validation is missing ${required}`)
}
const verify = requireJob('verify', qualifierJobs)
assertEqual(verify.needs, 'release-source', 'verification source dependency')
const verifySteps = requireSteps('verify', verify)
const check = verifySteps.find((step) => step.run === 'pnpm run release:check')
assertEqual(check?.if, "needs.release-source.outputs.qualified != 'true'", 'unqualified source fallback')
assertEqual(check?.['continue-on-error'], undefined, 'source qualification cannot ignore failures')
const build = verifySteps.find((step) => step.run === 'pnpm run build')
assertEqual(build?.if, "needs.release-source.outputs.qualified == 'true'", 'qualified source build')
const proof = sourceSteps.find((step) => step.id === 'gate')
assertEqual(proof?.run, 'node "$RUNNER_TEMP/release-policy/release-gate.mjs" --github-output "$GITHUB_OUTPUT"', 'trusted proof policy')
assertEqual(proof?.env?.GH_TOKEN, '${{ github.token }}', 'read-only proof lookup')
assertEqual(source.outputs?.qualified, '${{ steps.gate.outputs.qualified }}', 'qualification proof output')
if (!sourceCommands.includes('git show origin/main:scripts/release-gate.mjs')) throw new Error('proof policy must come from reviewed main')
for (const name of ['verify-official-optimizers', 'verify-runtime-bench'])
  assertEqual(qualifierJobs[name], undefined, `${name} belongs to the local release gate`)
const { scripts } = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
assertEqual(scripts.test, 'pnpm run build && pnpm run typecheck && pnpm run lint && vitest run', 'complete source qualification')
const releaseCheck = scripts['release:check']
for (const command of ['check:publish-workflow', 'pnpm run test', 'check-release-archive.mjs', 'check-version-bump.mjs --archive', 'verify:official-optimizers', 'verify:bench'])
  if (!releaseCheck.includes(command)) throw new Error(`release:check must include ${command}`)
assertEqual(
  requireJob('publish-npm').if,
  "(startsWith(github.ref, 'refs/tags/v') || github.event_name == 'workflow_dispatch') && needs.qualify.outputs.runtime-publication-pending == 'true'",
  'publish must retain default success gating and require missing version',
)
assertEqual(requireJob('publish-agent-bench').if,
  "startsWith(github.ref, 'refs/tags/agent-bench-v') && needs.qualify.outputs.bench-publication-pending == 'true'",
  'bench publication event and missing-version selection')

const archiveUpload = requireSteps('verify', requireJob('verify', qualifierJobs)).find((step) =>
  step.uses?.startsWith('actions/upload-artifact@'),
)
for (const file of ['*.tgz', 'agent-runtime-conformance-manifest.json', 'cohort-report.json']) {
  if (!archiveUpload?.with?.path?.includes(`agent-runtime-package/${file}`))
    throw new Error(`verified release artifact is missing ${file}`)
}

assertCohortJob(qualification, 'verify', releaseCohort)

process.stdout.write('Publish workflow keeps package creation separate from npm authority.\n')

function readWorkflow(path, label) {
  const document = parseDocument(readFileSync(path, 'utf8'))
  if (document.errors.length > 0) {
    throw new Error(`${label} workflow is invalid YAML: ${document.errors.join('; ')}`)
  }
  return document.toJS()
}

function assertCohortJob(targetWorkflow, jobName, cohort) {
  const job = requireJob(jobName, targetWorkflow.jobs ?? {})
  const steps = requireSteps(jobName, job)
  const readers = steps.filter((step) => step.id === 'cohort')
  assertEqual(readers.length, 1, `${jobName} cohort reader count`)
  assertEqual(
    readers[0].run,
    'node scripts/release-cohort.mjs --github-output "$GITHUB_OUTPUT"',
    `${jobName} cohort reader command`,
  )

  for (const [key, entry] of Object.entries(cohort.packages)) {
    const checkouts = steps.filter(
      (step) =>
        typeof step.uses === 'string' &&
        step.uses.startsWith('actions/checkout@') &&
        step.with?.repository === entry.repository,
    )
    assertEqual(checkouts.length, 1, `${jobName} ${entry.name} checkout count`)
    assertEqual(
      checkouts[0].with?.ref,
      `\${{ steps.cohort.outputs.${releaseCohortOutputKey(key, 'ref')} }}`,
      `${jobName} ${entry.name} ref`,
    )
  }

  const commands = steps.map((step) => step.run ?? '').join('\n')
  if (!commands.includes('--cohort-manifest release/cohort.json')) {
    throw new Error(`${jobName} does not verify the declared release cohort`)
  }
}

function requireJob(name, target = jobs) {
  const job = target[name]
  if (!job || typeof job !== 'object') throw new Error(`publish workflow is missing job ${name}`)
  return job
}

function requireSteps(jobName, job) {
  if (!Array.isArray(job.steps)) throw new Error(`${jobName} has no steps`)
  return job.steps
}

function assertCount(values, pattern, expected, label) {
  assertEqual(values.filter((value) => pattern.test(value)).length, expected, label)
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    )
  }
}
