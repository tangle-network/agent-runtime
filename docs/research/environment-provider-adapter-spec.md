# Generic environment provider adapter spec

**Status:** draft, evidence checked 2026-06-26 against this repo at `main`.

**Implementation status in this repo:** the runtime provider layer landed in
`src/runtime/environment-provider.ts`. It defines the runtime-facing provider
contract, exports it from `/runtime`, and includes compatibility adapters:

- `providerAsSandboxClient(provider)` so existing `runLoop`/`openSandboxRun`
  paths can run against any provider.
- `sandboxClientAsProvider(client)` so today's Tangle sandbox SDK client is the
  first provider implementation.
- `providerAsExecutor(provider)` so supervise-mode leaves can run a provider
  directly and still report usage through the existing `UsageEvent` channel.
- `createAgentEnvironmentProviderRegistry()` plus
  `createExecutor({ backend: 'provider', provider: 'name', registry })` so
  runtime config can resolve providers by name.

**Shared package status:** the public contract ships in
`@tangle-network/agent-interface@0.14.0` as
`@tangle-network/agent-interface/environment-provider`, and this runtime imports
those shared types directly. The SDK monorepo also contains external provider
packages for Tangle, CLI bridge, ComputeSDK, E2B, Daytona, and shared provider
conformance tests. Provider package publication is still blocked on npm
first-publish permissions/trusted publishing setup, but the code is present in
`/home/drew/code/agent-sdk`.

## Verdict

Yes: we should lift a provider-neutral environment contract above the current
Tangle sandbox SDK shape. The current runtime is close, but third-party
providers would have to pretend to be `SandboxInstance`, a SDK class with
private state, or squeeze through the task-only `Executor` path and lose
sessions/files/exec/fork behavior.

The durable split should be:

1. `@tangle-network/agent-interface` owns shared profile, event, session, and
   environment lifecycle types.
2. `@tangle-network/sandbox` implements those types for Tangle sandboxes and
   keeps its richer SDK methods.
3. `agent-runtime` consumes the neutral provider contract and supplies adapters
   to its existing `SandboxClient` and `Executor` ports during migration.
4. CLI bridge execution is exposed through an external HTTP provider package,
   instead of forcing runtime to edit the bridge repo directly.

This lets E2B, Daytona, a compute SDK, or a local process provider implement
one contract without importing the Tangle sandbox SDK.

## Evidence checked

- Runtime execution code:
  - `src/runtime/types.ts`
  - `src/runtime/run-loop.ts`
  - `src/runtime/sandbox-backend.ts`
  - `src/runtime/sandbox-acquire.ts`
  - `src/runtime/sandbox-lineage.ts`
  - `src/runtime/sandbox-events.ts`
  - `src/runtime/sandbox-capabilities.ts`
  - `src/runtime/inline-sandbox-client.ts`
  - `src/runtime/in-process-sandbox-client.ts`
  - `src/runtime/supervise/runtime.ts`
  - `src/runtime/supervise/types.ts`
  - `src/mcp/in-process-executor.ts`
  - `src/runtime/supervise/worktree-cli-executor.ts`
  - `src/agent/sandbox-act.ts`
- Installed package types:
  - `@tangle-network/sandbox@0.8.2`
  - `@tangle-network/agent-interface@0.14.0`
- SDK packages in `/home/drew/code/agent-sdk`:
  - `@tangle-network/agent-interface/environment-provider`
  - `@tangle-network/agent-provider-testkit`
  - `@tangle-network/agent-provider-tangle`
  - `@tangle-network/agent-provider-cli-bridge`
  - `@tangle-network/agent-provider-computesdk`
  - `@tangle-network/agent-provider-e2b`
  - `@tangle-network/agent-provider-daytona`
- Bridge execution code in `/home/drew/code/cli-bridge`:
  - `src/routes/chat-completions.ts`
  - `src/backends/types.ts`
  - `src/backends/profile-support.ts`
  - `src/backends/sandbox.ts`
  - `src/sessions/store.ts`

