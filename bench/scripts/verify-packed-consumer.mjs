import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const benchDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scratch = await mkdtemp(path.join(tmpdir(), 'agent-bench-consumer-'))

async function run(command, args, cwd) {
  try {
    return await execFileAsync(command, args, { cwd, maxBuffer: 10 * 1024 * 1024, timeout: 120_000 })
  } catch (error) {
    if (error?.stdout) process.stdout.write(error.stdout)
    if (error?.stderr) process.stderr.write(error.stderr)
    const invocation = [command, ...args].join(' ')
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${invocation} failed: ${message}`, { cause: error })
  }
}

try {
  const packDir = path.join(scratch, 'pack')
  const consumerDir = path.join(scratch, 'consumer')
  await mkdir(packDir)
  await mkdir(consumerDir)

  const packed = await run('npm', ['pack', '--json', '--pack-destination', packDir], benchDir)
  const [{ filename }] = JSON.parse(packed.stdout)
  const tarball = path.join(packDir, filename)
  const manifest = JSON.parse(await readFile(path.join(benchDir, 'package.json'), 'utf8'))
  const devDependencies = manifest.devDependencies
  if (
    typeof devDependencies?.['@types/node'] !== 'string' ||
    typeof devDependencies.typescript !== 'string' ||
    typeof devDependencies.tsx !== 'string' ||
    !devDependencies['@types/node'] ||
    !devDependencies.typescript ||
    !devDependencies.tsx
  ) {
    throw new Error('package verification requires @types/node, typescript, and tsx devDependencies')
  }
  const publicTsconfig = JSON.parse(await readFile(path.join(benchDir, 'tsconfig.public.json'), 'utf8'))
  if (!publicTsconfig.compilerOptions) throw new Error('tsconfig.public.json must define compilerOptions')

  await writeFile(
    path.join(consumerDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'agent-bench-package-verifier',
        private: true,
        type: 'module',
        dependencies: { '@tangle-network/agent-bench': `file:${tarball}` },
        devDependencies: {
          '@types/node': devDependencies['@types/node'],
          typescript: devDependencies.typescript,
          tsx: devDependencies.tsx,
        },
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    path.join(consumerDir, 'index.ts'),
    "import { resolveAdapter, runBenchmarks, type BenchmarkAdapter } from '@tangle-network/agent-bench'\n\nconst adapter: BenchmarkAdapter = resolveAdapter('swe-bench')\nvoid adapter\nvoid runBenchmarks\n",
  )
  await writeFile(
    path.join(consumerDir, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: publicTsconfig.compilerOptions,
        files: ['index.ts'],
      },
      null,
      2,
    )}\n`,
  )

  // Intentionally resolve the declared ranges like a brand-new registry consumer.
  // The preceding frozen install + public typecheck cover the exact bench lockfile.
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'], consumerDir)
  await run('npm', ['exec', '--', 'tsc', '-p', 'tsconfig.json'], consumerDir)
  await run('npm', ['exec', '--', 'tsx', 'index.ts'], consumerDir)
  let runtimeManifest
  try {
    runtimeManifest = JSON.parse(
      await readFile(path.join(consumerDir, 'node_modules/@tangle-network/agent-runtime/package.json'), 'utf8'),
    )
  } catch (error) {
    throw new Error('packed consumer did not install @tangle-network/agent-runtime', { cause: error })
  }
  console.log(
    `packed consumer verified: ${manifest.name}@${manifest.version} with @tangle-network/agent-runtime@${runtimeManifest.version}`,
  )
} finally {
  await rm(scratch, { recursive: true, force: true })
}
