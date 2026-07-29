import { execFile } from 'node:child_process'
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const benchDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(benchDir, '..')
const scratch = await mkdtemp(path.join(tmpdir(), 'agent-bench-consumer-'))
const args = process.argv.slice(2)
const useLocalRuntime = removeFlag(args, '--local-runtime')
const suppliedTarball = removeOption(args, '--tarball')
if (args.length > 0) throw new Error(`unknown arguments: ${args.join(', ')}`)

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
  const unpackDir = path.join(scratch, 'unpack')
  const runtimePackDir = path.join(scratch, 'runtime-pack')
  const consumerDir = path.join(scratch, 'consumer')
  const terminalBenchVenv = path.join(scratch, 'terminal-bench-venv')
  const terminalBenchBinDir = path.join(terminalBenchVenv, 'bin')
  await mkdir(packDir)
  await mkdir(unpackDir)
  await mkdir(runtimePackDir)
  await mkdir(consumerDir)
  await mkdir(terminalBenchBinDir, { recursive: true })
  await writeFile(path.join(terminalBenchVenv, 'package.json'), '{"type":"module"}\n')
  await writeFile(
    path.join(terminalBenchBinDir, 'python'),
    String.raw`#!/usr/bin/env node
const rows = [{
  id: 'installed-absolute-venv',
  instruction: 'prove the installed path',
  task_dir: '/tmp/terminal-bench-task',
  solution: 'echo ok\n',
}]
process.stdout.write(JSON.stringify(rows) + '\n')
`,
    { mode: 0o755 },
  )
  await writeFile(
    path.join(terminalBenchBinDir, 'tb'),
    String.raw`#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
function value(flag) {
  const index = args.indexOf(flag)
  if (index === -1 || index + 1 >= args.length) throw new Error('missing ' + flag)
  return args[index + 1]
}

const outputPath = value('--output-path')
const runId = value('--run-id')
const taskId = value('-t')
const reportDir = join(outputPath, runId)
mkdirSync(reportDir, { recursive: true })
writeFileSync(
  join(reportDir, 'results.json'),
  JSON.stringify({
    resolved_ids: [taskId],
    results: [{ task_id: taskId, is_resolved: true, parser_results: { installedVenv: true } }],
  }),
)
`,
    { mode: 0o755 },
  )

  let tarball
  if (suppliedTarball) {
    tarball = path.resolve(suppliedTarball)
    await access(tarball)
  } else {
    // Build explicitly so verification cannot inherit a machine-level
    // ignore-scripts setting and accidentally pack stale or missing output.
    await run('pnpm', ['build'], benchDir)
    await run('pnpm', ['pack', '--pack-destination', packDir], benchDir, {
      ...process.env,
      npm_config_ignore_scripts: 'true',
    })
    const packedFiles = (await readdir(packDir)).filter((name) => name.endsWith('.tgz'))
    if (packedFiles.length !== 1) {
      throw new Error(`expected one packed agent-bench tarball, found ${packedFiles.length}`)
    }
    tarball = path.join(packDir, packedFiles[0])
  }
  await run('tar', ['-xzf', tarball, '-C', unpackDir], benchDir)
  const runtimePackage = await resolveRuntimePackage(runtimePackDir)
  const packedManifest = JSON.parse(
    await readFile(path.join(unpackDir, 'package', 'package.json'), 'utf8'),
  )
  const nodeTypes = requiredPackedDevelopmentDependency(packedManifest, '@types/node')
  requiredPackedDevelopmentDependency(packedManifest, 'typescript')
  const tsx = requiredPackedDevelopmentDependency(packedManifest, 'tsx')
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
          '@types/node': nodeTypes,
          typescript: TYPESCRIPT_5,
          tsx,
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
    path.join(consumerDir, 'index.mjs'),
    "import { resolveAdapter, runBenchmarks } from '@tangle-network/agent-bench'\nimport { ADAPTERS } from '@tangle-network/agent-bench/adapters'\nimport { createCragAdapter } from '@tangle-network/agent-bench/benchmarks/crag'\n\nif (typeof resolveAdapter !== 'function' || typeof runBenchmarks !== 'function') throw new Error('root exports are not executable')\nif (typeof ADAPTERS !== 'object' || typeof createCragAdapter !== 'function') throw new Error('subpath exports are not executable')\nif (resolveAdapter('crag').name !== 'crag') throw new Error('compiled adapter registry returned the wrong adapter')\nprocess.env.TOOLLM_FIXTURES = '1'\nconst toolLlmTasks = await resolveAdapter('toollm').loadTasks({ limit: 1 })\nif (toolLlmTasks.length !== 1 || toolLlmTasks[0]?.id !== '1') throw new Error('packed ToolLLM fixture loading failed')\n",
  )
  await writeFile(
    path.join(consumerDir, 'terminal-bench-absolute-venv.mjs'),
    `import { createTerminalBenchAdapter } from '@tangle-network/agent-bench/benchmarks/terminal-bench'

const adapter = createTerminalBenchAdapter()
const tasks = await adapter.loadTasks({ ids: ['installed-absolute-venv'] })
if (tasks.length !== 1 || tasks[0]?.id !== 'installed-absolute-venv') {
  throw new Error('packed Terminal-Bench adapter did not load through the absolute venv')
}
const score = await adapter.judge(tasks[0], 'echo installed-package-path')
if (!score.resolved || score.score !== 1) {
  throw new Error(\`packed Terminal-Bench adapter did not judge through the absolute venv: \${JSON.stringify(score)}\`)
}
`,
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
  await run('node', ['index.mjs'], consumerDir)
  await run('node', ['terminal-bench-absolute-venv.mjs'], consumerDir, {
    ...process.env,
    TERMINAL_BENCH_VENV: terminalBenchVenv,
  })
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
    `packed consumer verified: ${packedManifest.name}@${packedManifest.version} with @tangle-network/agent-runtime@${runtimeManifest.version}, TypeScript ${TYPESCRIPT_5} and ${TYPESCRIPT_6}, absolute Terminal-Bench venv; prepared ${prepareProof.executionPlanDigest}`,
  )
} finally {
  await rm(scratch, { recursive: true, force: true })
}

function requiredPackedDevelopmentDependency(packageJson, name) {
  const version = packageJson.devDependencies?.[name]
  if (typeof version !== 'string' || version.length === 0 || version.startsWith('catalog:')) {
    throw new Error(`packed consumer requires a resolved ${name} development dependency`)
  }
  return version
}

function removeFlag(args, flag) {
  const index = args.indexOf(flag)
  if (index === -1) return false
  args.splice(index, 1)
  return true
}

function removeOption(args, option) {
  const index = args.indexOf(option)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`)
  args.splice(index, 2)
  return value
}
