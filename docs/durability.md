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
| Host recovery controller, stale-host recovery | placement, fencing | internal | production; the retirement fence on a create admitted before the drain is proven against real Redis (`retirement-admission-fence.test.ts`) | Fences a dead host before the sandbox is rebuilt elsewhere |
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
| Hub line outbox (`lib/lines/outbox.ts`) | effect outbox | production | One message per line and idempotency key, with reminder consent, quiet hours and STOP. A send that lost its result is `uncertain` and is replayed under the same key; a definitive 4xx drops it |
| Workflow suspensions (`wait.event`, `wait.timer`, `workflow.run`, decisions) | durable wait and timer | production | The only sleeping wait since #1622. A delivery wakes one parked run, and a concurrent duplicate falls through unconsumed |

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

## Product effect stores (audit, 2026-10-06)

A product keeps a store only for what the platform cannot know: when to send, who consented, and whether the domain still allows it. Each effect itself goes through a platform owner under one key.

| Product | Store | What only the product knows | Effect site and key | Decision |
|---|---|---|---|---|
| Hospitality | `outbox` (staff, guest, lead), `guest_revocation`, `lead_revocation` | The send time; shadow or live delivery; guest consent; whether a practitioner session is still requested; encrypted guest bodies | Hub line `send` with `idempotencyKey` = outbox id. A 4xx is `failed`. A lost transport response is `uncertain`, and so is a `sending` row older than ten minutes. Neither is resent | Keep. Hub's line outbox owns transport, quiet hours and STOP, but it cannot re-check the domain at send time. Its proactive-send consent is the recipient's `REMINDERS ON` reply, not guest registration, so moving the schedule there would change who consented |
| GTM | `billing_deduction_outbox` | The deduction owed for a chat turn | Platform `POST /v1/billing/deduct`, idempotent by `referenceId` = `chat:turn:<turnId>`. A retry re-posts the deduct and never re-runs the turn | Keep. It is the only copy, and no other product defers a deduction |
| GTM | `post.idempotency_key` | The post's draft, approval and send lifecycle | Hub tool execution keyed `post:<id>:attempt:<n>`. Protected Hub tools are keyed `<executionId>:<operationId>` | Keep. The Hub idempotency ledger already owns the effect |
| Builder | `assistant_product_outbound`, `assistant_message_turn` | Nothing since builder#496 | Hub lines | Done in builder#496, which deleted Builder's messaging engine. The tables remain as history, and dropping them would delete records |
| Super | `channel-outbox` in its own store | A local single-owner app's channel queue, keyed by binding and run | The channel providers directly | Keep. Super runs outside the platform |
| Tuner | `tuner_action_claims` | Request deduplication and spend caps for paid actions it receives | Its own API | Keep. It deduplicates incoming requests and is not an outbound effect |

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
| `supervise` resume with `modelChange` | same run, new root model | The recorded identity, coordination owner and settled children carry over; the journal gains one `model-changed` record with the time and reason. Any other profile change is refused |
| Keyed `Scope.spawn` after resume (`SpawnPrior.state`) | `completed` | Settled. Nothing new is spawned |
| | `retried` | The prior attempt settled `down`, was proven never dispatched, or died with the process for inline executors. It re-runs under the same key |
| `recoverExecutor` on resume | adopts the executor | Reattached. The interrupted child continues in its original session |
| `runDetachedTurn` (Agent App) | cached result | Settled server-side while the worker was gone |
| | re-stream | Not finished. The buffer is reset first |
| `createD1PlanFollowUpGate` | `admitted`, `in_flight`, `completed`; settlement `lease_lost` | A stale holder cannot overwrite a newer claim |
| Platform workflow crash resume | resumed, or refused | A settled action never re-runs. A notify or Hub write that was in flight at the crash refuses, because it may already have taken effect |
| Tangle provider reconnect after a host loss | `down` | The box is restored from its confirmed snapshot. An execution that was running settles `down` on its original id and is not dispatched again |

