# Execution model — the unified picture

> **In plain terms:** This doc explains how the package actually runs an agent's work — the difference between a "driver" (the agent that decides what to do next and hands out subtasks) and a "worker" (the agent that carries out one subtask), which tools each one gets, and the steps that start a new worker. It's for developers reading or building on the package who want the mental model before they open the source. The one thing to remember: everything that runs work — a plain API call, a command-line coding agent, a full sandbox, or your own custom agent — plugs into the same small interface, so you learn one shape and it covers every case.

**Track:** architecture · **Role:** the picture (how execution works). How work runs, what a driver vs a worker does, who gets which tools, and how a worker is spawned. Grounded to `file:line`; on conflict the code wins (fix this the same turn). Companion to [glossary.md](./glossary.md) (the terms) and [architecture.md](./architecture.md) (the overall design).

## 1. The unified thing — one port, four backends, two engines

Before, each bench hand-rolled its own pseudo-box client. Now there is **one execution port** (`Executor`), **one built-in** (`createExecutor`, backend chosen by *data*), and **one adapter** (`inlineSandboxClient`) to feed the round-synchronous engine. Two engines, one substrate.

```
              WHAT RUNS THE WORK = the Executor port (open, BYO-first)
              ──────────────────────────────────────────────────────────
              execute() · deliver?() · teardown() · resultArtifact()
              every executor normalizes usage → the conserved budget pool
                              (supervise/types.ts:69)

   createExecutor({ backend })  ── the ONE built-in: backend = DATA, not an import
   ┌──────────┬──────────┬──────────┬────────────┐         ┌──────────────────┐
   │ 'router' │ 'bridge' │  'cli'   │ 'sandbox'  │         │  BYO  Executor   │
   │ HTTP     │ cli-     │ claude-p │ a real box │         │ (mastra / agno / │
   │ chat     │ bridge   │ codex    │ runAgentRounds in │         │  your own HTTP)  │
   │ no box   │ HTTP     │ opencode │  a leaf    │         │ implements the   │
   └────┬─────┴────┬─────┴────┬─────┴─────┬──────┘         │ port directly    │
        └──────────┴──────────┴───────────┴──── all are Executors ──┴─────────┘
                              │                       (src/runtime/supervise/runtime.ts)
   ┌──────────────────────────┴──────────────────────────┐
   │                                                      │
 inlineSandboxClient(exec)                       (the sandbox executor already IS
 wraps a NON-box executor as a SandboxClient      a SandboxClient: real box, sessions,
 so runAgentRounds can drive it (inline-sandbox-client)  fs artifacts, fork/CRIU)
   │                                                      │
   ▼                                                      ▼
┌─────────────────────────────┐            ┌─────────────────────────────────┐
│ ENGINE A: runAgentRounds           │            │ ENGINE B: Scope / Supervisor    │
│ round-synchronous           │            │ reactive keystone (canonical)   │
│ driver.plan → decide        │            │ Agent.act spawns into a Scope   │
│ (most benches drive this)   │            │ conserved budget ⇒ equal-k      │
│ agent-rounds.ts                 │            │ supervise/{scope,supervisor}.ts │
└─────────────────────────────┘            └─────────────────────────────────┘
                └────────── same Executor port underneath ──────────┘
```

Local CLI and sealed candidate execution share native prompt projection: `systemPrompt`
replaces the harness prompt, `appendSystemPrompt` keeps it and adds privileged guidance,
and `instructions` remains caller guidance. Prefer addition for coding personas. Local
workspace inputs are included in the execution plan and removed after the process exits.

### Bridge implementation ownership

`src/runtime/supervise/runtime.ts` keeps backend configuration, factory selection, and the existing public exports.
Bridge code follows these internal boundaries:

- `bridge-config.ts` captures transport configuration and resolves protected credential references at dispatch.
- `bridge-executor.ts` owns the executor lifecycle and materialization.
- `bridge-session-stream.ts` owns the resumable session turn loop, steering, and measured usage.
- `bridge-transport.ts` owns admission checks, HTTP requests, ordered reconnect, and acknowledged cancellation.
- `bridge-protocol.ts` decodes streams and validates receipts without owning network or executor state.

Dependencies flow from the executor through transport to protocol validation.
Shared seam validation lives in `executor-seams.ts`; result pointer construction lives in `executor-outcome.ts`.
New backends still implement the existing `Executor` contract.

### Environment-provider credential identity

