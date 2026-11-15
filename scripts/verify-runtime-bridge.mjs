#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Fixed qualification cohort, not a selector for the current production installations.
// Bridge #349; archive bytes qualified in Runtime #2626, issuecomment-6901791941.
const bridge = {
  commit: 'dd33f4a283cd830f9b7c7bca936ad43316e46787',
  url: 'https://github.com/drewstone/cli-bridge/archive/dd33f4a283cd830f9b7c7bca936ad43316e46787.tar.gz',
  bytes: 854839,
  sha256: 'e71582c25fd6d39023aef5ee28c339adcc2d504a88f1004c12313e542a47bb2c',
  integrity: 'sha512-50TL9zDr9yLAXgBay8sCR/v9PKzowbkQe8LxYAbmbWg26KCse0tBegQiseVOhZOLokXcxLqqJ7DAl5+T12g3/A==',
}
// Snapshot of agent-container@a696c3cc22409a1d9824ac646e92d4d827f9975a/infra/nix/agent-clis.json.
// Reading that private production owner at runtime would require unrelated credentials.
const claude = {
  version: '2.1.318',
  url: 'https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/-/claude-code-linux-x64-2.1.318.tgz',
  integrity: 'sha512-GX+7CUng2R5f7SsA2w0LaXlH2f62fRCFD/Z2SUexoeH3B0KfulKQt5DtY9NeD2Yp3VEBz6/k/xWSbGPUi6NV2A==',
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const testFile = 'tests/integration/runtime-failure-bridge.test.ts'

if (process.argv.length > 2) {
  if (process.argv.length !== 3 || process.argv[2] !== '--help')
    throw new Error('verify:runtime-bridge accepts no filters or input overrides; every case must run')
  console.log(`pnpm run verify:runtime-bridge\nQualify ${testFile} with checksummed Bridge and Claude inputs on Linux x64.\nRun after the repository frozen install, through its maintained gate; no subscription credentials are needed.`)
  process.exit(0)
}
if (process.platform !== 'linux' || process.arch !== 'x64')
  throw new Error('verify:runtime-bridge requires Linux x64 for its qualified native Claude binary; use an admitted native gate host')

const temporary = mkdtempSync(join(tmpdir(), 'runtime-bridge-qualification-'))
try {
  console.log(`Runtime checkout HEAD: ${run('git', ['rev-parse', 'HEAD']).trim()}; tests use this working tree`)
  console.log(`Qualification inputs: Bridge ${bridge.commit}; Claude ${claude.version}`)
  const bridgeRoot = await installArchive('bridge', bridge)
  const claudeRoot = await installArchive('claude', claude)
  run('pnpm', ['install', '--frozen-lockfile', '--prod'], bridgeRoot, true)
  const native = join(claudeRoot, 'claude')
  const version = run(native, ['--version']).trim()
  if (version !== `${claude.version} (Claude Code)`)
    throw new Error(`qualified Claude version mismatch: ${version}`)
  const reportPath = join(temporary, 'vitest.json')
  const result = spawnSync('pnpm', [
    'exec', 'vitest', 'run', testFile, '--reporter=json', `--outputFile=${reportPath}`,
  ], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      RUNTIME_BRIDGE_PACKAGE_ENTRY: pathToFileURL(join(bridgeRoot, 'index.mjs')).href,
      RUNTIME_BRIDGE_NATIVE_CLAUDE_BIN: native,
    },
  })
  if (result.error) throw result.error
  if (!existsSync(reportPath))
    throw new Error(`Vitest produced no report (exit ${result.status ?? result.signal}); resolve the host or setup failure above before qualification`)
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  const cases = (report.testResults ?? []).flatMap(suite => suite.assertionResults ?? [])
  const incomplete = cases.filter(test => test.status !== 'passed')
  console.log(`Runtime/Bridge qualification: ${cases.length - incomplete.length} passed; ${incomplete.length} failed, skipped or pending; ${cases.length} total`)
  for (const test of incomplete)
    console.error(`${test.status}: ${test.fullName ?? test.title}\n${(test.failureMessages ?? []).join('\n')}`)
  if (result.status !== 0 || report.success !== true || cases.length === 0 || incomplete.length > 0)
    throw new Error(`complete Runtime/Bridge qualification failed (Vitest exit ${result.status ?? result.signal}); no skipped case qualifies`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}

function run(command, args, cwd = root, inherit = false) {
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'inherit'],
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status ?? result.signal}); qualification stopped`)
  return result.stdout ?? ''
}

async function installArchive(name, input) {
  const response = await fetch(input.url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`${name} archive download failed: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  if (integrity !== input.integrity ||
      (input.bytes !== undefined && bytes.length !== input.bytes) ||
      (input.sha256 !== undefined && createHash('sha256').update(bytes).digest('hex') !== input.sha256))
    throw new Error(`${name} archive does not match its qualified bytes; nothing from that archive was installed`)
  const archive = join(temporary, `${name}.tgz`)
  const directory = join(temporary, name)
  writeFileSync(archive, bytes)
  mkdirSync(directory)
  run('tar', ['-xzf', archive, '--strip-components=1', '-C', directory])
  return directory
}
