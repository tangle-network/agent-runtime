import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'

const root = resolve(import.meta.dirname, '..')
const original = readFileSync(join(root, '.github/workflows/publish.yml'), 'utf8')
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function check(mutate: (workflow: ReturnType<typeof parse>) => void = () => {}) {
  const workflow = parse(original)
  mutate(workflow)
  const directory = mkdtempSync(join(tmpdir(), 'publish-contract-'))
  directories.push(directory)
  const path = join(directory, 'publish.yml')
  writeFileSync(path, stringify(workflow))
  return spawnSync(process.execPath, [join(root, 'scripts/check-publish-workflow.mjs'), path], {
    cwd: root,
    encoding: 'utf8',
  })
}

it('accepts the release graph with immutable parallel checks and isolated publication', () => {
  const result = check()
  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
})

it.each(['verify', 'verify-official-optimizers', 'verify-runtime-bench'])(
  'rejects publication without required %s evidence',
  (name) => {
    const result = check((workflow) => {
      workflow.jobs['publish-npm'].needs = workflow.jobs['publish-npm'].needs.filter(
        (job: string) => job !== name,
      )
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`must depend on ${name}`)
  },
)

it('rejects a mutable checkout in a parallel verifier', () => {
  const result = check((workflow) => {
    workflow.jobs['verify-runtime-bench'].steps[0].with.ref = 'main'
  })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('immutable checkout')
})

it('rejects silently ignored optimizer failures', () => {
  const result = check((workflow) => {
    workflow.jobs['verify-official-optimizers'].steps.at(-1)['continue-on-error'] = true
  })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('required check failure')
})

it('rejects moving a parallel verifier behind the long archive verifier', () => {
  const result = check((workflow) => {
    workflow.jobs['verify-runtime-bench'].needs = 'verify'
  })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('parallel source dependency')
})

it('rejects npm authority in an integration job', () => {
  const result = check((workflow) => {
    workflow.jobs['verify-runtime-bench'].permissions = { 'id-token': 'write' }
  })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('unexpected job can mint')
})

it('preserves pushed Runtime tags, explicit retry tags, and Bench-only skipping', () => {
  const workflow = parse(original)
  expect(workflow.jobs['release-source'].if).toBe(
    "startsWith(github.ref, 'refs/tags/v') || github.event_name == 'workflow_dispatch'",
  )
  expect(workflow.jobs['release-source'].steps[0].with.ref).toBe(
    "${{ github.event_name == 'workflow_dispatch' && inputs.release_tag || github.ref }}",
  )
  expect(workflow.jobs['verify-agent-bench'].if).toBe(
    "startsWith(github.ref, 'refs/tags/agent-bench-v')",
  )
  const result = check((changed) => {
    changed.jobs['release-source'].steps[0].with.ref = '${{ github.sha }}'
  })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('release source tag selection')
})

it('rejects unconditional publication after a failed or skipped verification', () => {
  const result = check((workflow) => {
    workflow.jobs['publish-npm'].if = 'always()'
  })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('default success gating')
})

it('rejects dropping raw cohort evidence from the retained release artifact', () => {
  const result = check((workflow) => {
    const upload = workflow.jobs.verify.steps.find((step: { uses?: string }) =>
      step.uses?.startsWith('actions/upload-artifact@'),
    )
    upload.with.path = upload.with.path.replace(/.*cohort-report.json\n?/, '')
  })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('verified release artifact is missing cohort-report.json')
})
