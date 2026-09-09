// Run in a disposable privileged Linux container; never mount untrusted host trees.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { runIsolatedCheck } from '../../src/runtime/isolated-checker.ts'

const workspace = await mkdtemp('/work/check-')
const tree = `${workspace}/run $(touch escaped)`
await mkdir(tree)
await writeFile(`${workspace}/secret`, 'secret')
await symlink(`${workspace}/secret`, `${tree}/escape`)
await writeFile(`${tree}/input`, 'original')
const run = (script, rest = {}) =>
  runIsolatedCheck({ workspaceRoot: workspace, tree, command: ['/bin/sh', '-c', script], ...rest })
try {
  const result = await run(
    'test ! -e ../secret && test -L escape && test ! -e escape && test ! -e /work/checker-source && test -r input && echo changed > input && echo new > output && test -z "$HOST_SECRET" && test "$(ls /sys/class/net 2>/dev/null)" = "" && echo isolated',
  )
  assert.equal(result.succeeded, true, JSON.stringify(result))
  assert.equal(await readFile(`${tree}/input`, 'utf8'), 'original')
  await assert.rejects(readFile(`${tree}/output`), { code: 'ENOENT' })
  assert.equal((await run('sleep 30', { timeoutMs: 100 })).reason, 'timeout')
  assert.equal((await run('yes', { maxOutputBytes: 64 })).reason, 'output-limit')
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 100)
  assert.equal((await run('sleep 30', { signal: controller.signal })).reason, 'cancelled')
  assert.equal((await run('mkdir locked && chmod 000 locked')).succeeded, true)
  const network = await runIsolatedCheck({
    workspaceRoot: workspace,
    tree,
    command: [
      '/usr/local/bin/node',
      '-e',
      "const os=require('node:os');if(Object.keys(os.networkInterfaces()).some(k=>k!=='lo'))process.exit(1);const fs=require('node:fs');if(fs.readdirSync('/proc').filter(k=>/^[0-9]+$/.test(k)).length>4)process.exit(2)",
    ],
  })
  assert.equal(network.succeeded, true, JSON.stringify(network))
  const overlap = await runIsolatedCheck({
    workspaceRoot: '/usr',
    tree: '/usr/share',
    command: ['/bin/true'],
  })
  assert.equal(overlap.reason, 'refused')
  console.log(
    'PASS: parent absent, external symlink dangling, writes discarded, literal path, environment cleared, timeout, output limit, cancellation, ancestor bind refusal',
  )
} finally {
  await rm(workspace, { recursive: true, force: true })
}
