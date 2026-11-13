// Exercise the public ruler against real Linux namespaces and delegated kernel counters.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeSync } from 'node:fs'
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { measurePairedCommands } from '../../dist/kernel.js'

const workspace = await mkdtemp(join(tmpdir(), 'runtime-paired-proof-'))
const tree = join(workspace, 'input')
await mkdir(tree)
const command = (seconds, text = 'same') => ({
  workspaceRoot: workspace,
  tree,
  maxOutputBytes: 1024,
  timeoutMs: 5000,
  command: [
    '/usr/bin/python3',
    '-I',
    '-c',
    `import time; end=time.process_time()+${seconds}
while time.process_time()<end: pass
print(${JSON.stringify(text)})`,
  ],
})
const cases = [
  { id: 'short', baseline: command(0.015), candidate: command(0.005) },
  { id: 'long', baseline: command(0.03), candidate: command(0.015) },
]
const allocation = JSON.parse(process.env.BEELINK_GATE_CORES ?? 'null')
const options = {
  cases,
  blocksPerCase: 2,
  minimumRatio: 1.2,
  confidence: 0.95,
  maximumIdentityLogHalfWidth: Math.log(1.05),
  wallLimitMs: 30000,
  maxEvidenceBytes: 4 * 1024 * 1024,
  sameOutput: (_id, a, b) => a.stdoutBase64 === b.stdoutBase64 && a.stderrBase64 === b.stderrBase64,
  retainCall: async (call) => {
    writeSync(1, `${JSON.stringify({ kind: 'call', allocation, call })}\n`)
  },
}
options.comparatorDigest = `sha256:${createHash('sha256').update(options.sameOutput.toString()).digest('hex')}`
const cpu = (call) => {
  const c = call.execution.command.cpu
  assert.equal(c.available, true)
  return c.after.userUsec - c.before.userUsec + c.after.systemUsec - c.before.systemUsec
}
const prove = async (measurement, count) => {
  writeSync(1, `${JSON.stringify({ kind: 'measurement', measurement })}\n`)
  assert.equal(measurement.calls.length, count, JSON.stringify(measurement))
  assert.equal(measurement.retainedCalls, count)
  assert.equal(measurement.cost.cpuComplete, true)
  assert.equal(measurement.cleanupDiagnostic, undefined)
  const identities = new Set(
    measurement.calls.map(
      (call) => `${call.execution.command.cpu.sessionId}:${call.execution.command.cpu.inode}`,
    ),
  )
  assert.equal(identities.size, 1)
  assert.equal(
    measurement.cost.knownWorkloadCpuUsec,
    measurement.calls.reduce((sum, call) => sum + cpu(call), 0),
  )
  assert.ok(
    measurement.cost.wallMs >= measurement.calls.reduce((sum, call) => sum + call.fullWallMs, 0),
  )
  const path = measurement.calls[0].execution.command.cpu.cgroupPath
  await assert.rejects(access(path), { code: 'ENOENT' })
}
try {
  const paired = await measurePairedCommands(options)
  await prove(paired, 32)
  for (let cycle = 0; cycle < 2; cycle++) {
    for (const phase of ['identity', 'candidate']) {
      const ratios = cases.map((c) => {
        const block = paired.calls.filter(
          (call) => call.cycle === cycle && call.phase === phase && call.caseId === c.id,
        )
        assert.deepEqual(
          block.map((call) => call.abbaPosition),
          [0, 1, 2, 3],
        )
        assert.deepEqual(
          block.map((call) => call.role),
          ['baseline', 'candidate', 'candidate', 'baseline'],
        )
        assert.ok(block.every((call) => call.execution.succeeded))
        return (
          (Math.log(cpu(block[0])) +
            Math.log(cpu(block[3])) -
            Math.log(cpu(block[1])) -
            Math.log(cpu(block[2]))) /
          2
        )
      })
      assert.equal(
        paired.cycles[cycle][`${phase}LogRatio`],
        ratios.reduce((a, b) => a + b, 0) / cases.length,
      )
    }
  }
  assert.equal(paired.summaries[0].identityInterval.n, 2)
  assert.equal(paired.summaries[0].candidateInterval.n, 2)
  assert.ok(Math.abs(paired.summaries[0].identityInterval.criticalValue - 12.7062047361747) < 1e-6)
  assert.ok(Math.abs(paired.summaries[0].candidateInterval.criticalValue - 6.313751514675) < 1e-6)
  const identity = await measurePairedCommands({
    ...options,
    cases: cases.map(({ id, baseline }) => ({ id, baseline })),
    blocksPerCase: 4,
    identityPrefixes: [2, 4],
  })
  await prove(identity, 32)
  assert.equal(identity.verdict, 'unknown')
  assert.ok(identity.calls.every((call) => call.phase === 'identity'))
  assert.deepEqual(
    identity.summaries.map((row) => row.cycles),
    [2, 4],
  )
  assert.ok(identity.summaries.every((row) => row.candidateInterval === null))
  const mismatch = await measurePairedCommands({
    ...options,
    cases: [{ ...cases[0], candidate: command(0.005, 'wrong') }],
  })
  await prove(mismatch, 16)
  assert.notEqual(mismatch.verdict, 'qualified')
  const timeout = await measurePairedCommands({
    ...options,
    cases: [{ id: 'slow', baseline: command(30), candidate: command(30) }],
    wallLimitMs: 1000,
  })
  writeSync(1, `${JSON.stringify({ kind: 'measurement', measurement: timeout })}\n`)
  assert.equal(timeout.verdict, 'unknown')
  assert.equal(timeout.calls.length, 1)
  assert.equal(timeout.retainedCalls, 1)
  assert.ok(['timeout', 'cancelled'].includes(timeout.calls[0].execution.reason))
  assert.equal(timeout.cleanupDiagnostic, undefined)
  await assert.rejects(access(timeout.calls[0].execution.command.cpu.cgroupPath), {
    code: 'ENOENT',
  })
  writeSync(1, `${JSON.stringify({ kind: 'complete', calls: 81, measurements: 4 })}\n`)
} finally {
  await rm(workspace, { recursive: true })
}
