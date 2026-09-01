import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertPeerMatchesDevelopmentDependency,
  assertPublishableDependencySpecs,
  createStrictNodeConsumerTsconfig,
  isExactVersionSpec,
  rangeAdmits,
  requiredPackedDevelopmentDependency,
  requiredPackedPackageVersion,
  sandboxCompatibilityVersions,
  sandboxPeerRange,
} from './lib/packed-package-test.mjs'
import {
  findLiteralModuleSpecifiers,
  findStaticPackageImports,
} from './lib/static-imports.mjs'

// Static imports of these packages mutate Node builtins at module load and can
// make edge runtimes reject a Worker before startup. Scan installed first-party
// output because Runtime can inherit the failure through a transitive package.
const edgeUnsafeStaticImports = ['graceful-fs', 'proper-lockfile']

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tempRoot = mkdtempSync(join(tmpdir(), 'agent-runtime-package-'))
const suppliedTarball = process.argv[2] ? resolve(process.argv[2]) : undefined
const suppliedKnowledgeTarball = process.argv[3] ? resolve(process.argv[3]) : undefined

try {
  const packDir = join(tempRoot, 'pack')
  const unpackDir = join(tempRoot, 'unpack')
  const appDir = join(tempRoot, 'app')
  const standaloneAppDir = join(tempRoot, 'standalone-app')
  mkdirSync(packDir, { recursive: true })
  mkdirSync(unpackDir, { recursive: true })
  mkdirSync(appDir, { recursive: true })
  mkdirSync(standaloneAppDir, { recursive: true })

  if (suppliedTarball && !existsSync(suppliedTarball)) {
    throw new Error(`supplied release tarball does not exist: ${suppliedTarball}`)
  }
  if (suppliedKnowledgeTarball && !existsSync(suppliedKnowledgeTarball)) {
    throw new Error(`supplied knowledge tarball does not exist: ${suppliedKnowledgeTarball}`)
  }
  if (!suppliedTarball) {
    run('pnpm', ['pack', '--pack-destination', packDir], repoRoot)
  }
  const tarballs = suppliedTarball
    ? [suppliedTarball]
    : run('find', [packDir, '-maxdepth', '1', '-name', '*.tgz', '-print'], repoRoot)
        .trim()
        .split('\n')
        .filter(Boolean)
  if (tarballs.length !== 1) {
    throw new Error(`expected exactly one packed tarball, found ${tarballs.length}`)
  }

  run('tar', ['-xzf', tarballs[0], '-C', unpackDir], repoRoot)
  const packageDir = join(unpackDir, 'package')
  const packageJson = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  assertPublishableDependencySpecs(packageJson)
  for (const name of [
    '@tangle-network/agent-eval',
    '@tangle-network/agent-interface',
    '@tangle-network/sandbox',
  ]) {
    assertPeerMatchesDevelopmentDependency(
      packageJson,
      name,
      name === '@tangle-network/sandbox'
        ? { expectedRange: sandboxPeerRange, admittedVersions: sandboxCompatibilityVersions }
        : undefined,
    )
  }
  if (packageJson.peerDependenciesMeta?.['@tangle-network/agent-eval']?.optional) {
    throw new Error('@tangle-network/agent-eval must stay required: root and ./kernel import it at runtime')
  }
  if (packageJson.peerDependenciesMeta?.['@tangle-network/sandbox']?.optional) {
    throw new Error(
      '@tangle-network/sandbox must stay required: public execution exports import its runtime modules',
    )
  }
  const packageExports = packageJson.exports
  if (!packageExports || typeof packageExports !== 'object') {
    throw new Error('packed package has no exports map')
  }
  const requiredSubpaths = [
    '.',
    './agent',
    './conversation',
    './durable',
    './tool-loop',
    './intelligence',
    './kernel',
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
  const toolLoopPath = join(packageDir, packageExports['./tool-loop'].import)
  const toolLoopExternalImports = staticExternalImportClosure(toolLoopPath, packageDir)
  if (toolLoopExternalImports.length > 0) {
    throw new Error(
      `tool-loop entry has static external imports: ${toolLoopExternalImports.join(', ')}`,
    )
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
  const knowledgePackageSpec = suppliedKnowledgeTarball
    ? `file:${suppliedKnowledgeTarball}`
    : knowledgePackageJson.version
  const peerPackages = [
    '@tangle-network/agent-eval',
    '@tangle-network/agent-interface',
    '@tangle-network/sandbox',
  ]
  const peerDependencies = Object.fromEntries(
    peerPackages.map((name) => {
      return [name, requiredPackedDevelopmentDependency(packageJson, name)]
    }),
  )
  const consumerTypeScriptAlias = packageJson.devDependencies?.['typescript-consumer']
  const consumerTypeScriptPrefix = 'npm:typescript@'
  if (
    typeof consumerTypeScriptAlias !== 'string' ||
    !consumerTypeScriptAlias.startsWith(consumerTypeScriptPrefix)
  ) {
    throw new Error('packed consumer requires an exact typescript-consumer alias')
  }
  const consumerTypeScriptVersion = consumerTypeScriptAlias.slice(
    consumerTypeScriptPrefix.length,
  )
  if (!/^\d+\.\d+\.\d+$/.test(consumerTypeScriptVersion)) {
    throw new Error('packed consumer requires an exact TypeScript version')
  }
  writeFileSync(
    join(appDir, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        type: 'module',
        dependencies: {
          '@tangle-network/agent-runtime': `file:${tarballs[0]}`,
          '@tangle-network/agent-knowledge': knowledgePackageSpec,
          ...peerDependencies,
        },
        devDependencies: {
          '@types/node': requiredPackedDevelopmentDependency(packageJson, '@types/node'),
          typescript: consumerTypeScriptVersion,
        },
        overrides: {
          '@tangle-network/agent-knowledge': '$@tangle-network/agent-knowledge',
        },
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    join(appDir, 'tsconfig.json'),
    `${JSON.stringify(createStrictNodeConsumerTsconfig(), null, 2)}\n`,
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
        SandboxSizePreset,
        Sha256Digest,
      } from '@tangle-network/agent-interface'
      import type {
        ImproveMethodResult,
        ImprovementProfileCandidatePopulation,
        ImprovementProfilePopulationCandidateSource,
      } from '@tangle-network/agent-runtime'
      import {
        driverAgent,
        type AgentProfileImprovementFixture,
        type DriverAgentOptions,
        loadAgentImprovementProposalFixture,
        loadAgentProfileImprovementFixture,
        type ToolLoopChat,
      } from '@tangle-network/agent-runtime/testing'
      // @ts-expect-error Arbitrary driver construction is confined to the testing entrypoint.
      import type { DriverAgentOptions as ForbiddenDriverAgentOptions } from '@tangle-network/agent-runtime/kernel'
      // The caller-brain seam is production: ToolLoopChat resolves from /kernel (issue 694 option A).
      import {
        attachWorker,
        readWorkerSteerAcknowledgement,
        type ToolLoopChat as KernelToolLoopChat,
        type WorkerInteractiveBinding,
        type WorkerSteerAcknowledgement,
        type WriteWorkerSteerOptions,
        writeWorkerSteer,
      } from '@tangle-network/agent-runtime/kernel'
      import {
        deriveExecutionId,
        handleChatTurn,
        type ChatTurnResult,
      } from '@tangle-network/agent-runtime/durable'
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
        type AgentImprovementEvaluation,
        type AgentImprovementProfileStateDigest,
        type AgentImprovementProfileStateResolver,
        type AgentImprovementActivationTransitionInput,
        type CreateExactProcessCandidateExperimentExecutorOptions,
        type ExactProcessCandidateExperimentExecution,
        type ProfileImprovementActivationTransitionInput,
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
      declare const profileTransition: ProfileImprovementActivationTransitionInput
      declare const profileStateDigest: AgentImprovementProfileStateDigest
      declare const profileStateResolver: AgentImprovementProfileStateResolver
      declare const profileEvaluation: AgentImprovementEvaluation
      declare const activeProfile: AgentProfile
      declare const improvementResult: ImproveMethodResult
      const candidatePopulation: ImprovementProfileCandidatePopulation =
        improvementResult.candidatePopulation
      declare const populationCandidateSource: ImprovementProfilePopulationCandidateSource
      const proposalFixture: AgentImprovementProposal = loadAgentImprovementProposalFixture()
      const profileFixture: AgentProfileImprovementFixture =
        loadAgentProfileImprovementFixture()
      const fixtureProfileExperimentDigest: Sha256Digest =
        profileFixture.proposal.evaluation.experiment.digest
      const fixtureBaselineProfile: AgentProfile = profileFixture.baselineProfile
      const fixtureCandidateProfile: AgentProfile = profileFixture.candidateProfile
      const fixtureRecommendedSize: SandboxSizePreset = profileFixture.recommendedSize
      const durableExecutionId: string = deriveExecutionId({
        projectId: 'packed-consumer',
        sessionId: 'thread-1',
        turnIndex: 0,
      })
      const durableTurnHandler: typeof handleChatTurn = handleChatTurn
      declare const durableTurnResult: ChatTurnResult
      declare const workerBinding: WorkerInteractiveBinding
      declare const steerAcknowledgement: WorkerSteerAcknowledgement
      const steerOptions: WriteWorkerSteerOptions = {
        operationId: 'packed-consumer-steer',
        message: 'continue with the exact failing test',
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
      const profilePrepared = prepareAgentImprovementProfileActivation({
        currentByIdentity: new Map([['profile-1', activeProfile]]),
        profileTransition,
        stateDigest: profileStateDigest,
        resolveState: profileStateResolver,
      })
      if (profileEvaluation.kind === 'agent-profile-improvement-measured-comparison') {
        const profileExperimentDigest: Sha256Digest = profileEvaluation.experiment.digest
        void profileExperimentDigest
      }
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
      void profilePrepared
      void candidatePopulation
      void populationCandidateSource
      void proposalFixture
      void profileFixture
      void fixtureProfileExperimentDigest
      void fixtureBaselineProfile
      void fixtureCandidateProfile
      void fixtureRecommendedSize
      void durableExecutionId
      void durableTurnHandler
      void durableTurnResult
      void workerBinding
      void steerAcknowledgement
      void steerOptions
      void attachWorker
      void readWorkerSteerAcknowledgement
      void writeWorkerSteer
      void driverAgent
      void (undefined as unknown as DriverAgentOptions)
      void (undefined as unknown as ToolLoopChat)
      void (undefined as unknown as ForbiddenDriverAgentOptions)
      void (undefined as unknown as KernelToolLoopChat)
    `,
  )
  // This fixture type-checks with its declared dev toolchain; ambient production
  // install settings must not silently omit TypeScript or the Node declarations.
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], appDir)
  const installedScope = join(appDir, 'node_modules', '@tangle-network')
  const expectedFirstPartyVersions = {
    '@tangle-network/agent-core': requiredPackedPackageVersion(
      packageJson.dependencies?.['@tangle-network/agent-core'],
      '@tangle-network/agent-core',
      packageJson.name,
    ),
    '@tangle-network/agent-eval': requiredPackedDevelopmentDependency(
      packageJson,
      '@tangle-network/agent-eval',
    ),
    '@tangle-network/agent-interface': requiredPackedDevelopmentDependency(
      packageJson,
      '@tangle-network/agent-interface',
    ),
    '@tangle-network/agent-knowledge': requiredPackedPackageVersion(
      packageJson.dependencies?.['@tangle-network/agent-knowledge'],
      '@tangle-network/agent-knowledge',
      packageJson.name,
    ),
    '@tangle-network/sandbox': requiredPackedDevelopmentDependency(
      packageJson,
      '@tangle-network/sandbox',
    ),
  }
  for (const [packageName, expectedVersion] of Object.entries(
    expectedFirstPartyVersions,
  )) {
    assertSingleFirstPartyPackageVersion(installedScope, packageName, expectedVersion)
  }
  assertNoEdgeUnsafeStaticImports(installedScope)
  run('npm', ['exec', '--', 'tsc', '-p', 'tsconfig.json'], appDir)

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

  // Verify the install a new Runtime consumer actually performs. The app has
  // no direct peer declarations, so npm must install every required peer from
  // Runtime's metadata before any public entrypoint can load.
  writeFileSync(
    join(standaloneAppDir, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        type: 'module',
        dependencies: {
          '@tangle-network/agent-runtime': `file:${tarballs[0]}`,
        },
      },
      null,
      2,
    )}\n`,
  )
  run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
    standaloneAppDir,
  )
  const standaloneScope = join(standaloneAppDir, 'node_modules', '@tangle-network')
  assertPeerInstalled(
    standaloneScope,
    '@tangle-network/sandbox',
    packageJson.peerDependencies['@tangle-network/sandbox'],
  )
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
    standaloneAppDir,
  )

  run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        const root = await import('@tangle-network/agent-runtime')
        const kernel = await import('@tangle-network/agent-runtime/kernel')
        const toolLoop = await import('@tangle-network/agent-runtime/tool-loop')
        for (const name of ['attachWorker', 'readWorkerSteerAcknowledgement', 'writeWorkerSteer']) {
          if (typeof kernel[name] !== 'function') throw new Error('missing kernel export ' + name)
        }
        for (const name of ['runToolLoop', 'streamToolLoop']) {
          if (typeof toolLoop[name] !== 'function') throw new Error('missing tool-loop export ' + name)
          if (name in root) throw new Error('tool-loop export leaked through broad package root: ' + name)
        }
        async function* streamTurn() {
          yield { type: 'text', text: 'done' }
        }
        const result = await toolLoop.runToolLoop({
          systemPrompt: 'Finish the turn.',
          userMessage: 'Return done.',
          streamTurn,
          executeToolCall: async () => ({ ok: true, result: null }),
          isExecutableTool: () => false,
        })
        if (
          result.finalText !== 'done' ||
          result.stopReason !== 'completed' ||
          result.turns !== 1
        ) {
          throw new Error('packed tool-loop smoke failed: ' + JSON.stringify(result))
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
        const root = await import('@tangle-network/agent-runtime')
        const durable = await import('@tangle-network/agent-runtime/durable')
        for (const name of ['handleChatTurn', 'deriveExecutionId']) {
          if (typeof durable[name] !== 'function') throw new Error('missing durable export ' + name)
          if (name in root) throw new Error('durable export leaked through broad package root: ' + name)
        }
        if (
          durable.deriveExecutionId({
            projectId: 'packed-consumer',
            sessionId: 'thread-1',
            turnIndex: 0,
          }) !== 'packed-consumer:thread-1:0'
        ) {
          throw new Error('packed durable execution id drift')
        }
        if (
          durable.deriveExecutionId({
            projectId: 'packed:consumer',
            sessionId: 'thread:1',
            turnIndex: 0,
          }) !== 'packed%3Aconsumer:thread%3A1:0'
        ) {
          throw new Error('packed durable execution id is not collision-safe')
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
          'primeIntellectExecutorConfig',
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
          'proposeAgentProfileImprovement',
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
        for (const name of [
          'loadAgentImprovementProposalFixture',
          'loadAgentProfileImprovementFixture',
        ]) {
          if (name in intelligence) {
            throw new Error('testing fixture leaked into the intelligence entrypoint: ' + name)
          }
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
        for (const name of [
          'loadAgentImprovementProposalFixture',
          'loadAgentProfileImprovementFixture',
        ]) {
          if (name in runtime) {
            throw new Error('testing fixture leaked into the production root entrypoint: ' + name)
          }
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
        const expected = [
          'driverAgent',
          'loadAgentImprovementProposalFixture',
          'loadAgentProfileImprovementFixture',
          'runGraphWithTestBrain',
          'superviseWithTestBrain',
          'supervisorAgentWithTestBrain',
        ]
        const names = Object.keys(testing).sort()
        if (JSON.stringify(names) !== JSON.stringify(expected)) {
          throw new Error('testing entrypoint must export exactly the declared test helpers')
        }
        for (const name of expected) {
          if (typeof testing[name] !== 'function') {
            throw new Error('testing export must be a function: ' + name)
          }
        }
        const kernel = await import('@tangle-network/agent-runtime/kernel')
        for (const name of [
          'driverAgent',
          'runGraphWithTestBrain',
          'superviseWithTestBrain',
          'supervisorAgentWithTestBrain',
        ]) {
          if (name in kernel) {
            throw new Error('test-only model execution export leaked into kernel: ' + name)
          }
        }
        // runGraph's caller-brain seam is production (issue 694 option A): a brain must be
        // ACCEPTED, so the failure on an empty graph is about the graph, never about the brain.
        try {
          kernel.runGraph({}, { brain: async () => ({ toolCalls: [] }) })
          throw new Error('runGraph accepted an empty graph')
        } catch (error) {
          if (!(error instanceof Error) || error.message.includes('test-only')) {
            throw new Error('runGraph refused the production caller brain: ' + (error instanceof Error ? error.message : String(error)))
          }
          if (!error.message.includes('graph.nodes')) throw error
        }
        // supervise and supervisorAgent keep their guards: direct model injection stays test-only.
        for (const [name, invoke] of [
          ['supervise', () => kernel.supervise({}, null, { brain: async () => ({ toolCalls: [] }) })],
          ['supervisorAgent', () => kernel.supervisorAgent({}, { brain: async () => ({ toolCalls: [] }) })],
        ]) {
          try {
            invoke()
            throw new Error(name + ' accepted direct model injection')
          } catch (error) {
            if (!(error instanceof Error) || !error.message.includes('test-only')) throw error
          }
        }
        const first = testing.loadAgentImprovementProposalFixture()
        const second = testing.loadAgentImprovementProposalFixture()
        const firstProfile = testing.loadAgentProfileImprovementFixture()
        const secondProfile = testing.loadAgentProfileImprovementFixture()
        if (first === second || first.evaluation === second.evaluation) {
          throw new Error('testing fixture loader did not return an isolated clone')
        }
        if (
          first.evaluation.kind !== 'agent-improvement-measured-comparison' ||
          firstProfile.proposal.evaluation.kind !==
            'agent-profile-improvement-measured-comparison'
        ) {
          throw new Error('testing fixture loaders returned the wrong proposal shapes')
        }
        if (
          firstProfile === secondProfile ||
          firstProfile.proposal === secondProfile.proposal ||
          firstProfile.baselineProfile === secondProfile.baselineProfile ||
          firstProfile.candidateProfile === secondProfile.candidateProfile
        ) {
          throw new Error('profile testing fixture loader did not return an isolated clone')
        }
        const { canonicalCandidateDigest } =
          await import('@tangle-network/agent-interface')
        const experiment = firstProfile.proposal.evaluation.experiment
        const stateDigest = (profile) =>
          canonicalCandidateDigest({
            definition: profile,
            recommendedSize: firstProfile.recommendedSize,
          })
        if (
          stateDigest(firstProfile.baselineProfile) !== experiment.baseline.stateDigest ||
          stateDigest(firstProfile.candidateProfile) !== experiment.candidate.stateDigest
        ) {
          throw new Error('profile testing fixture state does not match its proposal')
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
          'providerAsExecutor',
          'providerAsSandboxClient',
          'resolveAgentEnvironmentProvider',
          'sandboxClientAsProvider',
        ]
        for (const name of expectedProvider) {
          if (typeof provider[name] !== 'function') throw new Error('missing environment-provider export ' + name)
        }
        const capabilities = await provider.sandboxClientAsProvider({
          async create() { throw new Error('packed capability check must not create') },
          async get() { return null },
        }).capabilities()
        const interactive = capabilities.interactiveAgent
        const requiredInteractive = [
          'start',
          'control',
          'status',
          'attach',
          'reattach',
          'sendPrompt',
          'input',
          'resize',
          'stop',
        ]
        if (!interactive || requiredInteractive.some((name) => interactive[name] !== true)) {
          throw new Error('packed Sandbox provider omits exact interactive capability')
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

function assertNoEdgeUnsafeStaticImports(scopeDir) {
  if (!existsSync(scopeDir)) throw new Error(`expected an installed scope at ${scopeDir}`)
  const packageDirs = firstPartyPackageDirs(scopeDir)
  if (packageDirs.length === 0) throw new Error(`no @tangle-network packages installed at ${scopeDir}`)
  const offenders = []
  let scanned = 0
  for (const packageDir of packageDirs) {
    // Third-party package bodies are outside this first-party artifact check.
    for (const file of ownJavascriptFiles(packageDir)) {
      scanned += 1
      const source = readFileSync(file, 'utf8')
      for (const specifier of findStaticPackageImports(source, edgeUnsafeStaticImports, file)) {
        offenders.push(`${file.slice(scopeDir.length + 1)} -> ${specifier}`)
      }
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      [
        'an installed @tangle-network package statically imports a module that patches a Node builtin.',
        'Cloudflare rejects the whole Worker on upload with code 10021, and a dry run cannot see it.',
        'Fix it in the owning package with a dynamic import() inside the function that needs it.',
        ...offenders.map((offender) => `  - ${offender}`),
      ].join('\n'),
    )
  }
  process.stdout.write(
    `Edge module-load safety: ${packageDirs.length} first-party packages, ${scanned} shipped files, no blocked static imports.\n`,
  )
}

function assertSingleFirstPartyPackageVersion(scopeDir, packageName, expectedVersion) {
  const installations = firstPartyPackageDirs(scopeDir)
    .map((packageDir) => ({
      packageDir,
      packageJson: JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')),
    }))
    .filter(({ packageJson }) => packageJson.name === packageName)
  if (installations.length === 0) {
    throw new Error(`packed consumer did not install ${packageName}`)
  }
  // A packed catalog specifier is a range below 1.0, so the installed copy is
  // proven by admission; only an exact specifier names one version to match.
  const installedVersion = installations[0].packageJson.version
  const admits = isExactVersionSpec(expectedVersion)
    ? installedVersion === expectedVersion
    : rangeAdmits(expectedVersion, installedVersion)
  if (installations.length !== 1 || !admits) {
    throw new Error(
      [
        `packed consumer must load exactly one ${packageName}@${expectedVersion}; found ${installations.length} installed path(s)`,
        ...installations.map(
          ({ packageDir, packageJson }) =>
            `  - ${packageJson.version} at ${relative(scopeDir, packageDir)}`,
        ),
      ].join('\n'),
    )
  }
  process.stdout.write(
    `${packageName}: one ${expectedVersion} installation.\n`,
  )
}

function assertPeerInstalled(scopeDir, packageName, peerRange) {
  const installations = firstPartyPackageDirs(scopeDir)
    .map((packageDir) => ({
      packageDir,
      packageJson: JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')),
    }))
    .filter(({ packageJson }) => packageJson.name === packageName)
  if (installations.length !== 1) {
    throw new Error(
      `standalone consumer must install exactly one ${packageName}; found ${installations.length}`,
    )
  }
  const installedVersion = installations[0].packageJson.version
  if (!rangeAdmits(peerRange, installedVersion)) {
    throw new Error(
      `standalone consumer installed ${packageName}@${installedVersion}, outside ${peerRange}`,
    )
  }
}

function staticExternalImportClosure(entryPath, packageDir) {
  const queue = [resolve(entryPath)]
  const visited = new Set()
  const externalImports = new Set()

  while (queue.length > 0) {
    const file = queue.pop()
    if (visited.has(file)) continue
    visited.add(file)

    const source = readFileSync(file, 'utf8')
    for (const specifier of findLiteralModuleSpecifiers(source, file)) {
      if (!specifier.startsWith('.')) {
        externalImports.add(specifier)
        continue
      }

      const importedFile = resolve(dirname(file), specifier)
      const packageRelativePath = relative(packageDir, importedFile)
      if (packageRelativePath.startsWith('..') || isAbsolute(packageRelativePath)) {
        throw new Error(`tool-loop import escapes the packed package: ${specifier}`)
      }
      if (!existsSync(importedFile)) {
        throw new Error(`tool-loop import is missing from the packed package: ${specifier}`)
      }
      queue.push(importedFile)
    }
  }

  return [...externalImports].sort()
}

/** Every installed `@tangle-network/*` directory, including nested copies. */
function firstPartyPackageDirs(scopeDir) {
  const dirs = []
  for (const entry of readdirSync(scopeDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const packageDir = join(scopeDir, entry.name)
    dirs.push(packageDir)
    const nestedScope = join(packageDir, 'node_modules', '@tangle-network')
    if (existsSync(nestedScope)) dirs.push(...firstPartyPackageDirs(nestedScope))
  }
  return dirs
}

function ownJavascriptFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...ownJavascriptFiles(path))
    else if (/\.(?:js|mjs|cjs)$/.test(entry.name)) files.push(path)
  }
  return files
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