## Acceptance answers

**What makes accepted work durable?** A record written before the work becomes visible:
- a supervised run's `spawned` event in its spawn journal;
- a retained provider run's `intent`, then `environment`, then `dispatched` admission;
- a chat turn's `turn_status` row and buffered events in Agent App;
- a workflow run's claim and checkpoint in Platform.

Each record keeps the original identity, so recovery never mints a replacement.

**What survives a process crash?** Everything in those records. On restart, `supervise` with the same `runDir` or run context replays:
- committed settlements and keyed assignments;
- budgets and deadlines, measured from each node's original `spawned` record;
- measured spend and coordination messages.

A retained provider run reattaches through `reconnectRetainedRun`. A chat turn resumes from Agent App's buffer and completion receipt. Work that was in flight is `in-doubt` until it is reattached or proven never dispatched.

A supervised manager's turn that stays pending is resolved, not retried until the run ends:
- A capacity refusal before dispatch, such as a subscription credential owner with no account room, was refused before it ran. The driver pauses as for any capacity refusal, bounded only by the deadline, the budget and cancellation, and time paused does not count toward `driverRetry.transientOutageMs`.
- A turn the provider answered but could not resolve, twice the same way or once when the failure would end the run, is abandoned. Runtime stops it at the provider, journals `execution-abandoned` with the outcome the provider confirmed (`stopped` or `uncertain`), and the next drive starts a new invocation. The journal refuses every later admission or result of the abandoned turn, so its replacement is the only one that can commit.
- A lost transport waits for the provider inside the outage window, because the original may still be running.

**What survives a host crash?** Sandbox owns this:
- Project identity survives, through the durable project store.
- Workspaces come back from a confirmed snapshot.
- The dead host is fenced before the sandbox is rebuilt.

Runtime's file run context survives only if its directory does. The fenced SQL context survives any single coordinator host: another process takes over after the lease expires. A create admitted before a host's drain blocks that host's deletion until the create releases its reservation. agent-dev-container `retirement-admission-fence.test.ts` proves this against real Redis.

**What is a native harness session versus a transcript?** A native session is the harness's own resumable conversation: Claude's session id, Codex's thread id, an OpenCode session. Continuing it keeps the model's context. A transcript is a captured copy of that conversation, kept as evidence. Runtime never replays a transcript into a different harness to fake continuation.

**What makes a workspace recoverable?** The Orchestrator distinguishes five states, from best to worst:
1. a live process;
2. a native session on a live box;
3. local workspace files;
4. a confirmed snapshot;
5. a fresh rebuild.

Agent App's recovery manager shows the user which of these is available. It does not take snapshots.

**Who owns timers and events?** Platform Workflows. Provider events, schedules, webhooks and timers park a run in the suspension store, outside customer compute, and wake that exact run. Its actions keep their `wf_<run>_a<step>` keys. Runtime has no sleeping waits since #1622. Inside a live supervised run, a manager waits by ending its turn, and Runtime starts its next turn when its workers report. That wait lasts only as long as its coordinator. A resumed coordinator rebuilds it from the journal.

**How are external effects made retry-safe?** One effect key goes from admission to the effect site, and every retry and recovery keeps it:
- `SpawnOpts.key` and keyed tools in Runtime;
- the Hub's execution idempotency rows;
- Platform's workflow operation keys, `wf_<run>_a<step>`, used by `integration.invoke`, `line.send` and `notify` alike;
- the provider's own idempotency key where one exists.

An effect without provider idempotency is reconciled, not assumed exactly-once. A lost acknowledgement leaves an explicit uncertain state:
- Where the provider honours the key, the owner replays under it. An `uncertain` Hub line send is retried with the same key.
- Where it does not, the owner refuses to repeat the effect. This covers a Hub write or a notify in flight at a crash, an `uncertain` product outbox row, and an `in-doubt` Runtime spawn.

