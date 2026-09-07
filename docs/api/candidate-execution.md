[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / candidate-execution

# candidate-execution

**`Experimental`**

`@tangle-network/agent-runtime/candidate-execution` — sealed candidate bundles
plus the isolated prepare/execute/finalize/recover lifecycle around them.

## Classes

### FileAgentCandidateExecutionClaimStore

**`Experimental`**

Cross-process lifecycle implemented as fsynced, create-if-absent records.

#### Implements

- [`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore)

#### Constructors

##### Constructor

> **new FileAgentCandidateExecutionClaimStore**(`options`): [`FileAgentCandidateExecutionClaimStore`](#fileagentcandidateexecutionclaimstore)

**`Experimental`**

###### Parameters

###### options

[`FileAgentCandidateExecutionClaimStoreOptions`](#fileagentcandidateexecutionclaimstoreoptions)

###### Returns

[`FileAgentCandidateExecutionClaimStore`](#fileagentcandidateexecutionclaimstore)

#### Methods

##### tryClaim()

> **tryClaim**(`requested`): `Promise`\<[`AgentCandidateExecutionClaimResult`](#agentcandidateexecutionclaimresult)\>

**`Experimental`**

###### Parameters

###### requested

[`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)

###### Returns

`Promise`\<[`AgentCandidateExecutionClaimResult`](#agentcandidateexecutionclaimresult)\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`tryClaim`](#tryclaim-1)

##### getAttempt()

> **getAttempt**(`requestedAttempt`): `Promise`\<[`AgentCandidateExecutionAttemptRecord`](#agentcandidateexecutionattemptrecord) \| `undefined`\>

**`Experimental`**

###### Parameters

###### requestedAttempt

[`AgentCandidateExecutionAttemptRef`](#agentcandidateexecutionattemptref)

###### Returns

`Promise`\<[`AgentCandidateExecutionAttemptRecord`](#agentcandidateexecutionattemptrecord) \| `undefined`\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`getAttempt`](#getattempt-1)

##### markCandidateMayRun()

> **markCandidateMayRun**(`requestedLease`): `Promise`\<[`AgentCandidateExecutionPhaseResult`](#agentcandidateexecutionphaseresult)\>

**`Experimental`**

Persist the point after which candidate code may have run.

###### Parameters

###### requestedLease

[`AgentCandidateExecutionLease`](#agentcandidateexecutionlease)

###### Returns

`Promise`\<[`AgentCandidateExecutionPhaseResult`](#agentcandidateexecutionphaseresult)\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`markCandidateMayRun`](#markcandidatemayrun-1)

##### stageTerminal()

> **stageTerminal**(`requestedLease`, `result`): `Promise`\<[`AgentCandidateExecutionStageResult`](#agentcandidateexecutionstageresult)\>

**`Experimental`**

Fsync the complete terminal record into the durable outbox.

###### Parameters

###### requestedLease

[`AgentCandidateExecutionLease`](#agentcandidateexecutionlease)

###### result

[`AgentCandidateExecutionTerminalResult`](#agentcandidateexecutionterminalresult)

###### Returns

`Promise`\<[`AgentCandidateExecutionStageResult`](#agentcandidateexecutionstageresult)\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`stageTerminal`](#stageterminal-1)

##### finish()

> **finish**(`requestedLease`, `requestedTerminalDigest`): `Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

**`Experimental`**

Publish exactly the staged terminal identified by `terminalDigest`.

###### Parameters

###### requestedLease

[`AgentCandidateExecutionLease`](#agentcandidateexecutionlease)

###### requestedTerminalDigest

`` `sha256:${string}` ``

###### Returns

`Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`finish`](#finish-1)

##### recoverExpired()

> **recoverExpired**(`requestedAttempt`, `evidence`): `Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

**`Experimental`**

Write a failed terminal only after the lease expired and a trusted worker
independently proved process death plus model and memory closure.

###### Parameters

###### requestedAttempt

[`AgentCandidateExecutionAttemptRef`](#agentcandidateexecutionattemptref)

###### evidence

[`AgentCandidateExecutionRecoveryEvidence`](#agentcandidateexecutionrecoveryevidence)

###### Returns

`Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`recoverExpired`](#recoverexpired-1)

***

### InMemoryAgentCandidateExecutionClaimStore

**`Experimental`**

Single-process lifecycle implementation.

#### Implements

- [`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore)

#### Constructors

##### Constructor

> **new InMemoryAgentCandidateExecutionClaimStore**(`options?`): [`InMemoryAgentCandidateExecutionClaimStore`](#inmemoryagentcandidateexecutionclaimstore)

**`Experimental`**

###### Parameters

###### options?

[`InMemoryAgentCandidateExecutionClaimStoreOptions`](#inmemoryagentcandidateexecutionclaimstoreoptions) = `{}`

###### Returns

[`InMemoryAgentCandidateExecutionClaimStore`](#inmemoryagentcandidateexecutionclaimstore)

#### Methods

##### tryClaim()

> **tryClaim**(`requested`): `Promise`\<[`AgentCandidateExecutionClaimResult`](#agentcandidateexecutionclaimresult)\>

**`Experimental`**

###### Parameters

###### requested

[`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)

###### Returns

`Promise`\<[`AgentCandidateExecutionClaimResult`](#agentcandidateexecutionclaimresult)\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`tryClaim`](#tryclaim-1)

##### getAttempt()

> **getAttempt**(`requestedAttempt`): `Promise`\<[`AgentCandidateExecutionAttemptRecord`](#agentcandidateexecutionattemptrecord) \| `undefined`\>

**`Experimental`**

###### Parameters

###### requestedAttempt

[`AgentCandidateExecutionAttemptRef`](#agentcandidateexecutionattemptref)

###### Returns

`Promise`\<[`AgentCandidateExecutionAttemptRecord`](#agentcandidateexecutionattemptrecord) \| `undefined`\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`getAttempt`](#getattempt-1)

##### markCandidateMayRun()

> **markCandidateMayRun**(`requestedLease`): `Promise`\<[`AgentCandidateExecutionPhaseResult`](#agentcandidateexecutionphaseresult)\>

**`Experimental`**

Persist the point after which candidate code may have run.

###### Parameters

###### requestedLease

[`AgentCandidateExecutionLease`](#agentcandidateexecutionlease)

###### Returns

`Promise`\<[`AgentCandidateExecutionPhaseResult`](#agentcandidateexecutionphaseresult)\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`markCandidateMayRun`](#markcandidatemayrun-1)

##### stageTerminal()

> **stageTerminal**(`requestedLease`, `result`): `Promise`\<[`AgentCandidateExecutionStageResult`](#agentcandidateexecutionstageresult)\>

**`Experimental`**

Fsync the complete terminal record into the durable outbox.

###### Parameters

###### requestedLease

[`AgentCandidateExecutionLease`](#agentcandidateexecutionlease)

###### result

[`AgentCandidateExecutionTerminalResult`](#agentcandidateexecutionterminalresult)

###### Returns

`Promise`\<[`AgentCandidateExecutionStageResult`](#agentcandidateexecutionstageresult)\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`stageTerminal`](#stageterminal-1)

##### finish()

> **finish**(`requestedLease`, `requestedTerminalDigest`): `Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

**`Experimental`**

Publish exactly the staged terminal identified by `terminalDigest`.

###### Parameters

###### requestedLease

[`AgentCandidateExecutionLease`](#agentcandidateexecutionlease)

###### requestedTerminalDigest

`` `sha256:${string}` ``

###### Returns

`Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`finish`](#finish-1)

##### recoverExpired()

> **recoverExpired**(`requestedAttempt`, `evidence`): `Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

**`Experimental`**

Write a failed terminal only after the lease expired and a trusted worker
independently proved process death plus model and memory closure.

###### Parameters

###### requestedAttempt

[`AgentCandidateExecutionAttemptRef`](#agentcandidateexecutionattemptref)

###### evidence

[`AgentCandidateExecutionRecoveryEvidence`](#agentcandidateexecutionrecoveryevidence)

###### Returns

`Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`recoverExpired`](#recoverexpired-1)

## Interfaces

### WorkspaceScanLimits

**`Experimental`**

The per-scan caps a bounded capture applies.

#### Properties

##### maxFiles

> `readonly` **maxFiles**: `number`

**`Experimental`**

##### maxFileBytes

> `readonly` **maxFileBytes**: `number`

**`Experimental`**

##### maxTotalFileBytes

> `readonly` **maxTotalFileBytes**: `number`

**`Experimental`**

***

### WorkspaceScanOptions

**`Experimental`**

What a workspace scan reads and how it records a file's permission bits.

#### Properties

##### ignoredProtectedRootEntries?

> `readonly` `optional` **ignoredProtectedRootEntries?**: readonly (`".git"` \| `".sidecar"`)[]

**`Experimental`**

##### limits?

> `readonly` `optional` **limits?**: [`WorkspaceScanLimits`](#workspacescanlimits)

**`Experimental`**

##### portableTree?

> `readonly` `optional` **portableTree?**: `boolean`

**`Experimental`**

Record Git's two file modes instead of the filesystem's exact permission bits: `0o755` when
any execute bit is set, `0o644` otherwise. A checkout umask then cannot move a manifest
digest, while a real permission change still does.

This is the normalization `readCandidateGitTreeFiles` already applies to a Git tree
(`100644`/`100755`), so one tree scanned from disk and the same tree read out of Git produce
the same manifest. Off by default: the flag changes the digest, so a capture and the verify
that checks it must agree on it.

***

### AgentCandidateCodeSurfaceSource

**`Experimental`**

The only accepted path from an agent-eval code candidate to executable bytes.

#### Properties

##### kind

> **kind**: `"code-surface"`

**`Experimental`**

##### surface

> **surface**: `CodeSurface`

**`Experimental`**

##### repository

> **repository**: `AgentCandidateGitHubRepository`

**`Experimental`**

##### worktreeDir?

> `optional` **worktreeDir?**: `string`

**`Experimental`**

Optional parent directory used to resolve a relative `surface.worktreeRef`.

***

### BuildAgentCandidateBundleInput

**`Experimental`**

Complete measured surfaces and execution policy compiled into one candidate bundle.

#### Properties

##### profile

> **profile**: [`AgentCandidateProfileSource`](#agentcandidateprofilesource)

**`Experimental`**

##### code

> **code**: [`AgentCandidateCodeSource`](#agentcandidatecodesource)

**`Experimental`**

##### execution

> **execution**: `AgentCandidateExecution`

**`Experimental`**

##### knowledge?

> `optional` **knowledge?**: `AgentCandidateKnowledge`

**`Experimental`**

##### memory

> **memory**: `AgentCandidateMemoryPolicy`

**`Experimental`**

***

### AgentCandidatePreparationEvidence

**`Experimental`**

#### Properties

##### executionPlan

> `readonly` **executionPlan**: `AgentCandidateArtifactRef`

**`Experimental`**

##### materializationReceipt

> `readonly` **materializationReceipt**: `AgentCandidateArtifactRef`

**`Experimental`**

***

### FileAgentCandidateExecutionClaimStoreOptions

**`Experimental`**

#### Properties

##### directory

> **directory**: `string`

**`Experimental`**

Evaluator-owned directory shared by every process allowed to execute candidates.

##### now?

> `optional` **now?**: () => `number`

**`Experimental`**

Testable evaluator clock; defaults to `Date.now`.

###### Returns

`number`

***

### AgentCandidateExecutionCleanupHandles

**`Experimental`**

Non-secret identities a trusted recovery worker needs to close an abandoned attempt.

#### Properties

##### preparationId

> `readonly` **preparationId**: `string`

**`Experimental`**

##### modelGrantDigest

> `readonly` **modelGrantDigest**: `` `sha256:${string}` ``

**`Experimental`**

##### resolvedModel

> `readonly` **resolvedModel**: `AgentCandidateResolvedModel`

**`Experimental`**

##### traceRunId

> `readonly` **traceRunId**: `string`

**`Experimental`**

##### cleanupTimeoutMs

> `readonly` **cleanupTimeoutMs**: `number`

**`Experimental`**

##### memory?

> `readonly` `optional` **memory?**: `object`

**`Experimental`**

###### accessDigest

> `readonly` **accessDigest**: `` `sha256:${string}` ``

###### effectiveNamespace

> `readonly` **effectiveNamespace**: `string`

***

### AgentCandidateExecutionClaim

**`Experimental`**

Immutable signed identity stored for one execution attempt.

#### Properties

##### executionId

> `readonly` **executionId**: `string`

**`Experimental`**

##### attempt

> `readonly` **attempt**: `number`

**`Experimental`**

##### maxAttempts

> `readonly` **maxAttempts**: `number`

**`Experimental`**

##### retryPolicy

> `readonly` **retryPolicy**: `"none"` \| `"pre-model-infrastructure-only"`

**`Experimental`**

##### bundleDigest

> `readonly` **bundleDigest**: `` `sha256:${string}` ``

**`Experimental`**

##### executionPlanDigest

> `readonly` **executionPlanDigest**: `` `sha256:${string}` ``

**`Experimental`**

##### preparationEvidence

> `readonly` **preparationEvidence**: [`AgentCandidatePreparationEvidence`](#agentcandidatepreparationevidence)

**`Experimental`**

Durable canonical bytes needed to reconstruct the signed preparation.

##### retryLineageDigest

> `readonly` **retryLineageDigest**: `` `sha256:${string}` ``

**`Experimental`**

Frozen plan identity with only attempt number and per-attempt grant identity normalized.

##### leaseExpiresAtMs

> `readonly` **leaseExpiresAtMs**: `number`

**`Experimental`**

The winning lease stops authorizing a new terminal write at this instant.

##### resultTimeoutMs

> `readonly` **resultTimeoutMs**: `number`

**`Experimental`**

Frozen budget for task verification, executable grading, and receipt construction.

##### cleanup

> `readonly` **cleanup**: [`AgentCandidateExecutionCleanupHandles`](#agentcandidateexecutioncleanuphandles)

**`Experimental`**

Non-secret handles retained so an expired attempt can be closed and reconciled.

***

### AgentCandidateExecutionLease

**`Experimental`**

Secret capability required to finish the acquired attempt.

#### Properties

##### executionId

> `readonly` **executionId**: `string`

**`Experimental`**

##### attempt

> `readonly` **attempt**: `number`

**`Experimental`**

##### token

> `readonly` **token**: `string`

**`Experimental`**

##### expiresAtMs

> `readonly` **expiresAtMs**: `number`

**`Experimental`**

***

### AgentCandidateExecutionRecoveryEvidence

**`Experimental`**

Trusted, independently observed closure facts for one expired winning lease.

#### Properties

##### failureClass

> `readonly` **failureClass**: [`AgentCandidateExecutionFailureClass`](#agentcandidateexecutionfailureclass)

**`Experimental`**

##### usage

> `readonly` **usage**: `AgentCandidateFixedSpend`

**`Experimental`**

##### modelSettlement

> `readonly` **modelSettlement**: `AgentCandidateArtifactRef`

**`Experimental`**

##### failureEvidence?

> `readonly` `optional` **failureEvidence?**: `AgentCandidateArtifactRef`

**`Experimental`**

##### process

> `readonly` **process**: `object`

**`Experimental`**

###### stopped

> `readonly` **stopped**: `true`

###### executionPlanDigest

> `readonly` **executionPlanDigest**: `` `sha256:${string}` ``

##### model

> `readonly` **model**: `object`

**`Experimental`**

###### closed

> `readonly` **closed**: `true`

###### preparationId

> `readonly` **preparationId**: `string`

###### grantDigest

> `readonly` **grantDigest**: `` `sha256:${string}` ``

##### memory?

> `readonly` `optional` **memory?**: `object`

**`Experimental`**

###### closed

> `readonly` **closed**: `true`

###### preparationId

> `readonly` **preparationId**: `string`

###### accessDigest

> `readonly` **accessDigest**: `` `sha256:${string}` ``

###### effectiveNamespace

> `readonly` **effectiveNamespace**: `string`

***

### AgentCandidateExecutionAttemptRef

**`Experimental`**

#### Properties

##### executionId

> `readonly` **executionId**: `string`

**`Experimental`**

##### attempt

> `readonly` **attempt**: `number`

**`Experimental`**

***

### AgentCandidateExecutionAttemptRecord

**`Experimental`**

Persisted state available to a fresh trusted recovery worker after a crash.

#### Properties

##### claim

> `readonly` **claim**: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)

**`Experimental`**

##### phase

> `readonly` **phase**: [`AgentCandidateExecutionPhase`](#agentcandidateexecutionphase)

**`Experimental`**

##### staged?

> `readonly` `optional` **staged?**: [`AgentCandidateExecutionTerminalRecord`](#agentcandidateexecutionterminalrecord)

**`Experimental`**

Durable outbox content written before the terminal compare-and-set.

##### terminal?

> `readonly` `optional` **terminal?**: [`AgentCandidateExecutionTerminalRecord`](#agentcandidateexecutionterminalrecord)

**`Experimental`**

***

### AgentCandidateExecutionClaimStore

**`Experimental`**

Atomic one-shot store for candidate execution attempts.

Implementations must linearize both methods across every process sharing the
store. Terminal publication is deliberately two-step: `stageTerminal`
fsyncs the complete immutable outbox record, then `finish` publishes exactly
those staged bytes by digest. A crash between the two leaves recoverable
evidence rather than an ambiguous completed run.

#### Methods

##### tryClaim()

> **tryClaim**(`claim`): `Promise`\<[`AgentCandidateExecutionClaimResult`](#agentcandidateexecutionclaimresult)\>

**`Experimental`**

###### Parameters

###### claim

[`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)

###### Returns

`Promise`\<[`AgentCandidateExecutionClaimResult`](#agentcandidateexecutionclaimresult)\>

##### getAttempt()

> **getAttempt**(`attempt`): `Promise`\<[`AgentCandidateExecutionAttemptRecord`](#agentcandidateexecutionattemptrecord) \| `undefined`\>

**`Experimental`**

###### Parameters

###### attempt

[`AgentCandidateExecutionAttemptRef`](#agentcandidateexecutionattemptref)

###### Returns

`Promise`\<[`AgentCandidateExecutionAttemptRecord`](#agentcandidateexecutionattemptrecord) \| `undefined`\>

##### markCandidateMayRun()

> **markCandidateMayRun**(`lease`): `Promise`\<[`AgentCandidateExecutionPhaseResult`](#agentcandidateexecutionphaseresult)\>

**`Experimental`**

Persist the point after which candidate code may have run.

###### Parameters

###### lease

[`AgentCandidateExecutionLease`](#agentcandidateexecutionlease)

###### Returns

`Promise`\<[`AgentCandidateExecutionPhaseResult`](#agentcandidateexecutionphaseresult)\>

##### stageTerminal()

> **stageTerminal**(`lease`, `result`): `Promise`\<[`AgentCandidateExecutionStageResult`](#agentcandidateexecutionstageresult)\>

**`Experimental`**

Fsync the complete terminal record into the durable outbox.

###### Parameters

###### lease

[`AgentCandidateExecutionLease`](#agentcandidateexecutionlease)

###### result

[`AgentCandidateExecutionTerminalResult`](#agentcandidateexecutionterminalresult)

###### Returns

`Promise`\<[`AgentCandidateExecutionStageResult`](#agentcandidateexecutionstageresult)\>

##### finish()

> **finish**(`lease`, `terminalDigest`): `Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

**`Experimental`**

Publish exactly the staged terminal identified by `terminalDigest`.

###### Parameters

###### lease

[`AgentCandidateExecutionLease`](#agentcandidateexecutionlease)

###### terminalDigest

`` `sha256:${string}` ``

###### Returns

`Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

##### recoverExpired()

> **recoverExpired**(`attempt`, `evidence`): `Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

**`Experimental`**

Write a failed terminal only after the lease expired and a trusted worker
independently proved process death plus model and memory closure.

###### Parameters

###### attempt

[`AgentCandidateExecutionAttemptRef`](#agentcandidateexecutionattemptref)

###### evidence

[`AgentCandidateExecutionRecoveryEvidence`](#agentcandidateexecutionrecoveryevidence)

###### Returns

`Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

***

### InMemoryAgentCandidateExecutionClaimStoreOptions

**`Experimental`**

#### Properties

##### now?

> `optional` **now?**: () => `number`

**`Experimental`**

Testable evaluator clock; defaults to `Date.now`.

###### Returns

`number`

***

### DisposePreparedAgentCandidateOptions

**`Experimental`**

#### Properties

##### cleanupTimeoutMs?

> `optional` **cleanupTimeoutMs?**: `number`

**`Experimental`**

***

### ExactProcessCandidateExecutorOptions

**`Experimental`**

#### Properties

##### provider

> **provider**: `AgentEnvironmentProvider`

**`Experimental`**

##### resources

> **resources**: `AgentExactProcessResources`

**`Experimental`**

##### provisionTimeoutMs?

> `optional` **provisionTimeoutMs?**: `number`

**`Experimental`**

##### recoveryRetentionMs?

> `optional` **recoveryRetentionMs?**: `number`

**`Experimental`**

##### providerOptions?

> `optional` **providerOptions?**: `Record`\<`string`, `unknown`\>

**`Experimental`**

***

### ExecutePreparedAgentCandidateOptions

**`Experimental`**

#### Properties

##### executor

> **executor**: [`AgentCandidateExecutorPort`](#agentcandidateexecutorport)

**`Experimental`**

##### grader

> **grader**: [`AgentCandidateBenchmarkGraderPort`](#agentcandidatebenchmarkgraderport)

**`Experimental`**

##### outputArtifacts

> **outputArtifacts**: [`AgentCandidateOutputArtifactPort`](#agentcandidateoutputartifactport)

**`Experimental`**

##### traceStore

> **traceStore**: `TraceStore`

**`Experimental`**

##### claimStore

> **claimStore**: [`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore)

**`Experimental`**

Long-lived evaluator-owned store shared by every process that can run this benchmark.

##### cleanupTimeoutMs?

> `optional` **cleanupTimeoutMs?**: `number`

**`Experimental`**

Maximum time to prove process death and revoke protected access after a run ends.

##### resultTimeoutMs?

> `optional` **resultTimeoutMs?**: `number`

**`Experimental`**

Maximum time for task verification, executable grading, and receipt construction.

***

### AgentCandidateExecutionRoots

**`Experimental`**

Absolute container roots owned by one isolated candidate execution.

#### Properties

##### taskRoot

> `readonly` **taskRoot**: `string`

**`Experimental`**

##### candidateRoot?

> `readonly` `optional` **candidateRoot?**: `string`

**`Experimental`**

##### profileRoot?

> `readonly` `optional` **profileRoot?**: `string`

**`Experimental`**

Private runtime HOME used for agent-scoped profile files, when needed.

***

### PrepareAgentCandidateExecutionOptions

**`Experimental`**

#### Properties

##### cleanupTimeoutMs?

> `optional` **cleanupTimeoutMs?**: `number`

**`Experimental`**

##### resultTimeoutMs?

> `optional` **resultTimeoutMs?**: `number`

**`Experimental`**

Maximum time for task verification, executable grading, and receipt construction.

***

### ProtectedAgentCandidateModelGrantContext

**`Experimental`**

Values available only while one protected model grant is active.

#### Properties

##### activation

> `readonly` **activation**: [`AgentCandidateProtectedModelActivation`](#agentcandidateprotectedmodelactivation)

**`Experimental`**

##### reservation

> `readonly` **reservation**: [`AgentCandidateProtectedModelReservation`](#agentcandidateprotectedmodelreservation)

**`Experimental`**

##### resolved

> `readonly` **resolved**: `AgentCandidateResolvedModel`

**`Experimental`**

***

### RunProtectedAgentCandidateModelGrantOptions

**`Experimental`**

Inputs for one protected grant scoped to one bounded caller unit.

#### Type Parameters

##### TResult

`TResult`

#### Properties

##### port

> `readonly` **port**: [`AgentCandidateModelPort`](#agentcandidatemodelport)

**`Experimental`**

Runtime port that validates and settles the evaluator-owned grant.

##### resolve

> `readonly` **resolve**: `object`

**`Experimental`**

Provider-neutral model request resolved before any grant is reserved.

###### requested

> **requested**: `string`

###### harness

> **harness**: `HarnessType`

###### reasoningEffort

> **reasoningEffort**: `"medium"` \| `"high"` \| `"low"` \| `"minimal"` \| `"none"` \| `"ultracode"` \| `"xhigh"` \| `undefined`

##### reserve

> `readonly` **reserve**: [`AgentCandidateModelGrantRunReservationInput`](#agentcandidatemodelgrantrunreservationinput)

**`Experimental`**

One bounded unit's immutable identity, attempt, expiry, and limits.

##### deadlineAtMs

> `readonly` **deadlineAtMs**: `number`

**`Experimental`**

Must be no later than the reservation expiry.

##### execute

> `readonly` **execute**: (`context`) => `Promise`\<`TResult`\>

**`Experimental`**

Execute exactly one bounded unit while the activated environment is valid.

###### Parameters

###### context

[`ProtectedAgentCandidateModelGrantContext`](#protectedagentcandidatemodelgrantcontext)

###### Returns

`Promise`\<`TResult`\>

***

### RunProtectedAgentCandidateModelGrantResult

**`Experimental`**

Result and sealed settlement returned after one protected grant closes.

#### Type Parameters

##### TResult

`TResult`

#### Properties

##### value

> `readonly` **value**: `TResult`

**`Experimental`**

##### resolved

> `readonly` **resolved**: `AgentCandidateResolvedModel`

**`Experimental`**

##### reservation

> `readonly` **reservation**: [`AgentCandidateProtectedModelReservation`](#agentcandidateprotectedmodelreservation)

**`Experimental`**

##### settlement

> `readonly` **settlement**: [`AgentCandidateProtectedModelSettlement`](#agentcandidateprotectedmodelsettlement)

**`Experimental`**

***

### AgentCandidateModelGrantClient

**`Experimental`**

Narrow transport contract for a service that owns scoped model credentials
and the authoritative per-call usage ledger.

An HTTP client can bind these methods to control-plane endpoints. Keeping
transport out of the runtime prevents parent credentials, endpoint paths,
and retry policy from becoming part of the portable candidate contract.

#### Methods

##### reserve()

> **reserve**(`input`): `Promise`\<[`AgentCandidateProtectedModelReservation`](#agentcandidateprotectedmodelreservation)\>

**`Experimental`**

###### Parameters

###### input

###### executionId

`string`

###### preparationId

`string`

###### expiresAtMs

`number`

###### attempt

`AgentCandidateAttemptPolicy`

###### bundleDigest

`` `sha256:${string}` ``

###### resolved

`AgentCandidateResolvedModel`

###### limits

[`AgentCandidateModelLimits`](#agentcandidatemodellimits)

###### Returns

`Promise`\<[`AgentCandidateProtectedModelReservation`](#agentcandidateprotectedmodelreservation)\>

##### activate()

> **activate**(`input`): `Promise`\<[`AgentCandidateProtectedModelActivation`](#agentcandidateprotectedmodelactivation)\>

**`Experimental`**

###### Parameters

###### input

###### executionId

`string`

###### preparationId

`string`

###### grantDigest

`` `sha256:${string}` ``

###### resolved

`AgentCandidateResolvedModel`

###### deadlineAtMs

`number`

###### Returns

`Promise`\<[`AgentCandidateProtectedModelActivation`](#agentcandidateprotectedmodelactivation)\>

##### settle()

> **settle**(`input`): `Promise`\<[`AgentCandidateProtectedModelSettlement`](#agentcandidateprotectedmodelsettlement)\>

**`Experimental`**

###### Parameters

###### input

###### executionId

`string`

###### preparationId

`string`

###### grantDigest

`` `sha256:${string}` ``

###### resolved

`AgentCandidateResolvedModel`

###### reason

`"completed"` \| `"failed"` \| `"timeout"` \| `"replayed"` \| `"preparation-failed"` \| `"abandoned"`

###### Returns

`Promise`\<[`AgentCandidateProtectedModelSettlement`](#agentcandidateprotectedmodelsettlement)\>

***

### CreateProtectedAgentCandidateModelPortOptions

**`Experimental`**

#### Properties

##### client

> **client**: [`AgentCandidateModelGrantClient`](#agentcandidatemodelgrantclient)

**`Experimental`**

##### resolveModel

> **resolveModel**: (`input`) => `Promise`\<`AgentCandidateResolvedModel`\>

**`Experimental`**

Catalog/snapshot resolution stays separate from credential issuance.

###### Parameters

###### input

###### requested

`string`

###### harness

`HarnessType`

###### reasoningEffort

`"medium"` \| `"high"` \| `"low"` \| `"minimal"` \| `"none"` \| `"ultracode"` \| `"xhigh"` \| `undefined`

###### Returns

`Promise`\<`AgentCandidateResolvedModel`\>

##### gatewayDomain

> **gatewayDomain**: `string`

**`Experimental`**

The only public DNS name candidate processes may reach for inference.

##### activationEnvNames

> **activationEnvNames**: readonly `string`[]

**`Experimental`**

Exact environment names the activation endpoint must return, no more or fewer.

***

### RecoverExpiredAgentCandidateOptions

**`Experimental`**

#### Properties

##### attempt

> **attempt**: [`AgentCandidateExecutionAttemptRef`](#agentcandidateexecutionattemptref)

**`Experimental`**

##### claimStore

> **claimStore**: [`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore)

**`Experimental`**

##### executor

> **executor**: [`AgentCandidateExecutorPort`](#agentcandidateexecutorport)

**`Experimental`**

##### traceStore

> **traceStore**: `TraceStore`

**`Experimental`**

##### ports

> **ports**: `Pick`\<[`AgentCandidateExecutionPorts`](#agentcandidateexecutionports), `"models"` \| `"memory"`\>

**`Experimental`**

##### outputArtifacts

> **outputArtifacts**: [`AgentCandidateOutputArtifactPort`](#agentcandidateoutputartifactport)

**`Experimental`**

##### cleanupTimeoutMs?

> `optional` **cleanupTimeoutMs?**: `number`

**`Experimental`**

##### now?

> `optional` **now?**: () => `number`

**`Experimental`**

Evaluator clock; must be the same clock used by the claim store.

###### Returns

`number`

***

### AgentCandidateArtifactPort

**`Experimental`**

Reads one content-addressed object from the closed S3/IPFS locator set.

#### Extended by

- [`AgentCandidateOutputArtifactPort`](#agentcandidateoutputartifactport)

#### Methods

##### read()

> **read**(`ref`): `Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

**`Experimental`**

###### Parameters

###### ref

`AgentCandidateArtifactRef`

###### Returns

`Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

***

### AgentCandidateOutputArtifactPort

**`Experimental`**

Durable content-addressed evidence store controlled only by the evaluator.

#### Extends

- [`AgentCandidateArtifactPort`](#agentcandidateartifactport)

#### Methods

##### read()

> **read**(`ref`): `Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

**`Experimental`**

###### Parameters

###### ref

`AgentCandidateArtifactRef`

###### Returns

`Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

###### Inherited from

[`AgentCandidateArtifactPort`](#agentcandidateartifactport).[`read`](#read)

##### put()

> **put**(`input`): `Promise`\<`AgentCandidateArtifactRef`\>

**`Experimental`**

Must be idempotent for identical bytes and return only a durable S3/IPFS locator.

###### Parameters

###### input

###### executionId

`string`

###### purpose

[`AgentCandidateOutputPurpose`](#agentcandidateoutputpurpose)

###### bytes

`Uint8Array`

###### signal?

`AbortSignal`

Abort must prevent durable publication when it happens before resolution.

###### Returns

`Promise`\<`AgentCandidateArtifactRef`\>

***

### AgentCandidateRepositoryPort

**`Experimental`**

Resolves a declared GitHub repository to an already-present local Git object store.

#### Methods

##### resolve()

> **resolve**(`repository`): `Promise`\<`string`\>

**`Experimental`**

###### Parameters

###### repository

`AgentCandidateGitHubRepository`

###### Returns

`Promise`\<`string`\>

***

### AgentCandidateVerificationPorts

**`Experimental`**

#### Extended by

- [`AgentCandidateExecutionPorts`](#agentcandidateexecutionports)

#### Properties

##### artifacts

> **artifacts**: [`AgentCandidateArtifactPort`](#agentcandidateartifactport)

**`Experimental`**

##### repositories

> **repositories**: [`AgentCandidateRepositoryPort`](#agentcandidaterepositoryport)

**`Experimental`**

***

### AgentCandidateWorkspacePort

**`Experimental`**

Materializes an already-verified workspace archive.

The runtime independently scans every resulting byte, mode, and path against
the signed manifest after this returns. Implementations may therefore unpack
any archive encoding, or no-op when the exact workspace is already present.

#### Methods

##### materialize()

> **materialize**(`input`): `Promise`\<`void`\>

**`Experimental`**

###### Parameters

###### input

###### role

`"task"` \| `"knowledge"` \| `"memory"` \| `"candidate"`

###### snapshot

`AgentCandidateWorkspaceSnapshotEvidence`

###### archive

`Uint8Array`

###### destination

`string`

###### Returns

`Promise`\<`void`\>

***

### ResolvedAgentCandidateContainer

**`Experimental`**

#### Properties

##### source

> **source**: `"pinned-container"` \| `"evaluator-task-container"`

**`Experimental`**

##### image

> **image**: `string`

**`Experimental`**

##### indexDigest

> **indexDigest**: `` `sha256:${string}` ``

**`Experimental`**

##### manifestDigest

> **manifestDigest**: `` `sha256:${string}` ``

**`Experimental`**

##### platform

> **platform**: `AgentCandidateOciPlatform`

**`Experimental`**

***

### AgentCandidateContainerPort

**`Experimental`**

#### Methods

##### resolve()

> **resolve**(`input`): `Promise`\<[`ResolvedAgentCandidateContainer`](#resolvedagentcandidatecontainer)\>

**`Experimental`**

###### Parameters

###### input

###### candidate

`AgentCandidateContainer` \| `undefined`

###### evaluatorTaskContainer

[`ResolvedAgentCandidateContainer`](#resolvedagentcandidatecontainer) \| `undefined`

###### Returns

`Promise`\<[`ResolvedAgentCandidateContainer`](#resolvedagentcandidatecontainer)\>

***

### AgentCandidateModelPort

**`Experimental`**

#### Methods

##### resolve()

> **resolve**(`input`): `Promise`\<`AgentCandidateResolvedModel`\>

**`Experimental`**

###### Parameters

###### input

###### requested

`string`

###### harness

`HarnessType`

###### reasoningEffort

`"medium"` \| `"high"` \| `"low"` \| `"minimal"` \| `"none"` \| `"ultracode"` \| `"xhigh"` \| `undefined`

###### Returns

`Promise`\<`AgentCandidateResolvedModel`\>

##### reserveGrant()

> **reserveGrant**(`input`): `Promise`\<[`AgentCandidateProtectedModelReservation`](#agentcandidateprotectedmodelreservation)\>

**`Experimental`**

Reserve a stable access identity without creating a live credential.
The reservation is scoped to `preparationId` and must automatically expire
at `expiresAtMs`, even if this call returns ambiguously to the runtime.

###### Parameters

###### input

###### executionId

`string`

###### preparationId

`string`

###### expiresAtMs

`number`

###### attempt

`AgentCandidateAttemptPolicy`

###### bundleDigest

`` `sha256:${string}` ``

###### resolved

`AgentCandidateResolvedModel`

###### limits

[`AgentCandidateModelLimits`](#agentcandidatemodellimits)

###### Returns

`Promise`\<[`AgentCandidateProtectedModelReservation`](#agentcandidateprotectedmodelreservation)\>

##### activateGrant()

> **activateGrant**(`input`): `Promise`\<[`AgentCandidateProtectedModelActivation`](#agentcandidateprotectedmodelactivation)\>

**`Experimental`**

Create the live scoped credential only after the execution attempt is durably claimed.

###### Parameters

###### input

###### executionId

`string`

###### preparationId

`string`

###### grantDigest

`` `sha256:${string}` ``

###### resolved

`AgentCandidateResolvedModel`

###### deadlineAtMs

`number`

###### Returns

`Promise`\<[`AgentCandidateProtectedModelActivation`](#agentcandidateprotectedmodelactivation)\>

##### settleGrant()

> **settleGrant**(`input`): `Promise`\<[`AgentCandidateProtectedModelSettlement`](#agentcandidateprotectedmodelsettlement)\>

**`Experimental`**

Atomically revoke the grant, drain in-flight calls, and return its immutable final ledger.
This operation must be idempotent for the exact preparation and must also
settle a reservation that was never activated. It must never affect a
different preparation, even when both reservations report the same digest.

###### Parameters

###### input

###### executionId

`string`

###### preparationId

`string`

###### grantDigest

`` `sha256:${string}` ``

###### resolved

`AgentCandidateResolvedModel`

###### reason

`"completed"` \| `"failed"` \| `"timeout"` \| `"replayed"` \| `"preparation-failed"` \| `"abandoned"`

###### Returns

`Promise`\<[`AgentCandidateProtectedModelSettlement`](#agentcandidateprotectedmodelsettlement)\>

***

### AgentCandidateProtectedModelReservation

**`Experimental`**

#### Properties

##### preparationId

> **preparationId**: `string`

**`Experimental`**

##### digest

> **digest**: `` `sha256:${string}` ``

**`Experimental`**

##### expiresAtMs

> **expiresAtMs**: `number`

**`Experimental`**

Evaluator service must expire and revoke this reservation at this epoch millisecond.

##### enforcedLimits

> **enforcedLimits**: [`AgentCandidateModelLimits`](#agentcandidatemodellimits)

**`Experimental`**

The gateway must stop calls before any declared model limit is exceeded.

##### network

> **network**: `AgentCandidateModelAccessNetwork`

**`Experimental`**

Exact public endpoint exception; every other candidate destination stays blocked.

***

### AgentCandidateProtectedModelActivation

**`Experimental`**

#### Properties

##### env

> **env**: `Readonly`\<`Record`\<`string`, `string`\>\>

**`Experimental`**

Injected only into the trusted executor after all pre-launch checks pass.

***

### AgentCandidateProtectedModelSettlement

**`Experimental`**

#### Properties

##### preparationId

> **preparationId**: `string`

**`Experimental`**

##### grantDigest

> **grantDigest**: `` `sha256:${string}` ``

**`Experimental`**

##### closed

> **closed**: `true`

**`Experimental`**

##### usageWithinLimits

> **usageWithinLimits**: `boolean`

**`Experimental`**

Router's terminal integrity result. False must never become a receipt.

##### calls

> **calls**: readonly [`AgentCandidateProtectedModelSettlementCall`](#agentcandidateprotectedmodelsettlementcall)[]

**`Experimental`**

***

### AgentCandidateMemoryResetResult

**`Experimental`**

#### Properties

##### preparationId

> **preparationId**: `string`

**`Experimental`**

##### accessDigest

> **accessDigest**: `` `sha256:${string}` ``

**`Experimental`**

##### expiresAtMs

> **expiresAtMs**: `number`

**`Experimental`**

##### evidence

> **evidence**: `AgentCandidateCapturedArtifact`

**`Experimental`**

##### emptyStateDigest

> **emptyStateDigest**: `` `sha256:${string}` ``

**`Experimental`**

##### beforeState

> **beforeState**: `AgentCandidateWorkspaceSnapshotEvidence`

**`Experimental`**

***

### AgentCandidateMemoryPort

**`Experimental`**

#### Methods

##### reset()

> **reset**(`input`): `Promise`\<[`AgentCandidateMemoryResetResult`](#agentcandidatememoryresetresult)\>

**`Experimental`**

Reset and reserve exact task memory without returning live access.
The service must scope the reservation to `preparationId`, automatically
revoke it at `expiresAtMs`, and never reuse it for another preparation.

###### Parameters

###### input

###### executionId

`string`

###### preparationId

`string`

###### expiresAtMs

`number`

###### effectiveNamespace

`string`

###### seed?

`Uint8Array`\<`ArrayBufferLike`\>

###### seedDigest?

`` `sha256:${string}` ``

###### Returns

`Promise`\<[`AgentCandidateMemoryResetResult`](#agentcandidatememoryresetresult)\>

##### activate()

> **activate**(`input`): `Promise`\<\{ `env`: `Readonly`\<`Record`\<`string`, `string`\>\>; \}\>

**`Experimental`**

Create live scoped access only after the execution attempt is durably claimed.
Activation must match the exact preparation/access pair and may not extend expiry.

###### Parameters

###### input

###### executionId

`string`

###### preparationId

`string`

###### accessDigest

`` `sha256:${string}` ``

###### effectiveNamespace

`string`

###### deadlineAtMs

`number`

###### Returns

`Promise`\<\{ `env`: `Readonly`\<`Record`\<`string`, `string`\>\>; \}\>

##### close()

> **close**(`input`): `Promise`\<\{ `closed`: `true`; \}\>

**`Experimental`**

Revoke evaluator-owned access after process death or a failed preparation.
Must be idempotent and concurrency-safe for the exact preparation/access
pair and must never close a different preparation.

###### Parameters

###### input

###### executionId

`string`

###### preparationId

`string`

###### accessDigest

`` `sha256:${string}` ``

###### effectiveNamespace

`string`

###### reason

`"completed"` \| `"failed"` \| `"timeout"` \| `"replayed"` \| `"preparation-failed"` \| `"abandoned"`

###### Returns

`Promise`\<\{ `closed`: `true`; \}\>

***

### AgentCandidateExecutionPorts

**`Experimental`**

#### Extends

- [`AgentCandidateVerificationPorts`](#agentcandidateverificationports)

#### Properties

##### artifacts

> **artifacts**: [`AgentCandidateArtifactPort`](#agentcandidateartifactport)

**`Experimental`**

###### Inherited from

[`AgentCandidateVerificationPorts`](#agentcandidateverificationports).[`artifacts`](#artifacts)

##### repositories

> **repositories**: [`AgentCandidateRepositoryPort`](#agentcandidaterepositoryport)

**`Experimental`**

###### Inherited from

[`AgentCandidateVerificationPorts`](#agentcandidateverificationports).[`repositories`](#repositories)

##### workspaces

> **workspaces**: [`AgentCandidateWorkspacePort`](#agentcandidateworkspaceport)

**`Experimental`**

##### containers

> **containers**: [`AgentCandidateContainerPort`](#agentcandidatecontainerport)

**`Experimental`**

##### models

> **models**: [`AgentCandidateModelPort`](#agentcandidatemodelport)

**`Experimental`**

##### memory

> **memory**: [`AgentCandidateMemoryPort`](#agentcandidatememoryport)

**`Experimental`**

***

### AgentCandidateTaskExecution

**`Experimental`**

Runtime placement for one exact cell from a signed candidate experiment.

#### Properties

##### executionId

> **executionId**: `string`

**`Experimental`**

##### runCell

> **runCell**: `AgentCandidateRunCell`

**`Experimental`**

##### benchmarkSuite

> **benchmarkSuite**: `AgentCandidateBenchmarkSuite`

**`Experimental`**

##### task

> **task**: `AgentCandidateBenchmarkTask`

**`Experimental`**

##### executionRoots

> **executionRoots**: [`AgentCandidateExecutionRoots`](#agentcandidateexecutionroots)

**`Experimental`**

Absolute paths inside the evaluator-owned execution environment.

##### stagingRoots

> **stagingRoots**: `object`

**`Experimental`**

Host-side staging roots. These are verified but never signed as container paths.

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

###### profileRoot

> **profileRoot**: `string`

***

### VerifiedAgentCandidate

**`Experimental`**

#### Properties

##### bundle

> `readonly` **bundle**: `AgentCandidateBundle`

**`Experimental`**

##### materializedTree?

> `readonly` `optional` **materializedTree?**: `string`

**`Experimental`**

##### \[verifiedCandidateBrand\]

> `readonly` **\[verifiedCandidateBrand\]**: `true`

**`Experimental`**

***

### CanonicalCandidateDocument

**`Experimental`**

#### Type Parameters

##### T

`T`

#### Properties

##### value

> `readonly` **value**: `T`

**`Experimental`**

##### bytes

> `readonly` **bytes**: `Uint8Array`

**`Experimental`**

Canonical UTF-8 bytes of `value` with its top-level digest omitted.

##### digest

> `readonly` **digest**: `` `sha256:${string}` ``

**`Experimental`**

***

### PreparedAgentCandidateLaunch

**`Experimental`**

#### Properties

##### executable

> **executable**: `string`

**`Experimental`**

##### args

> **args**: readonly `string`[]

**`Experimental`**

Complete fixed argv, including profile materializer flags but excluding task delivery.

##### env

> **env**: `Readonly`\<`Record`\<`string`, `string`\>\>

**`Experimental`**

##### flags

> **flags**: readonly `string`[]

**`Experimental`**

Informational subset already present at the tail of `args`; executors must not append twice.

##### cwd

> **cwd**: `string`

**`Experimental`**

***

### PreparedAgentCandidateInstruction

**`Experimental`**

#### Properties

##### bytes

> **bytes**: `Uint8Array`

**`Experimental`**

##### delivery

> **delivery**: `AgentCandidateInstructionDelivery`

**`Experimental`**

***

### PreparedAgentCandidateKnowledge

**`Experimental`**

Exact file-backed knowledge admitted by the candidate bundle.

#### Properties

##### candidate

> `readonly` **candidate**: `AgentCandidateKnowledgeRef`

**`Experimental`**

##### snapshot

> `readonly` **snapshot**: `AgentCandidateWorkspaceSnapshotEvidence`

**`Experimental`**

##### files

> `readonly` **files**: readonly [`AgentCandidateExecutorWorkspaceFile`](#agentcandidateexecutorworkspacefile)[]

**`Experimental`**

##### retrievalConfig?

> `readonly` `optional` **retrievalConfig?**: `Uint8Array`\<`ArrayBufferLike`\>

**`Experimental`**

***

### PreparedAgentCandidateTrace

**`Experimental`**

#### Properties

##### runId

> **runId**: `string`

**`Experimental`**

##### tags

> **tags**: `Readonly`\<`Record`\<`string`, `string`\>\>

**`Experimental`**

##### env

> **env**: `Readonly`\<`Record`\<`string`, `string`\>\>

**`Experimental`**

***

### PreparedAgentCandidateExecution

**`Experimental`**

#### Properties

##### bundle

> `readonly` **bundle**: `AgentCandidateBundle`

**`Experimental`**

##### benchmark

> `readonly` **benchmark**: `object`

**`Experimental`**

###### suite

> `readonly` **suite**: `AgentCandidateBenchmarkSuite`

###### task

> `readonly` **task**: `AgentCandidateBenchmarkTask`

##### executionId

> `readonly` **executionId**: `string`

**`Experimental`**

##### roots

> `readonly` **roots**: `object`

**`Experimental`**

###### execution

> **execution**: [`AgentCandidateExecutionRoots`](#agentcandidateexecutionroots)

###### staging

> **staging**: `object`

###### staging.taskRoot

> **taskRoot**: `string`

###### staging.candidateRoot?

> `optional` **candidateRoot?**: `string`

###### staging.profileRoot

> **profileRoot**: `string`

##### profilePlan

> `readonly` **profilePlan**: `object`

**`Experimental`**

###### value

> **value**: `AgentCandidateProfilePlanEvidence`

###### bytes

> **bytes**: `Uint8Array`

###### written

> **written**: readonly `string`[]

##### profileActivation

> `readonly` **profileActivation**: `AgentCandidateProfileActivation`

**`Experimental`**

##### executionPlan

> `readonly` **executionPlan**: `object`

**`Experimental`**

###### value

> **value**: `AgentCandidateExecutionPlanEvidence`

###### bytes

> **bytes**: `Uint8Array`

##### materializationReceipt

> `readonly` **materializationReceipt**: [`CanonicalCandidateDocument`](#canonicalcandidatedocument)\<`AgentCandidateMaterializationReceipt`\>

**`Experimental`**

##### launch

> `readonly` **launch**: [`PreparedAgentCandidateLaunch`](#preparedagentcandidatelaunch)

**`Experimental`**

##### instruction

> `readonly` **instruction**: [`PreparedAgentCandidateInstruction`](#preparedagentcandidateinstruction)

**`Experimental`**

##### resolvedModel

> `readonly` **resolvedModel**: `AgentCandidateResolvedModel`

**`Experimental`**

##### knowledge?

> `readonly` `optional` **knowledge?**: [`PreparedAgentCandidateKnowledge`](#preparedagentcandidateknowledge)

**`Experimental`**

##### trace

> `readonly` **trace**: [`PreparedAgentCandidateTrace`](#preparedagentcandidatetrace)

**`Experimental`**

##### memory

> `readonly` **memory**: `AgentCandidateEffectiveMemory`

**`Experimental`**

##### \[preparedCandidateBrand\]

> `readonly` **\[preparedCandidateBrand\]**: `true`

**`Experimental`**

***

### AgentCandidateProtectedRunCapture

**`Experimental`**

#### Properties

##### executionId

> **executionId**: `string`

**`Experimental`**

##### termination

> **termination**: `AgentCandidateTermination`

**`Experimental`**

***

### AgentCandidateExecutorMemoryCapture

**`Experimental`**

Raw isolated-memory capture made only after access has been revoked.

#### Properties

##### afterState

> `readonly` **afterState**: `AgentCandidateWorkspaceManifestMaterial`

**`Experimental`**

##### archive

> `readonly` **archive**: `Uint8Array`

**`Experimental`**

***

### AgentCandidateExecutorFinalCapture

**`Experimental`**

Replayable evaluator result captured only after process death and trace drain.

#### Properties

##### taskOutcome?

> `readonly` `optional` **taskOutcome?**: [`AgentCandidateExecutorTaskOutcomeCapture`](#agentcandidateexecutortaskoutcomecapture)

**`Experimental`**

##### memoryAfter?

> `readonly` `optional` **memoryAfter?**: [`AgentCandidateExecutorMemoryCapture`](#agentcandidateexecutormemorycapture)

**`Experimental`**

Required only when the prepared candidate uses isolated task memory.

##### evidence?

> `readonly` `optional` **evidence?**: `Uint8Array`\<`ArrayBufferLike`\>

**`Experimental`**

Executor-native bytes preserved when a fresh worker cannot reconstruct a verified outcome.

***

### AgentCandidateBenchmarkGraderPort

**`Experimental`**

Evaluator-owned executable grader, pinned by immutable implementation bytes.

`run` is an isolation boundary, not an arbitrary scoring callback. The
implementation admitted to that boundary is supplied by the runtime after
artifact verification. Implementations must derive every returned binding
digest from the bytes and task outcome they actually admitted, rather than
copying an expected digest from ambient configuration.

#### Properties

##### name

> `readonly` **name**: `string`

**`Experimental`**

##### version

> `readonly` **version**: `string`

**`Experimental`**

##### artifact

> `readonly` **artifact**: `AgentCandidateArtifactRef`

**`Experimental`**

#### Methods

##### run()

> **run**(`input`): `Promise`\<\{ `evaluation`: `BenchmarkEvaluation`; `evidence`: `Uint8Array`; `binding`: \{ `implementationDigest`: `` `sha256:${string}` ``; `taskOutcomeDigest`: `` `sha256:${string}` ``; `outputDigest`: `` `sha256:${string}` ``; \}; \}\>

**`Experimental`**

###### Parameters

###### input

###### executionId

`string`

###### termination

`AgentCandidateTermination`

###### outcome

[`VerifiedAgentCandidateTaskOutcome`](#verifiedagentcandidatetaskoutcome)

###### implementation

\{ `byteLength`: `number`; `bytes`: `Uint8Array`; \}

Exact verified artifact bytes. Each read returns a detached copy.

###### implementation.byteLength

`number`

###### implementation.bytes

`Uint8Array`

###### signal

`AbortSignal`

Frozen result deadline; runners must stop work and side effects when aborted.

###### Returns

`Promise`\<\{ `evaluation`: `BenchmarkEvaluation`; `evidence`: `Uint8Array`; `binding`: \{ `implementationDigest`: `` `sha256:${string}` ``; `taskOutcomeDigest`: `` `sha256:${string}` ``; `outputDigest`: `` `sha256:${string}` ``; \}; \}\>

***

### AgentCandidateExecutorRequest

**`Experimental`**

One detached request passed to the trusted environment-specific executor.

#### Properties

##### executionId

> `readonly` **executionId**: `string`

**`Experimental`**

##### benchmark

> `readonly` **benchmark**: `object`

**`Experimental`**

###### suite

> `readonly` **suite**: `AgentCandidateBenchmarkSuite`

###### task

> `readonly` **task**: `AgentCandidateBenchmarkTask`

##### inputs

> `readonly` **inputs**: `object`

**`Experimental`**

Immutable bytes from which the executor creates fresh isolated workspaces.

###### task

> `readonly` **task**: [`AgentCandidateExecutorWorkspaceInput`](#agentcandidateexecutorworkspaceinput)

###### candidate?

> `readonly` `optional` **candidate?**: [`AgentCandidateExecutorWorkspaceInput`](#agentcandidateexecutorworkspaceinput)

###### profile

> `readonly` **profile**: `object`

###### profile.files

> `readonly` **files**: readonly [`AgentCandidateExecutorProfileFile`](#agentcandidateexecutorprofilefile)[]

##### roots

> `readonly` **roots**: [`AgentCandidateExecutionRoots`](#agentcandidateexecutionroots)

**`Experimental`**

##### profilePlan

> `readonly` **profilePlan**: `object`

**`Experimental`**

###### value

> **value**: `AgentCandidateProfilePlanEvidence`

###### bytes

> **bytes**: `Uint8Array`

###### written

> **written**: readonly `string`[]

##### profileActivation

> `readonly` **profileActivation**: `AgentCandidateProfileActivation`

**`Experimental`**

##### executionPlan

> `readonly` **executionPlan**: `object`

**`Experimental`**

###### value

> **value**: `AgentCandidateExecutionPlanEvidence`

###### bytes

> **bytes**: `Uint8Array`

##### materializationReceipt

> `readonly` **materializationReceipt**: [`CanonicalCandidateDocument`](#canonicalcandidatedocument)\<`AgentCandidateMaterializationReceipt`\>

**`Experimental`**

##### launch

> `readonly` **launch**: [`PreparedAgentCandidateLaunch`](#preparedagentcandidatelaunch)

**`Experimental`**

##### instruction

> `readonly` **instruction**: [`PreparedAgentCandidateInstruction`](#preparedagentcandidateinstruction)

**`Experimental`**

##### resolvedModel

> `readonly` **resolvedModel**: `AgentCandidateResolvedModel`

**`Experimental`**

##### hardLimits

> `readonly` **hardLimits**: `Pick`\<`AgentCandidateExecutionLimits`, `"timeoutMs"`\>

**`Experimental`**

Mechanically enforced by the runtime plus executor process-death acknowledgement.

##### observedLimits

> `readonly` **observedLimits**: `Pick`\<`AgentCandidateExecutionLimits`, `"maxSteps"`\>

**`Experimental`**

Validity bound checked against protected traces; generic black-box executors cannot preempt it.

##### knowledge?

> `readonly` `optional` **knowledge?**: [`PreparedAgentCandidateKnowledge`](#preparedagentcandidateknowledge)

**`Experimental`**

##### trace

> `readonly` **trace**: [`PreparedAgentCandidateTrace`](#preparedagentcandidatetrace)

**`Experimental`**

##### memory

> `readonly` **memory**: `AgentCandidateEffectiveMemory`

**`Experimental`**

***

### AgentCandidateExecutorPort

**`Experimental`**

Executes one prepared request inside an evaluator-owned isolation boundary.

`request.launch.env` is the complete allowlisted environment, including
protected model, memory, and trace bindings. Implementations must not merge
ambient host variables into it. The returned capture deliberately contains
no candidate-authored usage or score fields.

#### Methods

##### execute()

> **execute**(`request`, `context`): `Promise`\<[`AgentCandidateProtectedRunCapture`](#agentcandidateprotectedruncapture)\>

**`Experimental`**

###### Parameters

###### request

[`AgentCandidateExecutorRequest`](#agentcandidateexecutorrequest)

###### context

###### traceStore

`TraceStore`

###### signal

`AbortSignal`

Aborted by the runtime at the exact frozen wall-time deadline.

###### deadlineAtMs

`number`

Absolute epoch-millisecond deadline owned by the runtime.

###### Returns

`Promise`\<[`AgentCandidateProtectedRunCapture`](#agentcandidateprotectedruncapture)\>

##### stop()

> **stop**(`request`, `context`): `Promise`\<\{ `stopped`: `true`; \}\>

**`Experimental`**

Kill the exact process/container and drain trace writes. Must be idempotent.

###### Parameters

###### request

[`AgentCandidateExecutorStopRequest`](#agentcandidateexecutorstoprequest)

###### context

###### traceStore

`TraceStore`

###### reason

`"completed"` \| `"failed"` \| `"timeout"`

###### signal

`AbortSignal`

Aborted at the frozen execution deadline or evaluator cleanup deadline.

###### deadlineAtMs

`number`

Absolute execution deadline; a later stop acknowledgement cannot produce success.

###### Returns

`Promise`\<\{ `stopped`: `true`; \}\>

##### capture()

> **capture**(`request`, `context`): `Promise`\<[`AgentCandidateExecutorFinalCapture`](#agentcandidateexecutorfinalcapture)\>

**`Experimental`**

Capture immutable final evidence after stop. Must be replayable by a fresh worker.

###### Parameters

###### request

[`AgentCandidateExecutorStopRequest`](#agentcandidateexecutorstoprequest)

###### context

###### traceStore

`TraceStore`

###### signal

`AbortSignal`

Aborted at the frozen execution deadline or evaluator cleanup deadline.

###### Returns

`Promise`\<[`AgentCandidateExecutorFinalCapture`](#agentcandidateexecutorfinalcapture)\>

##### dispose()?

> `optional` **dispose**(`request`, `context`): `Promise`\<\{ `disposed`: `true`; \}\>

**`Experimental`**

Remove evaluator-owned execution resources after final capture. Must be idempotent.

###### Parameters

###### request

[`AgentCandidateExecutorStopRequest`](#agentcandidateexecutorstoprequest)

###### context

###### signal

`AbortSignal`

###### Returns

`Promise`\<\{ `disposed`: `true`; \}\>

***

### AgentCandidateExecutorStopRequest

**`Experimental`**

Opaque process identity used for termination without re-exposing launch credentials.

#### Properties

##### executionId

> `readonly` **executionId**: `string`

**`Experimental`**

##### executionPlanDigest

> `readonly` **executionPlanDigest**: `` `sha256:${string}` ``

**`Experimental`**

***

### AgentCandidateExecutorWorkspaceInput

**`Experimental`**

#### Properties

##### snapshot

> `readonly` **snapshot**: `AgentCandidateWorkspaceSnapshotEvidence`

**`Experimental`**

##### files

> `readonly` **files**: readonly [`AgentCandidateExecutorWorkspaceFile`](#agentcandidateexecutorworkspacefile)[]

**`Experimental`**

***

### AgentCandidateExecutorWorkspaceFile

**`Experimental`**

#### Properties

##### path

> `readonly` **path**: `string`

**`Experimental`**

##### mode

> `readonly` **mode**: `number`

**`Experimental`**

##### bytes

> `readonly` **bytes**: `Uint8Array`

**`Experimental`**

***

### AgentCandidateExecutorProfileFile

**`Experimental`**

One exact profile file supplied to an evaluator-owned executor.

#### Properties

##### path

> `readonly` **path**: `string`

**`Experimental`**

##### mode

> `readonly` **mode**: `number`

**`Experimental`**

##### root?

> `readonly` `optional` **root?**: `"agent"`

**`Experimental`**

Omit for a workspace-root file; agent-root files use the private Pi directory.

##### bytes

> `readonly` **bytes**: `Uint8Array`

**`Experimental`**

***

### AgentCandidateWorkspaceArchiveLimits

**`Experimental`**

#### Properties

##### maxArchiveBytes

> **maxArchiveBytes**: `number`

**`Experimental`**

##### maxEmbeddedArtifactBytes

> **maxEmbeddedArtifactBytes**: `number`

**`Experimental`**

##### maxFiles

> **maxFiles**: `number`

**`Experimental`**

##### maxFileBytes

> **maxFileBytes**: `number`

**`Experimental`**

##### maxTotalFileBytes

> **maxTotalFileBytes**: `number`

**`Experimental`**

##### maxPathBytes

> **maxPathBytes**: `number`

**`Experimental`**

##### maxRepositoryBundleBytes

> **maxRepositoryBundleBytes**: `number`

**`Experimental`**

***

### CaptureAgentCandidateWorkspaceOptions

**`Experimental`**

#### Properties

##### includeRepository?

> `optional` **includeRepository?**: `boolean`

**`Experimental`**

Include Git HEAD so task preparation can prove its exact commit and tree.

##### limits?

> `optional` **limits?**: `Partial`\<[`AgentCandidateWorkspaceArchiveLimits`](#agentcandidateworkspacearchivelimits)\>

**`Experimental`**

##### artifactPersistence?

> `optional` **artifactPersistence?**: `object`

**`Experimental`**

Use the evaluator-owned artifact store when manifest or archive bytes should not be embedded.

###### executionId

> **executionId**: `string`

###### outputArtifacts

> **outputArtifacts**: [`AgentCandidateOutputArtifactPort`](#agentcandidateoutputartifactport)

###### signal?

> `optional` **signal?**: `AbortSignal`

***

### CreateAgentCandidateWorkspacePortOptions

**`Experimental`**

#### Properties

##### limits?

> `optional` **limits?**: `Partial`\<[`AgentCandidateWorkspaceArchiveLimits`](#agentcandidateworkspacearchivelimits)\>

**`Experimental`**

***

### CapturedAgentCandidateWorkspace

**`Experimental`**

#### Properties

##### snapshot

> `readonly` **snapshot**: `AgentCandidateWorkspaceSnapshotEvidence`

**`Experimental`**

##### archive

> `readonly` **archive**: `Uint8Array`

**`Experimental`**

Caller-owned bytes accepted by createAgentCandidateWorkspacePort.

***

### WorkspaceTreeExclusion

**`Experimental`**

One entry the walk recorded but did not describe. Reported rather than dropped: a digest that
 silently omitted an entry would be a different digest with no way to tell why.

#### Properties

##### path

> `readonly` **path**: `string`

**`Experimental`**

Tree-relative path, `/`-separated.

##### reason

> `readonly` **reason**: [`WorkspaceTreeExclusionReason`](#workspacetreeexclusionreason)

**`Experimental`**

##### target?

> `readonly` `optional` **target?**: `string`

**`Experimental`**

The link target exactly as it was written, for a symbolic-link exclusion.

***

### WorkspaceTreeDescriptor

**`Experimental`**

#### Properties

##### algorithm

> `readonly` **algorithm**: [`WorkspaceTreeAlgorithm`](#workspacetreealgorithm)

**`Experimental`**

##### digest

> `readonly` **digest**: `` `sha256:${string}` ``

**`Experimental`**

##### files

> `readonly` **files**: `number`

**`Experimental`**

##### directories

> `readonly` **directories**: `number`

**`Experimental`**

##### symlinks

> `readonly` **symlinks**: `number`

**`Experimental`**

Links kept INSIDE the tree. An excluded link is counted in `excluded`, never here.

##### bytes

> `readonly` **bytes**: `number`

**`Experimental`**

Total described regular-file bytes.

##### excluded

> `readonly` **excluded**: readonly [`WorkspaceTreeExclusion`](#workspacetreeexclusion)[]

**`Experimental`**

***

### DescribeWorkspaceTreeOptions

**`Experimental`**

#### Properties

##### algorithm?

> `readonly` `optional` **algorithm?**: [`WorkspaceTreeAlgorithm`](#workspacetreealgorithm)

**`Experimental`**

Default `'tree-v1'`.

##### onEscapingLink?

> `readonly` `optional` **onEscapingLink?**: [`WorkspaceTreeEntryPolicy`](#workspacetreeentrypolicy)

**`Experimental`**

A symbolic link that is absolute, leaves the tree lexically, resolves outside it, or does not
resolve at all. `'refuse'` (default) is correct for an input seed. `'exclude'` is correct for a
close-time walk over a tree a run wrote. The link is NEVER followed in either policy: an
escaping link must not contribute bytes from outside the tree to a content address.

##### onMissingEntry?

> `readonly` `optional` **onMissingEntry?**: [`WorkspaceTreeEntryPolicy`](#workspacetreeentrypolicy)

**`Experimental`**

An entry that vanished between the directory read that named it and the walk that reached it.
`'refuse'` (default) is correct for a settled tree; `'exclude'` is correct for a workspace a
live process still writes to.

***

### SeedWorkspaceTreeInput

**`Experimental`**

#### Properties

##### source

> `readonly` **source**: `string`

**`Experimental`**

The tree to copy FROM. Described, then copied entry by entry.

##### destination

> `readonly` **destination**: `string`

**`Experimental`**

The tree to copy INTO. Must exist, and must not lie inside `source`.

##### algorithm?

> `readonly` `optional` **algorithm?**: [`WorkspaceTreeAlgorithm`](#workspacetreealgorithm)

**`Experimental`**

Default `'tree-v1'`; decides only the digest this returns, never the bytes it writes.

## Type Aliases

### AgentCandidateProfileSource

> **AgentCandidateProfileSource** = \{ `kind`: `"profile"`; `profile`: `AgentProfile`; \} \| \{ `kind`: `"profile-diffs"`; `base`: `AgentProfile`; `diffs`: readonly `AgentProfileDiff`[]; \} \| \{ `kind`: `"candidate-profile"`; `profile`: `AgentCandidateProfile`; \}

**`Experimental`**

A complete profile that can be frozen without losing behavior.

#### Union Members

##### Type Literal

\{ `kind`: `"profile"`; `profile`: `AgentProfile`; \}

***

##### Type Literal

\{ `kind`: `"profile-diffs"`; `base`: `AgentProfile`; `diffs`: readonly `AgentProfileDiff`[]; \}

###### kind

> **kind**: `"profile-diffs"`

###### base

> **base**: `AgentProfile`

###### diffs

> **diffs**: readonly `AgentProfileDiff`[]

Applied in order before the resulting profile is frozen into the bundle.

***

##### Type Literal

\{ `kind`: `"candidate-profile"`; `profile`: `AgentCandidateProfile`; \}

###### kind

> **kind**: `"candidate-profile"`

###### profile

> **profile**: `AgentCandidateProfile`

Already converted to the closed, secret-free candidate profile contract.

***

### AgentCandidateCodeSource

> **AgentCandidateCodeSource** = `AgentCandidateCodeDisabled` \| `AgentCandidateCodeNoOp` \| [`AgentCandidateCodeSurfaceSource`](#agentcandidatecodesurfacesource)

**`Experimental`**

Explicit control/no-op code or one finalized CodeSurface whose bytes must still verify.

***

### AgentCandidateBundleInput

> **AgentCandidateBundleInput** = `Omit`\<`AgentCandidateBundle`, `"digest"`\>

**`Experimental`**

Exact candidate wire shape before the runtime computes its canonical digest.

***

### AgentCandidateExecutionFailureClass

> **AgentCandidateExecutionFailureClass** = `"pre-model-infrastructure"` \| `"execution"` \| `"post-model-infrastructure"` \| `"unknown"`

**`Experimental`**

Only the first class is retryable, and only when the closed model ledger has zero calls.

***

### AgentCandidateExecutionTerminalResult

> **AgentCandidateExecutionTerminalResult** = \{ `status`: `"succeeded"`; `usage`: `AgentCandidateFixedSpend`; `modelSettlement`: `AgentCandidateArtifactRef`; `taskOutcome`: `AgentCandidateArtifactRef`; `benchmarkResult`: `AgentCandidateArtifactRef`; `runReceipt`: `AgentCandidateArtifactRef`; \} \| \{ `status`: `"failed"`; `failureClass`: [`AgentCandidateExecutionFailureClass`](#agentcandidateexecutionfailureclass); `usage`: `AgentCandidateFixedSpend`; `modelSettlement`: `AgentCandidateArtifactRef`; `failureEvidence?`: `AgentCandidateArtifactRef`; \}

**`Experimental`**

Evaluator-owned terminal facts staged durably before the terminal CAS.

***

### AgentCandidateExecutionTerminalRecord

> **AgentCandidateExecutionTerminalRecord** = [`AgentCandidateExecutionTerminalResult`](#agentcandidateexecutionterminalresult) & `object`

**`Experimental`**

Durable terminal record for one acquired execution attempt.

#### Type Declaration

##### executionId

> `readonly` **executionId**: `string`

##### attempt

> `readonly` **attempt**: `number`

##### bundleDigest

> `readonly` **bundleDigest**: `Sha256Digest`

##### executionPlanDigest

> `readonly` **executionPlanDigest**: `Sha256Digest`

##### preparationEvidence

> `readonly` **preparationEvidence**: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)\[`"preparationEvidence"`\]

##### terminalDigest

> `readonly` **terminalDigest**: `Sha256Digest`

RFC 8785 SHA-256 of this record with `terminalDigest` omitted.

***

### AgentCandidateExecutionPhase

> **AgentCandidateExecutionPhase** = `"claimed"` \| `"candidate-may-run"`

**`Experimental`**

Monotonic durable phase: the second value means candidate code could have started.

***

### AgentCandidateExecutionClaimResult

> **AgentCandidateExecutionClaimResult** = \{ `acquired`: `true`; `claim`: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim); `lease`: [`AgentCandidateExecutionLease`](#agentcandidateexecutionlease); \} \| \{ `acquired`: `false`; `reason`: `"already-claimed"`; `claim`: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim); `exactReplay`: `boolean`; \} \| \{ `acquired`: `false`; `reason`: `"retry-not-eligible"`; `claim`: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim); `detail`: [`AgentCandidateRetryRejection`](#agentcandidateretryrejection); \}

**`Experimental`**

Result of atomically claiming one execution attempt.

#### Union Members

##### Type Literal

\{ `acquired`: `true`; `claim`: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim); `lease`: [`AgentCandidateExecutionLease`](#agentcandidateexecutionlease); \}

***

##### Type Literal

\{ `acquired`: `false`; `reason`: `"already-claimed"`; `claim`: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim); `exactReplay`: `boolean`; \}

###### acquired

> `readonly` **acquired**: `false`

###### reason

> `readonly` **reason**: `"already-claimed"`

###### claim

> `readonly` **claim**: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)

The durable winner already occupying this execution-attempt slot.

###### exactReplay

> `readonly` **exactReplay**: `boolean`

True only when every signed claim field matches the durable winner.

***

##### Type Literal

\{ `acquired`: `false`; `reason`: `"retry-not-eligible"`; `claim`: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim); `detail`: [`AgentCandidateRetryRejection`](#agentcandidateretryrejection); \}

***

### AgentCandidateExecutionFinishResult

> **AgentCandidateExecutionFinishResult** = \{ `finished`: `true`; `terminal`: [`AgentCandidateExecutionTerminalRecord`](#agentcandidateexecutionterminalrecord); \} \| \{ `finished`: `false`; `terminal`: [`AgentCandidateExecutionTerminalRecord`](#agentcandidateexecutionterminalrecord); `exactReplay`: `boolean`; \}

**`Experimental`**

Result of atomically recording an attempt's terminal facts.

#### Union Members

##### Type Literal

\{ `finished`: `true`; `terminal`: [`AgentCandidateExecutionTerminalRecord`](#agentcandidateexecutionterminalrecord); \}

***

##### Type Literal

\{ `finished`: `false`; `terminal`: [`AgentCandidateExecutionTerminalRecord`](#agentcandidateexecutionterminalrecord); `exactReplay`: `boolean`; \}

###### finished

> `readonly` **finished**: `false`

###### terminal

> `readonly` **terminal**: [`AgentCandidateExecutionTerminalRecord`](#agentcandidateexecutionterminalrecord)

###### exactReplay

> `readonly` **exactReplay**: `boolean`

True when a repeated finish supplied the same terminal digest.

***

### AgentCandidateExecutionStageResult

> **AgentCandidateExecutionStageResult** = \{ `staged`: `true`; `terminal`: [`AgentCandidateExecutionTerminalRecord`](#agentcandidateexecutionterminalrecord); \} \| \{ `staged`: `false`; `terminal`: [`AgentCandidateExecutionTerminalRecord`](#agentcandidateexecutionterminalrecord); `exactReplay`: `boolean`; \}

**`Experimental`**

Result of durably staging the one immutable terminal outbox entry.

***

### AgentCandidateExecutionPhaseResult

> **AgentCandidateExecutionPhaseResult** = \{ `marked`: `true`; `phase`: `"candidate-may-run"`; \} \| \{ `marked`: `false`; `phase`: `"candidate-may-run"`; \}

**`Experimental`**

Result of crossing the irreversible candidate-may-run boundary.

***

### AgentCandidateRetryRejection

> **AgentCandidateRetryRejection** = `"prior-attempt-missing"` \| `"prior-attempt-running"` \| `"prior-attempt-succeeded"` \| `"prior-attempt-spent-model-calls"` \| `"prior-attempt-not-pre-model-infrastructure"` \| `"retry-lineage-mismatch"`

**`Experimental`**

***

### AgentCandidateModelGrantRunReservationInput

> **AgentCandidateModelGrantRunReservationInput** = `Omit`\<[`AgentCandidateModelGrantReserveInput`](#agentcandidatemodelgrantreserveinput), `"resolved"`\>

**`Experimental`**

Reservation fields supplied by a caller before Runtime resolves the model.

***

### AgentCandidateModelGrantReserveInput

> **AgentCandidateModelGrantReserveInput** = `Parameters`\<[`AgentCandidateModelPort`](#agentcandidatemodelport)\[`"reserveGrant"`\]\>\[`0`\]

**`Experimental`**

***

### AgentCandidateModelGrantActivateInput

> **AgentCandidateModelGrantActivateInput** = `Parameters`\<[`AgentCandidateModelPort`](#agentcandidatemodelport)\[`"activateGrant"`\]\>\[`0`\]

**`Experimental`**

***

### AgentCandidateModelGrantSettleInput

> **AgentCandidateModelGrantSettleInput** = `Parameters`\<[`AgentCandidateModelPort`](#agentcandidatemodelport)\[`"settleGrant"`\]\>\[`0`\]

**`Experimental`**

***

### AgentCandidateModelGrantReservation

> **AgentCandidateModelGrantReservation** = [`AgentCandidateProtectedModelReservation`](#agentcandidateprotectedmodelreservation)

**`Experimental`**

Secret-free response from the service's reservation endpoint.

***

### AgentCandidateOutputPurpose

> **AgentCandidateOutputPurpose** = `"execution-plan"` \| `"materialization-receipt"` \| `"candidate-workspace-manifest"` \| `"candidate-workspace-archive"` \| `"task-manifest"` \| `"task-archive"` \| `"task-patch"` \| `"task-output"` \| `"task-outcome"` \| `"memory-after-manifest"` \| `"memory-after-archive"` \| `"grader-evidence"` \| `"benchmark-result"` \| `"model-settlement"` \| `"trace"` \| `"executor-native-evidence"` \| `"executor-capture"` \| `"run-receipt"` \| `"knowledge-retrieval-config"` \| `"knowledge-evaluation"` \| `"failure-evidence"`

**`Experimental`**

***

### AgentCandidateModelLimits

> **AgentCandidateModelLimits** = `Pick`\<`AgentCandidateExecutionLimits`, `"maxModelCalls"` \| `"maxInputTokens"` \| `"maxOutputTokens"` \| `"maxCostUsd"`\> & `object`

**`Experimental`**

Limits mechanically enforced by the evaluator-owned model gateway.

#### Type Declaration

##### maxTotalTokens?

> `optional` **maxTotalTokens?**: `number`

Optional caller-declared cap across input and output tokens.

***

### AgentCandidateProtectedModelSettlementCall

> **AgentCandidateProtectedModelSettlementCall** = `AgentCandidateModelSettlementCall` & `object`

**`Experimental`**

Protected-port wire call with the gateway's counted input total preserved.

#### Type Declaration

##### accountedInputTokens

> **accountedInputTokens**: `number`

***

### AgentCandidateExecutorTaskOutcomeCapture

> **AgentCandidateExecutorTaskOutcomeCapture** = \{ `kind`: `"workspace"`; `resultTree`: `string`; `afterState`: `AgentCandidateWorkspaceManifestMaterial`; `archive`: `Uint8Array`; `gitDiff`: `Uint8Array`; \} \| \{ `kind`: `"output"`; `bytes`: `Uint8Array`; \}

**`Experimental`**

Raw evaluator capture made only after the candidate process is dead.

#### Union Members

##### Type Literal

\{ `kind`: `"workspace"`; `resultTree`: `string`; `afterState`: `AgentCandidateWorkspaceManifestMaterial`; `archive`: `Uint8Array`; `gitDiff`: `Uint8Array`; \}

###### kind

> `readonly` **kind**: `"workspace"`

###### resultTree

> `readonly` **resultTree**: `string`

Claimed final tree. The runtime recomputes it independently from `gitDiff`.

###### afterState

> `readonly` **afterState**: `AgentCandidateWorkspaceManifestMaterial`

Complete evaluator-captured workspace description after candidate execution.

###### archive

> `readonly` **archive**: `Uint8Array`

Reproducible workspace archive corresponding to `afterState`.

###### gitDiff

> `readonly` **gitDiff**: `Uint8Array`

Exact binary patch from the signed task base to `afterState`.

***

##### Type Literal

\{ `kind`: `"output"`; `bytes`: `Uint8Array`; \}

###### kind

> `readonly` **kind**: `"output"`

###### bytes

> `readonly` **bytes**: `Uint8Array`

Exact evaluator-captured final output bytes.

***

### PersistedTaskOutcomeEvidence

> **PersistedTaskOutcomeEvidence**\<`Kind`\> = `Omit`\<`AgentCandidateTaskOutcomeEvidence`, `"material"`\> & `object`

**`Experimental`**

Immutable evaluator evidence retained with a verified candidate task outcome.

#### Type Declaration

##### artifact

> `readonly` **artifact**: `AgentCandidateArtifactRef`

##### material

> `readonly` **material**: `Omit`\<`AgentCandidateTaskOutcomeMaterial`, `"outcome"`\> & `object`

###### Type Declaration

###### outcome

> `readonly` **outcome**: `Extract`\<`AgentCandidateTaskOutcomeMaterial`\[`"outcome"`\], \{ `kind`: `Kind`; \}\>

#### Type Parameters

##### Kind

`Kind` *extends* `AgentCandidateTaskOutcomeMaterial`\[`"outcome"`\]\[`"kind"`\]

***

### VerifiedAgentCandidateTaskOutcome

> **VerifiedAgentCandidateTaskOutcome** = \{ `kind`: `"workspace"`; `evidence`: [`PersistedTaskOutcomeEvidence`](#persistedtaskoutcomeevidence)\<`"workspace"`\>; `patch`: `Uint8Array`; `[verifiedTaskOutcomeBrand]`: `true`; \} \| \{ `kind`: `"output"`; `evidence`: [`PersistedTaskOutcomeEvidence`](#persistedtaskoutcomeevidence)\<`"output"`\>; `spec`: `AgentCandidateTaskOutputSpec`; `bytes`: `Uint8Array`; `[verifiedTaskOutcomeBrand]`: `true`; \}

**`Experimental`**

Branded task outcome that has survived independent evaluator verification.

***

### AgentCandidateRunFinalization

> **AgentCandidateRunFinalization** = \{ `succeeded`: `true`; `receipt`: [`CanonicalCandidateDocument`](#canonicalcandidatedocument)\<`AgentCandidateRunReceipt`\>; `artifacts`: \{ `executorCapture`: `AgentCandidateArtifactRef`; `modelSettlement`: `AgentCandidateArtifactRef`; `taskOutcome`: `AgentCandidateArtifactRef`; `benchmarkResult`: `AgentCandidateArtifactRef`; `runReceipt`: `AgentCandidateArtifactRef`; \}; \} \| \{ `succeeded`: `false`; `reason`: `string`; `partial`: \{ `executionId`: `string`; `bundleDigest`: `Sha256Digest`; `executionPlanDigest`: `Sha256Digest`; `materializationReceiptDigest`: `Sha256Digest`; `termination?`: `AgentCandidateTermination`; \}; `usage`: `AgentCandidateFixedSpend` \| `null`; \}

**`Experimental`**

#### Union Members

##### Type Literal

\{ `succeeded`: `true`; `receipt`: [`CanonicalCandidateDocument`](#canonicalcandidatedocument)\<`AgentCandidateRunReceipt`\>; `artifacts`: \{ `executorCapture`: `AgentCandidateArtifactRef`; `modelSettlement`: `AgentCandidateArtifactRef`; `taskOutcome`: `AgentCandidateArtifactRef`; `benchmarkResult`: `AgentCandidateArtifactRef`; `runReceipt`: `AgentCandidateArtifactRef`; \}; \}

***

##### Type Literal

\{ `succeeded`: `false`; `reason`: `string`; `partial`: \{ `executionId`: `string`; `bundleDigest`: `Sha256Digest`; `executionPlanDigest`: `Sha256Digest`; `materializationReceiptDigest`: `Sha256Digest`; `termination?`: `AgentCandidateTermination`; \}; `usage`: `AgentCandidateFixedSpend` \| `null`; \}

###### succeeded

> **succeeded**: `false`

###### reason

> **reason**: `string`

###### partial

> **partial**: `object`

###### partial.executionId

> **executionId**: `string`

###### partial.bundleDigest

> **bundleDigest**: `Sha256Digest`

###### partial.executionPlanDigest

> **executionPlanDigest**: `Sha256Digest`

###### partial.materializationReceiptDigest

> **materializationReceiptDigest**: `Sha256Digest`

###### partial.termination?

> `optional` **termination?**: `AgentCandidateTermination`

###### usage

> **usage**: `AgentCandidateFixedSpend` \| `null`

Independent evaluator-gateway usage, even when execution or trace capture failed.

***

### WorkspaceTreeAlgorithm

> **WorkspaceTreeAlgorithm** = `"tree-v1"` \| `"portable-tree-v1"`

**`Experimental`**

`'tree-v1'` records a file's exact permission bits. `'portable-tree-v1'` records the two modes
Git stores — `755` when any execute bit is set, `644` otherwise, and `755` for a directory — so a
digest survives a checkout whose umask differs. Both stamp the algorithm into the digest, so one
tree cannot produce the same digest under both.

***

### WorkspaceTreeEntryPolicy

> **WorkspaceTreeEntryPolicy** = `"refuse"` \| `"exclude"`

**`Experimental`**

What a walk does with an entry it refuses to describe: fail, or record and continue.

***

### WorkspaceTreeExclusionReason

> **WorkspaceTreeExclusionReason** = `"absolute-symlink"` \| `"symlink-escapes-tree"` \| `"symlink-resolves-outside-tree"` \| `"unresolved-symlink"` \| `"entry-disappeared"`

**`Experimental`**

Why one entry contributed its name instead of its content.

## Variables

### CANDIDATE\_KNOWLEDGE\_ROOT\_ENV

> `const` **CANDIDATE\_KNOWLEDGE\_ROOT\_ENV**: `"TANGLE_CANDIDATE_KNOWLEDGE_ROOT"` = `'TANGLE_CANDIDATE_KNOWLEDGE_ROOT'`

**`Experimental`**

Environment variable containing the materialized candidate knowledge root.

***

### CANDIDATE\_KNOWLEDGE\_RETRIEVAL\_CONFIG\_ENV

> `const` **CANDIDATE\_KNOWLEDGE\_RETRIEVAL\_CONFIG\_ENV**: `"TANGLE_CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG"` = `'TANGLE_CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG'`

**`Experimental`**

Environment variable containing the materialized retrieval configuration path.

***

### CANDIDATE\_TRACE\_TAGS

> `const` **CANDIDATE\_TRACE\_TAGS**: `object`

**`Experimental`**

Protected trace tags that bind a run to one prepared candidate execution.

#### Type Declaration

##### executionId

> `readonly` **executionId**: `"tangle.candidate.execution_id"` = `'tangle.candidate.execution_id'`

##### bundleDigest

> `readonly` **bundleDigest**: `"tangle.candidate.bundle_digest"` = `'tangle.candidate.bundle_digest'`

##### executionPlanDigest

> `readonly` **executionPlanDigest**: `"tangle.candidate.execution_plan_digest"` = `'tangle.candidate.execution_plan_digest'`

##### materializationReceiptDigest

> `readonly` **materializationReceiptDigest**: `"tangle.candidate.materialization_receipt_digest"` = `'tangle.candidate.materialization_receipt_digest'`

***

### CANDIDATE\_TRACE\_ENV

> `const` **CANDIDATE\_TRACE\_ENV**: `object`

**`Experimental`**

Environment keys used to propagate immutable candidate trace identity.

#### Type Declaration

##### executionId

> `readonly` **executionId**: `"TANGLE_CANDIDATE_EXECUTION_ID"` = `'TANGLE_CANDIDATE_EXECUTION_ID'`

##### bundleDigest

> `readonly` **bundleDigest**: `"TANGLE_CANDIDATE_BUNDLE_DIGEST"` = `'TANGLE_CANDIDATE_BUNDLE_DIGEST'`

##### executionPlanDigest

> `readonly` **executionPlanDigest**: `"TANGLE_CANDIDATE_EXECUTION_PLAN_DIGEST"` = `'TANGLE_CANDIDATE_EXECUTION_PLAN_DIGEST'`

##### materializationReceiptDigest

> `readonly` **materializationReceiptDigest**: `"TANGLE_CANDIDATE_MATERIALIZATION_RECEIPT_DIGEST"` = `'TANGLE_CANDIDATE_MATERIALIZATION_RECEIPT_DIGEST'`

##### traceRunId

> `readonly` **traceRunId**: `"TANGLE_TRACE_RUN_ID"` = `'TANGLE_TRACE_RUN_ID'`

***

### AGENT\_CANDIDATE\_EXECUTION\_SUPPORT

> `const` **AGENT\_CANDIDATE\_EXECUTION\_SUPPORT**: `Readonly`\<\{ `outcomes`: readonly \[`"workspace"`, `"output"`\]; `code`: readonly \[`"disabled"`, `"no-op"`, `"git-patch"`\]; `memory`: readonly \[`"disabled"`, `"isolated"`\]; `knowledge`: `true`; `profile`: `Readonly`\<\{ `mcpTransports`: readonly \[`"stdio"`\]; `remoteMcp`: `false`; `tools`: `false`; `permissions`: `false`; `modes`: `false`; `confidential`: `false`; \}\>; \}\>

**`Experimental`**

Surfaces admitted by Runtime's verifier before an environment adapter is selected.

## Functions

### verifyMaterializedWorkspace()

> **verifyMaterializedWorkspace**(`root`, `expected`, `options?`): `Promise`\<`void`\>

**`Experimental`**

Refuse a materialized workspace whose files, modes, or bytes are not the signed manifest.

The scan streams, so the size of the largest file does not decide whether the check can run, and
the refusal names the one mismatch a caller can produce on its own: a capture and a verify that
disagree about `portableTree`.

#### Parameters

##### root

`string`

##### expected

`AgentCandidateWorkspaceManifestMaterial`

##### options?

`Omit`\<[`WorkspaceScanOptions`](#workspacescanoptions), `"limits"`\> = `{}`

#### Returns

`Promise`\<`void`\>

***

### scanMaterializedWorkspaceManifest()

> **scanMaterializedWorkspaceManifest**(`root`, `options?`): `Promise`\<`AgentCandidateWorkspaceManifestMaterial`\>

**`Experimental`**

The canonical manifest of one materialized workspace, read without holding any file.

Every file is digested by streaming, so the size of the largest file does not decide whether the
workspace can be described. `FileHandle.readFile` refuses anything above 2 GiB with
`ERR_FS_FILE_TOO_LARGE`, which made a workspace holding one such artifact impossible to verify
against a manifest it already matched. The digest is sha-256 over the same bytes either way, so
a manifest a buffered read produced is reproduced exactly.

#### Parameters

##### root

`string`

##### options?

[`WorkspaceScanOptions`](#workspacescanoptions) = `{}`

#### Returns

`Promise`\<`AgentCandidateWorkspaceManifestMaterial`\>

***

### candidateWorkspaceManifest()

> **candidateWorkspaceManifest**(`files`, `options?`): `AgentCandidateWorkspaceManifestMaterial`

**`Experimental`**

Build the canonical manifest for files a caller already holds — the shape a remote executor
returns. Pass `portableTree` to record Git's two file modes instead of exact permission bits, and
pass the same flag to every verify that reads the result.

#### Parameters

##### files

readonly `object`[]

##### options?

###### portableTree?

`boolean`

#### Returns

`AgentCandidateWorkspaceManifestMaterial`

***

### buildAgentCandidateBundle()

> **buildAgentCandidateBundle**(`input`): `AgentCandidateBundle`

**`Experimental`**

Compile one measured profile/code candidate into the immutable execution
contract. Code bytes are re-read and verified by agent-eval before they are
embedded. The returned bundle is schema-validated, canonically digested, and
deeply immutable; call `verifyAgentCandidateBundle` at the execution boundary
to re-read external memory, repository, and workspace artifacts.

#### Parameters

##### input

[`BuildAgentCandidateBundleInput`](#buildagentcandidatebundleinput)

#### Returns

`AgentCandidateBundle`

***

### sealAgentCandidateBundle()

> **sealAgentCandidateBundle**(`input`): `AgentCandidateBundle`

**`Experimental`**

Validate and content-address a candidate bundle before it crosses an approval boundary.

#### Parameters

##### input

[`AgentCandidateBundleInput`](#agentcandidatebundleinput)

#### Returns

`AgentCandidateBundle`

***

### candidateExecutionClaim()

> **candidateExecutionClaim**(`prepared`, `preparationEvidence`): [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)

**`Experimental`**

Extract the complete durable claim from a prepared execution.

#### Parameters

##### prepared

[`PreparedAgentCandidateExecution`](#preparedagentcandidateexecution)

##### preparationEvidence

###### executionPlan

`AgentCandidateArtifactRef`

###### materializationReceipt

`AgentCandidateArtifactRef`

#### Returns

[`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)

***

### disposePreparedAgentCandidateExecution()

> **disposePreparedAgentCandidateExecution**(`prepared`, `options?`): `Promise`\<\{ `disposed`: `true`; \}\>

**`Experimental`**

Revoke reservations held by a prepared candidate that will not be executed.

#### Parameters

##### prepared

[`PreparedAgentCandidateExecution`](#preparedagentcandidateexecution)

##### options?

[`DisposePreparedAgentCandidateOptions`](#disposepreparedagentcandidateoptions) = `{}`

#### Returns

`Promise`\<\{ `disposed`: `true`; \}\>

***

### exactProcessProviderAsCandidateExecutor()

> **exactProcessProviderAsCandidateExecutor**(`options`): [`AgentCandidateExecutorPort`](#agentcandidateexecutorport)

**`Experimental`**

Adapt one neutral exact-process provider to Runtime's trusted candidate boundary.

#### Parameters

##### options

[`ExactProcessCandidateExecutorOptions`](#exactprocesscandidateexecutoroptions)

#### Returns

[`AgentCandidateExecutorPort`](#agentcandidateexecutorport)

***

### executePreparedAgentCandidate()

> **executePreparedAgentCandidate**(`prepared`, `options`): `Promise`\<[`AgentCandidateRunFinalization`](#agentcandidaterunfinalization)\>

**`Experimental`**

Executes and finalizes one durably claimed candidate without exposing an unproven result.

#### Parameters

##### prepared

[`PreparedAgentCandidateExecution`](#preparedagentcandidateexecution)

##### options

[`ExecutePreparedAgentCandidateOptions`](#executepreparedagentcandidateoptions)

#### Returns

`Promise`\<[`AgentCandidateRunFinalization`](#agentcandidaterunfinalization)\>

***

### candidateKnowledgeExecutionPaths()

> **candidateKnowledgeExecutionPaths**(`taskRoot`, `hasRetrievalConfig`): `object`

**`Experimental`**

Deterministic, signed locations used by every candidate executor.

#### Parameters

##### taskRoot

`string`

##### hasRetrievalConfig

`boolean`

#### Returns

`object`

##### root

> **root**: `string`

##### retrievalConfig?

> `optional` **retrievalConfig?**: `string`

***

### persistCandidateOutputArtifact()

> **persistCandidateOutputArtifact**(`port`, `input`): `Promise`\<`AgentCandidateArtifactRef`\>

**`Experimental`**

Persist evaluator evidence, read it back, and bind the returned locator to the exact bytes.

#### Parameters

##### port

[`AgentCandidateOutputArtifactPort`](#agentcandidateoutputartifactport)

##### input

###### executionId

`string`

###### purpose

[`AgentCandidateOutputPurpose`](#agentcandidateoutputpurpose)

###### bytes

`Uint8Array`

###### signal?

`AbortSignal`

#### Returns

`Promise`\<`AgentCandidateArtifactRef`\>

***

### prepareAgentCandidateExecution()

> **prepareAgentCandidateExecution**(`candidate`, `task`, `ports`, `options?`): `Promise`\<[`PreparedAgentCandidateExecution`](#preparedagentcandidateexecution)\>

**`Experimental`**

Materializes a verified candidate into one immutable evaluator-owned execution plan.

#### Parameters

##### candidate

[`VerifiedAgentCandidate`](#verifiedagentcandidate)

##### task

[`AgentCandidateTaskExecution`](#agentcandidatetaskexecution)

##### ports

[`AgentCandidateExecutionPorts`](#agentcandidateexecutionports)

##### options?

[`PrepareAgentCandidateExecutionOptions`](#prepareagentcandidateexecutionoptions) = `{}`

#### Returns

`Promise`\<[`PreparedAgentCandidateExecution`](#preparedagentcandidateexecution)\>

***

### freezeGenericAgentCandidateProfile()

> **freezeGenericAgentCandidateProfile**(`input`): `AgentCandidateProfile`

**`Experimental`**

Convert only behavior-preserving generic profile fields into the closed candidate contract.

#### Parameters

##### input

`AgentProfile`

#### Returns

`AgentCandidateProfile`

***

### assertCandidateProfileBinding()

> **assertCandidateProfileBinding**(`measuredInput`, `bundled`): `void`

**`Experimental`**

Prove the measured generic profile and sealed candidate profile describe the same behavior.

#### Parameters

##### measuredInput

`unknown`

##### bundled

`AgentCandidateProfile`

#### Returns

`void`

***

### parseExactAgentProfile()

> **parseExactAgentProfile**(`input`, `label`): `AgentProfile`

**`Experimental`**

Parse a complete profile without silently discarding unsupported fields.

#### Parameters

##### input

`unknown`

##### label

`string`

#### Returns

`AgentProfile`

***

### parseExactAgentProfileDiff()

> **parseExactAgentProfileDiff**(`input`, `label`): `AgentProfileDiff`

**`Experimental`**

Parse a profile diff without silently discarding unsupported fields.

#### Parameters

##### input

`unknown`

##### label

`string`

#### Returns

`AgentProfileDiff`

***

### applyExactAgentProfileDiff()

> **applyExactAgentProfileDiff**(`baseInput`, `diffInput`, `label`): `AgentProfile`

**`Experimental`**

Apply one exact diff and reject any value that cannot be preserved canonically.

#### Parameters

##### baseInput

`unknown`

##### diffInput

`unknown`

##### label

`string`

#### Returns

`AgentProfile`

***

### parseExactCandidateProfile()

> **parseExactCandidateProfile**(`input`): `AgentCandidateProfile`

**`Experimental`**

Parse a candidate profile without silently discarding unsupported or non-canonical fields.

#### Parameters

##### input

`unknown`

#### Returns

`AgentCandidateProfile`

***

### agentCandidateProfileAsAgentProfile()

> **agentCandidateProfileAsAgentProfile**(`candidate`): `AgentProfile`

**`Experimental`**

Convert the candidate profile contract into the portable interface profile it represents.

#### Parameters

##### candidate

`AgentCandidateProfile`

#### Returns

`AgentProfile`

***

### omitUndefinedObjectFields()

> **omitUndefinedObjectFields**(`value`, `path`): `unknown`

**`Experimental`**

Recursively remove undefined object fields while refusing undefined array entries.

#### Parameters

##### value

`unknown`

##### path

`string`

#### Returns

`unknown`

***

### runProtectedAgentCandidateModelGrant()

> **runProtectedAgentCandidateModelGrant**\<`TResult`\>(`options`): `Promise`\<[`RunProtectedAgentCandidateModelGrantResult`](#runprotectedagentcandidatemodelgrantresult)\<`TResult`\>\>

**`Experimental`**

Run one bounded unit under a protected model grant.

Runtime owns the grant lifecycle; callers own the unit boundary and any
durable scheduling or accounting around it. A reserved grant is settled
after activation failure or callback failure, and the callback error is
preserved when settlement also fails.

#### Type Parameters

##### TResult

`TResult`

#### Parameters

##### options

[`RunProtectedAgentCandidateModelGrantOptions`](#runprotectedagentcandidatemodelgrantoptions)\<`TResult`\>

#### Returns

`Promise`\<[`RunProtectedAgentCandidateModelGrantResult`](#runprotectedagentcandidatemodelgrantresult)\<`TResult`\>\>

***

### createProtectedAgentCandidateModelPort()

> **createProtectedAgentCandidateModelPort**(`options`): [`AgentCandidateModelPort`](#agentcandidatemodelport)

**`Experimental`**

Bind a protected model-grant service to the immutable candidate runtime.

The service remains the authority for expiry, admission, revocation, and
metering. This adapter independently checks every response before allowing
it to cross into candidate execution or durable receipt finalization.

#### Parameters

##### options

[`CreateProtectedAgentCandidateModelPortOptions`](#createprotectedagentcandidatemodelportoptions)

#### Returns

[`AgentCandidateModelPort`](#agentcandidatemodelport)

***

### recoverExpiredAgentCandidateExecution()

> **recoverExpiredAgentCandidateExecution**(`options`): `Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

**`Experimental`**

Close an expired crashed attempt from persisted non-secret handles, then record failure.

#### Parameters

##### options

[`RecoverExpiredAgentCandidateOptions`](#recoverexpiredagentcandidateoptions)

#### Returns

`Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

***

### verifyAgentCandidateBundle()

> **verifyAgentCandidateBundle**(`input`, `ports`): `Promise`\<[`VerifiedAgentCandidate`](#verifiedagentcandidate)\>

**`Experimental`**

Verifies every digest, resource, workspace, and Git object in a candidate bundle.

#### Parameters

##### input

`unknown`

##### ports

[`AgentCandidateVerificationPorts`](#agentcandidateverificationports)

#### Returns

`Promise`\<[`VerifiedAgentCandidate`](#verifiedagentcandidate)\>

***

### captureAgentCandidateWorkspace()

> **captureAgentCandidateWorkspace**(`rootInput`, `options?`): `Promise`\<[`CapturedAgentCandidateWorkspace`](#capturedagentcandidateworkspace)\>

**`Experimental`**

Capture one exact regular-file workspace for immutable candidate execution.

#### Parameters

##### rootInput

`string`

##### options?

[`CaptureAgentCandidateWorkspaceOptions`](#captureagentcandidateworkspaceoptions) = `{}`

#### Returns

`Promise`\<[`CapturedAgentCandidateWorkspace`](#capturedagentcandidateworkspace)\>

***

### captureAgentCandidateWorkspaceFiles()

> **captureAgentCandidateWorkspaceFiles**(`input`, `options?`): `Promise`\<[`CapturedAgentCandidateWorkspace`](#capturedagentcandidateworkspace)\>

**`Experimental`**

Capture detached files returned by a remote executor into the standard archive.

#### Parameters

##### input

readonly [`AgentCandidateExecutorWorkspaceFile`](#agentcandidateexecutorworkspacefile)[]

##### options?

`Omit`\<[`CaptureAgentCandidateWorkspaceOptions`](#captureagentcandidateworkspaceoptions), `"includeRepository"`\> = `{}`

#### Returns

`Promise`\<[`CapturedAgentCandidateWorkspace`](#capturedagentcandidateworkspace)\>

***

### createAgentCandidateWorkspacePort()

> **createAgentCandidateWorkspacePort**(`options?`): [`AgentCandidateWorkspacePort`](#agentcandidateworkspaceport)

**`Experimental`**

Create the standard bounded materializer for candidate execution ports.

#### Parameters

##### options?

[`CreateAgentCandidateWorkspacePortOptions`](#createagentcandidateworkspaceportoptions) = `{}`

#### Returns

[`AgentCandidateWorkspacePort`](#agentcandidateworkspaceport)

***

### describeWorkspaceTree()

> **describeWorkspaceTree**(`directory`, `options?`): `Promise`\<[`WorkspaceTreeDescriptor`](#workspacetreedescriptor)\>

**`Experimental`**

Describe one directory tree by content, streaming every file.

The digest covers, for every entry in sorted order: its kind, its tree-relative path, its mode
under the selected algorithm, and then — for a file, its length and its own sha-256; for a kept
link, its target; for an excluded entry, the reason and the target. A file's content therefore
never enters the tree hash directly, which is what removes any in-memory size ceiling: the tree
hash consumes 32 bytes per file however large the file is.

A hard-linked regular file is described like any other regular file. Its content is what the
digest is about, and a package manager that links a store into `node_modules` is ordinary
content, not a reason to refuse a workspace.

#### Parameters

##### directory

`string`

##### options?

[`DescribeWorkspaceTreeOptions`](#describeworkspacetreeoptions) = `{}`

#### Returns

`Promise`\<[`WorkspaceTreeDescriptor`](#workspacetreedescriptor)\>

***

### seedWorkspaceTree()

> **seedWorkspaceTree**(`input`): `Promise`\<[`WorkspaceTreeDescriptor`](#workspacetreedescriptor)\>

**`Experimental`**

Seed a workspace from a directory, one entry at a time, and return the digest of what was
seeded.

Nothing is packed: `cp` walks and copies file by file, so a multi-gigabyte seed costs one file
handle rather than one archive in memory. Existing destination entries are never overwritten —
a seed that could replace a file the workspace already holds would make the resulting tree
depend on the order two seeds ran in.

Links are copied verbatim, exactly as they were written. Following them would copy bytes from
outside the seed into the workspace, which is the same rule [describeWorkspaceTree](#describeworkspacetree)
applies to the digest.

#### Parameters

##### input

[`SeedWorkspaceTreeInput`](#seedworkspacetreeinput)

#### Returns

`Promise`\<[`WorkspaceTreeDescriptor`](#workspacetreedescriptor)\>
