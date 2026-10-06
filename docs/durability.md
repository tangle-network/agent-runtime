# Durability: who owns what

This page maps every durability primitive in the Tangle stack to its owner. It is the inventory for [#1585](https://github.com/tangle-network/agent-runtime/issues/1585). Each row names what the primitive durably owns, who uses it, and whether it is public. Consumers come from an org-wide search of every repository's default branch on 2026-10-06; "none" means no code outside the owning repository imports it.

## The model

Durable work breaks into six separate questions. Each has one owner.

| Question | Owner | Primitive |
|---|---|---|
| **Accepted work.** Which run, turn or operation was accepted, and under which identity? | Runtime for supervised runs and retained provider runs. Agent App for chat turns. Platform for workflow runs. | Spawn journal and run context; retained-run admissions; Agent App turn store; workflow run claims |
| **Harness continuation.** How does the same harness and model continue? | The harness's native session, reached through the Sidecar or provider adapter | Claude Code `nativeSessionId`, Codex `threadId`, OpenCode and Pi sessions through the CLI provider base |
| **Execution recovery.** Is the original execution still running, finished, or gone? | Runtime for provider runs. Agent App for chat-turn completion receipts. | `recoverRetainedRun`, `reconnectRetainedRun`, `readCompletedSandboxTurn` |
| **Workspace recovery.** What is left: a live process, a native session, local files, a confirmed snapshot, or nothing? | Orchestrator and host agent | Durable project store, snapshots, host recovery; Agent App's recovery manager only decides what to offer the user |
| **External effects.** Which side effects already happened? | The effect boundary | Spawn keys and keyed tools in Runtime; `hub_exec_idempotency` in the Hub; `workflow_agent_operations` in Platform |
| **Placement.** Which compute runs it? | Orchestrator for hosts. Runtime's `selectProviderPlacement` for providers. | Independent of harness and model identity |

## Inventory

### Runtime (`@tangle-network/agent-runtime`)

| Primitive | Class | Public | Status | Consumers | Durably owns |
|---|---|---|---|---|---|
| `supervise` / `runGraph` with `runDir` (`createFileRunContext`: `FileSpawnJournal`, `FileResultBlobStore`, `FileCoordinationLog`) | orchestration journal | `/kernel` | production | discovery-lab, discovery, agent-eval, supervisor-lab, traces, blueprint-agent | A run directory's committed child settlements, keyed assignments, waits with their original deadlines, measured spend, and coordination messages |
| `createFencedSqlRunContext` over `openSqlRunStore` | ownership and fencing, orchestration journal | `/kernel` | production | discovery-lab | One live owner per run in shared SQL. A generation-fenced head row, hash-chained records, takeover after lease expiry, and rejection of stale writes |
| `SpawnJournal`, `InMemorySpawnJournal`, `replaySpawnTree`, `loadSpawnForest` | orchestration journal, observation | `/kernel` | production | Platform workflow engine (event and blob types), agent-sdk, physim, redteam, discovery-lab | The spawn-tree event shape every durable run context writes |
| `startRetainedRun`, `recoverRetainedRun`, `reconnectRetainedRun`, `startRetainedRunInEnvironment` | accepted-work state, execution recovery | `/kernel` | production | braid, agent-sdk, discovery-lab | The admission records (`intent`, then `environment`, then `dispatched`) that make a detached provider run reattachable without minting new identity |
| `startRetainedInteractiveRun`, `recoverRetainedInteractiveRun`, `reconnectRetainedInteractiveRun`, `claimRetainedInteractiveControl` | native harness session (process) | `/kernel` | production | braid | The exact interactive process reference and its control claim |
| `retainHarnessTranscript`, `captureHarnessTranscript` | native session evidence | `/kernel` | production | discovery, discovery-lab | Captured native transcripts. They are evidence, not resume state |
| `Scope.wait`, `pendingWaits` | durable wait | `/kernel` | production | discovery-lab | The armed wait's label and absolute deadline in the spawn journal. It wakes only while a coordinator runs |
| `supervisePursuit`, `acquireRunDirectoryLock`, `readSettleRecord`, `readFailureRecord` | ownership, accepted-work terminal record | `/durable` | production (operator) | discovery-lab, discovery | One live owner per run directory, plus `result.json` or `failure.json` |
| `FileObserverJournal`, `projectPursuit` | observation and read model | `/durable` | production | discovery-lab, Intelligence API (projection types) | Third-person history of one execution. The projection is rebuildable and owns no coordination |
| `handleChatTurn`, `deriveExecutionId` | stream framing, accepted-work identity | `/durable` | production | Agent App; GTM and Insurance call `deriveExecutionId`; most chat products import the `ChatStreamEvent` type | No storage. One stable execution id per `(project, session, turnIndex)`, composed by Agent App's turn route |
| `DelegationTaskQueue`, `FileDelegationStore` | accepted-work state | `/task-queue`, `/mcp` | production, single process | MCP delegation | Delegation status. Its idempotency index lives in one process |
| `runConversation` | none | root | production, in-process | none | Nothing. The conversation journal was deleted (see the ledger below) |

`/durable` holds the chat turn envelope and the records of one supervised run directory. It does not own execution recovery: that lives in `/kernel`.

### Sandbox: Orchestrator, Sidecar and host agent (`agent-dev-container`)

| Primitive | Class | Public | Status | Durably owns |
|---|---|---|---|---|
| Orchestrator durable project store | workspace identity | internal | production | Named project and instance identity across host replacement |
| Snapshots: snapshot service, S3/restic on the host agent, reclaim holds | workspace snapshot | through the Sandbox SDK | production | Confirmed workspace snapshots and their restore sources |
| Host recovery controller, stale-host recovery | placement, fencing | internal | production; fencing gap tracked in #1585 section E | Fences a dead host before the sandbox is rebuilt elsewhere |
| Sidecar sessions and message admission (`messageExecutionId`) | native harness session, stream replay | through the Sandbox SDK | production | Session event buffer (replay from `since: '0'`) and execution ids such as `plan-followup-sha256(session\0turn)` |
| Run-session loss store | observation | internal | production | Captures the platform gave up on, delivered to Intelligence as a loss seal |
| `sdk-session-persistence`, `sdk-provider-cli-base` | native harness session | ADC packages | production | Session and message storage for CLI providers that have none |
| Durable plans (`durable_plans`, `durable_plan_followups`) | accepted-work state | Sandbox API through the SDK | production | Plan lifecycle and the follow-up turn `plan:<id>:revision:<n>:<outcome>` |

### Platform Workflows and Hub (`products/platform/api`)

| Primitive | Class | Status | Durably owns |
|---|---|---|---|
| Workflow engine durability (`workflow_engine_trees`, `workflow_engine_journal`, `workflow_engine_blobs`, `workflow_runs` claim epoch) | orchestration journal, ownership | production | One current cursor checkpoint per run, fenced by its claim epoch. It composes Runtime's `SpawnEvent` and `ResultBlobStore` instead of a second journal format |
| `workflow_agent_operations` | effect ledger | production | One row per `(run, action, operation key)` with a request digest and commit time |
| `hub_exec_idempotency` | effect idempotency | production | One leased, request-hashed result per Hub execution idempotency key |

### Agent App (`@tangle-network/agent-app`)

| Primitive | Class | Public | Consumers | Durably owns |
|---|---|---|---|---|
| `TurnEventStore` (D1, Durable Object and memory stores), `createBufferedTurnTap`, `replayTurnEvents` | stream replay | `/stream`, `/turn-stream` | every chat product | Turn events and turn status |
| Running-turn lease (`listRunning`) and turn lock (`createDurableTurnLock`, `reconcileStaleTurnLock`) | ownership | `/stream`, `/turn-stream`, `/chat-routes` | GTM, Tax, Legal, Creative, Physim | One running turn per scope and lock, released only by its holder or a proven-terminal probe |
| `runDetachedTurn` and the Cloudflare detached-turn workflow tick | accepted-work state, recovery | `/chat-routes`, `/preset-cloudflare` | GTM, Relationships, Workcomp | Crash-safe projection of one detached turn. `TurnEventStore.resetEvents` clears a crashed buffer before a re-stream |
| Assistant draft row (`assistant:<turnId>`) | accepted-work result | `/chat-routes` | products | The persisted assistant message for one turn |
| `readCompletedSandboxTurn`, `observeNativeCompletion` | execution recovery | `/chat-routes` | GTM, Agent App | The exact completed turn receipt, validated against turn and session identity |
| Interactions contract, route and sidecar | accepted-work state | `/interactions` | GTM, Tax, Legal, Creative | Durable interaction answers |
| Plan follow-up attach (`planFollowUpExecutionId`, `resolvePlanFollowUpRequest`, `streamPlanFollowUpEvents`, `createD1PlanFollowUpGate`) | accepted-work claim, stream replay | `/chat-routes` | GTM, Tax, Legal, Creative | One leased claim per follow-up execution, plus a replay of that exact execution |
| Workspace sandbox recovery manager | workspace recovery decision | `/sandbox` | products | Nothing itself. It decides replace or decline from snapshot freshness; the Orchestrator owns the snapshot |

`agent-app-peer-check` fails product source that writes `turn_status` or `turn_events`, opens its own `box.session(id).events(...)` replay, or mints a `plan-followup-` id.

### Provider adapters

| Primitive | Class | Owner | Durably owns |
|---|---|---|---|
| `agent-provider-tangle`: workspace recovery and retained control | workspace recovery, native session | agent-sdk | Checkpoint lookup and retained Tangle sessions, reached through Runtime's retained-run API |
| `agent-provider-cli-bridge` | native harness session | agent-sdk | CLI-bridge sessions; resume maps to the CLI's own flag (`claude --resume`, `opencode -s`) |
| Braid runtime adapters | composition | braid | Nothing new. They call `startRetainedRun`, `recoverRetainedRun` and the interactive equivalents |

## Recovery outcomes

| API | Outcome | Meaning |
|---|---|---|
| `recoverRetainedRun` | `recovered`, `via: 'reattached'` | The provider self-identified the original session with the exact recorded coordinates |
| | `recovered`, `via: 'resumed'` | A pre-create intent was replayed through the exact, idempotent create and dispatch. The handle controls the admitted run, whether or not the crashed process had dispatched it |
| | `not_found` | The environment is gone. Nothing remains to destroy |
| | `unverifiable` | Uncertain. Keep the environment and never destroy it on this outcome |
| `recoverRetainedInteractiveRun` | handle | Resumed through the exact start request |
| | `null` | The environment is gone |
| `RetainedRunHandle.cancel` | `cancel_requested`, `cancelled`, `not_live`, `unknown` | `cancel_requested` is not a confirmed stop |
| `supervise` resume (`ResumedWork.keys`) | `completed`, `down` | Settled. The journal replays the settlement |
| | `in-doubt` | Uncertain. A keyed replacement is refused until the original execution is recovered |
| Keyed `Scope.spawn` after resume (`SpawnPrior.state`) | `completed` | Settled. Nothing new is spawned |
| | `retried` | The prior attempt settled `down`, was proven never dispatched, or died with the process for inline executors. It re-runs under the same key |
| `recoverExecutor` on resume | adopts the executor | Reattached. The interrupted child continues in its original session |
| `runDetachedTurn` (Agent App) | cached result | Settled server-side while the worker was gone |
| | re-stream | Not finished. The buffer is reset first |
| `createD1PlanFollowUpGate` | `admitted`, `in_flight`, `completed`; settlement `lease_lost` | A stale holder cannot overwrite a newer claim |

## Acceptance answers

**What makes accepted work durable?** A record written before the work becomes visible:
- a supervised run's `spawned` event in its spawn journal;
- a retained provider run's `intent`, then `environment`, then `dispatched` admission;
- a chat turn's `turn_status` row and buffered events in Agent App;
- a workflow run's claim and checkpoint in Platform.

Each record keeps the original identity, so recovery never mints a replacement.

**What survives a process crash?** Everything in those records. On restart, `supervise` with the same `runDir` or run context replays:
- committed settlements and keyed assignments;
- waits, with their original deadlines;
- measured spend and coordination messages.

A retained provider run reattaches through `reconnectRetainedRun`. A chat turn resumes from Agent App's buffer and completion receipt. Work that was in flight is `in-doubt` until it is reattached or proven never dispatched.

**What survives a host crash?** Sandbox owns this:
- Project identity survives, through the durable project store.
- Workspaces come back from a confirmed snapshot.
- The dead host is fenced before the sandbox is rebuilt.

Runtime's file run context survives only if its directory does. The fenced SQL context survives any single coordinator host: another process takes over after the lease expires. Section E of #1585 tracks the remaining host-retirement fencing gap.

**What is a native harness session versus a transcript?** A native session is the harness's own resumable conversation: Claude's session id, Codex's thread id, an OpenCode session. Continuing it keeps the model's context. A transcript is a captured copy of that conversation, kept as evidence. Runtime never replays a transcript into a different harness to fake continuation.

**What makes a workspace recoverable?** The Orchestrator distinguishes five states, from best to worst:
1. a live process;
2. a native session on a live box;
3. local workspace files;
4. a confirmed snapshot;
5. a fresh rebuild.

Agent App's recovery manager shows the user which of these is available. It does not take snapshots.

**Who owns timers and events?** Waits inside a supervised run belong to Runtime, but they wake only while a coordinator runs. Sleeping waits outside customer compute belong to Platform Workflows: provider events, schedules and webhooks. Section F of #1585 tracks correlating them to Runtime run identity.

**How are external effects made retry-safe?** By a stable key at the effect boundary:
- `SpawnOpts.key` and keyed tools in Runtime;
- the Hub's execution idempotency rows;
- Platform's workflow operation keys;
- the provider's own idempotency key where one exists.

An effect without provider idempotency is reconciled, not assumed exactly-once.

**How do Pi, Claude and Codex differ?** In native session identity and resume. Claude Code resumes a session id, Codex resumes a thread id, and OpenCode and Pi resume through the CLI provider base and session persistence. The cross-harness failure matrix belongs to #1585 section D.

**Which substrate runs it, and can that change?** The Orchestrator places sandboxes on hosts. Runtime's provider placement picks the provider environment. Placement can change only at admission or at a supported checkpoint, and never by migrating a live process. The admitted harness and model stay the same.

## One durable path for `supervise`

Use `runDir` for a file-backed run, or `runContext: await createFencedSqlRunContext(...)` for shared SQL. `runDir` is shorthand for `createFileRunContext(runDir)`.

Passing `journal`, `blobs` and `resume` directly is an advanced test seam, not a second recommended path. No consumer outside Runtime uses it.

## Deletion ledger (slices A, B, C and J, 2026-10-06)

| Removed | Canonical owner | Consumers before | Replacement | Tests |
|---|---|---|---|---|
| `createSqlRunContext`, the single-writer SQL helper (#1586) | `createFencedSqlRunContext` | none | fenced SQL context | fenced SQL conformance (40 cases) |
| `SqlSpawnJournal`, `SqlResultBlobStore`, `SqlStatements` | `createFencedSqlRunContext` | none | fenced SQL context | fenced SQL conformance; the single-writer matrix is deleted |
| `ConversationJournal`, `FileConversationJournal`, `InMemoryConversationJournal`, `SqlConversationJournal`, `runConversation({ journal })`, `conversation_resumed` | Agent App turn store for chat; `supervise` run context for supervised work | none | none needed | the two conversation conformance matrices are deleted with the surface |
| Run-directory layout constants and helpers from `/durable` (`*_FILE`, `REVIEW_DIR`, `pursuitVersionsLedgerPath`, `settleRecordJson`, `deliverPursuitObserver`, `createFileObserverHooks`, `FORK_PARENT_UNCERTAIN_NODES_KEY`) | `supervisePursuit` | none | the readers that remain public | `tests/integration/supervise-pursuit-*` |
| Worker binding paths and wake defaults from `/kernel` (`CONTINUATIONS_DIR`, `workerInteractiveBinding*`, `workerInteractiveAdmissionFile`, `readWorkerInteractiveAdmissions`, `DEFAULT_WAKE_*`, `composeContinuationNote`) | `supervise` | none | `attachWorker`, `readWorkerInteractiveBinding` | `tests/runtime/worker-interactive-attach.test.ts` |
| Four product copies of the plan follow-up attach (GTM, Tax, Legal, Creative) | Agent App `/chat-routes` | four products | `planFollowUpExecutionId`, `resolvePlanFollowUpRequest`, `streamPlanFollowUpEvents`, `createD1PlanFollowUpGate` | `tests/chat-routes/plan-follow-up.test.ts` |
| `runDetachedTurn({ resetBuffer })` and the raw `DELETE FROM turn_events` callbacks | `TurnEventStore.resetEvents` | Relationships, Workcomp | store method | `tests/turn-buffer.test.ts`, `tests/chat-routes/detached-turn.test.ts` |

Runtime's measured surface went from 2,166 public exports to 2,138: `/durable` from 74 to 62, `/kernel` from 1,059 to 1,048, and the root from 313 to 308. Line counts for each pull request are recorded on #1585.
