import { execFile } from 'node:child_process'
import { access, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const benchDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = path.join(benchDir, 'src')
const fixtureEnv = { ...process.env, GIT_ALLOW_TEST_IDENTITY: '1' }

async function collectTests(dir) {
  const files = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await collectTests(absolute)))
    else if (entry.isFile() && /\.test\.(?:mts|ts)$/.test(entry.name)) files.push(absolute)
  }
  return files.sort()
}

async function run(command, args, env = process.env) {
  try {
    await execFileAsync(command, args, {
      cwd: benchDir,
      env,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
    })
  } catch (error) {
    if (error?.stdout) process.stdout.write(error.stdout)
    if (error?.stderr) process.stderr.write(error.stderr)
    const invocation = [command, ...args].join(' ')
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${invocation} failed: ${message}`, { cause: error })
  }
}

const python = path.join(benchDir, '.venv', 'bin', 'python')
try {
  await access(python)
} catch {
  await run('python3', ['-m', 'venv', '.venv'])
}

const tests = await collectTests(sourceDir)
if (tests.length === 0) throw new Error('no package tests found under src/')

// Two test runtimes coexist under src/: node:test files run under `node --test`;
// vitest files (the swe-arena suite) crash there (`vitest` APIs need the vitest
// worker), so partition by the framework each file actually imports.
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
    ['--test', '--import', 'tsx', ...nodeTests.map((file) => path.relative(benchDir, file))],
    {
      ...fixtureEnv,
      TSX_TSCONFIG_PATH: 'tsconfig.public.json',
    },
  )
}

if (vitestTests.length > 0) {
  await run(
    'npx',
    ['vitest', 'run', ...vitestTests.map((file) => path.relative(benchDir, file))],
    fixtureEnv,
  )
}

await run(
  python,
  ['-m', 'unittest', 'discover', '-s', 'pier_agents', '-p', '*_test.py'],
  fixtureEnv,
)

console.log(
  `package tests passed: ${tests.length}/${tests.length} TypeScript files (${nodeTests.length} node:test + ${vitestTests.length} vitest) + Pier bridge`,
)