Important correction to older research: `AgentProfile` already lives in
`@tangle-network/agent-interface@0.14.0` and is re-exported by
`@tangle-network/sandbox@0.8.2`. The remaining missing shared layer is not
profile shape; it is environment lifecycle, sessions, workspace operations,
and capability reporting.

## AgentProfile decision

Do not change `AgentProfile` for provider selection. It remains the portable
description of who the agent is and what it can use: prompt, model hints,
permissions, tools, MCP, subagents, resources, hooks, modes, confidential
settings, metadata, and extensions.

Provider/runtime choice belongs beside the profile in run config:

```ts
{
  profile,
  target: { provider: 'daytona', backend: 'codex' }
}
```

Provider-specific profile knobs should use the existing extension escape hatch:

```ts
{
  extensions: {
    daytona: { snapshotId: 'snap_123' },
    e2b: { template: 'codex' }
  }
}
```

Each provider must expose `validateProfile(profile)` and capabilities so callers
can see which profile fields are honored before a run starts.

## Current execution map

| Path | Where the agent runs | Current contract | Adapter implication |
|---|---|---|---|
| `runLoop` sandbox path | Managed sandbox | `SandboxClient.create` -> `SandboxInstance.streamPrompt` | Needs neutral create/stream/session/workspace contract. |
| `SandboxLineage` | Managed sandbox with continuation/forking | `box.streamPrompt`, `box.session`, `box.checkpoint`, `box.fork` | Capabilities must say whether sessions, replay, checkpoint, and fork exist. |
| `createSandboxAct` | Managed sandbox | `createSandboxForSpec` then `box.streamPrompt` | Must keep a direct "run this profile in an environment" entry point. |
| `sandboxExecutor` | Managed sandbox via `runLoop` | `Executor.execute` wraps a single sandbox run | Provider should expose an `Executor` view for supervise mode. |
| `routerInlineExecutor` | Direct model call, no workspace | `Executor.execute` | Not an environment provider; keep as a task executor. |
| `routerToolsInlineExecutor` | Host tool loop, no isolated workspace | `Executor.execute` plus `deliver` | Could stay executor-only, or implement a minimal provider with no workspace. |
| `bridgeExecutor` | cli-bridge HTTP session | OpenAI-compatible stream plus stable `session_id` | Should become an environment/session provider for host CLI execution. |
| worktree CLI executor | Local worktree process | `Executor.execute` | Should become a local provider with exec/workspace and limited session support. |
| `SandboxBackend` in cli-bridge | sandbox-api `/batch/run` | Batch task SSE -> OpenAI deltas | Should become a provider adapter over sandbox-api, not a bridge-only special case. |
| in-process sandbox clients | Test/local callback | SDK-shaped fake box | Should move to neutral fake environment; the SDK cast disappears. |

## What is wrong with the current shape

### Runtime has two good ideas, but they are split

`SandboxClient` is box-shaped and supports environment lifecycle, workspace,
sessions, and forking, but it is typed to the Tangle sandbox SDK:

- `CreateSandboxOptions`
- `SandboxInstance`
- `SandboxEvent`

`Executor` is open and provider-neutral enough for router/CLI/sandbox tasks,
but it does not describe environment lifecycle, files, exec, sessions, replay,
or fork. A provider can run a task through it, but cannot expose the richer
environment behavior the runtime already uses.

### `SandboxInstance` is not structurally implementable

The SDK exports `SandboxInstance` as a class with private fields. Local adapters
currently work around this in `in-process-sandbox-client.ts` by casting objects
into `SandboxInstance`. That is acceptable as a local compatibility bridge, but
it is the wrong target for third-party providers.

### Profile execution is provider-owned, but the runtime still builds SDK options

