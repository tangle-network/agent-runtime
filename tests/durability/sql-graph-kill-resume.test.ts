/** The existing conformance graph, moved between independent hosts' local directories via SQL. */
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SpawnEvent } from '../../src/runtime/supervise/types'
import { ARTIFACT_KEY, EXPECTED_OUT, RUN_ID, WORKER_NODES } from '../helpers/durability/conformance-graph'

const script = new URL('../helpers/durability/sql-graph-child.ts', import.meta.url).pathname
interface Report {
  kind: string
  out: unknown
  labels: string[]
  events: SpawnEvent[]
  effects: Array<{ effect_key: string }>
  escalations: unknown[]
}
async function phase(file: string, label?: string) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', script, file, ...(label ? [label] : [])], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000)
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }) })
  })
}
function report(stdout: string): Report {
  const line = stdout.split('\n').filter((value) => value.startsWith('{')).at(-1)
  if (!line) throw new Error(`missing child report: ${stdout}`)
  return JSON.parse(line) as Report
}
function assertConformance(value: Report) {
  expect(value.kind).toBe('winner')
  expect(value.out).toEqual(EXPECTED_OUT)
  expect(value.effects).toEqual([{ effect_key: ARTIFACT_KEY }])
  // Unlike the old file suite, SQL must recover the ORIGINAL spawn, not escalate to a new key.
  expect(value.escalations).toEqual([])
  expect(value.events.filter((e) => e.kind === 'spawned' && e.parent === undefined)).toHaveLength(1)
  expect(value.events.filter((e) => e.kind === 'materialized' && e.id === RUN_ID).length).toBeLessThanOrEqual(1)
  const cursors = value.events.flatMap((e) => e.kind === 'settled' || e.kind === 'cancelled' ? [e.seq] : [])
  expect(new Set(cursors).size).toBe(cursors.length)
  for (const label of WORKER_NODES) {
    const spawns = value.events.filter((e): e is Extract<SpawnEvent, { kind: 'spawned' }> => e.kind === 'spawned' && e.label === label)
    expect(spawns, `one original spawn for ${label}`).toHaveLength(1)
    expect(value.events.filter((e) => e.kind === 'settled' && e.status === 'done' && e.id === spawns[0]?.id)).toHaveLength(1)
  }
}

describe('runGraph SQL kill-and-resume conformance', () => {
  it('SIGKILL at every observed boundary resumes without losing/duplicating a step or an in-doubt spawn', { timeout: 900_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sql-graph-matrix-'))
    try {
      const reference = await phase(join(dir, 'reference.sqlite'))
      expect(reference.code, reference.stderr).toBe(0)
      const baseline = report(reference.stdout)
      assertConformance(baseline)
      expect(baseline.labels).toContain('tool:commit:after-effect')
      expect(baseline.labels.some((label) => label.startsWith('journal:after:execution-result:'))).toBe(true)
      for (const [index, label] of baseline.labels.entries()) {
        const file = join(dir, `kill-${index}.sqlite`)
        const killed = await phase(file, label)
        expect(killed.signal, `${label}: ${killed.stderr}`).toBe('SIGKILL')
        // Database clock has one-second resolution on SQLite; use a conservative expiry margin.
        await new Promise<void>((resolve) => setTimeout(resolve, 2200))
        const resumed = await phase(file)
        expect(resumed.code, `${label}: ${resumed.stderr}`).toBe(0)
        assertConformance(report(resumed.stdout))
      }
      console.log(`SQL graph kill matrix: ${baseline.labels.length} boundaries passed`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
