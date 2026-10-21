import {
  assertNoEdgeUnsafeStaticImports,
  staticExternalImportClosure,
} from './lib/packed-edge-imports.mjs'
import {
  assertPeerInstalled,
  assertSingleFirstPartyPackageVersion,
} from './lib/packed-installation-cohort.mjs'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertPeerMatchesDevelopmentDependency,
  assertPublishableDependencySpecs,
  createStrictNodeConsumerTsconfig,
  peerCompatibility,
  requiredPackedDevelopmentDependency,
  requiredPackedPackageVersion,
  requiredPackedPeerCandidateVersion,
} from './lib/packed-package-test.mjs'
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tempRoot = mkdtempSync(join(tmpdir(), 'agent-runtime-package-'))
const suppliedTarball = process.argv[2] ? resolve(process.argv[2]) : undefined
const suppliedKnowledgeTarball = process.argv[3] ? resolve(process.argv[3]) : undefined
const suppliedSandboxTarball = process.argv[4] ? resolve(process.argv[4]) : undefined

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
  if (suppliedSandboxTarball && !existsSync(suppliedSandboxTarball)) {
    throw new Error(`supplied sandbox tarball does not exist: ${suppliedSandboxTarball}`)
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
    assertPeerMatchesDevelopmentDependency(packageJson, name, peerCompatibility[name])
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
    './durable',
    './tool-loop',
    './placement',
    './intelligence',
    './kernel',
    './analyst-loop',
    './profiles',
    './platform',
    './candidate-execution',
    './testing',
    './mcp',
  ]
  for (const subpath of requiredSubpaths) {
    if (!(subpath in packageExports)) {
      throw new Error(`packed package removed public export ${subpath}`)
    }
  }
  for (const subpath of ['graph', 'primeintellect', 'conversation', 'knowledge', 'environment-provider']) {
    if (`./${subpath}` in packageExports) {
      throw new Error(`removed public subpath returned: ${subpath}`)
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
  // Edge entries: a Worker bundles them with no Node compatibility and no peer installs.
  for (const subpath of ['./tool-loop', './placement']) {
    const entryPath = join(packageDir, packageExports[subpath].import)
    const externalImports = staticExternalImportClosure(entryPath, packageDir)
    if (externalImports.length > 0) {
      throw new Error(`${subpath} entry has static external imports: ${externalImports.join(', ')}`)
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
  const providerPackages = [
    '@tangle-network/agent-provider-cli-bridge',
    '@tangle-network/agent-provider-tangle',
    '@tangle-network/agent-provider-daytona',
    '@tangle-network/agent-provider-e2b',
  ]
  const providerDependencies = Object.fromEntries(
    providerPackages.map((name) => [name, requiredPackedDevelopmentDependency(packageJson, name)]),
  )
  const sandboxVersion = suppliedSandboxTarball
    ? requiredPackedPeerCandidateVersion(
        packageJson,
        '@tangle-network/sandbox',
        JSON.parse(run('tar', ['-xOf', suppliedSandboxTarball, 'package/package.json'], repoRoot)),
      )
    : requiredPackedDevelopmentDependency(packageJson, '@tangle-network/sandbox')
  if (suppliedSandboxTarball) {
    peerDependencies['@tangle-network/sandbox'] = `file:${suppliedSandboxTarball}`
  }
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
          ...providerDependencies,
        },
        devDependencies: {
          '@types/node': requiredPackedDevelopmentDependency(packageJson, '@types/node'),
          typescript: consumerTypeScriptVersion,
        },
        ...(suppliedKnowledgeTarball
          ? { overrides: { '@tangle-network/agent-knowledge': '$@tangle-network/agent-knowledge' } }
          : {}),
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    join(appDir, 'tsconfig.json'),
    `${JSON.stringify(
      { ...createStrictNodeConsumerTsconfig(), include: ['consumer.ts', 'provider-consumer.ts'] },
      null,
      2,
    )}\n`,
  )
  copyFileSync(
    join(repoRoot, 'scripts', 'fixtures', 'packed-provider-consumer.ts'),
    join(appDir, 'provider-consumer.ts'),
  )
  copyFileSync(
    join(repoRoot, 'scripts', 'fixtures', 'packed-runtime-consumer.ts'),
    join(appDir, 'consumer.ts'),
  )
  // This fixture type-checks with its declared dev toolchain; ambient production
  // install settings must not silently omit TypeScript or the Node declarations.
  run('npm', ['install', '--strict-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund'], appDir)
  const installedScope = join(appDir, 'node_modules', '@tangle-network')
  const expectedFirstPartyVersions = {
    ...providerDependencies,
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
    '@tangle-network/sandbox': sandboxVersion,
  }
  for (const [packageName, expectedVersion] of Object.entries(
    expectedFirstPartyVersions,
  )) {
    assertSingleFirstPartyPackageVersion(installedScope, packageName, expectedVersion)
  }
  assertNoEdgeUnsafeStaticImports(installedScope)
  run('npm', ['exec', '--', 'tsc', '-p', 'tsconfig.json'], appDir)
  run(process.execPath, ['--experimental-strip-types', 'provider-consumer.ts'], appDir)
  copyFileSync(
    join(repoRoot, 'scripts', 'fixtures', 'packed-sandbox-contract-consumer.mjs'),
    join(appDir, 'sandbox-contract-consumer.mjs'),
  )
  const cohortBoundary = sandboxBoundaryResult(
    run(process.execPath, ['sandbox-contract-consumer.mjs'], appDir),
  )

  run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      readFileSync(join(repoRoot, 'scripts', 'fixtures', 'packed-entrypoint-imports.mjs'), 'utf8'),
    ],
    appDir,
  )

  // Node workers inherit execArgv: use a normal file consumer, rather than the
  // --input-type=module eval launcher used for the import-only probe above.
  writeFileSync(join(appDir, 'code-mode-consumer.mjs'), `
        const { strict: assert } = await import('node:assert')
        const { runCodeMode, createCodeModeTools } = await import('@tangle-network/agent-runtime/kernel')
        let effects = 0
        const tools = [{ name: 'read', execute: () => ({ value: ++effects }) }]
        const program = createCodeModeTools(tools, { concurrency: 1 })
        const context = { signal: new AbortController().signal, callId: 'packed', parentCallId: 'packed' }
        const result = await program.tools.find(tool => tool.name === 'codemode').execute({
          code: 'const rows = await Promise.all([tools.read({}), tools.read({})]); store("sum", rows.reduce((n, r) => n + r.value, 0)); return load("sum")',
        }, context)
        assert.equal(result.ok, true, JSON.stringify(result))
        assert.equal(result.value, 3)
        // A newly constructed toolset restores only committed data, without replaying effects.
        const resumed = createCodeModeTools(tools, { store: program.snapshotStore() })
        const restored = await resumed.tools.find(tool => tool.name === 'codemode').execute({
          code: 'return load("sum")',
        }, { ...context, callId: 'restored', parentCallId: 'restored' })
        assert.equal(restored.value, 3)
        assert.equal(effects, 2)
        const isolated = await runCodeMode('return [typeof process, typeof fetch]', {
          tools: [], callId: 'isolation', timeoutMs: 5000,
        })
        assert.equal(isolated.ok, true, JSON.stringify(isolated))
        assert.deepEqual(isolated.value, ['undefined', 'undefined'])
  `)
  run(process.execPath, ['code-mode-consumer.mjs'], appDir)

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
    ['install', '--strict-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund'],
    standaloneAppDir,
  )
  const standaloneScope = join(standaloneAppDir, 'node_modules', '@tangle-network')
  assertPeerInstalled(
    standaloneScope,
    '@tangle-network/sandbox',
    packageJson.peerDependencies['@tangle-network/sandbox'],
  )
  copyFileSync(
    join(repoRoot, 'scripts', 'fixtures', 'packed-sandbox-contract-consumer.mjs'),
    join(standaloneAppDir, 'sandbox-contract-consumer.mjs'),
  )
  const standaloneBoundary = sandboxBoundaryResult(
    run(process.execPath, ['sandbox-contract-consumer.mjs'], standaloneAppDir),
  )
  if (standaloneBoundary.conversionCanonicalSha256 !== cohortBoundary.conversionCanonicalSha256) {
    throw new Error(
      `candidate profile conversion under agent-interface@${standaloneBoundary.interfaceVersion} differs from agent-interface@${cohortBoundary.interfaceVersion}`,
    )
  }
  process.stdout.write(
    `Sandbox contract boundary: agent-interface@${cohortBoundary.interfaceVersion} and @${standaloneBoundary.interfaceVersion} convert to identical canonical bytes; ${standaloneBoundary.uncarriedFieldRefusals} uncarried-field refusals (proxySecrets admitted by the standalone Interface: ${standaloneBoundary.interfaceAdmitsProxySecrets}).\n`,
  )
  run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      readFileSync(join(repoRoot, 'scripts', 'fixtures', 'packed-entrypoint-imports.mjs'), 'utf8'),
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
        const assert = (await import('node:assert/strict')).default
        const handle = kernel.createRootHandle()
        const supervisor = kernel.createSupervisor()
        supervisor.attach(handle)
        const cancellation = await supervisor.run({
          name: 'packed-root-signals',
          async act(_task, scope) {
            for (const signal of [
              { kind: 'pause' },
              { kind: 'resume' },
              { kind: 'ask', question: 'What is running?' },
            ]) {
              assert.throws(() => handle.signal(signal), root.ValidationError)
              assert.equal(scope.signal.aborted, false)
            }
            handle.signal({ kind: 'cancel', reason: 'packed consumer stop' })
          },
        }, 'task', {
          budget: { maxIterations: 1, maxTokens: 10 },
          runId: 'packed-root-signals',
          journal: new kernel.InMemorySpawnJournal(),
          blobs: new kernel.InMemoryResultBlobStore(),
          executors: kernel.createExecutorRegistry(),
        })
        assert.equal(cancellation.reason, 'cancelled')
        assert.equal(cancellation.source, 'root-signal')
        assert.equal(cancellation.cancellationReason, 'packed consumer stop')
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
        const intelligence = await import('@tangle-network/agent-runtime/intelligence')
        const expectedIntelligence = [
          'createIntelligenceClient',
          'createCertifiedPromptSource',
          'withIntelligence',
          'pullCertified',
          'resolveEffort',
          'isIntelligenceOff',
          'defaultRedactor',
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
        let pulls = 0
        const source = intelligence.createCertifiedPromptSource({
          target: 'packed-consumer', apiKey: 'fixture', refreshMs: 60000,
          fetchImpl: async () => new Response(JSON.stringify({
            target: 'packed-consumer',
            promptSurface: { surface: 'revision-' + (++pulls), surfaceHash: 'fixture', version: pulls, lift: null },
            artifacts: {},
          }), { status: 200 }),
        })
        await source.compose('BASE')
        await source.refresh({ force: true })
        const composed = await source.compose('BASE')
        if (pulls !== 2 || !composed.includes('revision-2')) {
          throw new Error('packed certified source lost forced refresh semantics')
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
        for (const name of ['improve', 'officialGepa', 'officialSkillOpt', 'createCommandProfileTrainer', 'createProfileImprovementHarness']) {
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
        const knowledge = await import('@tangle-network/agent-runtime')
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
          'captureAgentWorkspaceSnapshot',
          'materializeAgentWorkspaceSnapshot',
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
        const { verifyWorkingTreeConsumer } = await import(
          ${JSON.stringify(new URL('./lib/working-tree-consumer.mjs', import.meta.url).href)}
        )
        const kernel = await import('@tangle-network/agent-runtime/kernel')
        await verifyWorkingTreeConsumer(candidates, kernel)
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
        const provider = await import('@tangle-network/agent-runtime/kernel')
        const expectedProvider = [
          'createAgentEnvironmentProviderRegistry',
          'providerAsExecutor',
          'providerAsSandboxClient',
          'resolveAgentEnvironmentProvider',
        ]
        for (const name of expectedProvider) {
          if (typeof provider[name] !== 'function') throw new Error('missing environment-provider export ' + name)
        }
        const { verifyProviderReplacementConsumer } = await import(
          ${JSON.stringify(new URL('./lib/provider-replacement-consumer.mjs', import.meta.url).href)}
        )
        await verifyProviderReplacementConsumer(provider)
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
        const kernel = await import('@tangle-network/agent-runtime/kernel')
        const { verifyRetainedAdmissionConsumer } = await import(
          ${JSON.stringify(new URL('./lib/retained-admission-consumer.mjs', import.meta.url).href)}
        )
        await verifyRetainedAdmissionConsumer(kernel)
      `,
    ],
    appDir,
  )

  run(process.execPath, ['--input-type=module', '--eval', `
    const kernel = await import('@tangle-network/agent-runtime/kernel')
    const { verifyRemoteSupervisorConsumer } = await import(
      ${JSON.stringify(new URL('./lib/remote-supervisor-proof.mjs', import.meta.url).href)}
    )
    await verifyRemoteSupervisorConsumer(kernel)
  `], appDir)

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

function sandboxBoundaryResult(stdout) {
  const result = JSON.parse(stdout.trim().split('\n').at(-1))
  if (result.kind !== 'packed-sandbox-contract-boundary') {
    throw new Error(`unexpected Sandbox contract boundary result: ${stdout.trim()}`)
  }
  return result
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
