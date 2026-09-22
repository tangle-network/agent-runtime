// Grades both arms of the enforcement proof. Exits non-zero unless the enforced arm blocked
// everything it had to AND the control arm proved the probe can succeed when nothing stops it.
import { readFileSync } from 'node:fs'

import {
  gradeControlArm,
  gradeEnforcedArm,
  parseEgressProbeOutput,
} from '../src/runtime/egress/probe.ts'

function flag(name: string): string {
  const index = process.argv.indexOf(`--${name}`)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  if (!value) throw new Error(`--${name} <path> is required`)
  return value
}

const enforced = gradeEnforcedArm(parseEgressProbeOutput(readFileSync(flag('enforced'), 'utf8')))
const control = gradeControlArm(parseEgressProbeOutput(readFileSync(flag('control'), 'utf8')))

for (const [arm, verdict] of [
  ['ENFORCED', enforced],
  ['CONTROL', control],
] as const) {
  console.log(`${arm}: ${verdict.enforced ? 'PASS' : 'FAIL'} (${verdict.records.length} records)`)
  for (const failure of verdict.failures) console.log(`  - ${failure}`)
}

const advisory = enforced.records.filter((r) => r.id.startsWith('dns:'))
for (const record of advisory) {
  console.log(`ADVISORY ${record.id}: ${record.status} (${record.detail})`)
}

if (!enforced.enforced || !control.enforced) process.exit(1)
console.log('PROOF: policy is enforced, and the probe was calibrated against an unenforced arm.')