`src/runtime/sandbox-backend.ts` builds `CreateSandboxOptions` by injecting
`backend.profile = profile`. That is correct for Tangle sandbox, but it bakes
one provider's creation shape into the runtime. E2B, Daytona, and plain compute
providers will have different creation inputs and different profile
materialization steps.

### Current capabilities are too narrow

`src/runtime/sandbox-capabilities.ts` only asks whether fork can work through
`criuStatus`. A generic adapter needs feature reporting for:

- profile fields it honors
- live streaming
- reconnect/replay
- stable turn ids
- sessions
- file read/write
- command execution
- repository helpers
- checkpoint/fork
- placement metadata
- usage reporting
- confidential execution support

### The router registry collapses too much into "sandbox"

`createExecutorRegistry` currently maps non-null backend kinds to the sandbox
executor. That was fine with one managed sandbox provider. A provider-capable
runtime needs to resolve a requested runtime/backend to a named provider and
capability set, not collapse every code-agent backend into one sandbox path.

## Proposed shared contract

These types should live in `@tangle-network/agent-interface` because they are
provider-neutral and should be public. Runtime-specific adapters can live in
this repo.

```ts
import type {
  AgentProfile,
  AgentProfileCapabilities,
  InputPart,
  StreamEvent,
  TokenUsage,
} from '@tangle-network/agent-interface'

export interface AgentEnvironmentProvider {
  readonly name: string
  capabilities(): AgentEnvironmentCapabilities | Promise<AgentEnvironmentCapabilities>
  validateProfile?(profile: AgentProfile): AgentProfileValidationResult | Promise<AgentProfileValidationResult>
  create(input: CreateAgentEnvironmentInput): Promise<AgentEnvironment>
  get?(id: string): Promise<AgentEnvironment | null>
  list?(query?: AgentEnvironmentQuery): Promise<AgentEnvironmentSummary[]>
}

export interface CreateAgentEnvironmentInput {
  profile: AgentProfile
  workspace?: WorkspaceRequest
  resources?: ResourceRequest
  env?: Record<string, string>
  secrets?: string[] | Record<string, string>
  metadata?: Record<string, unknown>
  name?: string
  idempotencyKey?: string
  signal?: AbortSignal
  providerOptions?: Record<string, unknown>
}

export interface AgentEnvironment {
  readonly id: string
  readonly provider: string
  readonly name?: string
  status(): Promise<AgentEnvironmentStatus>
  stream(input: AgentTurnInput): AsyncIterable<AgentEnvironmentEvent>
  dispatch?(input: AgentTurnInput): Promise<AgentSessionRef>
  session?(id: string): AgentSession
  read?(path: string, options?: { sessionId?: string }): Promise<string>
  write?(path: string, content: string, options?: { sessionId?: string }): Promise<void>
  exec?(command: string, options?: ExecRequest): Promise<ExecResult>
  checkpoint?(options?: CheckpointRequest): Promise<CheckpointRef>
  fork?(checkpoint: CheckpointRef, options?: ForkRequest): Promise<AgentEnvironment>
  placement?(): Promise<PlacementInfo>
  refresh?(): Promise<void>
  destroy?(): Promise<void>
}

export interface AgentTurnInput {
  prompt?: string
  parts?: InputPart[]
  sessionId?: string
  model?: string
  timeoutMs?: number
  executionId?: string
  lastEventId?: string
  turnId?: string
  detach?: boolean
  context?: Record<string, unknown>
  signal?: AbortSignal
}

export interface AgentSession {
  readonly id: string
  status(): Promise<AgentSessionStatus | null>
  events(options?: { since?: string; signal?: AbortSignal }): AsyncIterable<AgentEnvironmentEvent>
  result(): Promise<AgentTurnResult>
  prompt(input: AgentTurnInput): Promise<AgentTurnResult>
  cancel(): Promise<void>
}

export interface AgentEnvironmentEvent {
  type: string
  data: Record<string, unknown>
  id?: string
  normalized?: StreamEvent
  usage?: TokenUsage
  providerEvent?: unknown
}

export interface AgentEnvironmentCapabilities {
  profile: AgentProfileCapabilities
  streaming: {
    live: boolean
    replay: boolean
    detach: boolean
    turnIdempotency: boolean
  }
  sessions: {
    continue: boolean
    list: boolean
    messages: boolean
  }
  workspace: {
    read: boolean
    write: boolean
    exec: boolean
    git: boolean
    upload: boolean
    download: boolean
  }
  branching: {
    checkpoint: boolean
    fork: boolean
  }
  placement: boolean
  usage: boolean
  confidential: boolean
}
```

