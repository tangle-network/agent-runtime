import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

interface PierProofResult {
  readonly arm: 'failure' | 'success'
  readonly reward: number
  readonly patchApplied: number
  readonly modelCalls: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly costUsd: number
  readonly runReceiptDigest: string
}

const benchDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const script = path.join(benchDir, 'scripts', 'verify-pier-agent.mts')
const recoveryScript = path.join(benchDir, 'scripts', 'verify-pier-recovery.mts')

function runArm(arm: PierProofResult['arm']): PierProofResult {
  const stdout = execFileSync(process.execPath, ['--import', 'tsx', script], {
    cwd: benchDir,
    env: { ...process.env, PIER_PROOF_ARM: arm },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    timeout: 20 * 60_000,
    maxBuffer: 20 * 1024 * 1024,
  })
  return JSON.parse(stdout) as PierProofResult
}

const failure = runArm('failure')
const recovery = JSON.parse(
  execFileSync(process.execPath, ['--import', 'tsx', recoveryScript], {
    cwd: benchDir,
    env: { ...process.env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    timeout: 120_000,
  }),
) as { freshProcess?: boolean; processExited?: boolean; containersRemoved?: boolean }
if (
  recovery.freshProcess !== true ||
  recovery.processExited !== true ||
  recovery.containersRemoved !== true
) {
  throw new Error(`Pier fresh-process recovery failed: ${JSON.stringify(recovery)}`)
}
const success = runArm('success')
if (
  failure.arm !== 'failure' ||
  failure.reward !== 0 ||
  failure.patchApplied !== 0 ||
  success.arm !== 'success' ||
  success.reward !== 1 ||
  success.patchApplied !== 1
) {
  throw new Error(`Pier controls did not separate: ${JSON.stringify({ failure, success })}`)
}
for (const result of [failure, success]) {
  if (
    result.modelCalls !== 0 ||
    result.inputTokens !== 0 ||
    result.outputTokens !== 0 ||
    result.costUsd !== 0
  ) {
    throw new Error(`Pier ${result.arm} control spent model budget: ${JSON.stringify(result)}`)
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(result.runReceiptDigest)) {
    throw new Error(`Pier ${result.arm} control omitted its run receipt digest`)
  }
}

console.log(JSON.stringify({ recovery, controls: [failure, success] }, null, 2))
