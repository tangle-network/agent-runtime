
      import type {
        AgentCandidateProfileActivation,
        AgentImprovementActivationOutcome,
        AgentImprovementProposal,
        AgentProfile,
        AgentTrainingReceipt,
        CandidateExecutionEvidence,
        SandboxSizePreset,
        Sha256Digest,
      } from '@tangle-network/agent-interface'
      import {
        createCommandProfileTrainer,
        createProfileImprovementHarness,
        improve,
        type ControlledTrainingCommand,
        type ImproveTrainingOptions,
        type ImproveTrainingResult,
        type ProfileTrainer,
        type ImproveMethodResult,
        type ImproveSearchResult,
        searchMethod,
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
        createRootHandle,
        type ObserveInput,
        type ObserveOptions,
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
        type SeatSelection,
        type SeatSelectionInput,
        type SelectSeat,
      } from '@tangle-network/agent-runtime/durable'
      import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
      import {
        createCertifiedPromptSource,
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

      const promptSource = createCertifiedPromptSource({ target: 'packed-consumer' })
      const rootHandle = createRootHandle()
      rootHandle.signal({ kind: 'cancel', reason: 'operator stop' })
      // @ts-expect-error Runtime does not implement topology pause.
      rootHandle.signal({ kind: 'pause' })
      // @ts-expect-error Runtime does not implement topology resume.
      rootHandle.signal({ kind: 'resume' })
      // @ts-expect-error Messages go through the root inbox, not a discarded signal.
      rootHandle.signal({ kind: 'ask', question: 'What is running?' })
      const forcedPromptRefresh: Promise<void> = promptSource.refresh({ force: true })
      const ordinaryPromptRefresh: Promise<void> = promptSource.refresh()
      // @ts-expect-error Forced refresh is explicit boolean policy, not a truthy string.
      promptSource.refresh({ force: 'yes' })
      void forcedPromptRefresh
      void ordinaryPromptRefresh

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
      declare const trainingOptions: ImproveTrainingOptions
      declare const commandOptions: ControlledTrainingCommand
      declare const trainingResult: ImproveTrainingResult
      const training: Promise<ImproveTrainingResult> = improve(activeProfile, trainingOptions)
      const commandTrainer: ProfileTrainer = createCommandProfileTrainer(commandOptions)
      const profileHarness = createProfileImprovementHarness({
        profile: activeProfile,
        executionRef: trainingOptions.executionRef,
        agent: async () => { throw new Error('type-only fixture') },
      })
      const harnessTraining: Promise<ImproveTrainingResult> = profileHarness.train(trainingOptions)
      const { executionRef: _trainingExecution, ...missingTrainingExecution } = trainingOptions
      // @ts-expect-error Evaluation identity cannot substitute for the trainer/serving identity.
      profileHarness.train(missingTrainingExecution)
      if (trainingResult.succeeded) {
        const trainingReceipt: AgentTrainingReceipt = trainingResult.receipt
        const { timeoutMs: _timeout, ...withoutDeadline } = trainingOptions
        const retrained: Promise<ImproveTrainingResult> = improve(trainingResult.profile, withoutDeadline)
        const rebound = createProfileImprovementHarness({
          profile: trainingResult.profile,
          executionRef: trainingOptions.executionRef,
          agent: async () => 'fixture',
        })
        void retrained
        void rebound
        void trainingReceipt
      }
      void training
      void commandTrainer
      void harnessTraining
      declare const improvementResult: ImproveMethodResult
      const methodLedgerDigest: string | undefined = improvementResult.searchHistory?.ledger.sha256
      declare const searchResult: ImproveSearchResult
      const searchLedgerComplete: boolean = searchResult.searchHistory.complete
      const searchDecision: 'ship' | 'hold' = searchResult.decision
      const nativeSearch: typeof searchMethod = searchMethod
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
      declare const seatSelectionInput: SeatSelectionInput
      declare const seatSelection: SeatSelection
      const selectSeat: SelectSeat = async (_input: SeatSelectionInput) => seatSelection
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
      const observationInput: ObserveInput = {
        task: 'Inspect', output: 'done', trace: [], context: { prompts: ['correction'] },
      }
      const observationOptions: ObserveOptions = {
        maxContextChars: 12000,
        analysis: async (input) => ({
          findings: [], report: JSON.stringify(input.context),
          usage: { input: 0, output: 0, known: true },
        }),
      }
      void observationInput
      void observationOptions
      void execution
      void activation
      void outcome
      void desiredInput
      void currentInput
      void currentDigest
      void profileDiffs
      void profilePrepared
      void methodLedgerDigest
      void searchLedgerComplete
      void searchDecision
      void nativeSearch
      void proposalFixture
      void profileFixture
      void fixtureProfileExperimentDigest
      void fixtureBaselineProfile
      void fixtureCandidateProfile
      void fixtureRecommendedSize
      void durableExecutionId
      void durableTurnHandler
      void durableTurnResult
      void seatSelectionInput
      void selectSeat
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
