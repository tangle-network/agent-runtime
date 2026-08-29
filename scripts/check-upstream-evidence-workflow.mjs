import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import { UPSTREAM_CONTRACTS } from './lib/upstream-contract.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workflowPath = resolve(
  process.argv[2] ?? resolve(repoRoot, '.github/workflows/upstream-evidence.yml'),
)
const workflow = readWorkflow(workflowPath)
const jobs = workflow.jobs
if (!jobs || typeof jobs !== 'object') throw new Error('upstream evidence workflow has no jobs')

assertEqual(workflow.permissions?.contents, 'read', 'workflow contents permission')
assertJob('package')
assertNoWritePermissions()
assertPackageJob(jobs.package)
assertContractJob(jobs.contract)

process.stdout.write('Upstream evidence workflow is pinned, tag-bound, and retains exact UP-ID artifacts.\n')

function readWorkflow(path) {
  const document = parseDocument(readFileSync(path, 'utf8'))
  if (document.errors.length > 0) {
    throw new Error(`upstream evidence workflow is invalid YAML: ${document.errors.join('; ')}`)
  }
  return document.toJS()
}

function assertPackageJob(job) {
  assertEqual(job.permissions, undefined, 'package job permissions')
  const steps = requireSteps('package', job)
  assertPinnedActions('package', steps)
  const checkout = steps.find((step) => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'))
  assertEqual(checkout?.with?.['persist-credentials'], false, 'package checkout credentials')
  const packageStep = steps.find((step) => step.id === 'package')
  if (!packageStep || typeof packageStep.run !== 'string') throw new Error('package archive step is missing')
  for (const required of ['pnpm pack', 'sha256sum', 'verify-package-exports.mjs']) {
    if (!packageStep.run.includes(required)) throw new Error(`package archive step is missing ${required}`)
  }
  const upload = requireArtifactUpload('package', steps, 'agent-runtime-upstream-tarball')
  assertEqual(upload.with?.['retention-days'], 90, 'package archive retention')
  assertEqual(upload.with?.['compression-level'], 0, 'package archive compression')
}

function assertContractJob(job) {
  assertEqual(job.name, '${{ matrix.check }}', 'contract job name')
  assertNeeds(job, 'package')
  const checks = job.strategy?.matrix?.check
  assertEqual(JSON.stringify(checks), JSON.stringify(Object.keys(UPSTREAM_CONTRACTS)), 'contract matrix')
  const steps = requireSteps('contract', job)
  assertPinnedActions('contract', steps)
  const checkout = steps.find((step) => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'))
  assertEqual(checkout?.with?.['persist-credentials'], false, 'contract checkout credentials')
  const runner = steps.find((step) => typeof step.run === 'string' && step.run.includes('run-upstream-contract.mjs'))
  if (!runner) throw new Error('contract job does not invoke the packed contract runner')
  for (const required of [
    '--check "$CHECK"',
    '--tarball',
    '--release-tag "$GITHUB_REF_NAME"',
    '--tag-commit "$GITHUB_SHA"',
    '--cohort-manifest release/cohort.json',
  ]) {
    if (!runner.run.includes(required)) throw new Error(`contract runner is missing ${required}`)
  }
  const upload = requireArtifactUpload('contract', steps, 'agent-runtime-${{ matrix.check }}')
  assertEqual(upload.with?.['retention-days'], 90, 'contract evidence retention')
  assertEqual(upload.with?.['compression-level'], 0, 'contract evidence compression')
}

function assertNoWritePermissions() {
  for (const [name, job] of Object.entries(jobs)) {
    if (job?.permissions?.contents === 'write') throw new Error(`${name} may not write repository contents`)
    if (job?.permissions?.['id-token'] === 'write') throw new Error(`${name} may not mint package identity tokens`)
  }
}

function assertPinnedActions(jobName, steps) {
  for (const step of steps) {
    if (typeof step.uses !== 'string') continue
    if (!/@[a-f0-9]{40}$/.test(step.uses)) {
      throw new Error(`${jobName} action is not pinned to a commit: ${step.uses}`)
    }
  }
}

function requireArtifactUpload(jobName, steps, expectedName) {
  const uploads = steps.filter(
    (step) => typeof step.uses === 'string' && /^actions\/upload-artifact@/.test(step.uses),
  )
  assertEqual(uploads.length, 1, `${jobName} artifact upload count`)
  assertEqual(uploads[0].with?.name, expectedName, `${jobName} artifact name`)
  return uploads[0]
}

function assertJob(name) {
  if (!jobs[name] || typeof jobs[name] !== 'object') throw new Error(`workflow is missing job ${name}`)
}

function requireSteps(jobName, job) {
  if (!Array.isArray(job.steps)) throw new Error(`${jobName} has no steps`)
  return job.steps
}

function assertNeeds(job, expected) {
  const needs = Array.isArray(job.needs) ? job.needs : [job.needs]
  if (!needs.includes(expected)) throw new Error(`job must depend on ${expected}`)
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
  }
}