The exact names can change, but the shape should keep one rule: the provider
owns materialization and environment behavior; the runtime owns planning,
parallelism, parsing, validation, and cost accounting.

## Adapter views required by runtime

A provider should be adaptable into both existing runtime ports while migration
is in progress:

```ts
export function providerAsSandboxClient(
  provider: AgentEnvironmentProvider,
): SandboxClient

export function providerAsExecutor(
  provider: AgentEnvironmentProvider,
  defaults: CreateAgentEnvironmentInput,
): Executor
```

`providerAsSandboxClient` is compatibility only. New code should consume the
neutral provider contract directly.

## Provider responsibilities

Every provider must own these translations:

1. **Profile materialization**
   - Map `AgentProfile.prompt`, `model`, `tools`, `mcp`, `permissions`,
     `resources`, `hooks`, `modes`, `confidential`, and `extensions` into the
     provider's native setup.
   - Return validation warnings/errors before a run when a field cannot be
     honored.
   - Use `profile.extensions.<providerName>` for non-portable options.

2. **Environment lifecycle**
   - Create, find/reconnect, refresh, and destroy an environment.
   - Support an idempotency key when the provider can, so retries do not create
     duplicate machines.

3. **Session lifecycle**
   - Accept caller-supplied `sessionId` when possible.
   - Return a provider session id.
   - Support status/result/cancel where possible.
   - Report unsupported session features in capabilities, not by silently
     ignoring the field.

4. **Event normalization**
   - Preserve raw provider events.
   - Emit `message.part.updated`, usage, status, and terminal events where the
     provider can.
   - Guarantee that a completed stream has a terminal success/failure signal.

5. **Workspace behavior**
   - Expose read/write/exec when backed by a real workspace.
   - Use capability flags for providers that only run model calls and cannot
     touch files.

6. **Cost and usage**
   - Surface token usage when the provider reports it.
   - Preserve provider-native usage in raw event data for future parsing.

## What each existing component should lift

### Sandbox SDK

Lift these public, neutral types to `agent-interface` or re-export them from
there:

- environment provider
- environment instance
- session
- turn input/result
- environment event
- environment capabilities
- workspace/resource request
- placement summary

Keep these SDK-specific:

- Tangle client configuration
- sandbox-api HTTP routes
- Firecracker/CRIU specifics
- collaboration, preview links, TEE report transport, and other Tangle-only
  capabilities
- rich convenience methods on the SDK class

Then implement `createTangleProvider(client)` that maps:

- `CreateAgentEnvironmentInput` -> `CreateSandboxOptions`
- `AgentTurnInput` -> `PromptOptions`
- `AgentEnvironment` -> `SandboxInstance`
- `AgentSession` -> `SandboxSession`
- capabilities -> `backend.capabilities`, `criuStatus`, and SDK feature probes

### CLI bridge

The bridge already has most of the generic concepts:

- stable caller `session_id`
- backend-owned internal session id
- OpenAI-compatible streaming deltas
- request/session persistence
- `agent_profile` forwarding
- MCP materializers for Claude, Codex, Kimi, and OpenCode
- `execution.kind = 'host' | 'sandbox'`

Lift it by:

1. Importing `AgentProfile` from `@tangle-network/agent-interface`, not the
   sandbox SDK.
