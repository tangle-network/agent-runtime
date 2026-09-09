import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import { readReleaseCohort, releaseCohortOutputKey } from './release-cohort.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workflowPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(repoRoot, '.github/workflows/publish.yml')
const workflow = readWorkflow(workflowPath, 'publish')
const jobs = workflow.jobs
if (!jobs || typeof jobs !== 'object') throw new Error('publish workflow has no jobs')
const releaseCohort = readReleaseCohort()

const publishJobs = {
  'publish-npm': 'verify',
  'publish-agent-bench': 'verify-agent-bench',
}

for (const [jobName, requiredJob] of Object.entries(publishJobs)) {
  const job = requireJob(jobName)
  assertEqual(job.permissions?.contents, 'read', `${jobName} contents permission`)
  assertEqual(job.permissions?.['id-token'], 'write', `${jobName} id-token permission`)
  assertNeeds(job, requiredJob)

  const steps = requireSteps(jobName, job)
  const actionNames = steps.flatMap((step) => (typeof step.uses === 'string' ? [step.uses] : []))
  assertCount(actionNames, /^actions\/setup-node@[a-f0-9]{40}$/, 1, `${jobName} setup-node`)
  assertCount(
    actionNames,
    /^actions\/download-artifact@[a-f0-9]{40}$/,
    1,
    `${jobName} artifact download`,
  )

  for (const step of steps) {
    if (typeof step.uses === 'string') {
      if (/^actions\/checkout@|^pnpm\/action-setup@/.test(step.uses)) {
        throw new Error(`${jobName} may not check out source or install pnpm: ${step.uses}`)
      }
      if (!/@[a-f0-9]{40}$/.test(step.uses)) {
        throw new Error(`${jobName} action is not pinned to a commit: ${step.uses}`)
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
  for (const required of ['sha256sum', 'npm publish', '--ignore-scripts', '--provenance']) {
    if (!commands.includes(required)) {
      throw new Error(`${jobName} publish command is missing ${required}`)
    }
  }
}

for (const [jobName, job] of Object.entries(jobs)) {
  const idToken = job?.permissions?.['id-token']
  if (idToken === 'write' && !(jobName in publishJobs)) {
    throw new Error(`unexpected job can mint a package identity token: ${jobName}`)
  }
  if (job?.permissions?.contents === 'write') {
    throw new Error(`publish workflow must not write repository contents: ${jobName}`)
  }
}

for (const jobName of ['verify', 'verify-agent-bench']) {
  const job = requireJob(jobName)
  if (job.permissions?.['id-token'] === 'write') {
    throw new Error(`${jobName} may not mint a package identity token`)
  }
  const steps = requireSteps(jobName, job)
  assertCount(
    steps.flatMap((step) => (typeof step.uses === 'string' ? [step.uses] : [])),
    /^actions\/upload-artifact@[a-f0-9]{40}$/,
    1,
    `${jobName} artifact upload`,
  )
  for (const step of steps) {
    if (typeof step.uses === 'string' && /^actions\/checkout@/.test(step.uses)) {
      assertEqual(step.with?.['persist-credentials'], false, `${jobName} checkout credentials`)
    }
  }
}

// All release checks consume the same validated commit, including manual tag retries.
const source = requireJob('release-source')
assertEqual(source.outputs?.sha, '${{ steps.release.outputs.sha }}', 'release source SHA output')
assertEqual(
  source.outputs?.version,
  '${{ steps.release.outputs.version }}',
  'release source version output',
)
assertEqual(
  source.if,
  "startsWith(github.ref, 'refs/tags/v') || github.event_name == 'workflow_dispatch'",
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
const releaseChecks = {
  verify: 'pnpm run verify:package:static',
  'verify-official-optimizers': 'pnpm run verify:official-optimizers',
  'verify-runtime-bench': 'pnpm run verify:bench',
}
for (const [name, command] of Object.entries(releaseChecks)) {
  const job = requireJob(name)
  assertEqual(job.needs, 'release-source', `${name} parallel source dependency`)
  assertEqual(job.if, undefined, `${name} must require successful source validation`)
  assertEqual(job['continue-on-error'], undefined, `${name} cannot ignore failure`)
  assertNeeds(requireJob('publish-npm'), name)
  const steps = requireSteps(name, job)
  const checkout = steps.find(
    (step) => step.uses?.startsWith('actions/checkout@') && !step.with?.repository,
  )
  assertEqual(
    checkout?.with?.ref,
    '${{ needs.release-source.outputs.sha }}',
    `${name} immutable checkout`,
  )
  const checks = steps.filter((step) => step.run === command)
  assertEqual(checks.length, 1, `${name} required check count`)
  assertEqual(checks[0].if, undefined, `${name} required check condition`)
  assertEqual(checks[0]['continue-on-error'], undefined, `${name} required check failure`)
}
assertEqual(
  requireJob('publish-npm').if,
  "startsWith(github.ref, 'refs/tags/v') || github.event_name == 'workflow_dispatch'",
  'publish must retain default success gating',
)
for (const name of ['release-source', ...Object.keys(releaseChecks)]) {
  for (const step of requireSteps(name, requireJob(name))) {
    if (step.uses && !/@[a-f0-9]{40}$/.test(step.uses))
      throw new Error(`${name} action is not pinned`)
    if (step.uses?.startsWith('actions/checkout@'))
      assertEqual(step.with?.['persist-credentials'], false, `${name} checkout credentials`)
    if (step.env?.NPM_TOKEN || step.env?.NODE_AUTH_TOKEN)
      throw new Error(`${name} must not receive publishing credentials`)
  }
}

const archiveUpload = requireSteps('verify', requireJob('verify')).find((step) =>
  step.uses?.startsWith('actions/upload-artifact@'),
)
for (const file of ['*.tgz', 'agent-runtime-conformance-manifest.json', 'cohort-report.json']) {
  if (!archiveUpload?.with?.path?.includes(`agent-runtime-package/${file}`))
    throw new Error(`verified release artifact is missing ${file}`)
}

assertCohortJob(workflow, 'verify', releaseCohort)
assertCohortJob(
  readWorkflow(resolve(repoRoot, '.github/workflows/ci.yml'), 'CI'),
  'packed-cohort',
  releaseCohort,
)

process.stdout.write('Publish workflow keeps package creation separate from npm authority.\n')

function readWorkflow(path, label) {
  const document = parseDocument(readFileSync(path, 'utf8'))
  if (document.errors.length > 0) {
    throw new Error(`${label} workflow is invalid YAML: ${document.errors.join('; ')}`)
  }
  return document.toJS()
}

function assertCohortJob(targetWorkflow, jobName, cohort) {
  const job = targetWorkflow.jobs?.[jobName]
  if (!job || typeof job !== 'object') throw new Error(`workflow is missing job ${jobName}`)
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

function requireJob(name) {
  const job = jobs[name]
  if (!job || typeof job !== 'object') throw new Error(`publish workflow is missing job ${name}`)
  return job
}

function requireSteps(jobName, job) {
  if (!Array.isArray(job.steps)) throw new Error(`${jobName} has no steps`)
  return job.steps
}

function assertNeeds(job, expected) {
  const needs = Array.isArray(job.needs) ? job.needs : [job.needs]
  if (!needs.includes(expected)) throw new Error(`publish job must depend on ${expected}`)
}

function assertCount(values, pattern, expected, label) {
  const count = values.filter((value) => pattern.test(value)).length
  if (count !== expected) throw new Error(`${label}: expected ${expected}, received ${count}`)
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    )
  }
}
