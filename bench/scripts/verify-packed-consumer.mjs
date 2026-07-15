import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const benchDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scratch = await mkdtemp(path.join(tmpdir(), 'agent-bench-consumer-'))
const runtimePackage = process.env.AGENT_RUNTIME_PACKAGE
  ? path.resolve(process.env.AGENT_RUNTIME_PACKAGE)
  : undefined

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
    `packed consumer verified: ${manifest.name}@${manifest.version} with @tangle-network/agent-runtime@${runtimeManifest.version}; prepared ${prepareProof.executionPlanDigest}`,
  )
} finally {
  await rm(scratch, { recursive: true, force: true })
}
