import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const agentEvalVersion = '0.126.5'
const agentKnowledgeVersion = '5.0.0'
const gepaVersion = '0.1.4'
const gepaSourceRevision = 'f919db0a622e2e9f9204779b81fe00cc1b2d808f'
const skillOptRevision = '61735e3922efc2b90c6d6cab561e62e98452ca90'
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = readJson(join(repoRoot, 'package.json'))
const tempRoot = mkdtempSync(join(tmpdir(), 'agent-runtime-official-'))

assertVersion(
  packageJson.devDependencies?.['@tangle-network/agent-eval'],
  agentEvalVersion,
  '@tangle-network/agent-eval development dependency',
)
assertVersion(
  packageJson.dependencies?.['@tangle-network/agent-knowledge'],
  agentKnowledgeVersion,
  '@tangle-network/agent-knowledge dependency',
)
assertVersion(
  packageJson.peerDependencies?.['@tangle-network/agent-eval'],
  `>=${agentEvalVersion} <0.127.0`,
  '@tangle-network/agent-eval peer dependency',
)

try {
  run('pnpm', ['build'], repoRoot)

  const python = installWheelPythonPackages(tempRoot)
  run(
    'pnpm',
    ['exec', 'vitest', 'run', 'src/improvement/official-packages.test.ts', '--maxWorkers=1'],
    repoRoot,
    { AGENT_EVAL_TEST_PYTHON: python },
  )

  const packDir = join(tempRoot, 'pack')
  const appDir = join(tempRoot, 'consumer')
  mkdirSync(packDir, { recursive: true })
  mkdirSync(appDir, { recursive: true })

  run(
    'npm',
    ['pack', '--loglevel=error', '--ignore-scripts=false', '--pack-destination', packDir],
    repoRoot,
  )
  const tarballs = readdirSync(packDir).filter((name) => name.endsWith('.tgz'))
  if (tarballs.length !== 1) {
    throw new Error(`expected one Runtime tarball, found ${tarballs.length}`)
  }

  const runtimeTarball = join(packDir, tarballs[0])
  writeFileSync(
    join(appDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'agent-runtime-official-optimizer-verification',
        private: true,
        type: 'module',
        dependencies: {
          '@tangle-network/agent-eval': agentEvalVersion,
          '@tangle-network/agent-interface':
            packageJson.devDependencies['@tangle-network/agent-interface'],
          '@tangle-network/agent-runtime': `file:${runtimeTarball}`,
        },
      },
      null,
      2,
    )}\n`,
  )
  copyFileSync(
    join(repoRoot, 'scripts', 'verify-official-optimizers-consumer.mjs'),
    join(appDir, 'verify.mjs'),
  )
  run(
    'npm',
    [
      'install',
      '--strict-peer-deps',
      '--loglevel=error',
      '--ignore-scripts=false',
      '--no-audit',
      '--no-fund',
      '--cache',
      join(tempRoot, 'npm-cache'),
      '--prefer-online',
    ],
    appDir,
  )

  assertInstalledVersion(appDir, '@tangle-network/agent-runtime', packageJson.version)
  assertInstalledVersion(appDir, '@tangle-network/agent-eval', agentEvalVersion)
  assertInstalledVersion(appDir, '@tangle-network/agent-knowledge', agentKnowledgeVersion)
  const installedKnowledge = readJson(
    join(appDir, 'node_modules', '@tangle-network', 'agent-knowledge', 'package.json'),
  )
  assertVersion(
    installedKnowledge.dependencies?.['@tangle-network/agent-eval'],
    agentEvalVersion,
    'installed Agent Knowledge dependency on Agent Eval',
  )
  run(
    process.execPath,
    ['verify.mjs', 'wheel'],
    appDir,
    { AGENT_EVAL_TEST_PYTHON: python },
    10 * 60_000,
  )
  const sourcePython = installSourceGepa(tempRoot)
  run(
    process.execPath,
    ['verify.mjs', 'omni'],
    appDir,
    { AGENT_EVAL_TEST_PYTHON: sourcePython },
    10 * 60_000,
  )
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}

function installWheelPythonPackages(root) {
  const python = createPythonVenv(root, 'wheel-python')
  installPythonRequirements(python, [
    '--only-binary=agent-eval-rpc,gepa',
    `agent-eval-rpc==${agentEvalVersion}`,
    `gepa[full]==${gepaVersion}`,
    `skillopt @ git+https://github.com/microsoft/SkillOpt.git@${skillOptRevision}`,
  ])
  const installed = inspectPythonPackages(python, true)
  assertVersion(installed.bridge, agentEvalVersion, 'agent-eval-rpc Python package')
  assertVersion(installed.gepa, gepaVersion, 'GEPA Python package')
  assertVersion(installed.gepaRevision, null, 'wheel GEPA source revision')
  assertVersion(installed.skilloptRevision, skillOptRevision, 'SkillOpt source revision')
  return python
}

