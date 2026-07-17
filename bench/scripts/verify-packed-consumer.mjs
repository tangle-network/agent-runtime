import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const benchDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(benchDir, '..')
const scratch = await mkdtemp(path.join(tmpdir(), 'agent-bench-consumer-'))
const args = new Set(process.argv.slice(2))
const useLocalRuntime = args.delete('--local-runtime')
if (args.size > 0) throw new Error(`unknown arguments: ${[...args].join(', ')}`)

const TYPESCRIPT_5 = '5.9.3'
const TYPESCRIPT_6 = '6.0.3'

async function run(command, args, cwd, env = process.env) {
  try {
    return await execFileAsync(command, args, {
      cwd,
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

async function resolveRuntimePackage(packDir) {
  if (process.env.AGENT_RUNTIME_PACKAGE) {
    return path.resolve(process.env.AGENT_RUNTIME_PACKAGE)
  }
  if (!useLocalRuntime) return undefined
  const manifest = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'))
  if (manifest.name !== '@tangle-network/agent-runtime') {
    throw new Error('--local-runtime requires an agent-runtime source workspace')
  }
  await run('pnpm', ['pack', '--pack-destination', packDir], repoRoot)
  const tarballs = (await readdir(packDir)).filter((name) => name.endsWith('.tgz'))
  if (tarballs.length !== 1) {
    throw new Error(`expected one packed agent-runtime tarball, found ${tarballs.length}`)
  }
  return path.join(packDir, tarballs[0])
}

try {
  const packDir = path.join(scratch, 'pack')
  const runtimePackDir = path.join(scratch, 'runtime-pack')
  const consumerDir = path.join(scratch, 'consumer')
  await mkdir(packDir)
  await mkdir(runtimePackDir)
  await mkdir(consumerDir)

  await run('pnpm', ['pack', '--pack-destination', packDir], benchDir)
  const packedFiles = (await readdir(packDir)).filter((name) => name.endsWith('.tgz'))
  if (packedFiles.length !== 1) {
    throw new Error(`expected one packed agent-bench tarball, found ${packedFiles.length}`)
  }
  const tarball = path.join(packDir, packedFiles[0])
  const runtimePackage = await resolveRuntimePackage(runtimePackDir)
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
    throw new Error(
      'package verification requires @types/node, typescript, and tsx devDependencies',
    )
  }
  const publicTsconfig = JSON.parse(
    await readFile(path.join(benchDir, 'tsconfig.public.json'), 'utf8'),
  )
  if (!publicTsconfig.compilerOptions)
    throw new Error('tsconfig.public.json must define compilerOptions')

  await writeFile(
    path.join(consumerDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'agent-bench-package-verifier',
        private: true,
        type: 'module',
        dependencies: {
          '@tangle-network/agent-bench': `file:${tarball}`,
          ...(runtimePackage
            ? { '@tangle-network/agent-runtime': `file:${runtimePackage}` }
            : {}),
        },
        devDependencies: {
          '@types/node': devDependencies['@types/node'],
          typescript: TYPESCRIPT_5,
          tsx: devDependencies.tsx,
        },
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    path.join(consumerDir, 'index.ts'),
    "import { createSweBenchAdapter, executePreparedPierCandidate, FilePierCandidateTrialController, resolveAdapter, runBenchmarks, runStagedJudge, StagedJudgeError, type BenchmarkAdapter, type JudgeArtifactReceipt, type PierCandidateTrialController, type PierCandidateTrialHandle, type PierDockerConnection, type StagedPierCandidateExecution } from '@tangle-network/agent-bench'\n\nconst adapter: BenchmarkAdapter = resolveAdapter('swe-bench')\nconst captureAdapter: BenchmarkAdapter = createSweBenchAdapter({ captureEvaluatorArtifacts: ({ taskId, attemptSequence }) => ({ destination: `/tmp/${taskId}/${attemptSequence}` }) })\nconst receipt = undefined as JudgeArtifactReceipt | undefined\nconst staged = undefined as StagedPierCandidateExecution | undefined\nconst trial = undefined as PierCandidateTrialHandle | undefined\nconst controller = undefined as PierCandidateTrialController | undefined\nconst dockerConnection = undefined as PierDockerConnection | undefined\nvoid adapter\nvoid captureAdapter\nvoid receipt\nvoid staged\nvoid trial\nvoid controller\nvoid dockerConnection\nvoid executePreparedPierCandidate\nvoid FilePierCandidateTrialController\nvoid runBenchmarks\nvoid runStagedJudge\nvoid StagedJudgeError\n",
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
  await writeFile(
    path.join(consumerDir, 'verify_pier_payload.py'),
    `import py_compile
from pathlib import Path

import pier_agents
from pier_agents import candidate_contract

root = Path(pier_agents.__file__).parent
expected = {
    "__init__.py",
    "candidate_contract.py",
    "process_boundary.py",
    "tangle_candidate.py",
    "workspace_boundary.py",
}
observed = {path.name for path in root.glob("*.py")}
assert observed == expected, (observed, expected)
assert candidate_contract.PreparedCandidateContract.__module__ == "pier_agents.candidate_contract"
for name in sorted(expected):
    py_compile.compile(root / name, doraise=True)
`,
  )

  // Intentionally resolve the declared ranges like a brand-new registry consumer.
  // The preceding frozen install + public typecheck cover the exact bench lockfile.
  await run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'],
    consumerDir,
  )
  await run('npm', ['exec', '--', 'tsc', '-p', 'tsconfig.json'], consumerDir)
  const typescript5 = await run('npm', ['exec', '--', 'tsc', '--version'], consumerDir)
  if (typescript5.stdout.trim() !== `Version ${TYPESCRIPT_5}`) {
    throw new Error(`expected TypeScript ${TYPESCRIPT_5}, received ${typescript5.stdout.trim()}`)
  }
  await run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-save',
      '--package-lock=false',
      `typescript@${TYPESCRIPT_6}`,
    ],
    consumerDir,
  )
  await run('npm', ['exec', '--', 'tsc', '-p', 'tsconfig.json'], consumerDir)
  const typescript6 = await run('npm', ['exec', '--', 'tsc', '--version'], consumerDir)
  if (typescript6.stdout.trim() !== `Version ${TYPESCRIPT_6}`) {
    throw new Error(`expected TypeScript ${TYPESCRIPT_6}, received ${typescript6.stdout.trim()}`)
  }
  await run('npm', ['exec', '--', 'tsx', 'index.ts'], consumerDir)
  const installedPackage = path.join(consumerDir, 'node_modules', '@tangle-network', 'agent-bench')
  const prepared = await run(
    'npm',
    [
      'exec',
      '--',
      'tsx',
      path.join(installedPackage, 'scripts', 'verify-pier-agent.mts'),
    ],
    consumerDir,
    { ...process.env, PIER_PREPARE_ONLY: '1', PIER_PROOF_ARM: 'failure' },
  )
  const prepareProof = JSON.parse(prepared.stdout)
  if (
    prepareProof.prepared !== true ||
    prepareProof.disposed !== true ||
    !/^sha256:[a-f0-9]{64}$/.test(prepareProof.executionPlanDigest) ||
    !/^sha256:[a-f0-9]{64}$/.test(prepareProof.graderDigest)
  ) {
    throw new Error(`packed consumer did not prepare a real candidate: ${prepared.stdout}`)
  }
  await run('python3', ['verify_pier_payload.py'], consumerDir, {
    ...process.env,
    PYTHONPATH: installedPackage,
  })
  let runtimeManifest
  try {
    runtimeManifest = JSON.parse(
      await readFile(
        path.join(consumerDir, 'node_modules/@tangle-network/agent-runtime/package.json'),
        'utf8',
      ),
    )
  } catch (error) {
    throw new Error('packed consumer did not install @tangle-network/agent-runtime', {
      cause: error,
    })
  }
  console.log(
    `packed consumer verified: ${manifest.name}@${manifest.version} with @tangle-network/agent-runtime@${runtimeManifest.version}, TypeScript ${TYPESCRIPT_5} and ${TYPESCRIPT_6}; prepared ${prepareProof.executionPlanDigest}`,
  )
} finally {
  await rm(scratch, { recursive: true, force: true })
}