An environment-provider executor passes the exact profile's `model.metadata.credentialSource` to the provider unchanged.
Runtime accepts only `managed` or `subscription`; the provider validates the selected credential reference before creating an environment.
Credential values remain private executor inputs.
Router, bridge, and legacy sandbox executors reject this field because they do not enforce this selection contract.
Unknown model controls and unenforceable completion ceilings still fail before execution.

Construct the Sandbox provider with `createTangleProvider` from `@tangle-network/agent-provider-tangle`.
Pass it to `createExecutor({ backend: 'provider', provider })` or `provisionSupervisor({ connection: { provider }, ... })`.
Runtime no longer constructs an agent provider from a Sandbox client, endpoint, or API key.
Shared-box workers implement `AgentEnvironment` directly.
A profile with explicit credential intent keeps its dedicated provider.

## 2. Driver vs worker — judgment vs labor

```
                    ┌───────────────────────────────────────────┐
                    │  DRIVER  (the lead / "operator")           │
                    │  an Agent.act running in a Scope           │
                    │                                            │
                    │  each round it decides the TOPOLOGY MOVE ─────┐ this IS
                    │   refine │ fanout │ select │ stop          │ │ "topology grown
                    │  then drives workers via the toolbox:      │ │  by LLM decision"
                    │   spawn_worker · steer_agent · end turn    │ │ (driver.ts:52)
                    └───────────────┬────────────────────────────┘ │
       spawn_worker(profile,task) ──┤  reserves budget (fails       │
       steer_agent(id,msg) ────────┤  CLOSED if the pool is dry)   │
       end turn (wait) ──────────────┘                               │
                    ┌───────────────┼───────────────┐               │
                    ▼               ▼                ▼               │
             ┌───────────┐   ┌───────────┐   ┌───────────┐          │
             │ WORKER 1  │   │ WORKER 2  │   │ ANALYST   │ ◄────────┘ (a worker
             │ does the  │   │ (fanout)  │   │ reads the │            variant)
             │ TASK over │   │ does the  │   │ worker's  │
             │ the shared│   │ task too  │   │ TRACE →   │
             │ ARTIFACT  │   │           │   │ a steer   │
             └───────────┘   └───────────┘   └───────────┘
   Driver  = judgment: what runs next, who to spawn, when to stop, who wins.
   Worker  = labor: bring the shared artifact to its required final state.
   Analyst = a worker variant that reads ONLY the trace → a correction
             (never the judge's verdict — the selector≠judge firewall).
```

## 3. Who gets which tools / MCPs

```
  ROLE      │ in-box TOOLS                    │ operator MCP toolbox  │ can it spawn?
  ──────────┼─────────────────────────────────┼───────────────────────┼──────────────
  DRIVER    │ artifact tools  +  OPERATOR     │ ✅ yes (Scope-as-MCP, │ YES — that is
  /operator │ toolbox (spawn/steer/await…)    │   when it runs in a   │ its whole job
            │                                 │   sandbox)            │
  ──────────┼─────────────────────────────────┼───────────────────────┼──────────────
  WORKER    │ artifact tools ONLY             │ ❌ none               │ NO — a leaf;
  /default  │ (bash/read/edit/… the surface   │                       │ it does the
            │  supplies)                      │                       │ task
  ──────────┼─────────────────────────────────┼───────────────────────┼──────────────
  ANALYST   │ read_trace ONLY                 │ ❌ none               │ NO (a driver
  /trace    │ (firewall: trace in, correction │                       │ may define_
            │  out, NEVER the verdict)        │                       │ analyst kinds)
```

**The rule in one line:** the driver carries the coordination MCP because spawning/steering *is* its job; the worker gets only the artifact's tools because its job is to do the task, not manage others; the analyst is locked to `read_trace` so the selector cannot peek at the judge.

## 4. How a worker is spawned (the mechanics)

```
  driver calls  spawn_worker(profile, task, budget)        (mcp/tools/coordination-worker-tools.ts)
        │
        ▼
  scope.spawn(spec, budget)                                (supervise/scope.ts:130)
        │
        ├─ 1. pool.reserve(budget)  ──►  FAILS CLOSED if the pool is dry      ┐ equal-k
        │      (atomic; total ≡ free + reserved + committed)                  │ by
        │                                                                     │ construction
        ├─ 2. registry.resolve(spec)   precedence:                            │ — the anti-
        │        BYO spec.executor → harness===null (router) →                │ confound
        │        registered 'sandbox' factory                                 │ invariant
        │                                   │                                 ┘
        │                                   ▼
        │                            createExecutor picks the backend body
        │                            (router / bridge / cli / sandbox)
        │                                   │
        ├─ 3. runChild(executor)  ──►  execute(task) … meters UsageEvents
        │                                   │
        └─ 4. settle  ──►  pool.reconcile(ticket, actualSpend)
                                            │
                                            ▼
                              Runtime wakes the driver with this child's result
```

