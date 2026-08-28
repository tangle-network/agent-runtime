import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertReleaseCohortArtifacts,
  readReleaseCohort,
  releaseCohortOutputKey,
} from './release-cohort.mjs'

const workspaces = []

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true })
  }
})

describe('release cohort', () => {
  it('reads one exact source identity for every first-party dependency', () => {
    const cohort = readReleaseCohort()
    expect(Object.keys(cohort.packages)).toEqual([
      'agentInterface',
      'agentEval',
      'agentKnowledge',
    ])
    expect(Object.values(cohort.packages).every((entry) => /^[a-f0-9]{40}$/.test(entry.ref))).toBe(
      true,
    )
  })

  it('rejects missing packages and non-commit refs', () => {
    const cohort = readReleaseCohort()
    const missing = structuredClone(cohort)
    delete missing.packages.agentKnowledge
    expect(() => readReleaseCohort(writeManifest(missing))).toThrow(/must be exactly/)

    const moving = structuredClone(cohort)
    moving.packages.agentEval.ref = 'main'
    expect(() => readReleaseCohort(writeManifest(moving))).toThrow(/full commit ref/)
  })

  it('rejects a packed artifact from a different version or source commit', () => {
    const cohort = readReleaseCohort()
    const artifacts = Object.values(cohort.packages).map((entry) => ({
      name: entry.name,
      version: entry.version,
      sourceCommit: entry.ref,
    }))
    expect(() => assertReleaseCohortArtifacts(artifacts, cohort)).not.toThrow()

    const wrongVersion = structuredClone(artifacts)
    wrongVersion[1].version = '0.0.0'
    expect(() => assertReleaseCohortArtifacts(wrongVersion, cohort)).toThrow(/version mismatch/)

    const wrongCommit = structuredClone(artifacts)
    wrongCommit[2].sourceCommit = 'f'.repeat(40)
    expect(() => assertReleaseCohortArtifacts(wrongCommit, cohort)).toThrow(/commit mismatch/)
  })

  it('uses stable GitHub output names', () => {
    expect(releaseCohortOutputKey('agentInterface', 'ref')).toBe('agent_interface_ref')
    expect(releaseCohortOutputKey('agentKnowledge', 'version')).toBe(
      'agent_knowledge_version',
    )
  })
})

function writeManifest(value) {
  const workspace = mkdtempSync(join(tmpdir(), 'agent-runtime-release-cohort-'))
  workspaces.push(workspace)
  const path = join(workspace, 'cohort.json')
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
  return path
}