A notify retry repeats only the POST, under the same `Idempotency-Key`. It never re-runs the agent action before it. The product stores that remain are listed above.

**How do Pi, Claude and Codex differ?** In native session identity and resume. Claude Code resumes a session id, Codex resumes a thread id, and OpenCode and Pi resume through the CLI provider base and session persistence. The cross-harness recovery matrix, with receipts from the real CLIs, is in agent-dev-container `tests/harness-conformance/README.md`. Pi Durable is not covered: it has no adapter, and it must not silently replace `pi`.

**Which substrate runs it, and can that change?** The Orchestrator places sandboxes on hosts. Runtime's provider placement picks the provider environment. Placement can change only at admission or at a supported checkpoint, and never by migrating a live process. The admitted harness and model stay the same.

## One durable path for `supervise`

Use `runDir` for a file-backed run, or `runContext: await createFencedSqlRunContext(...)` for shared SQL. `runDir` is shorthand for `createFileRunContext(runDir)`.

Passing `journal`, `blobs` and `resume` directly is an advanced test seam, not a second recommended path. No consumer outside Runtime uses it.

## Conformance matrix

| Failure | Proven by | Setting |
|---|---|---|
| Coordinator killed before or after dispatch, mid-turn, before or after commit, before or after an effect | Runtime `tests/durability/sql-run-context.test.ts` and the `runDir` graph kill matrix | Real OS processes; synthetic retained provider |
| Two contenders, a stale owner (SIGSTOP, then SIGCONT), lease expiry and takeover | Runtime fenced SQL suite | Real OS processes, SQLite |
| A manager turn left pending by a capacity refusal, a lost reply, a crash at any retained boundary, or an execution the provider can no longer resolve | Runtime `tests/durability/retained-owner-pending-invariants.test.ts` (seeded sequences) and `tests/kernel/supervise-retained-owner-pending.test.ts` | Production provider executor, owner journal and driver retry; durable synthetic provider |
| Kill during a session resume | Harness conformance case 8 kills the CLI during a resume turn, and the session continues. In the `host-loss` restore scenario, a coordinator is killed during recovery, before the director's session resumes; the next coordinator resumes that same session. Runtime `tests/durability/session-reattach.test.ts` covers kills mid-session with re-attach | Real Claude Code, Codex, OpenCode and Pi; end to end; synthetic sessions |
| CLI killed mid-tool, then resumed | Harness conformance case 7 | Real CLIs, scripted model |
| Host loss, end to end | Harness conformance `host-loss`, restore scenario | Runtime supervisor, sidecar and Claude Code in Docker; shim control plane |
| Coordinator killed during a workspace restore | `host-loss`, restore scenario: the next coordinator joins the in-flight restore, and each box is restored once | Same |
| Snapshot lag | `host-loss`: the restored workspace lacks the work done after the snapshot, and the keyed effect made then is accepted once | Same |
| Duplicate wake | Platform `workflow-suspensions.test.ts`: of two concurrent deliveries to one wait, exactly one resumes the run. In `host-loss`, the second of two coordinators started together exits | Platform tests; end to end |
| Cancellation during recovery | `host-loss`, cancel scenario: no model call or admission follows the cancel. Platform `workflow-suspensions.test.ts`: a settle after a cancel is refused | End to end; Platform tests |
| Host retirement against a create admission | agent-dev-container `retirement-admission-fence.test.ts` | Real Redis |
| Park, evacuate, retire, resume elsewhere | agent-dev-container `parked-evacuation-resume-elsewhere.test.ts` | Orchestrator unit tests |
| A notify retry after agent work | Platform `workflow-engine.test.ts`: the agent runs once, and every attempt carries one key | Platform tests |
| A notify or Hub write in flight at a crash | Platform `workflow-runner-engine.test.ts`, `workflow-crash-resume-process.test.ts` | Real processes |

