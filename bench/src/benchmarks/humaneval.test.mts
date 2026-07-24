import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { runPythonProgram } from './humaneval'

describe('HumanEval Python isolation', () => {
  it('runs the exact program through the resource-capped networkless container', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'humaneval-docker-test-'))
    const fakeDocker = join(dir, 'docker')
    const capture = join(dir, 'capture.jsonl')
    writeFileSync(
      fakeDocker,
      `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
if (args[0] === 'rm') process.exit(0)
if (process.env.FAKE_DOCKER_MISSING === '1') {
  process.stderr.write('docker: Error response from daemon: No such image: python:3.12-slim')
  process.exit(125)
}
const mount = args[args.indexOf('-v') + 1]
const hostDir = mount.slice(0, -':/w:ro'.length)
fs.appendFileSync(process.env.FAKE_DOCKER_CAPTURE, JSON.stringify({
  args,
  program: fs.readFileSync(path.join(hostDir, 'p.py'), 'utf8'),
}) + '\\n')
if (process.env.FAKE_DOCKER_NO_START === '1') {
  process.stderr.write('docker: Error response from daemon: unable to start container process')
  process.exit(125)
}
process.stdout.write(args[args.length - 2] + '\\n')
if (process.env.FAKE_DOCKER_CANDIDATE === 'daemon-text') {
  process.stderr.write('Cannot connect to the Docker daemon')
  process.exit(1)
}
if (process.env.FAKE_DOCKER_CANDIDATE === 'exit-125') process.exit(125)
process.stdout.write('CONTAINER_OK\\n')
`,
      { mode: 0o755 },
    )
    const originalPath = process.env.PATH
    const originalCapture = process.env.FAKE_DOCKER_CAPTURE
    const originalMissing = process.env.FAKE_DOCKER_MISSING
    const originalCandidate = process.env.FAKE_DOCKER_CANDIDATE
    const originalNoStart = process.env.FAKE_DOCKER_NO_START
    process.env.PATH = `${dir}:${originalPath ?? ''}`
    process.env.FAKE_DOCKER_CAPTURE = capture
    try {
      const program = 'print("exact bytes")\n'
      const result = await runPythonProgram(program, 2_000)
      assert.equal(result.exitCode, 0)
      assert.match(result.stdout, /CONTAINER_OK/)

      const firstCall = JSON.parse(readFileSync(capture, 'utf8').trim().split('\n')[0]!) as {
        args: string[]
        program: string
      }
      assert.equal(firstCall.program, program)
      assert.deepEqual(firstCall.args.slice(0, 2), ['run', '--rm'])
      assert.ok(firstCall.args.includes('--network=none'))
      assert.ok(firstCall.args.includes('--cpus=1'))
      assert.ok(firstCall.args.includes('--memory=512m'))
      assert.ok(firstCall.args.includes('--pids-limit=64'))
      assert.ok(firstCall.args.includes('--cap-drop=ALL'))
      assert.ok(firstCall.args.includes('--security-opt=no-new-privileges'))
      assert.ok(firstCall.args.includes('--pull=never'))
      assert.ok(firstCall.args.includes('--read-only'))
      assert.equal(
        firstCall.args[firstCall.args.indexOf('--tmpfs') + 1],
        '/tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777',
      )
      assert.equal(firstCall.args[firstCall.args.indexOf('--user') + 1], '65534:65534')
      assert.match(firstCall.args[firstCall.args.indexOf('-v') + 1] ?? '', /:\/w:ro$/)
      const command = firstCall.args.slice(firstCall.args.indexOf('python:3.12-slim'))
      assert.equal(command[0], 'python:3.12-slim')
      assert.equal(command[1], 'sh')
      assert.equal(command[2], '-c')
      assert.match(command[3] ?? '', /command -v timeout/)
      assert.equal(command[4], 'agent-runtime-checker')
      assert.match(command[5] ?? '', /^__AGENT_RUNTIME_CANDIDATE_STARTED_hev-/)
      assert.equal(command[6], '2s')

      process.env.FAKE_DOCKER_MISSING = '1'
      await assert.rejects(
        runPythonProgram('print("must not score")\n', 2_000),
        /docker image python:3\.12-slim unavailable/,
      )

      delete process.env.FAKE_DOCKER_MISSING
      process.env.FAKE_DOCKER_CANDIDATE = 'daemon-text'
      const daemonText = await runPythonProgram('raise SystemExit(1)\n', 2_000)
      assert.equal(daemonText.exitCode, 1)
      assert.match(daemonText.stderr, /Cannot connect to the Docker daemon/)

      process.env.FAKE_DOCKER_CANDIDATE = 'exit-125'
      const exit125 = await runPythonProgram('raise SystemExit(125)\n', 2_000)
      assert.equal(exit125.exitCode, 125)

      delete process.env.FAKE_DOCKER_CANDIDATE
      process.env.FAKE_DOCKER_NO_START = '1'
      await assert.rejects(
        runPythonProgram('print("never started")\n', 2_000),
        /did not start the candidate/,
      )
    } finally {
      if (originalPath === undefined) delete process.env.PATH
      else process.env.PATH = originalPath
      if (originalCapture === undefined) delete process.env.FAKE_DOCKER_CAPTURE
      else process.env.FAKE_DOCKER_CAPTURE = originalCapture
      if (originalMissing === undefined) delete process.env.FAKE_DOCKER_MISSING
      else process.env.FAKE_DOCKER_MISSING = originalMissing
      if (originalCandidate === undefined) delete process.env.FAKE_DOCKER_CANDIDATE
      else process.env.FAKE_DOCKER_CANDIDATE = originalCandidate
      if (originalNoStart === undefined) delete process.env.FAKE_DOCKER_NO_START
      else process.env.FAKE_DOCKER_NO_START = originalNoStart
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
