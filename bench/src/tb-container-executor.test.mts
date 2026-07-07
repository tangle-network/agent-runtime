import assert from 'node:assert/strict'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AgentSpec, ExecutorContext } from '../../src/runtime/index'
import { buildTbDockerExecArgs, createTbContainerExecutor } from './tb-container-executor.mts'

const spec: AgentSpec = { profile: { name: 'tb-test-worker' }, harness: null }

function context(): ExecutorContext {
  return { signal: new AbortController().signal, seams: {} }
}

async function executable(name: string, body: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'tb-container-executor-'))
  const file = path.join(dir, name)
  await writeFile(file, body)
  await chmod(file, 0o755)
  return file
}

async function main(): Promise<void> {
  assert.deepEqual(
    buildTbDockerExecArgs('cid', 'echo ok', {
      workdir: '/app',
      env: { A: 'B', EMPTY: '' },
      shell: '/bin/bash',
    }),
    ['exec', '-i', '--workdir', '/app', '-e', 'A=B', 'cid', '/bin/bash', '-c', 'echo ok'],
    'docker exec argv is deterministic and skips empty env values',
  )

  assert.throws(
    () => createTbContainerExecutor({ containerEnvVar: 'TB_CONTAINER_EXECUTOR_TEST_MISSING' })(spec, context()),
    /no target container/,
    'missing target container fails before spawning',
  )

  const fakeDocker = await executable(
    'fake-docker',
    `#!/bin/sh
printf 'argv:%s\\n' "$*"
`,
  )

  const metered = createTbContainerExecutor({
    containerId: 'cid',
    dockerBin: fakeDocker,
    workdir: '/work',
    env: { OPENAI_BASE_URL: 'http://router.test' },
    parseUsage: () => ({ input: 7, output: 11, usd: 0.004 }),
  })(spec, context())

  assert.equal(metered.budgetExempt, false, 'usage parser makes the executor metered')
  const meteredResult = await metered.execute({ command: 'echo hello' }, new AbortController().signal)
  assert.equal(meteredResult.out.containerId, 'cid')
  assert.equal(meteredResult.out.command, 'echo hello')
  assert.match(
    meteredResult.out.stdout,
    /argv:exec -i --workdir \/work -e OPENAI_BASE_URL=http:\/\/router\.test cid \/bin\/sh -c echo hello/,
  )
  assert.deepEqual(meteredResult.spent.tokens, { input: 7, output: 11 })
  assert.equal(meteredResult.spent.usd, 0.004)
  assert.equal(metered.resultArtifact().out, meteredResult.out)

  const free = createTbContainerExecutor({ containerId: 'cid', dockerBin: fakeDocker })(spec, context())
  assert.equal(free.budgetExempt, true, 'unmetered shell commands are explicit budget-exempt work')
  const freeResult = await free.execute('printf ok', new AbortController().signal)
  assert.equal(freeResult.spent.iterations, 0)
  assert.deepEqual(freeResult.spent.tokens, { input: 0, output: 0 })
  assert.equal(freeResult.spent.usd, 0)

  const failingDocker = await executable(
    'failing-docker',
    `#!/bin/sh
echo failed >&2
exit 7
`,
  )
  const strict = createTbContainerExecutor({
    containerId: 'cid',
    dockerBin: failingDocker,
    failOnNonZeroExit: true,
  })(spec, context())
  await assert.rejects(
    strict.execute('do work', new AbortController().signal),
    /command exited 7/,
    'strict mode treats non-zero command exit as infrastructure failure',
  )

  const lenient = createTbContainerExecutor({ containerId: 'cid', dockerBin: failingDocker })(spec, context())
  const lenientResult = await lenient.execute('do work', new AbortController().signal)
  assert.equal(lenientResult.out.exitCode, 7, 'default mode returns non-zero exits as task artifacts')
  assert.match(lenientResult.out.stderr, /failed/)

  console.log('tb-container-executor.test: OK')
}

void main()
