import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tempRoot = mkdtempSync(join(tmpdir(), 'agent-runtime-package-'))

try {
  const packDir = join(tempRoot, 'pack')
  const unpackDir = join(tempRoot, 'unpack')
  const appDir = join(tempRoot, 'app')
  mkdirSync(packDir, { recursive: true })
  mkdirSync(unpackDir, { recursive: true })
  mkdirSync(appDir, { recursive: true })

  run('pnpm', ['pack', '--pack-destination', packDir], repoRoot)
  const tarballs = run('find', [packDir, '-maxdepth', '1', '-name', '*.tgz', '-print'], repoRoot)
    .trim()
    .split('\n')
    .filter(Boolean)
  if (tarballs.length !== 1) {
    throw new Error(`expected exactly one packed tarball, found ${tarballs.length}`)
  }

  run('tar', ['-xzf', tarballs[0], '-C', unpackDir], repoRoot)
  const packageDir = join(unpackDir, 'package')
  const packageJson = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  if (packageJson.peerDependenciesMeta?.['@tangle-network/agent-eval']?.optional) {
    throw new Error('@tangle-network/agent-eval must stay required: root and ./loops import it at runtime')
  }
  const packageExports = packageJson.exports
  if (!packageExports || typeof packageExports !== 'object') {
    throw new Error('packed package has no exports map')
  }
  const requiredSubpaths = [
    '.',
    './agent',
    './conversation',
    './intelligence',
    './loops',
    './environment-provider',
    './analyst-loop',
    './knowledge',
    './profiles',
    './platform',
    './primeintellect',
    './candidate-execution',
    './mcp',
  ]
  for (const subpath of requiredSubpaths) {
    if (!(subpath in packageExports)) {
      throw new Error(`packed package removed public export ${subpath}`)
    }
  }
  for (const [subpath, exportTarget] of Object.entries(packageExports)) {
    for (const field of ['import', 'types']) {
      const relativeTarget = exportTarget[field]
      if (typeof relativeTarget !== 'string') {
        throw new Error(`missing ${field} target for package export ${subpath}`)
      }
      run('test', ['-f', join(packageDir, relativeTarget)], repoRoot)
    }
  }

  const repoPackageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  const knowledgePackageDir = join(
    repoRoot,
    'node_modules',
    '@tangle-network',
    'agent-knowledge',
  )
  const knowledgePackageJson = JSON.parse(
    readFileSync(join(knowledgePackageDir, 'package.json'), 'utf8'),
  )
  if (
    knowledgePackageJson.name !== '@tangle-network/agent-knowledge' ||
    typeof knowledgePackageJson.version !== 'string' ||
    knowledgePackageJson.version.length === 0
  ) {
    throw new Error('packed consumer requires an installed @tangle-network/agent-knowledge release')
  }
  const peerPackages = [
    '@tangle-network/agent-eval',
    '@tangle-network/agent-interface',
    '@tangle-network/sandbox',
    'playwright',
  ]
  const peerDependencies = Object.fromEntries(
    peerPackages.map((name) => {
      const version = repoPackageJson.devDependencies?.[name]
      if (typeof version !== 'string' || version.length === 0) {
        throw new Error(`packed consumer requires a ${name} development dependency`)
      }
      return [name, version]
    }),
  )
  writeFileSync(
    join(appDir, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        type: 'module',
        dependencies: {
          '@tangle-network/agent-runtime': `file:${tarballs[0]}`,
          ...peerDependencies,
        },
        devDependencies: {
          '@types/node': repoPackageJson.devDependencies['@types/node'],
          typescript: repoPackageJson.devDependencies.typescript,
        },
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    join(appDir, 'pnpm-workspace.yaml'),
    `overrides:\n  '@tangle-network/agent-knowledge': ${knowledgePackageJson.version}\n`,
  )
  writeFileSync(
    join(appDir, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
        },
        include: ['consumer.ts'],
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    join(appDir, 'consumer.ts'),
    `
      import type {
        AgentCandidateProfileActivation,
        AgentProfile,
        CandidateExecutionEvidence,
        Sha256Digest,
      } from '@tangle-network/agent-interface'
      import { SandboxClient } from '@tangle-network/sandbox'
      import {
        createSandboxCandidateExperimentExecutor,
        agentImprovementProfileSurfaceDigest,
        agentImprovementProfileSurfaceInput,
        agentImprovementTargetProfileDiffs,
        isAgentImprovementProfileSurface,
        parseCandidateProfileMaterialization,
        sandboxCandidateExperimentExecutionSupport,
        verifyCandidateExecutionEvidence,
        type AgentImprovementActivationTransitionInput,
        type CreateSandboxCandidateExperimentExecutorOptions,
        type SandboxCandidateExperimentExecution,
        type VerifyCandidateExecutionEvidenceOptions,
      } from '@tangle-network/agent-runtime/intelligence'

      const client = new SandboxClient({
        apiKey: 'sk_sandbox_compile_only',
        baseUrl: 'https://sandbox.example.com',
        trustLocalCliAuth: false,
      })
      declare const ports: CreateSandboxCandidateExperimentExecutorOptions['ports']
      declare const grader: CreateSandboxCandidateExperimentExecutorOptions['grader']
      declare const outputArtifacts: CreateSandboxCandidateExperimentExecutorOptions['outputArtifacts']
      declare const traceStore: CreateSandboxCandidateExperimentExecutorOptions['traceStore']
      declare const claimStore: CreateSandboxCandidateExperimentExecutorOptions['claimStore']
      declare const executionInput: SandboxCandidateExperimentExecution
      declare const verification: VerifyCandidateExecutionEvidenceOptions
      declare const storedEvidence: unknown
      declare const transitionInput: AgentImprovementActivationTransitionInput
      declare const activeProfile: AgentProfile

      const executor = createSandboxCandidateExperimentExecutor({
        client,
        ports,
        grader,
        outputArtifacts,
        traceStore,
        claimStore,
      })
      const execution: Promise<CandidateExecutionEvidence> = executor.execute(executionInput)
      const evidence = verifyCandidateExecutionEvidence(storedEvidence, verification)
      const activation: AgentCandidateProfileActivation =
        parseCandidateProfileMaterialization(
          evidence.materializationReceipt.profileActivation,
          evidence.materializationReceipt.profileActivation.profilePlan.digest,
        )
      const outcome: 'output' = sandboxCandidateExperimentExecutionSupport.outcomes[0]
      const desiredInput: unknown = transitionInput.targets[0].desiredInput
      const currentInput: unknown = agentImprovementProfileSurfaceInput(activeProfile, 'prompt')
      const currentDigest: Sha256Digest = agentImprovementProfileSurfaceDigest(
        activeProfile,
        'prompt',
      )
      const profileDiffs = isAgentImprovementProfileSurface(transitionInput.targets[0].surface)
        ? agentImprovementTargetProfileDiffs(
            {
              surface: transitionInput.targets[0].surface,
              desiredInput,
            },
            { id: transitionInput.activation.digest },
          )
        : []
      void execution
      void activation
      void outcome
      void desiredInput
      void currentInput
      void currentDigest
      void profileDiffs
    `,
  )
  run('pnpm', ['install', '--config.auto-install-peers=false'], appDir)
  run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], appDir)

  run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        const { readFileSync } = await import('node:fs')
        const packageJson = JSON.parse(
          readFileSync('node_modules/@tangle-network/agent-runtime/package.json', 'utf8'),
        )
        for (const subpath of Object.keys(packageJson.exports)) {
          const specifier =
            subpath === '.' ? packageJson.name : packageJson.name + subpath.slice(1)
          await import(specifier)
        }
      `,
    ],
    appDir,
  )

  run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        const prime = await import('@tangle-network/agent-runtime/primeintellect')
        for (const name of [
          'createPrimeIntellectPackage',
          'writePrimeIntellectPackage',
          'readPrimeIntellectEpisodeContext',
          'createPrimeIntellectBackend',
          'runPrimeIntellectProgram',
          'parsePrimeIntellectTraces',
          'primeIntellectTraceToRunRecord',
          'importPrimeIntellectTraces',
        ]) {
          if (typeof prime[name] !== 'function') throw new Error('missing PrimeIntellect export ' + name)
        }
      `,
    ],
    appDir,
  )
  run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        const intelligence = await import('@tangle-network/agent-runtime/intelligence')
        const expectedIntelligence = [
          'createIntelligenceClient',
          'withIntelligence',
          'pullCertified',
          'resolveEffort',
          'isIntelligenceOff',
          'defaultRedactor',
          'composeCertifiedProfile',
          'manifestFromProfile',
          'CapabilityNotAdmittedError',
          'createSandboxCandidateExperimentExecutor',
          'agentImprovementProfileSurfaceDigest',
          'agentImprovementProfileSurfaceInput',
          'createAgentImprovementActivation',
          'createAgentImprovementActivationResult',
          'executeAgentImprovementActivation',
          'executeAgentCandidateExperimentCell',
          'parseCandidateProfileMaterialization',
          'proposeAgentImprovement',
          'reviewAgentImprovementProposal',
          'runAgentCandidateExperiment',
          'sandboxCandidateExperimentExecutionSupport',
          'verifyAgentImprovementActivation',
          'verifyAgentImprovementActivationResult',
          'verifyCandidateExecutionEvidence',
        ]
        for (const name of expectedIntelligence) {
          if (!(name in intelligence)) throw new Error('missing intelligence export ' + name)
        }
      `,
    ],
    appDir,
  )
  run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        const runtime = await import('@tangle-network/agent-runtime')
        for (const name of ['improve']) {
          if (typeof runtime[name] !== 'function') throw new Error('missing improvement export ' + name)
        }
        const knowledge = await import('@tangle-network/agent-runtime/knowledge')
        for (const name of [
          'buildKnowledgeImprovementExperimentBundles',
          'createKnowledgeImprovementActivationExecutor',
          'runKnowledgeImprovementJob',
        ]) {
          if (typeof knowledge[name] !== 'function') throw new Error('missing knowledge export ' + name)
        }
      `,
    ],
    appDir,
  )
  run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        const candidates = await import('@tangle-network/agent-runtime/candidate-execution')
        for (const name of [
          'buildAgentCandidateBundle',
          'sealAgentCandidateBundle',
          'verifyAgentCandidateBundle',
        ]) {
          if (typeof candidates[name] !== 'function') throw new Error('missing candidate export ' + name)
        }
        const bundle = candidates.buildAgentCandidateBundle({
          profile: {
            kind: 'profile',
            profile: { name: 'packed-consumer', harness: 'codex' },
          },
          code: { kind: 'disabled' },
          execution: {
            harness: 'codex',
            harnessVersion: '1.0.0',
            launch: { kind: 'container-command', executable: 'codex' },
            instructionDelivery: { kind: 'stdin-utf8' },
            cwd: { workspace: 'task', path: '.' },
            environment: { kind: 'evaluator-task-container' },
            isolation: {
              network: 'disabled',
              remoteIntegrations: 'disabled',
              candidateSecrets: 'disabled',
            },
          },
          memory: { mode: 'disabled' },
        })
        const verified = await candidates.verifyAgentCandidateBundle(bundle, {
          artifacts: { read: async () => { throw new Error('unexpected artifact read') } },
          repositories: { resolve: async () => { throw new Error('unexpected repository read') } },
        })
        if (verified.bundle.digest !== bundle.digest) throw new Error('packed candidate digest drift')
      `,
    ],
    appDir,
  )
  run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        const provider = await import('@tangle-network/agent-runtime/environment-provider')
        const expectedProvider = [
          'createAgentEnvironmentProviderRegistry',
          'providerAsExecutor',
          'providerAsSandboxClient',
          'resolveAgentEnvironmentProvider',
          'sandboxClientAsProvider',
        ]
        for (const name of expectedProvider) {
          if (typeof provider[name] !== 'function') throw new Error('missing environment-provider export ' + name)
        }
      `,
    ],
    appDir,
  )

  const repackDir = join(tempRoot, 'repack')
  mkdirSync(repackDir, { recursive: true })
  run(
    'npm',
    ['pack', '--ignore-scripts=false', '--pack-destination', repackDir],
    packageDir,
  )
  const repackedTarballs = run(
    'find',
    [repackDir, '-maxdepth', '1', '-name', '*.tgz', '-print'],
    repoRoot,
  )
    .trim()
    .split('\n')
    .filter(Boolean)
  if (repackedTarballs.length !== 1) {
    throw new Error(`expected exactly one repacked runtime tarball, found ${repackedTarballs.length}`)
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    throw new Error(
      [
        `command failed: ${command} ${args.join(' ')}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }
  return result.stdout
}