2. Adding a provider adapter over the existing `/v1/chat/completions` stream:
   `createCliBridgeProvider({ baseUrl, token })`.
3. Mapping `session_id` to `AgentSession`.
4. Mapping `agent_profile`, `mcp`, `cwd`, `env`, and `execution` into
   `CreateAgentEnvironmentInput`.
5. Treating its sandbox-api backend as just another provider implementation,
   not a separate special path.

The bridge should remain able to serve OpenAI-compatible clients. The provider
adapter is an additional typed entry point, not a replacement for the HTTP API.

### Runtime router

Keep the direct router paths as executors. They do not need to become fake
workspaces.

Change provider resolution so the runtime can distinguish:

- direct model executor
- host CLI provider
- Tangle sandbox provider
- third-party compute provider
- third-party sandbox provider

The legacy `AgentSpec` backend field can keep working, but the new config
should name a provider plus an agent backend. Example:

```ts
type ExecutionTarget =
  | { kind: 'router'; model: string }
  | { kind: 'provider'; provider: string; backend?: string; environment?: string }
```

The runtime should fail fast when a requested behavior needs a capability the
provider does not expose. Examples: a run requiring fork cannot use a provider
with `branching.fork = false`; a run requiring file edits cannot use a
router-only executor.

### Agent profiles

Do not create a new profile type. `AgentProfile` is already the shared behavior
manifest.

Provider choice should live outside the profile in run config. The current
`profile.metadata.backendType` fallback in `sandbox-backend.ts` should become a
compatibility path or move under a provider namespaced extension such as:

```ts
{
  extensions: {
    tangleSandbox: { backendType: 'opencode' }
  }
}
```

The provider must report which profile fields it honors through
`AgentProfileCapabilities` and `validateProfile`.

## Third-party provider model

### Package layout

Providers should be external packages. Runtime core should depend on the shared
contract, not every vendor SDK:

```txt
@tangle-network/agent-interface
@tangle-network/agent-provider-testkit
@tangle-network/agent-provider-tangle
@tangle-network/agent-provider-cli-bridge
@tangle-network/agent-provider-computesdk
@tangle-network/agent-provider-e2b
@tangle-network/agent-provider-daytona
```

`agent-provider-testkit` should own the conformance checks below so community
providers can prove they behave correctly without copying tests from runtime.

### ComputeSDK

ComputeSDK should be the broad adapter. Its value is provider coverage: one
adapter can reach many sandbox/compute backends and give users a fast on-ramp.

Expected mapping:

- ComputeSDK sandbox/session id -> `AgentEnvironment.id`.
- ComputeSDK filesystem APIs -> `read`, `write`, upload/download capability.
- ComputeSDK command execution -> `exec`.
- ComputeSDK provider selection -> `providerOptions`.
- Agent backend startup -> a CLI materializer layered on top of ComputeSDK when
  the selected compute provider does not ship a native agent runtime.

Use this as the default "bring many providers" path. Keep direct adapters for
provider-specific strengths.

### E2B or Daytona

Direct E2B and Daytona adapters should not import `@tangle-network/sandbox`.
They should:

1. Create a machine/workspace through the provider SDK.
2. Clone or mount the requested workspace.
3. Install or start the requested agent backend if the provider does not ship
   one.
4. Materialize `AgentProfile` into files, CLI flags, MCP config, env, and
   permissions.
5. Stream stdout/SSE/native events into `AgentEnvironmentEvent`.
6. Implement read/write/exec through the provider SDK.
7. Report unsupported features, especially checkpoint/fork and event replay.

E2B direct adapter priorities:

- templates and prebuilt images
- command/process streaming
- filesystem operations
- internet access controls
- Codex/CLI agent startup patterns

Daytona direct adapter priorities:

- workspace lifecycle
- filesystem, git, process, and PTY operations
- snapshots/fork where available
- long-lived development environments

### Compute SDK