function installSourceGepa(root) {
  const python = createPythonVenv(root, 'source-python')
  installPythonRequirements(python, [
    '--only-binary=agent-eval-rpc',
    `agent-eval-rpc==${agentEvalVersion}`,
    `gepa[full] @ git+https://github.com/gepa-ai/gepa.git@${gepaSourceRevision}`,
  ])
  const installed = inspectPythonPackages(python, false)
  assertVersion(installed.bridge, agentEvalVersion, 'source GEPA agent-eval-rpc package')
  assertVersion(installed.gepa, gepaVersion, 'source GEPA package version')
  assertVersion(installed.gepaRevision, gepaSourceRevision, 'GEPA source revision')
  return python
}

function createPythonVenv(root, name) {
  const basePython = process.env.PYTHON ?? 'python'
  const version = run(
    basePython,
    ['-c', 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'],
    repoRoot,
    { PYTHONNOUSERSITE: '1' },
  ).trim()
  if (version !== '3.12') {
    throw new Error(`official optimizer verification requires Python 3.12, found ${version}`)
  }

  const venvDir = join(root, name)
  run(basePython, ['-m', 'venv', venvDir], repoRoot, { PYTHONNOUSERSITE: '1' })
  return process.platform === 'win32'
    ? join(venvDir, 'Scripts', 'python.exe')
    : join(venvDir, 'bin', 'python')
}

function installPythonRequirements(python, requirements) {
  run(
    python,
    [
      '-m',
      'pip',
      'install',
      '--disable-pip-version-check',
      '--quiet',
      '--index-url=https://pypi.org/simple',
      '--no-cache-dir',
      ...requirements,
    ],
    repoRoot,
    {},
    10 * 60_000,
  )
}

function inspectPythonPackages(python, includeSkillOpt) {
  return JSON.parse(
    run(
      python,
      [
        '-c',
        `
import json
from importlib.metadata import distribution, version

gepa = distribution("gepa")
gepa_direct = json.loads(gepa.read_text("direct_url.json") or "{}")
${
  includeSkillOpt
    ? `skillopt = distribution("skillopt")
skillopt_direct = json.loads(skillopt.read_text("direct_url.json") or "{}")`
    : 'skillopt_direct = {}'
}
print(json.dumps({
    "bridge": version("agent-eval-rpc"),
    "gepa": version("gepa"),
    "gepaRevision": gepa_direct.get("vcs_info", {}).get("commit_id"),
    "skilloptRevision": skillopt_direct.get("vcs_info", {}).get("commit_id"),
}))
`,
      ],
      repoRoot,
    ).trim(),
  )
}

function assertInstalledVersion(appDir, packageName, expected) {
  const actual = readJson(join(appDir, 'node_modules', ...packageName.split('/'), 'package.json'))
    .version
  assertVersion(actual, expected, `installed ${packageName}`)
}

function assertVersion(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} must be ${expected}, found ${String(actual)}`)
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function run(command, args, cwd, env = {}, timeout = 5 * 60_000) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
  })
  if (result.error || result.status !== 0) {
    throw new Error(
      [
        `command failed: ${command} ${args.join(' ')}`,
        result.error?.message,
        result.stdout?.trim(),
        result.stderr?.trim(),
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  return result.stdout
}
