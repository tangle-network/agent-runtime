import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  const requiredExports = {
    '.': ['import', 'types'],
    './agent': ['import', 'types'],
    './candidate-execution': ['import', 'types'],
    './intelligence': ['import', 'types'],
    './loops': ['import', 'types'],
    './environment-provider': ['import', 'types'],
    './profiles': ['import', 'types'],
    './mcp': ['import', 'types'],
  }

  for (const [subpath, fields] of Object.entries(requiredExports)) {
    const exportTarget = packageJson.exports?.[subpath]
    if (!exportTarget) throw new Error(`missing package export ${subpath}`)
    for (const field of fields) {
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
  if (!existsSync(join(knowledgePackageDir, 'package.json'))) {
    throw new Error('packed consumer requires an installed @tangle-network/agent-knowledge package')
  }
  const knowledgePackDir = join(tempRoot, 'knowledge')
  mkdirSync(knowledgePackDir, { recursive: true })
  run('pnpm', ['pack', '--pack-destination', knowledgePackDir], knowledgePackageDir)
  const knowledgeTarballs = run(
    'find',
    [knowledgePackDir, '-maxdepth', '1', '-name', '*.tgz', '-print'],
    repoRoot,
  )
    .trim()
    .split('\n')
    .filter(Boolean)
  if (knowledgeTarballs.length !== 1) {
    throw new Error(`expected exactly one packed knowledge tarball, found ${knowledgeTarballs.length}`)
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
        devDependencies: { typescript: repoPackageJson.devDependencies.typescript },
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    join(appDir, 'pnpm-workspace.yaml'),
    `overrides:\n  '@tangle-network/agent-knowledge': file:${knowledgeTarballs[0]}\n`,
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
        AgentImprovementProposal,
        AgentImprovementReview,
        CandidateExecutionEvidence,
      } from '@tangle-network/agent-interface'
      import { SandboxClient } from '@tangle-network/sandbox'
      import type { AgentCandidateTaskExecution } from '@tangle-network/agent-runtime/candidate-execution'
      import {
        createSandboxApprovedCandidateExecutor,
        parseAgentCandidateProfileActivation,
        sandboxApprovedCandidateExecutionSupport,
        verifyCandidateExecutionEvidence,
        type CreateSandboxApprovedCandidateExecutorOptions,
      } from '@tangle-network/agent-runtime/intelligence'

      const client = new SandboxClient({
        apiKey: 'sk_sandbox_compile_only',
        baseUrl: 'https://sandbox.example.com',
        trustLocalCliAuth: false,
      })
      declare const ports: CreateSandboxApprovedCandidateExecutorOptions['ports']
      declare const grader: CreateSandboxApprovedCandidateExecutorOptions['grader']
      declare const outputArtifacts: CreateSandboxApprovedCandidateExecutorOptions['outputArtifacts']
      declare const traceStore: CreateSandboxApprovedCandidateExecutorOptions['traceStore']
      declare const claimStore: CreateSandboxApprovedCandidateExecutorOptions['claimStore']
      declare const proposal: AgentImprovementProposal
      declare const review: AgentImprovementReview
      declare const task: AgentCandidateTaskExecution
      declare const storedEvidence: unknown

      const executor = createSandboxApprovedCandidateExecutor({
        client,
        ports,
        grader,
        outputArtifacts,
        traceStore,
        claimStore,
        authorizeReview: async () => true,
      })
      const execution: Promise<CandidateExecutionEvidence> = executor.execute({
        proposal,
        review,
        task,
      })
      const evidence = verifyCandidateExecutionEvidence([storedEvidence], {
        proposal,
        review,
        expectedCount: 1,
      })[0]
      const activation: AgentCandidateProfileActivation =
        parseAgentCandidateProfileActivation(evidence?.profileActivation)
      const outcome: 'output' = sandboxApprovedCandidateExecutionSupport.outcomes[0]
      void execution
      void activation
      void outcome
    `,
  )
  run('pnpm', ['install', '--ignore-scripts', '--config.auto-install-peers=false'], appDir)
  run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], appDir)

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
          'createSandboxApprovedCandidateExecutor',
          'parseAgentCandidateProfileActivation',
          'sandboxApprovedCandidateExecutionSupport',
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
          code: { kind: 'disabled', reason: 'control' },
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
          lineage: { source: 'human' },
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
