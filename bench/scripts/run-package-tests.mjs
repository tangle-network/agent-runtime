import { execFile } from 'node:child_process'
import { readdir, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const benchDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function packageNodeTestArgs(files, env = process.env) {
  const raw = env.AGENT_BENCH_PACKAGE_TEST_CONCURRENCY
  const concurrency = raw === undefined ? undefined : Number(raw)
  if (raw !== undefined && (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(concurrency))) {
    throw new Error('AGENT_BENCH_PACKAGE_TEST_CONCURRENCY must be a positive safe integer')
  }
  return [
    '--test',
    ...(concurrency === undefined ? [] : [`--test-concurrency=${concurrency}`]),
    '--import',
    'tsx',
    ...files,
  ]
}

export function resolvePackageTestTimeoutMs(env = process.env) {
  const raw = env.AGENT_BENCH_PACKAGE_TEST_TIMEOUT_MS
  if (raw === undefined) return undefined
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) {
    throw new Error('AGENT_BENCH_PACKAGE_TEST_TIMEOUT_MS must be a non-negative safe integer')
  }
  const timeoutMs = Number(raw)
  if (!Number.isSafeInteger(timeoutMs)) {
    throw new Error('AGENT_BENCH_PACKAGE_TEST_TIMEOUT_MS must be a non-negative safe integer')
  }
  return timeoutMs
}

async function collectTests(dir) {
  const files = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await collectTests(absolute)))
    else if (entry.isFile() && /\.test\.(?:mts|ts)$/.test(entry.name)) files.push(absolute)
  }
  return files.sort()
}

export async function run(command, args, env = process.env) {
  const timeoutMs = resolvePackageTestTimeoutMs(env)
  try {
    await execFileAsync(command, args, {
      cwd: benchDir,
      env,
      maxBuffer: 10 * 1024 * 1024,
      ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
    })
  } catch (error) {
    if (error?.stdout) process.stdout.write(error.stdout)
    if (error?.stderr) process.stderr.write(error.stderr)
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${[command, ...args].join(' ')} failed: ${message}`, { cause: error })
  }
}

export async function runPythonTests(python, env = process.env) {
  // Fixture roots must be physical paths; the production boundary rejects symlinked ancestors.
  const physicalTemp = await realpath(env.TMPDIR || tmpdir())
  await run(python, ['-m', 'unittest', 'discover', '-s', 'pier_agents', '-p', '*_test.py'], {
    ...env,
    TMPDIR: physicalTemp,
  })
}

async function main() {
  const python = (await execFileAsync('python3', ['-c', 'import sys; print(sys.executable)'])).stdout.trim()
  const testEnv = { ...process.env, AGENT_BENCH_PYTHON: process.env.AGENT_BENCH_PYTHON ?? python }
  const tests = await collectTests(path.join(benchDir, 'src'))
  if (tests.length === 0) throw new Error('no package tests found under src/')

  // Two test runtimes coexist under src/: node:test files run under `node --test`;
  // Vitest files need the Vitest worker, so partition by the framework each file
  // actually imports.
  const nodeTests = []
  const vitestTests = []
  for (const file of tests) {
    const body = await readFile(file, 'utf8')
    if (/from\s+['"]vitest['"]/.test(body)) vitestTests.push(file)
    else nodeTests.push(file)
  }

  if (nodeTests.length > 0) {
    await run(
      process.execPath,
      packageNodeTestArgs(nodeTests.map((file) => path.relative(benchDir, file))),
      {
        ...testEnv,
        TSX_TSCONFIG_PATH: 'tsconfig.public.json',
      },
    )
  }

  if (vitestTests.length > 0) {
    await run('npx', ['vitest', 'run', ...vitestTests.map((file) => path.relative(benchDir, file))], testEnv)
  }

  await runPythonTests(python, testEnv)

  console.log(
    `package tests passed: ${tests.length}/${tests.length} TypeScript files (${nodeTests.length} node:test + ${vitestTests.length} vitest) + Pier bridge`,
  )
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await main()
}