**Net:** the "unified thing" is the `Executor` port. Everything that runs work — a router call, a cli-bridge turn, a `claude -p` subprocess, a full sandbox rollout, or a BYO agent — is an `Executor`, chosen by data via `createExecutor`, metered by one budget pool. Drivers and workers are both `act`s over that port; the only structural difference is the driver carries the operator toolbox (so it can spawn/steer) and the worker does not.

## Isolated checks of untrusted run trees

Use `runIsolatedCheck` from `@tangle-network/agent-runtime/kernel` to execute checks supplied by an untrusted run tree.
The checker requires Linux, `/usr/bin/bwrap` with `--json-status-fd`, GNU `/bin/chmod` and `/bin/rm`, and permission to create user, mount, network, and process namespaces.
Unsupported hosts return a refusal; the checker never executes the command directly on the host.

Provide the trusted workspace root, the tree path, and an executable with its argument array.
The checker copies the tree without following symbolic links and mounts that writable copy at the tree's canonical host path.
Writes disappear after execution unless explicitly requested output retention fails and returns recovery custody.
The namespace exposes trusted system toolchains, private process and device filesystems, and temporary storage.
Workspace parents contain no host files; sibling trees and external symbolic-link targets remain inaccessible.
The checker rejects toolchain mounts that overlap the workspace or tree, including canonical paths through symbolic links.
Keep the input tree and system toolchains stable during preparation; this API does not synchronize concurrent host writers.

The command receives only an explicit executable search path, home directory, and locale.
Timeouts, cancellation, and output overflow kill the Bubblewrap process group; namespace teardown also terminates descendants.
Command time and captured output have limits.
Failed commands retain bounded stdout, stderr, and exit-code evidence.
A private Bubblewrap status pipe distinguishes setup refusals from command failures; command stderr cannot change that classification.
Cleanup uses symlink-safe directory traversal, including trees deeper than the host path-length limit.
Cleanup failures return typed results and preserve any primary command failure.
Set `maxInputBytes` and `maxInputEntries` to bound regular-file content and entries copied or captured from the input tree.
These limits are opt-in to preserve existing callers with unknown workspace sizes.
An exceeded input budget returns `input-limit` before the command starts.
These limits cover the input copy and box upload, not decompressed data, command memory, or files generated by the command.
Run checks in a separately resource-limited container, VM, or Sandbox box when those resources require protection.
Bubblewrap namespaces alone do not impose a memory, process, CPU, or writable-disk quota.

Run `bash scripts/verify-isolated-checker-linux.sh` for the real Linux boundary tests.
The script copies source into disposable Docker containers and never mounts the host workspace.
It tests successful isolation with namespace privileges and refusal without those privileges.

### Retaining declared output files

Pass `outputs` to retain exact evaluator files before the writable copy or check box is removed.
The declaration contains `paths`, `maxFileBytes`, `maxTotalBytes`, and an optional `timeoutMs`.
Add the check's `executionId` and an existing `AgentCandidateOutputArtifactPort` as `artifacts`.
Use `validateIsolatedCheckOutputs` from the same kernel entrypoint when validating authored declarations.
Paths name between one and 16 distinct portable relative files, without globs, directory trees, links, or protected `.git`/`.sidecar` entries.
The total byte cap is at most 64 MiB; the per-file cap must fit inside it.
The declaration author must approve these files for disclosure. Hidden judge inputs, credentials, private prompts, and unrestricted logs do not belong in this list.
Runtime treats retained bytes as opaque and does not infer a benchmark verdict or redact file content.

Requested paths must not overlap input files. This prevents an old input report from being accepted as newly produced evidence.
For local checks with outputs, the private input copy must also satisfy the existing regular-file workspace-manifest contract; preserved symbolic links are refused before execution.
The local copier already rejects special files and detaches source hard links into independent copied files.
The checker binds output evidence to the canonical digest of the exact input copy before the command starts.
Box checks use the same `box.inputDigest` already recorded on complete input delivery.
This digest identifies the delivered tree; callers still record their candidate revision and checker identity with the result.