A compute SDK may provide only lifecycle, files, and exec. That is still useful.
It can compose with a CLI materializer:

- compute SDK creates the machine
- CLI materializer installs/configures the agent backend
- provider adapter streams the process output
- workspace methods delegate to compute SDK files/exec

This makes "bring your own compute" possible without requiring every compute
provider to implement native agent semantics.

## Migration plan

1. **Define neutral provider types**
   - Shared types ship in
     `@tangle-network/agent-interface/environment-provider`.
   - Runtime imports and re-exports those shared types from
     `src/runtime/environment-provider.ts`.
   - Keep the first shared version additive and public.

2. **Implement the Tangle sandbox provider adapter**
   - Runtime adapter exists as `sandboxClientAsProvider`.
   - Keep current `SandboxClient` runtime path through `providerAsSandboxClient`.
   - Add conformance tests that run against the adapter, not the SDK class.

3. **Switch runtime internals to the neutral provider where practical**
   - Start with `sandbox-acquire`, `sandbox-lineage`, and `sandbox-capabilities`.
   - Keep `runLoop` behavior unchanged.
   - Keep old SDK-shaped entry points as compatibility wrappers.

4. **Add the CLI bridge provider adapter**
   - Use stable `session_id`.
   - Preserve usage and final chunks.
   - Validate profile/MCP support by backend.

5. **Update router/provider selection**
   - Provider registry keyed by provider name exists in runtime.
   - `createExecutor({ backend: 'provider', provider: 'name', registry })`
     resolves a named provider without changing `AgentProfile`.

6. **Publish example adapters**
   - `createComputeSdkProvider`
   - `createE2BProvider`
   - `createDaytonaProvider`

7. **Retire casts and duplicate profile imports**
   - Replace in-process fake `SandboxInstance` casts with neutral fake
     environments.
   - Move cli-bridge imports from sandbox SDK to agent-interface.

## Conformance checks

Every provider adapter should pass the same test suite:

| Check | Required for minimum provider | Notes |
|---|---:|---|
| create and destroy environment | yes | Idempotency key required if provider supports it. |
| stream one prompt to terminal event | yes | Must not silently end without status. |
| propagate abort | yes | Stop spending work when caller aborts. |
| preserve raw events | yes | Needed for provider-specific debugging. |
| emit normalized text delta | yes | Can be synthesized from stdout. |
| emit usage when provider reports it | yes | Optional only if provider truly lacks usage. |
| validate unsupported profile fields | yes | Warnings or errors, not silent drops. |
| continue a session | optional | Must be accurately reported. |
| replay events after event id | optional | Required for durable long runs. |
| read/write files | optional | Required for code-editing workflows. |
| exec command | optional | Required for test-running workflows. |
| checkpoint/fork | optional | Required for lineage fanout. |

## Non-goals

- Do not rebuild sandbox SDK stream durability in runtime. The SDK already has
  stable execution ids, last-event replay, turn idempotency, and detach.
- Do not move planning, output parsing, validation, or cost policy into
  providers.
- Do not make direct router calls pretend to have files or shell execution.
- Do not invent another agent profile format.
- Do not require third-party providers to depend on the Tangle sandbox SDK.

## Decisions

1. `AgentEnvironmentProvider` ships from `agent-interface` directly. It is the
   public adapter contract.

2. Profile validation remains optional at the type level but expected for
   provider packages that drop or reinterpret profile fields.

3. The CLI bridge adapter ships as an external package in the SDK monorepo.
   That avoids editing the dirty bridge repo and lets any runtime use it.

4. Provider-specific options use generic `providerOptions` at creation time
   plus `profile.extensions.<providerName>` for profile-bound behavior.

## Bottom line

The core change is not a large rewrite. It is a type and adapter boundary:
move environment/session/workspace vocabulary into the shared public interface,
wrap Tangle sandbox as the first provider, then let runtime, bridge, E2B,
Daytona, and compute providers all meet the same contract.
