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
import {
  assertPeerMatchesDevelopmentDependency,
  expectedPeerRange,
  requiredPackedDevelopmentDependency,
  requiredPackedPackageVersion,
} from './lib/packed-package-test.mjs'

const gepaVersion = '0.1.4'
const gepaSourceRevision = 'f919db0a622e2e9f9204779b81fe00cc1b2d808f'
const skillOptRevision = '61735e3922efc2b90c6d6cab561e62e98452ca90'
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = readJson(join(repoRoot, 'package.json'))
const workspaceAgentEvalVersion = installedPackageVersion(repoRoot, '@tangle-network/agent-eval')
const workspaceAgentInterfaceVersion = installedPackageVersion(
  repoRoot,
  '@tangle-network/agent-interface',
)
const workspaceAgentKnowledgeVersion = installedPackageVersion(
  repoRoot,
  '@tangle-network/agent-knowledge',
)
const workspaceSandboxVersion = installedPackageVersion(repoRoot, '@tangle-network/sandbox')
const agentEvalVersion = workspaceAgentEvalVersion
const officialOptimizerEnv = {
  AGENT_EVAL_EXPECTED_BRIDGE_VERSION: agentEvalVersion,
  AGENT_EVAL_EXPECTED_GEPA_VERSION: gepaVersion,
  AGENT_EVAL_EXPECTED_GEPA_REVISION: gepaSourceRevision,
  AGENT_EVAL_EXPECTED_SKILLOPT_REVISION: skillOptRevision,
}
const tempRoot = mkdtempSync(join(tmpdir(), 'agent-runtime-official-'))

assertVersion(
  packageJson.peerDependencies?.['@tangle-network/agent-eval'],
  expectedPeerRange(agentEvalVersion),
  '@tangle-network/agent-eval peer dependency',
)
assertVersion(
  packageJson.peerDependencies?.['@tangle-network/agent-interface'],
  expectedPeerRange(workspaceAgentInterfaceVersion),
  '@tangle-network/agent-interface peer dependency',
)
assertVersion(
  packageJson.peerDependencies?.['@tangle-network/sandbox'],
  expectedPeerRange(workspaceSandboxVersion),
  '@tangle-network/sandbox peer dependency',
)

try {
  run('pnpm', ['build'], repoRoot)

  const python = installWheelPythonPackages(tempRoot)
  run(
    'pnpm',
    ['exec', 'vitest', 'run', 'src/improvement/official-packages.test.ts', '--maxWorkers=1'],
    repoRoot,
    { AGENT_EVAL_TEST_PYTHON: python, ...officialOptimizerEnv },
  )

  const packDir = join(tempRoot, 'pack')
  const appDir = join(tempRoot, 'consumer')
  mkdirSync(packDir, { recursive: true })
  mkdirSync(appDir, { recursive: true })

  run('pnpm', ['pack', '--pack-destination', packDir], repoRoot)
  const tarballs = readdirSync(packDir).filter((name) => name.endsWith('.tgz'))
  if (tarballs.length !== 1) {
    throw new Error(`expected one Runtime tarball, found ${tarballs.length}`)
  }

  const runtimeTarball = join(packDir, tarballs[0])
  const unpackDir = join(tempRoot, 'unpack')
  mkdirSync(unpackDir, { recursive: true })
  run('tar', ['-xzf', runtimeTarball, '-C', unpackDir], repoRoot)
  const packedPackageJson = readJson(join(unpackDir, 'package', 'package.json'))
  for (const name of [
    '@tangle-network/agent-eval',
    '@tangle-network/agent-interface',
    '@tangle-network/sandbox',
  ]) {
    assertPeerMatchesDevelopmentDependency(packedPackageJson, name)
  }
  const packedAgentEvalVersion = requiredPackedDevelopmentDependency(
    packedPackageJson,
    '@tangle-network/agent-eval',
  )
  const packedAgentInterfaceVersion = requiredPackedDevelopmentDependency(
    packedPackageJson,
    '@tangle-network/agent-interface',
  )
  const packedSandboxVersion = requiredPackedDevelopmentDependency(
    packedPackageJson,
    '@tangle-network/sandbox',
  )
  assertVersion(
    packedAgentEvalVersion,
    workspaceAgentEvalVersion,
    'packed @tangle-network/agent-eval development dependency',
  )
  assertVersion(
    packedAgentInterfaceVersion,
    workspaceAgentInterfaceVersion,
    'packed @tangle-network/agent-interface development dependency',
  )
  assertVersion(
    packedSandboxVersion,
    workspaceSandboxVersion,
    'packed @tangle-network/sandbox development dependency',
  )
  assertVersion(
    requiredPackedDependency(packedPackageJson, '@tangle-network/agent-knowledge'),
    workspaceAgentKnowledgeVersion,
    'packed @tangle-network/agent-knowledge dependency',
  )
  writeFileSync(
    join(appDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'agent-runtime-official-optimizer-verification',
        private: true,
        type: 'module',
        dependencies: {
          '@tangle-network/agent-eval': packedAgentEvalVersion,
          '@tangle-network/agent-interface': packedAgentInterfaceVersion,
          '@tangle-network/sandbox': packedSandboxVersion,
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
  assertInstalledVersion(appDir, '@tangle-network/agent-eval', packedAgentEvalVersion)
  assertInstalledVersion(appDir, '@tangle-network/agent-interface', packedAgentInterfaceVersion)
  assertInstalledVersion(appDir, '@tangle-network/sandbox', packedSandboxVersion)
  assertInstalledVersion(appDir, '@tangle-network/agent-knowledge', workspaceAgentKnowledgeVersion)
  const installedKnowledge = readJson(
    join(appDir, 'node_modules', '@tangle-network', 'agent-knowledge', 'package.json'),
  )
  assertInstalledKnowledgeSharedPeer(installedKnowledge, '@tangle-network/agent-eval')
  assertInstalledKnowledgeSharedPeer(
    installedKnowledge,
    '@tangle-network/agent-interface',
  )
  run(
    process.execPath,
    ['verify.mjs', 'wheel'],
    appDir,
    { AGENT_EVAL_TEST_PYTHON: python, ...officialOptimizerEnv },
    10 * 60_000,
  )
  const sourcePython = installSourceGepa(tempRoot)
  run(
    process.execPath,
    ['verify.mjs', 'omni'],
    appDir,
    { AGENT_EVAL_TEST_PYTHON: sourcePython, ...officialOptimizerEnv },
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
  const actual = installedPackageVersion(appDir, packageName)
  assertVersion(actual, expected, `installed ${packageName}`)
}

function installedPackageVersion(root, packageName) {
  const packageJson = readJson(join(root, 'node_modules', ...packageName.split('/'), 'package.json'))
  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error(`installed ${packageName} has no version`)
  }
  return packageJson.version
}

function requiredPackedDependency(packageJson, packageName) {
  return requiredPackedPackageVersion(
    packageJson.dependencies?.[packageName],
    packageName,
    packageJson.name,
  )
}

function assertInstalledKnowledgeSharedPeer(packageJson, packageName) {
  if (packageJson.dependencies?.[packageName] !== undefined) {
    throw new Error(`installed Agent Knowledge must not nest ${packageName} as a runtime dependency`)
  }
  // npm installs with strict peer checks above. This confirms Knowledge's tested lower bound
  // without requiring its development patch to equal the compatible patch selected by Runtime.
  requiredPackedDevelopmentDependency(packageJson, packageName)
  assertPeerMatchesDevelopmentDependency(packageJson, packageName)
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