Capture follows observed command termination, including a nonzero exit, timeout, or cancellation whose bounded process kill and wait succeeded.
An unconfirmed launch or termination skips capture and enters the whole-box recovery path below.
It has its own bounded deadline (30 seconds by default, at most 120 seconds) so cancellation does not discard files the check already wrote.
Each file is persisted with purpose `grader-evidence`, and the existing artifact helper verifies the returned digest, byte count, and stored bytes before accepting its reference.
`outputs.files` contains only verified references. `outputs.missing` reports bounded reason codes for every other declared path.
`outputs.status: 'retained'` means every requested file passed this procedure; it does not claim stronger durability than the caller's chosen artifact port.
Files are verified individually, not as an atomic snapshot of the output tree. A process exit receipt alone does not prove all detached descendants stopped; checks must finish their writers before returning.
A local private CAS still needs its existing configured durable store to survive loss of the host.

If any output cannot be retained, `outputs.status` is `incomplete` and cleanup preserves the source for explicit recovery.
A local `outputs.source` gives the private Runtime scratch path, outside the original input tree. The caller owns recovery and removal; there is no automatic retry, background keeper, or expiry timer.
The existing resource-limited placement requirement still applies to all generated files and retained scratch. The capture byte limit does not impose a writable-disk quota.
A box source gives its sandbox id and `state: 'stopped'` only after the existing native `stop({ wait: true })` operation confirms the whole sandbox stopped. This also stops detached descendants and capture processes still in flight.
This recovery stop has a separate 30-second deadline. If stopped state cannot be confirmed, the checker attempts its normal deletion and returns incomplete retention without a recovery source.
A command transport failure with unknown settlement skips live file capture and takes this same whole-box recovery path.
The caller owns recovery and eventual deletion of a stopped box. Runtime does not resume it, run a keeper, or extend its lifetime.
The Sandbox `maxLifetimeSeconds` setting is a native lifecycle policy, not a guaranteed deletion deadline; suspend and cold-recovery behavior depend on the native driver.
Recovery coordinates are private operational data and must be omitted from public result projections.
When the command succeeded but retention failed, the result is `succeeded: false`, `reason: 'failed'`, and `exitCode: 0`, with `outputs.status: 'incomplete'`. This is an evidence failure, not a negative scientific verdict.
An existing command failure keeps its original reason and exit evidence.
Without `outputs`, the original cleanup behavior is unchanged. A confirmed setup refusal also cleans up normally because no check ran.

Box output capture requires `/usr/bin/python3` with its standard library in the selected environment.
The fixed capture program uses isolated Python startup, directory file descriptors, no-follow opens, regular-file and link checks, bounded reads, and a post-read stability check.
Caller paths are separate arguments and never enter shell source. Missing capture tooling produces explicit incomplete retention.
The local filesystem/CAS tests and direct Python capture tests exercise these byte and path boundaries without claiming Sandbox transport or namespace isolation.
The Linux integration script additionally covers real isolated success, failed commands, timeouts, and source custody on a real filesystem store failure.

### A check in its own box

Pass `box` to run the check in a fresh Sandbox box instead of Bubblewrap on the calling host.
Use this placement when the verdict must not depend on the run it judges.
The run cannot write the check's box, its input, or its verdict.

Any key of a Sandbox account can read, write, and execute in every box of that account.
So the check needs its own key on an account the run holds no key to.
Set `box.client` to a Sandbox client authenticated with that key.
Set `box.builderAccounts` to the `customerId` that `Sandbox.getIdentity()` returns for each Sandbox key the run holds.
The checker refuses before it creates a box when the check key's account is in that list.
Set `box.resources.memoryMB` to request an explicit cgroup memory limit.
When set, the checker refuses advisory memory requests and refuses before upload if the create response does not report a granted memory limit at or below the request.
The API-reported grant is returned as `result.box.memoryMB` after complete input delivery; the checker does not inspect the box's cgroup files.
Set `box.environment` to the environment or image that holds the check's toolchain.

