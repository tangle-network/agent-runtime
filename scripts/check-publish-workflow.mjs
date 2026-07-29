import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workflowPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(repoRoot, '.github/workflows/publish.yml')
const document = parseDocument(readFileSync(workflowPath, 'utf8'))

if (document.errors.length > 0) {
  throw new Error(`publish workflow is invalid YAML: ${document.errors.join('; ')}`)
}

const workflow = document.toJS()
const jobs = workflow.jobs
if (!jobs || typeof jobs !== 'object') throw new Error('publish workflow has no jobs')

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
  assertCount(actionNames, /^actions\/download-artifact@[a-f0-9]{40}$/, 1, `${jobName} artifact download`)

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

process.stdout.write('Publish workflow keeps package creation separate from npm authority.\n')

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
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
  }
}
