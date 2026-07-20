/** Execute the exact admitted Pier result parser bytes in a fresh Node process. */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { BenchmarkEvaluation } from '@tangle-network/agent-eval'

import type { PierCandidateGraderPort } from './pier-agent'

const sha256 = (bytes: Uint8Array): `sha256:${string}` =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`

export function createPierResultGrader(
  descriptor: Pick<PierCandidateGraderPort, 'name' | 'version' | 'artifact'>,
): PierCandidateGraderPort {
  return {
    ...descriptor,
    run: async (input) => {
      input.signal.throwIfAborted()
      const implementation = Uint8Array.from(input.implementation.bytes)
      if (implementation.byteLength !== input.implementation.byteLength) {
        throw new Error('Pier grader implementation length changed before execution')
      }
      const evidence = Uint8Array.from(input.officialResult.bytes)
      const evaluation = await executeGrader(implementation, evidence, input.signal)
      input.signal.throwIfAborted()
      return {
        evaluation,
        evidence,
        binding: {
          implementationDigest: sha256(implementation),
          taskOutcomeDigest: input.outcome.evidence.digest,
          outputDigest: sha256(evidence),
        },
      }
    },
  }
}

async function executeGrader(
  implementation: Uint8Array,
  resultBytes: Uint8Array,
  signal: AbortSignal,
): Promise<BenchmarkEvaluation> {
  const directory = await mkdtemp(join(tmpdir(), 'pier-result-grader-'))
  const script = join(directory, 'grader.mjs')
  try {
    await writeFile(script, implementation, { flag: 'wx', mode: 0o600 })
    await chmod(script, 0o500)
    const stdout = await runNode(script, resultBytes, signal)
    const parsed = JSON.parse(stdout.toString('utf8')) as BenchmarkEvaluation
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Pier result grader returned a non-object evaluation')
    }
    return parsed
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function runNode(
  script: string,
  input: Uint8Array,
  signal: AbortSignal,
): Promise<Buffer> {
  signal.throwIfAborted()
  return await new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, ['--no-warnings', script], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: 'C',
        LC_ALL: 'C',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      signal,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let bytes = 0
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      bytes += chunk.byteLength
      if (bytes > 1024 * 1024) {
        child.kill('SIGKILL')
        reject(new Error('Pier result grader exceeded its output limit'))
        return
      }
      target.push(Buffer.from(chunk))
    }
    child.stdout.on('data', collect(stdout))
    child.stderr.on('data', collect(stderr))
    child.once('error', reject)
    child.once('close', (code, childSignal) => {
      if (code !== 0) {
        reject(
          new Error(
            `Pier result grader failed (${childSignal ?? code}): ${Buffer.concat(stderr).toString('utf8').trim()}`,
          ),
        )
        return
      }
      resolveResult(Buffer.concat(stdout))
    })
    child.stdin.end(input)
  })
}