The checker reads the tree's regular files once and records their manifest before it creates the box.
Symbolic links, hard-linked files, and special files are refused; empty directories are not delivered.
The box is created with `createIsolated`, blocked egress, and a new idempotency key.
The checker refuses a box unless its create receipt reports a new box, isolated owner context, and no injected secrets.
Each file is uploaded with its mode, and the digest that the box computes on receipt must match the recorded digest.
The command runs in `tree/` under the box workspace, with only `PATH`, `HOME`, and `LANG` set.
The box is deleted after the command and successful requested retention. Incomplete retention preserves it only after a confirmed whole-box stop, as described above.
The requested lifetime includes setup headroom, but crash recovery and native lifecycle policy remain the placement owner's responsibility; Runtime does not add an automatic deletion service.

The result has the same shape as a Bubblewrap check.
A zero exit returns `succeeded: true`; a nonzero exit or signal returns `reason: 'failed'`.
Both normally mean the check executed and returned a verdict; incomplete requested output retention must be treated as unassessed, as described above.
Every other reason means the check produced no verdict, so the artifact is unassessed.
A box that could not start the executable returns `refused`, not `failed`.
Once the box received its complete input, the result carries `box`: the box id, the check's account, the delivered manifest, and its canonical digest.
Record `box.inputDigest` with the verdict to name the exact bytes the check judged.

The calling process holds the verdict.
Store it where the run cannot write; the run's own record directory does not qualify when the run can reach it.

## Driver attempt evidence

Runtime appends each completed manager driver attempt to the spawn journal before retrying or calling `onDriverAttempt`.
Each `driver-attempt` event retains the error, classification, duration, progress, retry decision, and execution attempt identity when known.
Errors remain bounded and redacted through Runtime's shared error formatter.
The per-node event ordinal continues across coordinator restarts.
Cancellation keeps its terminal outcome and does not remove earlier attempt evidence.
Replay and cost readers treat these events as observations, without settling nodes or charging work again.

### Native transcript evidence

An opted-in Bridge manager forwards its executor's native capture and waits for the independent final read before settlement.
Bridge and provider manager drives and leaf executions retain an `execution-evidence` blob with `kind: 'harness-transcript'`, the exact Runtime node and attempt, the actual input's `taskRef`, an output reference when available, and its transcript receipt.
This includes fresh native sessions, continued sessions, and failed captures; the latest receipt never replaces earlier attempt evidence.
The final root or child receipt describes the latest attempt, so consumers use the journal to account for the whole episode.

Use `readHarnessTranscriptSessions` from the kernel with the journal's exact node and attempt, the run's blob store, and the native parser already owned by the consumer.
It verifies the capture's content address, inventory, retained bytes, exact execution identity, and complete native session family before returning sessions.
An incomplete, unbound, or unavailable capture returns an explicit failure and remains audit evidence.
Runtime does not infer completeness from a projected tool event or a readable transcript file.

The provider backend accepts `harnessTranscript` as a live capture callback.
Runtime reuses the Bridge capture request with the admitted `AgentExactRunControlRef`, host working directory, session and run, profile digest, and node, only after the exact run reports a terminal status.
Use the existing native export and `captureBoundHarnessTranscript`; the callback may keep the Bridge binding or return a provider binding with that exact control reference. Runtime stamps the verified provider control onto accepted evidence. Keep the native parser in its owning library.
Runtime checks the returned control reference, profile, node, session and run bindings before accepting its capture.
The callback has an independent bounded capture signal, so cancellation does not discard an already produced transcript.
Every retained provider invocation writes its receipt before the environment can be reused or deleted, including invocations that ended with a capacity refusal.
Provider-internal retries can produce more than one native conversation; `nativeSessionIds` retains their observed order and the reader verifies every family.
Retained files preserve their original `attribution.nativePath`, separate from the archive's storage layout, so native parsers retain the correct parent and child identities.
Producer-declared install/cache content omissions and credential exclusions stay visible as `omitted` metadata; they are not counted as retained bytes or confused with missing conversation data.
The original archive can also retain binary or configuration files that have no text projection.
Learning readers still require every attested native conversation and its recorded child family, with no parser integrity gaps.

An incomplete configured capture preserves its source environment for recovery; an explicit retained release makes one final capture attempt before deciding whether source custody can end.
That repair writes a new receipt for the same exact invocation, without running the agent again.
A failed durable write also prevents deletion and fails through the existing durable-state guard.
An in-memory capture alone cannot repay a failed durable write.
The normal bounded filesystem fallback remains available when no capture callback is configured, but its unbound scan does not establish complete native coverage.
The legacy steerable provider session does not expose an exact retained execution binding and refuses this capture option instead of silently dropping it.