Each assertion holds where it is proven:
- original ids, keys, budgets, deadline origins, session ids and environment ids survive;
- no node is dispatched twice;
- a keyed effect is accepted once;
- one result is written.

Limits by capability:
- Prime has no receipt. It opens a new ACP session per process and continues history from its agent directory.
- Pi Durable has no adapter and has not run.
- The end-to-end host loss ran Claude Code only, on an emulated control plane.

## Deletion ledger (2026-10-06)

| Removed | Canonical owner | Consumers before | Replacement | Tests |
|---|---|---|---|---|
| `createSqlRunContext`, the single-writer SQL helper (#1586) | `createFencedSqlRunContext` | none | fenced SQL context | fenced SQL conformance (40 cases) |
| `SqlSpawnJournal`, `SqlResultBlobStore`, `SqlStatements` | `createFencedSqlRunContext` | none | fenced SQL context | fenced SQL conformance; the single-writer matrix is deleted |
| `ConversationJournal`, `FileConversationJournal`, `InMemoryConversationJournal`, `SqlConversationJournal`, `runConversation({ journal })`, `conversation_resumed` | Agent App turn store for chat; `supervise` run context for supervised work | none | none needed | the two conversation conformance matrices are deleted with the surface |
| Run-directory layout constants and helpers from `/durable` (`*_FILE`, `REVIEW_DIR`, `pursuitVersionsLedgerPath`, `settleRecordJson`, `deliverPursuitObserver`, `createFileObserverHooks`, `FORK_PARENT_UNCERTAIN_NODES_KEY`) | `supervisePursuit` | none | the readers that remain public | `tests/integration/supervise-pursuit-*` |
| Worker binding paths and wake defaults from `/kernel` (`CONTINUATIONS_DIR`, `workerInteractiveBinding*`, `workerInteractiveAdmissionFile`, `readWorkerInteractiveAdmissions`, `DEFAULT_WAKE_*`, `composeContinuationNote`) | `supervise` | none | `attachWorker`, `readWorkerInteractiveBinding` | `tests/runtime/worker-interactive-attach.test.ts` |
| Four product copies of the plan follow-up attach (GTM, Tax, Legal, Creative) | Agent App `/chat-routes` | four products | `planFollowUpExecutionId`, `resolvePlanFollowUpRequest`, `streamPlanFollowUpEvents`, `createD1PlanFollowUpGate` | `tests/chat-routes/plan-follow-up.test.ts` |
| `runDetachedTurn({ resetBuffer })` and the raw `DELETE FROM turn_events` callbacks | `TurnEventStore.resetEvents` | Relationships, Workcomp | store method | `tests/turn-buffer.test.ts`, `tests/chat-routes/detached-turn.test.ts` |
| Supervise wait-state nodes (#1622): `Scope.wait`, `timerAt`, `pollFor`, `waitUntil`, the probe registry, the journal's `waiting` and `woken` events, and the `waiting` status | Platform workflow suspensions and timers | none outside Runtime | `wait.*` in Platform workflows | Runtime vitest; durability conformance |
| `probeSandboxCapabilities`, `SandboxCapabilities`, `SandboxClient.criuStatus` and the checkpoint-fork lineage path (#1623), and the sandbox CLI's `criuStatus` forward (agent-dev-container#9496) | the box's `branch(count)` | none: the SDK dropped `criuStatus()` in agent-dev-container#5227 | `branch(count)` | Runtime vitest |
| Prime's copy of the ACP session client (agent-dev-container#9491) | `AcpProviderAdapterBase` in `sdk-provider-cli-base` | Prime, ACP | the shared base | provider tests |

Runtime's measured surface went from 2,166 public exports to 2,138: `/durable` from 74 to 62, `/kernel` from 1,059 to 1,048, and the root from 313 to 308. Slices D to I removed 5,157 lines and added 1,595 across #1622, #1623 and agent-dev-container#9491, as GitHub counts them. Line counts for each pull request are recorded on #1585.
