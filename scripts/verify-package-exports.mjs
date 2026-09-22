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
    './interaction',
    './intelligence',
    './loops',
    './environment-provider',
    './analyst-loop',
    './knowledge',
    './profiles',
    './platform',
    './primeintellect',
    './candidate-execution',
    './testing',
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
  const benchPackageJson = JSON.parse(
    readFileSync(join(repoRoot, 'bench', 'package.json'), 'utf8'),
  )
  for (const [name, runtimeVersion] of [
    ['@tangle-network/agent-eval', repoPackageJson.devDependencies['@tangle-network/agent-eval']],
    [
      '@tangle-network/agent-interface',
      repoPackageJson.devDependencies['@tangle-network/agent-interface'],
    ],
    [
      '@tangle-network/agent-knowledge',
      repoPackageJson.dependencies['@tangle-network/agent-knowledge'],
    ],
    ['@tangle-network/sandbox', repoPackageJson.devDependencies['@tangle-network/sandbox']],
  ]) {
    const benchVersion = benchPackageJson.dependencies?.[name]
    if (benchVersion !== runtimeVersion) {
      throw new Error(
        `Runtime and Bench dependency drift for ${name}: runtime=${runtimeVersion}, bench=${benchVersion}`,
      )
    }
  }
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
          types: ['node'],
        },
        include: ['*.ts'],
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
        AgentImprovementActivationOutcome,
        AgentImprovementProposal,
        AgentProfile,
        CandidateExecutionEvidence,
        Sha256Digest,
      } from '@tangle-network/agent-interface'
      import { loadAgentImprovementProposalFixture } from '@tangle-network/agent-runtime/testing'
      import type {
        OtelDropEvent,
        OtelFlushResult,
      } from '@tangle-network/agent-runtime'
      import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
      import {
        createExactProcessCandidateExperimentExecutor,
        agentImprovementProfileSurfaceDigest,
        agentImprovementProfileSurfaceInput,
        agentImprovementTargetProfileDiffs,
        exactProcessCandidateExperimentExecutionSupport,
        isAgentImprovementProfileSurface,
        parseCandidateProfileMaterialization,
        prepareAgentImprovementProfileActivation,
        verifyCandidateExecutionEvidence,
        type AgentImprovementActivationTransitionInput,
        type CertifiedContextCheckpointStore,
        type CreateExactProcessCandidateExperimentExecutorOptions,
        type ExactProcessCandidateExperimentExecution,
        type VerifyCandidateExecutionEvidenceOptions,
      } from '@tangle-network/agent-runtime/intelligence'

      declare const provider: AgentEnvironmentProvider
      declare const ports: CreateExactProcessCandidateExperimentExecutorOptions['ports']
      declare const grader: CreateExactProcessCandidateExperimentExecutorOptions['grader']
      declare const outputArtifacts: CreateExactProcessCandidateExperimentExecutorOptions['outputArtifacts']
      declare const traceStore: CreateExactProcessCandidateExperimentExecutorOptions['traceStore']
      declare const claimStore: CreateExactProcessCandidateExperimentExecutorOptions['claimStore']
      declare const executionInput: ExactProcessCandidateExperimentExecution
      declare const verification: VerifyCandidateExecutionEvidenceOptions
      declare const storedEvidence: unknown
      declare const transitionInput: AgentImprovementActivationTransitionInput
      declare const activeProfile: AgentProfile
      declare const dropEvent: OtelDropEvent
      declare const flushResult: OtelFlushResult
      const proposalFixture: AgentImprovementProposal = loadAgentImprovementProposalFixture()
      const droppedSpans: number = dropEvent.totalDropped + flushResult.droppedSpans
      const checkpointStore: CertifiedContextCheckpointStore = {
        async load() {
          return null
        },
        async save() {},
      }

      const executor = createExactProcessCandidateExperimentExecutor({
        provider,
        resources: { cpu: 2, memoryMb: 2048, diskMb: 8192 },
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
      const outcome: 'output' = exactProcessCandidateExperimentExecutionSupport.outcomes[0]
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
      const desiredProfile: AgentProfile = {
        ...activeProfile,
        prompt: { systemPrompt: 'candidate prompt' },
      }
      const prepared = prepareAgentImprovementProfileActivation({
        currentByIdentity: new Map([['profile-1', activeProfile]]),
        targets: [{
          surface: 'prompt',
          identity: 'profile-1',
          expectedBaseDigest: agentImprovementProfileSurfaceDigest(activeProfile, 'prompt'),
          desiredDigest: agentImprovementProfileSurfaceDigest(desiredProfile, 'prompt'),
          desiredInput: { prompt: desiredProfile.prompt },
        }],
      })
      if (prepared.status === 'apply') {
        const activationOutcome: AgentImprovementActivationOutcome = {
          status: 'applied',
          transactionId: 'compile-only',
          targets: prepared.targets,
        }
        void activationOutcome
      } else if (prepared.status === 'already-applied' || prepared.status === 'conflict') {
        const activationOutcome: AgentImprovementActivationOutcome = {
          status: prepared.status,
          targets: prepared.targets,
        }
        void activationOutcome
      }
      void execution
      void activation
      void outcome
      void desiredInput
      void currentInput
      void currentDigest
      void profileDiffs
      void proposalFixture
      void droppedSpans
      void checkpointStore
    `,
  )
  writeFileSync(
    join(appDir, 'environment-api.ts'),
    `
      import type { AgentProfile } from '@tangle-network/agent-interface'
      import type {
        AgentEnvironmentProvider,
      } from '@tangle-network/agent-interface/environment-provider'
      import {
        createAgentEnvironmentProviderRegistry,
        resolveAgentEnvironmentProvider,
      } from '@tangle-network/agent-runtime/environment-provider'
      import {
        createEnvironmentForSpec,
        createEnvironmentLineage,
        createEnvironmentToolPartState,
        createSteerableEnvironmentSession,
        inProcessEnvironmentProvider,
        inlineEnvironmentProvider,
        localEnvironmentProvider,
        mapAgentEnvironmentEvent,
        mapEnvironmentToolEvent,
        notifyAgentEnvironmentEventObserver,
        openEnvironmentRun,
        sumEnvironmentUsage,
        turnEvents,
        type EnvironmentDeliverable,
        type EnvironmentLineage,
        type EnvironmentLineageHandle,
        type EnvironmentRun,
        type EnvironmentSteeringOptions,
        type EnvironmentToolPartState,
        type EnvironmentTurnOptions,
        type EnvironmentTurnResult,
        type InProcessEnvironmentProviderOptions,
        type InlineEnvironmentProviderOptions,
        type LocalEnvironmentProviderOptions,
        type OpenEnvironmentRunOptions,
        type SteerableEnvironmentArgs,
        type SteerableEnvironmentSession,
      } from '@tangle-network/agent-runtime/loops'

      declare const profile: AgentProfile
      declare const provider: AgentEnvironmentProvider
      const registry = createAgentEnvironmentProviderRegistry([provider])
      const resolved = resolveAgentEnvironmentProvider(provider, registry)
      const inline = inlineEnvironmentProvider(() => ({
        runtime: 'compile-check',
        execute: async () => ({
          outRef: 'compile-check',
          out: { content: 'ok' },
          spent: { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
        }),
        teardown: async () => ({ destroyed: true }),
        resultArtifact: () => ({
          outRef: 'compile-check',
          out: { content: 'ok' },
          spent: { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
        }),
      }))
      const inProcess = inProcessEnvironmentProvider({
        onTurn: async () => [{ type: 'result', data: { finalText: 'ok' } }],
      })
      const pendingEnvironment = createEnvironmentForSpec(
        resolved,
        { profile, taskToPrompt: String },
        new AbortController().signal,
      )

      void createEnvironmentLineage
      void createEnvironmentToolPartState
      void createSteerableEnvironmentSession
      void localEnvironmentProvider
      void mapAgentEnvironmentEvent
      void mapEnvironmentToolEvent
      void notifyAgentEnvironmentEventObserver
      void openEnvironmentRun
      void sumEnvironmentUsage
      void turnEvents
      void inline
      void inProcess
      void pendingEnvironment
      void (0 as unknown as EnvironmentDeliverable<unknown>)
      void (0 as unknown as EnvironmentLineage)
      void (0 as unknown as EnvironmentLineageHandle)
      void (0 as unknown as EnvironmentRun<unknown>)
      void (0 as unknown as EnvironmentSteeringOptions)
      void (0 as unknown as EnvironmentToolPartState)
      void (0 as unknown as EnvironmentTurnOptions)
      void (0 as unknown as EnvironmentTurnResult<unknown>)
      void (0 as unknown as InProcessEnvironmentProviderOptions)
      void (0 as unknown as InlineEnvironmentProviderOptions)
      void (0 as unknown as LocalEnvironmentProviderOptions)
      void (0 as unknown as OpenEnvironmentRunOptions<unknown>)
      void (0 as unknown as SteerableEnvironmentArgs)
      void (0 as unknown as SteerableEnvironmentSession)
    `,
  )
  writeFileSync(
    join(appDir, 'removed-api.ts'),
    `
      import type { CertifiedContext } from '@tangle-network/agent-interface'
      import type { DetachedSessionDelegateOptions } from '@tangle-network/agent-runtime/mcp'
      import type { ToolLoopResult } from '@tangle-network/agent-runtime'
      import * as intelligence from '@tangle-network/agent-runtime/intelligence'
      import * as loops from '@tangle-network/agent-runtime/loops'
      import * as mcp from '@tangle-network/agent-runtime/mcp'
      import * as prime from '@tangle-network/agent-runtime/primeintellect'
      import * as environment from '@tangle-network/agent-runtime/environment-provider'

      declare const certified: CertifiedContext
      declare const detached: DetachedSessionDelegateOptions
      declare const toolLoop: ToolLoopResult

      // @ts-expect-error runLoop was removed; runAgentRounds is the current entry point.
      loops.runLoop
      // @ts-expect-error RunLoopOptions was removed with runLoop.
      type OldLoopOptions = loops.RunLoopOptions
      // @ts-expect-error AgentProfile is owned by @tangle-network/agent-interface.
      type OldLoopAgentProfile = loops.AgentProfile
      // @ts-expect-error detached delegates require an explicit executor.
      detached.sandboxClient
      // @ts-expect-error stopReason replaces the ambiguous cappedOut flag.
      toolLoop.cappedOut
      // @ts-expect-error PrimeIntellectImportDefaults was removed.
      type OldPrimeDefaults = prime.PrimeIntellectImportDefaults
      // @ts-expect-error certified delivery no longer carries profile patches.
      certified.profileDiffs
      // @ts-expect-error CertifiedProfile was replaced by the exact CertifiedContext contract.
      type OldCertifiedProfile = intelligence.CertifiedProfile
      // @ts-expect-error remote tool composition was removed from certified context delivery.
      intelligence.composeCertifiedProfile
      // @ts-expect-error old profile pull was replaced by tenant-bound context pull.
      intelligence.pullCertified
      // @ts-expect-error raw prompt rendering is internal; use composeCertifiedContext.
      intelligence.composeCertifiedPrompt
      // @ts-expect-error partial context extraction is internal.
      intelligence.certifiedPromptAdditions
      // @ts-expect-error partial file extraction is internal.
      intelligence.certifiedContextFiles
      // @ts-expect-error the old manifest converter was removed.
      intelligence.manifestFromProfile
      // @ts-expect-error the old admission error was removed with manifests.
      intelligence.CapabilityNotAdmittedError
      // @ts-expect-error reverse adaptation to the old SandboxClient contract was removed.
      environment.providerAsSandboxClient
      // @ts-expect-error reverse adapter options were removed with the adapter.
      type OldProviderAdapter = environment.ProviderAsSandboxClientOptions
      // @ts-expect-error provider execution is consumed directly by runtime entry points.
      environment.providerAsExecutor
      // @ts-expect-error duplicate provider executor options were removed.
      type OldProviderExecutorOptions = environment.ProviderExecutorOptions
      // @ts-expect-error SandboxClient was replaced by AgentEnvironmentProvider.
      type OldSandboxClient = loops.SandboxClient
      // @ts-expect-error Sandbox placement is reported as provider PlacementInfo.
      type OldSandboxPlacement = loops.LoopSandboxPlacement
      // @ts-expect-error persistent runs use openEnvironmentRun.
      loops.openSandboxRun
      // @ts-expect-error persistent run types use EnvironmentRun.
      type OldSandboxRun = loops.SandboxRun
      // @ts-expect-error persistent run options use OpenEnvironmentRunOptions.
      type OldSandboxRunOptions = loops.OpenSandboxRunOptions
      // @ts-expect-error in-process execution is an environment provider.
      loops.inProcessSandboxClient
      // @ts-expect-error executor adaptation is an environment provider.
      loops.inlineSandboxClient
      // @ts-expect-error same-host execution is an environment provider.
      loops.localSandboxClient
      // @ts-expect-error product transport resolution returns an environment provider.
      loops.resolveSandboxClient
      // @ts-expect-error provider-to-Sandbox reverse adaptation was removed.
      loops.sandboxClientAsProvider
      // @ts-expect-error Tangle adaptation lives in @tangle-network/agent-provider-tangle.
      loops.createTangleSandboxExactProcessProvider
      // @ts-expect-error environment creation replaces direct Sandbox acquisition.
      loops.acquireSandbox
      // @ts-expect-error capabilities come from AgentEnvironmentProvider.capabilities().
      loops.probeSandboxCapabilities
      // @ts-expect-error event mapping uses mapAgentEnvironmentEvent.
      loops.mapSandboxEvent
      // @ts-expect-error tool event mapping uses mapEnvironmentToolEvent.
      loops.mapSandboxToolEvent
      // @ts-expect-error event state uses createEnvironmentToolPartState.
      loops.createSandboxToolPartState
      // @ts-expect-error usage folding uses sumEnvironmentUsage.
      loops.sumSandboxUsage
      // @ts-expect-error lineage uses createEnvironmentLineage.
      loops.createSandboxLineage
      // @ts-expect-error steering uses createSteerableEnvironmentSession.
      loops.createSteerableSandboxSession
      // @ts-expect-error MCP delegation accepts an AgentEnvironmentProvider.
      mcp.createSiblingSandboxExecutor
      // @ts-expect-error MCP no longer exposes sibling Sandbox options.
      type OldSiblingOptions = mcp.SiblingSandboxExecutorOptions
      // @ts-expect-error detached turns use AgentEnvironment directly.
      type OldDriveTurnBox = mcp.DriveTurnCapableBox
      // @ts-expect-error in-process placement is reported by the provider.
      type OldInProcessPlacement = mcp.InProcessExecutorDescribePlacement

      void (0 as unknown as OldLoopOptions)
      void (0 as unknown as OldLoopAgentProfile)
      void (0 as unknown as OldPrimeDefaults)
      void (0 as unknown as OldCertifiedProfile)
      void (0 as unknown as OldProviderAdapter)
      void (0 as unknown as OldProviderExecutorOptions)
      void (0 as unknown as OldSandboxClient)
      void (0 as unknown as OldSandboxPlacement)
      void (0 as unknown as OldSandboxRun)
      void (0 as unknown as OldSandboxRunOptions)
      void (0 as unknown as OldSiblingOptions)
      void (0 as unknown as OldDriveTurnBox)
      void (0 as unknown as OldInProcessPlacement)
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
          'pullCertifiedContext',
          'resolveEffort',
          'isIntelligenceOff',
          'defaultRedactor',
          'composeCertifiedContext',
          'createCertifiedContextSource',
          'createExactProcessCandidateExperimentExecutor',
          'agentImprovementProfileSurfaceDigest',
          'agentImprovementProfileSurfaceInput',
          'createAgentImprovementActivation',
          'createAgentImprovementActivationResult',
          'executeAgentImprovementActivation',
          'executeAgentCandidateExperimentCell',
          'parseCandidateProfileMaterialization',
          'prepareAgentImprovementProfileActivation',
          'proposeAgentImprovement',
          'reviewAgentImprovementProposal',
          'runAgentCandidateExperiment',
          'exactProcessCandidateExperimentExecutionSupport',
          'verifyAgentImprovementActivation',
          'verifyAgentImprovementActivationResult',
          'verifyCandidateExecutionEvidence',
        ]
        for (const name of expectedIntelligence) {
          if (!(name in intelligence)) throw new Error('missing intelligence export ' + name)
        }
        if ('loadAgentImprovementProposalFixture' in intelligence) {
          throw new Error('testing fixture leaked into the intelligence entrypoint')
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
        for (const name of ['improve', 'officialGepa', 'officialSkillOpt']) {
          if (typeof runtime[name] !== 'function') throw new Error('missing improvement export ' + name)
        }
        if ('loadAgentImprovementProposalFixture' in runtime) {
          throw new Error('testing fixture leaked into the production root entrypoint')
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
        const testing = await import('@tangle-network/agent-runtime/testing')
        const names = Object.keys(testing)
        if (
          names.length !== 1 ||
          names[0] !== 'loadAgentImprovementProposalFixture' ||
          typeof testing.loadAgentImprovementProposalFixture !== 'function'
        ) {
          throw new Error('testing entrypoint must export only the proposal fixture loader')
        }
        const first = testing.loadAgentImprovementProposalFixture()
        const second = testing.loadAgentImprovementProposalFixture()
        if (first === second || first.evaluation === second.evaluation) {
          throw new Error('testing fixture loader did not return an isolated clone')
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
          'assertCandidateProfileBinding',
          'exactProcessProviderAsCandidateExecutor',
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
            env: { PATH: { kind: 'public', value: '/usr/local/bin:/usr/bin:/bin' } },
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
        candidates.assertCandidateProfileBinding(
          { name: 'packed-consumer', harness: 'codex' },
          bundle.profile,
        )
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
          'resolveAgentEnvironmentProvider',
        ]
        for (const name of expectedProvider) {
          if (typeof provider[name] !== 'function') throw new Error('missing environment-provider export ' + name)
        }
        for (const name of [
          'createTangleSandboxExactProcessProvider',
          'providerAsExecutor',
          'providerAsSandboxClient',
          'sandboxClientAsProvider',
        ]) {
          if (name in provider) throw new Error('retired environment-provider export leaked: ' + name)
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
        const loops = await import('@tangle-network/agent-runtime/loops')
        for (const name of [
          'createAgentEnvironmentProviderRegistry',
          'createEnvironmentForSpec',
          'createEnvironmentLineage',
          'createEnvironmentToolPartState',
          'createSteerableEnvironmentSession',
          'inProcessEnvironmentProvider',
          'inlineEnvironmentProvider',
          'localEnvironmentProvider',
          'mapAgentEnvironmentEvent',
          'mapEnvironmentToolEvent',
          'notifyAgentEnvironmentEventObserver',
          'openEnvironmentRun',
          'resolveAgentEnvironmentProvider',
          'sumEnvironmentUsage',
          'turnEvents',
        ]) {
          if (typeof loops[name] !== 'function') throw new Error('missing loops export ' + name)
        }
        for (const name of [
          'acquireSandbox',
          'createSandboxLineage',
          'createSandboxToolPartState',
          'createSteerableSandboxSession',
          'createTangleSandboxExactProcessProvider',
          'inProcessSandboxClient',
          'inlineSandboxClient',
          'localSandboxClient',
          'mapSandboxEvent',
          'mapSandboxToolEvent',
          'openSandboxRun',
          'probeSandboxCapabilities',
          'providerAsExecutor',
          'resolveEnvironmentProvider',
          'resolveSandboxClient',
          'sandboxClientAsProvider',
          'sumSandboxUsage',
        ]) {
          if (name in loops) throw new Error('retired loops export leaked: ' + name)
        }

        const mcp = await import('@tangle-network/agent-runtime/mcp')
        for (const name of [
          'createDelegationExecutor',
          'createFleetWorkspaceExecutor',
          'createInProcessExecutor',
        ]) {
          if (typeof mcp[name] !== 'function') throw new Error('missing MCP export ' + name)
        }
        if ('createSiblingSandboxExecutor' in mcp) {
          throw new Error('retired MCP export leaked: createSiblingSandboxExecutor')
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
