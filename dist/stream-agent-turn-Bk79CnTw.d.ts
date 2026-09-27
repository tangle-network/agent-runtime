import { $a as RuntimeStreamEvent, C as ExecutorToolCall, Ca as Validator, Ha as AgentTaskStatus, Pn as ExecutorProgress, Qi as ExecCtx, Tn as TraceSource, Ua as BackendErrorDetail, X as Scope, Y as Runtime, b as ExecutorRegistry, ba as SandboxClient, f as ExecutorCancellation, fa as LoopTokenUsage, g as ExecutorFactory, gt as UsageEvent, p as ExecutorCancellationRequest, rt as Spend, s as DefaultVerdict, vr as UnavailablePausePolicy, y as ExecutorProgressEvent } from "./types-D56jQad-.js";
import { t as AgentCandidateArtifactPort } from "./types-CuXu5zuS.js";
import { AgentCandidateWorkspaceSnapshotEvidence, AgentProfile, AgentProfileMcpServer, AgentProfileValidationResult, HarnessType, ReasoningEffort, StreamEvent } from "@tangle-network/agent-interface";
import { AgentRunOutcome } from "@tangle-network/sandbox/runtime";
import { ChildProcess } from "node:child_process";
import { WorkspacePlanReceipt } from "@tangle-network/agent-profile-materialize";
import { BackendType, CreateSandboxOptions, PromptOptions, Sandbox, SandboxEvent, SandboxInstance } from "@tangle-network/sandbox";
import { AgentEnvironment, AgentEnvironment as AgentEnvironment$1, AgentEnvironmentCapabilities, AgentEnvironmentCapabilities as AgentEnvironmentCapabilities$1, AgentEnvironmentEvent, AgentEnvironmentEvent as AgentEnvironmentEvent$1, AgentEnvironmentProvider, AgentEnvironmentProvider as AgentEnvironmentProvider$1, AgentEnvironmentQuery, AgentEnvironmentStatus, AgentEnvironmentSummary, AgentProfileRef, AgentProfileRef as AgentProfileRef$1, AgentSession, AgentSessionRef, AgentSessionStatus as AgentSessionStatus$1, AgentTurnInput, AgentTurnInput as AgentTurnInput$1, AgentTurnResult as AgentTurnResult$2, CheckpointRef, CheckpointRequest, CreateAgentEnvironmentInput, CreateAgentEnvironmentInput as CreateAgentEnvironmentInput$1, ExecRequest, ExecResult, ForkRequest, PlacementInfo, ResourceRequest, WorkspaceRequest } from "@tangle-network/agent-interface/environment-provider";
//#region src/redact.d.ts
/**
 * Redaction for values that may leave the Runtime process. The built-in
 * redactor is agent-eval's redaction core (`@tangle-network/agent-eval/traces`,
 * default profile): credentials found by field name or value shape are
 * replaced whole, email, card, SSN and phone values in place, and token counts
 * such as `inputTokens` or `max_tokens` are kept. A customer with
 * domain-specific PII supplies their own `redact` hook.
 *
 * This is narrower than `src/sanitize.ts`, which drops fields of the runtime's
 * *event envelope* unless the caller opts in: here the value is opaque customer
 * payload, so the scrub is value-shaped, not schema-shaped.
 *
 * @experimental
 */
/** A redactor maps an arbitrary trace value to a safe-to-export value. Pure;
 *  must not throw on cyclic input (the default tolerates cycles). */
type Redactor = (value: unknown) => unknown;
/**
 * The built-in redactor. Cycle-safe, depth-bounded and total: it never throws
 * on customer input and never mutates it.
 */
declare function defaultRedactor(value: unknown): unknown;
/**
 * Resolve the redactor a client uses. A caller-supplied hook handles
 * domain-specific values first, then the built-in scrubber still removes
 * credentials and personal data. Returning `false` is the explicit opt-out for
 * already-reviewed public values.
 */
declare function resolveRedactor(redact: Redactor | false | undefined): Redactor;
//#endregion
//#region src/mcp/protocol.d.ts
/**
 * Shared wire contracts for the in-process stdio MCP servers.
 *
 * Keeping these types in one module prevents the delegation and generic tool
 * servers from accepting subtly different JSON-RPC messages.
 *
 * @experimental
 */
/**
 * MCP tool annotations (protocol 2025-03-26 and later). Hints a client reads
 * before calling, for example to run a read-only tool without confirmation.
 * They describe the tool; they do not enforce anything. @experimental
 */
interface McpToolAnnotations {
  title?: string;
  /** The tool does not modify its environment. */
  readOnlyHint?: boolean;
  /** The tool may perform destructive updates. Meaningful only when not read-only. */
  destructiveHint?: boolean;
  /** Repeating a call with the same arguments has no additional effect. */
  idempotentHint?: boolean;
  /** The tool may reach entities outside its own data, such as the web. */
  openWorldHint?: boolean;
}
/** A callable MCP tool exposed by either stdio server. @experimental */
interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Published in `tools/list` when present. */
  annotations?: McpToolAnnotations;
  handler: (raw: unknown) => Promise<unknown>;
}
/** Stdio-shaped transport used by the shared JSON-RPC server implementation. @experimental */
interface McpTransport {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}
/** One JSON-RPC 2.0 request or notification. @experimental */
interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: unknown;
}
/** One JSON-RPC 2.0 response. @experimental */
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}
//#endregion
//#region src/runtime/supervise/peer-mail.d.ts
/**
 * What one envelope IS, typed so a reader can act on it without parsing prose.
 *
 *  - `ask` — request a fact the sender lacks; expects an `answer`.
 *  - `tell` — share a result; MUST carry evidence refs.
 *  - `challenge` — dispute a peer's claim; MUST cite the refs of the claim it disputes.
 *  - `answer` — reply to an `ask` or a `challenge`.
 */
type PeerMailKind = 'ask' | 'tell' | 'challenge' | 'answer';
/** One admitted peer message. `threadId` is the root mail's id; `depth` is 0 for a root mail and
 *  one more than its parent for a reply, which is what the reply-depth cap counts. */
interface PeerMailEnvelope {
  readonly mailId: string;
  readonly threadId: string;
  readonly depth: number;
  /** The bound sender — resolved from the capability, never from a tool argument. */
  readonly from: string;
  readonly to: string;
  readonly kind: PeerMailKind;
  readonly subject: string;
  readonly body: string;
  /** Evidence the receiver can re-check for itself. Required for `tell` and `challenge`. */
  readonly evidenceRefs: ReadonlyArray<string>;
  /** The mail id this replies to. Never a coordination question id — a peer cannot address the
   *  parent's answer channel. */
  readonly replyTo?: string;
  readonly at: number;
}
/** Why an attempt did not reach a sibling. Each value is a fact the sender can read and act on. */
type PeerMailRefusal = 'sender-unbound' | 'self-addressed' | 'send-quota-exhausted' | 'mailbox-full' | 'thread-depth-exceeded' | 'thread-stopped' | 'unknown-reply-target' | 'evidence-required' | 'subject-too-large' | 'body-too-large' | 'forged-authority' | 'unknown-worker' | 'already-settled' | 'worker-has-no-inbox' | 'scope-stopped' | 'runtime-error';
type PeerMailOutcome = 'delivered' | PeerMailRefusal;
/** The audit record for one attempt — published whether it delivered or was refused, because a
 *  refused attempt is exactly what a parent auditing a channel needs to see. */
interface PeerMailEvent {
  readonly envelope: PeerMailEnvelope;
  readonly delivered: boolean;
  readonly outcome: PeerMailOutcome;
  /** Canonical digest of the exact admitted body, so a later claim can name the bytes it read. */
  readonly bodyDigest: string;
  readonly error?: string;
}
/** Hard bounds. Every one fails closed with a refusal the sender can read. */
interface PeerMailLimits {
  /** Mail one worker may attempt to send for the whole run. */
  readonly maxSentPerWorker: number;
  /** Mail one worker may receive for the whole run. */
  readonly maxInboxPerWorker: number;
  /** Total admitted body bytes one worker may receive for the whole run. */
  readonly maxInboxBytesPerWorker: number;
  /** Maximum reply depth; a root mail is depth 0, so `2` allows ask → answer → answer. */
  readonly maxThreadDepth: number;
  readonly maxBodyBytes: number;
  readonly maxSubjectBytes: number;
}
/** Bounds chosen so a peer channel cannot become the dominant cost of a run: eight sends and
 *  sixteen receives per worker, 32 KiB of received body, and a reply chain that terminates. */
declare const DEFAULT_PEER_MAIL_LIMITS: PeerMailLimits;
/**
 * Phrases that mark the run's AUTHORITY in a folded prompt. A peer that writes one of these is
 * trying to speak as the supervisor, so intake refuses the envelope outright.
 *
 * The render-time fence in the inbox is the second half of this defence and neither half is
 * sufficient alone: a fence loses to a body that closes it, and an intake filter loses to a body
 * that invents a new authority phrase. Together they make forgery mechanically detectable and give
 * the standing prompt one concrete boundary to bind to. Neither makes a model OBEY a boundary.
 */
declare const AUTHORITY_MARKERS: ReadonlyArray<string>;
/** The wire property carrying an envelope to a worker inbox. Deliberately its OWN discriminant:
 *  reusing `steer`/`answer` would let a peer mint a message on the parent's channels. */
declare const PEER_MAIL_WIRE_KEY = "mail";
/** The tool names a mail capability endpoint serves. It serves NOTHING else. */
declare const peerMailVerbNames: readonly ["send_mail", "read_mail"];
/** What a worker sees when it reads its own mailbox. */
interface PeerMailReadout {
  /** The reading worker's own id, so a worker can address a reply correctly. */
  readonly you: string;
  /** Every envelope admitted to this worker so far, oldest first. */
  readonly inbox: ReadonlyArray<PeerMailEnvelope>;
  /** Live siblings this worker may write to (itself excluded). Without this a worker knows no
   *  peer's id and the channel is unusable. */
  readonly peers: ReadonlyArray<{
    readonly workerId: string;
    readonly label: string;
  }>;
  readonly sent: number;
  /** Sends still allowed, or `null` when this run set no send quota. */
  readonly sendQuotaLeft: number | null;
  readonly limits: PeerMailLimits;
}
interface PeerMailSendInput {
  readonly to: unknown;
  readonly kind: unknown;
  readonly subject: unknown;
  readonly body: unknown;
  readonly evidenceRefs?: unknown;
  readonly replyTo?: unknown;
}
interface PeerMailbox {
  readonly limits: PeerMailLimits;
  /**
   * Publish the base URL of the capability listener once it has a port. Until it is set no spawn
   * receives a mail endpoint: a capability nobody can reach is not worth handing out, and a URL
   * built from an unassigned port would be a lie.
   */
  setEndpoint(baseUrl: string): void;
  /** Mint (idempotently, per assignment) the capability URL for one spawn. Undefined before the
   *  listener has published its endpoint. */
  mintCapability(assignmentId: string): string | undefined;
  /** Bind a minted capability to the concrete worker the spawn produced. Until this runs the
   *  capability can send nothing. */
  bindCapability(assignmentId: string, workerId: string): void;
  /** Resolve the capability path segment carried in a request URL. */
  hasCapability(capabilityId: string): boolean;
  /** The two tools a single capability serves, with the sender closed over. */
  tools(capabilityId: string): McpToolDescriptor[];
  send(capabilityId: string, input: PeerMailSendInput): Promise<PeerMailEvent>;
  read(capabilityId: string): PeerMailReadout;
  /** The parent's control: refuse every further mail on one thread. Returns false when the thread
   *  was already stopped. Mail already delivered is not recalled — this stops the next reply. */
  stopThread(threadId: string): boolean;
  /** Every attempt in order — delivered and refused alike. */
  history(): ReadonlyArray<PeerMailEvent>;
}
interface PeerMailboxOptions {
  readonly scope: Scope<unknown>;
  /** Publish one attempt as a coordination event. Awaited, so a durable subscriber commits the
   *  record before the sender learns the outcome. */
  readonly publish: (event: PeerMailEvent) => Promise<void>;
  readonly limits?: Partial<PeerMailLimits>;
  readonly now?: () => number;
}
/** True when `text` carries a phrase reserved for the run's authority. Case-insensitive, because
 *  the render is read by a model and case is not what distinguishes an instruction. */
declare function claimsAuthority(text: string): boolean;
/** True when `value` is an envelope this runtime produced. The worker inbox parses with this, so a
 *  malformed or partial wire object is discarded rather than rendered as a peer message. */
declare function isPeerMailEnvelope(value: unknown): value is PeerMailEnvelope;
/** Create the run's post office. One per manager scope; the manager's siblings are its addresses. */
declare function createPeerMailbox(opts: PeerMailboxOptions): PeerMailbox;
/**
 * The two tools ONE capability serves. `capabilityId` is closed over and `from` is not a parameter,
 * so the endpoint a worker holds can only ever speak as that worker. The descriptions carry the
 * authority rule, because the receiving model reads them as part of the channel's contract.
 */
declare function peerMailTools(mailbox: PeerMailbox, capabilityId: string): McpToolDescriptor[];
//#endregion
//#region src/runtime/router-retry-policy.d.ts
/** Exact retry controls accepted at `AgentProfile.model.metadata.retry`. */
interface RouterRetryPolicy {
  /** Total attempts, including the first request. */
  readonly maxAttempts?: number;
  /** Delay before the second attempt. Later delays grow exponentially. */
  readonly initialBackoffMs?: number;
  /** Maximum delay between attempts. */
  readonly maxBackoffMs?: number;
  /** Symmetric random variation around each delay, from 0 through 1. */
  readonly jitter?: number;
  /** HTTP statuses that may be retried. */
  readonly retryStatuses?: ReadonlyArray<number>;
  /** Deadline for receiving one attempt's response headers. Zero disables it. */
  readonly requestTimeoutMs?: number;
}
//#endregion
//#region src/runtime/tool-loop.d.ts
/** Provider-neutral conversation record accepted by a tool-loop brain. */
type ToolLoopMessageRecord = Record<string, unknown>;
/** One provider-neutral tool request emitted by a tool-loop model. */
interface ToolLoopToolCall {
  id: string;
  name: string;
  /** Raw JSON arguments emitted by the model. */
  arguments: string;
}
/** Runtime-owned identity and cancellation for one logical inference call. The wrapper is frozen
 * before dispatch; a transport may observe the signal but cannot replace the authority it names. */
interface ToolLoopCallContext {
  readonly signal: AbortSignal;
  readonly callId: string;
  readonly correlationId: string;
}
/** One inference turn over the running conversation + the tool specs → the model's text, any
 *  tool calls, and token usage. The seam every brain satisfies. */
type ToolLoopChat = (messages: ReadonlyArray<ToolLoopMessageRecord>, tools: ReadonlyArray<ToolSpec>, context?: ToolLoopCallContext) => Promise<{
  content?: string | null;
  toolCalls: ToolLoopToolCall[];
  usage?: {
    input: number;
    output: number;
    reasoning?: number;
  };
  /** Caller-measured resource totals for this turn; omission makes enforced dimensions unknown. */
  resources?: Spend['resources'];
  /** Dollar value reported for the turn. It is not billed spend unless provenance says so. */
  costUsd?: number;
  costProvenance?: 'provider-receipt' | 'billing-receipt' | 'catalog-estimate';
  /** The turn ran but its usage was not reported when the transport EXPECTED one (the streamed
   *  router transport asks for usage and this says it never arrived). A metering caller records an
   *  unknown turn on it; `runBrainLoop` itself ignores it. */
  usageUnknown?: true;
  /** Provider-observed model identity. Profile-bound callers validate it before accepting output. */
  model?: string;
  /** Provider-reported prompt-cache evidence; missing fields remain missing. */
  promptCache?: Readonly<Record<string, number | string>>;
  /** Physical HTTP/injected-transport attempts spent by this one logical call. */
  transportAttempts?: number;
}>;
/** Self-compaction — bound the loop's OWN context window the way a fresh-respawn (dumb-Ralph) loop
 *  does, but in place. A stateless chat API re-sends the WHOLE running conversation every turn, so an
 *  agent that accumulates dozens of turns of tool results re-bills its entire transcript on every
 *  inference — the context-overflow-one-level-up that the conserved budget pool cannot fix. With
 *  compaction set, once the conversation exceeds `thresholdTokens` the accumulated middle (every prior
 *  assistant turn + tool result) is distilled into ONE compact progress note and the conversation is
 *  reset to `[...head, digest]`: the preserved head (system + the original task) survives, the stale
 *  turn-by-turn history does not. The model keeps deciding; it stops re-billing the whole transcript.
 *  Fires at a CLEAN turn boundary (after a turn's tool results are folded in, before the next
 *  inference) so it never orphans an assistant `tool_calls` from its `tool` replies. */
interface ToolLoopCompaction {
  /** Compact once the estimated token count of the conversation exceeds this. */
  readonly thresholdTokens: number;
  /** Distill the conversation into a compact progress note that REPLACES the middle. Receives the
   *  full conversation (so it can summarize everything done so far); returns the digest string. */
  readonly distill: (messages: ReadonlyArray<ToolLoopMessageRecord>) => Promise<string> | string;
  /** Leading messages preserved verbatim (system + the original task). Default 2. */
  readonly preserveHead?: number;
  /** Token estimator over the conversation. Default ≈ chars/4 (incl. tool-call arguments). */
  readonly estimateTokens?: (messages: ReadonlyArray<ToolLoopMessageRecord>) => number;
  /** Notified each time a compaction fires — for observability/metering. */
  readonly onCompact?: (info: {
    turn: number;
    beforeTokens: number;
    afterTokens: number;
  }) => void;
}
/** Public supervisor-facing compaction config: same knobs as the primitive, but `distill` is optional
 *  because the supervisor has a default digest that combines a brain note with live worker state. */
type ToolLoopCompactionOptions = Omit<ToolLoopCompaction, 'distill'> & {
  readonly distill?: ToolLoopCompaction['distill'];
};
//#endregion
//#region src/runtime/router-client.d.ts
/**
 * Connection details for Runtime's Router-backed executors.
 *
 * This is deliberately transport-only: model, prompt, tools, generation settings, and retry
 * policy belong to the exact executable `AgentProfile` consumed by `streamAgentTurn`.
 */
interface RouterTransportConfig {
  routerBaseUrl: string;
  routerKey: string;
  /** Injectable OpenAI-compatible transport. Optional usage.resources carries measured turn totals. */
  complete?: (body: Record<string, unknown>, request?: {
    readonly headers: Readonly<Record<string, string>>;
    readonly signal?: AbortSignal;
  }) => Promise<unknown>;
}
/**
 * Private request configuration used by Runtime's Router adapter.
 *
 * Do not export this through a package entry point. Public callers execute a concrete
 * `AgentProfile` through `createExecutor` + `streamAgentTurn`; only Runtime may lower that profile
 * into these provider request fields.
 */
interface RouterConfig extends RouterTransportConfig {
  model: string;
  /** Exact retry controls lowered from `AgentProfile.model.metadata.retry`. */
  retry?: RouterRetryPolicy;
  /**
   * Optional ceiling for one completion, forwarded as `max_tokens`.
   *
   * A REASONING model spends this budget on hidden thinking BEFORE it emits a visible token, so
   * the default can truncate one mid-thought and return no content at all — observed live with a
   * model that spent 8,188 of the 8,192 on reasoning and answered with nothing. Raise it for a
   * thinking model; the ceiling belongs to the router and model a caller chose, which is why it
   * lives here rather than on one call site.
   */
  maxTokens?: number;
  /**
   * Optional ceiling on TOTAL completion tokens — visible answer plus hidden reasoning —
   * forwarded as `max_completion_tokens`. Distinct from `maxTokens`: a reasoning model can spend
   * an entire `max_tokens` budget on hidden thinking, so only this field bounds what the provider
   * bills for one completion.
   */
  maxCompletionTokens?: number;
  /**
   * Take the tool-calling completion over SSE instead of one buffered POST. Off by default —
   * `routerChatWithTools` never streams, and every existing caller keeps the buffered transport
   * byte for byte.
   *
   * Why it exists: a buffered POST holds one connection idle for the WHOLE completion, and a
   * supervisor turn is the longest completion in the system. An intermediary gateway with an
   * idle-read timeout kills that connection mid-completion (the 524/503 family). A streamed
   * response puts bytes on the wire from the first generated token on, so the connection is only
   * idle through prefill. It does NOT shorten prefill, so a gateway whose deadline is
   * time-to-FIRST-byte is unaffected; only an idle-timeout gateway is.
   *
   * Mutually exclusive with `complete`: the injected transport returns one parsed JSON body and has
   * no stream to read, so setting both throws rather than silently taking the buffered path.
   *
   * WHICH PATHS CAN OPT IN. This flag is read in exactly one place (the private `chatWithTools` transport switch), so
   * every entry point that takes a caller-supplied `RouterConfig` honors it: `routerBrain`,
   * `routerToolLoop`, and `supervisorAgent` (which spreads `deps.router` into the brain's config —
   * the supervisor turn this exists for). Two production call sites build a `RouterConfig` literal
   * from their own options and therefore CANNOT express it today: the bench strategy's
   * `routerToolLoop` config in `strategy.ts` and the local sandbox client's `routerBrain` config in
   * `local-sandbox-client.ts`. Neither drives a supervisor-length turn; setting `stream` on a
   * config handed to either has no path to reach them, and they stay buffered.
   */
  stream?: boolean;
}
interface ToolSpec {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: unknown;
  };
}
//#endregion
//#region src/mcp/local-harness.d.ts
/**
 * Local coding harness available inside the sandbox — a narrowing of the shared `HarnessType`
 * vocabulary, NOT a private spelling of it. The harness id is `claude-code`; `claude` is the
 * EXECUTABLE name and lives only in the `command` field below. Keeping one vocabulary is what
 * lets a `LocalHarness` be handed straight to the profile materializer and the capability table
 * with no translation step.
 */
type LocalHarness = Extract<HarnessType, 'claude-code' | 'codex' | 'opencode' | 'pi'>;
/** Every local harness, in table order — the one list `AGENT_RUNTIME_LOCAL_HARNESSES` and any
 *  other harness enumeration reads, so adding a row above is the only edit a new harness needs. */
declare const LOCAL_HARNESSES: ReadonlyArray<LocalHarness>;
/** The harness a caller gets when it expresses no preference. A composition-root default, not a
 *  capability claim: one constant so the several entry points cannot drift apart. */
declare const DEFAULT_LOCAL_HARNESS: LocalHarness;
/** The CLI binary a harness id runs. The two are NOT the same string (`claude-code` runs `claude`),
 *  so anything spawning a harness — a version probe, a login check — reads it from here rather than
 *  passing the harness id as a command. */
declare function localHarnessExecutable(harness: LocalHarness): string;
/**
 * Whether the harness's native control can express this reasoning effort. Admission checks read
 * this so a profile the invocation would later refuse is rejected BEFORE any workspace state is
 * created, against the same table that emits the argv.
 */
declare function harnessSupportsReasoningEffort(harness: LocalHarness, reasoningEffort: ReasoningEffort): boolean;
/** @experimental */
interface RunLocalHarnessOptions {
  harness: LocalHarness;
  /** Working directory for the subprocess (typically a worktree path). */
  cwd: string;
  /** Prompt forwarded as the harness CLI's task argument. */
  taskPrompt: string;
  /**
   * Pre-built command + args (e.g. from `harnessInvocation` so the full authored
   * `AgentProfile` — systemPrompt + model — reaches the harness). When set it OVERRIDES the
   * default prompt-only `buildArgs(taskPrompt)` path; `command` defaults to the harness's
   * default binary when only `args` is supplied. When absent the legacy prompt-only shape
   * is used unchanged.
   */
  invocation?: {
    command?: string;
    args: ReadonlyArray<string>;
  };
  /** Allow autonomous edits without an interactive approval gate, using whichever bypass argv the
   *  harness declares. Use only when `cwd` is an isolated candidate worktree. */
  dangerouslySkipPermissions?: boolean;
  /** Isolate Codex from ambient configuration/instructions and require JSONL token usage.
   *  The invocation should come from `harnessInvocation(..., { codexReproducible: true })`. */
  codexReproducible?: boolean;
  /** Absolute host paths that reproducible Codex must not read. The normalized set is compiled
   *  into the controlled permission profile and its digest is returned in execution evidence. */
  codexReadDeniedPaths?: ReadonlyArray<string>;
  /** Optional wall-clock kill deadline (ms). Omit it for no timer. A positive value sends
   *  SIGTERM on expiry. */
  timeoutMs?: number;
  /** Newest stdout/stderr bytes retained per stream. Default 64 MiB. */
  maxOutputBytes?: number;
  /** Caller cancellation. SIGTERM is sent on abort. */
  signal?: AbortSignal;
  /** Override env (defaults to inheriting from the parent). */
  env?: NodeJS.ProcessEnv;
  /**
   * Test seam — inject a custom spawner so unit tests can mock the
   * subprocess without touching the OS. Defaults to node's `child_process.spawn`.
   */
  spawn?: (command: string, args: ReadonlyArray<string>, opts: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdio: 'pipe';
    detached: boolean;
  }) => ChildProcess;
  /** Test seam for locating the native Codex executable before it is staged in the worktree. */
  resolveCodexExecutable?: (command: string, env: NodeJS.ProcessEnv) => Promise<string>;
}
/**
 * Exact aggregate usage emitted by Codex's terminal `turn.completed` JSONL event.
 *
 * `cachedInputTokens` is a part of `inputTokens` and `reasoningOutputTokens` is a part of
 * `outputTokens`; neither adds to the total it describes. `cacheWriteInputTokens` is optional
 * because the codex CLI reports it and a provider-normalized capture omits it, and an absent
 * counter must stay absent rather than become a zero that claims no cache write was measured.
 */
interface CodexTokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  cacheWriteInputTokens?: number;
}
/** Isolation settings asserted before a reproducible Codex run is allowed to start. */
interface CodexExecutionPolicy {
  sessionPersistence: 'ephemeral';
  userConfig: false;
  rules: false;
  projectInstructions: false;
  skillInstructions: false;
  appInstructions: false;
  toolSuggestions: false;
  multiAgentInstructions: false;
  sandbox: 'workspace-write';
  permissionProfile: 'agent_runtime_reproducible';
  approvalPolicy: 'never';
  shellNetwork: false;
  webSearch: false;
  serviceTier: 'default';
  shellEnvironment: 'core-filtered';
  loginShell: false;
  credentialsReadable: false;
  hostHomeReadable: false;
  procEnvironment: 'private-sanitized';
  sensitiveEnvironmentNamesVisible: false;
  parentRepoRead: false;
  gitMetadata: false;
  temporaryDirectory: 'workspace-private';
  stagedExecutable: 'static-elf-read-only';
  callerReadDeniedPaths: 'enforced';
  containerSockets: false;
}
/** Zero-model-call evidence for the exact Codex process about to run. */
interface CodexExecutionEvidence {
  cliVersion: string;
  executableSha256: string;
  /** SHA-256 of the exact composed prompt argument proved present in the rendered prompt. */
  requestedPromptSha256: string;
  effectivePromptSha256: string;
  nonPromptArgsSha256: string;
  controlledConfigSha256: string;
  /** Sorted normalized paths compiled into the permission profile. */
  readDeniedPaths: string[];
  readDeniedPathsSha256: string;
  readDeniedPathCount: number;
  policy: CodexExecutionPolicy;
}
/** @experimental */
interface LocalHarnessResult {
  /** OS exit code. `null` when killed before exit. */
  exitCode: number | null;
  /** Concatenated stdout. */
  stdout: string;
  /** Concatenated stderr. */
  stderr: string;
  /** Set when the process exited via signal (timeout / abort). */
  killedBySignal: NodeJS.Signals | null;
  /** Wall-clock duration ms (spawn → exit). */
  durationMs: number;
  /** Set when timeoutMs elapsed before exit. */
  timedOut: boolean;
  /**
   * Set when the caller's AbortSignal fired before this result settled.
   * Optional so injected runners and stored results from older releases remain valid.
   */
  aborted?: boolean;
  /** Present for a reproducible Codex run; parsed from the real terminal JSONL event. */
  usage?: CodexTokenUsage;
  /** Present for reproducible Codex runs; generated and checked before model execution. */
  evidence?: CodexExecutionEvidence;
}
/**
 * Spawn a local coding harness CLI as a subprocess + collect its output.
 *
 * NOT responsible for parsing the harness's output or extracting a diff —
 * the in-process executor's `streamPrompt` orchestrates `git diff` against
 * the worktree after this resolves. This function is intentionally narrow:
 * spawn, wait, capture, return.
 *
 * Fails loud — throws when:
 *   - `cwd` doesn't exist (subprocess emits ENOENT; surfaced as Error)
 *   - the harness binary is not on PATH (ENOENT)
 *   - the caller signal was already aborted before process launch
 *
 * Does NOT throw when:
 *   - the subprocess exits non-zero (`result.exitCode` carries the code)
 *   - a non-reproducible subprocess is aborted / timed out (`result.aborted` /
 *     `result.timedOut` carries the reason even when a TERM-aware child exits zero)
 *
 * Reproducible Codex additionally requires a terminal usage event. If cancellation
 * prevents that event, this rejects with `CodexExecutionDiagnosticError` instead of
 * returning an incomplete reproducibility receipt.
 *
 * @experimental
 */
declare function runLocalHarness(options: RunLocalHarnessOptions): Promise<LocalHarnessResult>;
/**
 * Parse and validate the one terminal usage event emitted by `codex exec --json`.
 *
 * The JSONL framing is this surface's own; the usage RECORD is read by `parseCodexUsageRecord`,
 * the one codex usage reader the sandbox decoder also calls, so both surfaces hold the same field
 * policy and the same two cross-field invariants.
 */
declare function parseCodexTokenUsage(stdout: string): CodexTokenUsage;
//#endregion
//#region src/mcp/worktree.d.ts
/**
 *
 * Git worktree helpers for the in-process delegation executor. Each
 * delegation runs in its own worktree so multiple parallel harness
 * subprocesses (claude / codex / opencode in a 3-way fanout) don't clobber
 * each other's edits on the shared workspace.
 *
 * Worktrees live under `<repoRoot>/.agent-worktrees/<runId>/`. After the
 * harness exits + the diff is captured, the worktree is removed.
 *
 * All operations spawn `git` via `child_process.spawn` synchronously
 * (via a `runGit` helper). Stays narrow on purpose: no commits, no rebases.
 * Diff capture stages all changes (`git add -A`) into the ephemeral worktree's
 * index so created (untracked) files appear in the `--cached` diff.
 *
 * @experimental
 */
/** @experimental */
interface WorktreeHandle {
  /** Absolute path to the worktree directory. */
  path: string;
  /** SHA the worktree was created at. */
  baseSha: string;
  /** Branch name created for this worktree (typically `delegate/<runId>`). */
  branch: string;
}
/** @experimental */
interface CreateWorktreeOptions {
  /** Absolute path to the main git checkout. */
  repoRoot: string;
  /** Unique id for the worktree path + branch. Use the delegation run id. */
  runId: string;
  /** Parent directory the worktree lives under. Defaults to `.agent-worktrees`. */
  variantsDir?: string;
  /** Override the base ref (default `HEAD`). */
  baseRef?: string;
  /** Test seam — inject a custom git runner. */
  runGit?: GitRunner;
}
/** @experimental */
interface DiffOptions {
  /** Worktree to diff. */
  worktree: WorktreeHandle;
  /** What to compare against. Default `worktree.baseSha`. */
  baseRef?: string;
  /**
   * Repository-relative input paths to omit from the captured worker patch.
   * Paths are passed to Git with literal exclusion magic, so profile-provided
   * `*`, `?`, `[` and `:` characters can never expand into broader pathspecs.
   */
  excludePaths?: ReadonlyArray<string>;
  /** Test seam. */
  runGit?: GitRunner;
}
/** @experimental */
interface DiffResult {
  patch: string;
  stats: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
}
/** @experimental */
interface RemoveWorktreeOptions {
  worktree: WorktreeHandle;
  repoRoot: string;
  /** Force removal even if dirty (default true; the loser of a fanout has uncommitted changes). */
  force?: boolean;
  /** Test seam. */
  runGit?: GitRunner;
}
/** Pluggable git runner (sync) — replaceable in tests. */
type GitRunner = (args: ReadonlyArray<string>, opts: {
  cwd: string;
}) => {
  stdout: string;
  stderr: string;
  exitCode: number;
};
/** Checkout a fresh git worktree for a delegation run on a new branch under `variantsDir`. @experimental */
declare function createWorktree(options: CreateWorktreeOptions): Promise<WorktreeHandle>;
/** Stage worker changes and return the diff + shortstat, excluding declared input paths. @experimental */
declare function captureWorktreeDiff(options: DiffOptions): Promise<DiffResult>;
/**
 * Remove a git worktree and delete its branch. Already-removed paths are harmless; every other
 * Git failure rejects so callers cannot report a worktree as destroyed when cleanup failed.
 * @experimental
 */
declare function removeWorktree(options: RemoveWorktreeOptions): Promise<void>;
//#endregion
//#region src/mcp/worktree-harness.d.ts
/** Outcome of one verification command run in the worktree (test or typecheck). */
interface WorktreeCommandResult {
  /** The shell command line that was run. */
  command: string;
  /** Did the command exit 0? The PASS signal a deliverable gate / coder output reads. */
  passed: boolean;
  /** OS exit code, or `null` when killed before exit. */
  exitCode: number | null;
  /** Combined stdout+stderr (capped) — surfaced in traces for diagnosis. */
  output: string;
}
/** Proof of the profile inputs delivered before the worker process started. */
interface WorktreeProfileMaterializationReceipt {
  /** Digest of the exact materializer plan: files, modes, environment, flags, and unsupported rows. */
  workspacePlanDigest: string;
  /** Repository-relative profile input files written into the worker worktree. */
  writtenPaths: string[];
  /** Must be empty on a successful run because this path fails closed. */
  unsupported: WorkspacePlanReceipt['unsupported'];
  /** Environment variable names added to the worker process. Values remain out of telemetry. */
  environmentNames: string[];
  /** Exact additional CLI arguments emitted by the materializer. */
  flags: string[];
  /** `resources.instructions` bypasses native project files so reproducible Codex cannot drop it. */
  resourceInstructions: {
    delivery: 'none' | 'invocation-prompt';
    sha256: string | null;
    byteLength: number;
  };
}
/** The canonical result of one worktree-harness run, projected by each port to its own shape. */
interface WorktreeHarnessResult {
  /** The branch the worktree was cut on (`delegate/<runId>`). */
  branch: string;
  /** `git diff` of the worktree against its base — the unified patch the harness produced. */
  patch: string;
  /** Shortstat-derived change counts. */
  stats: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
  /**
   * Exact profile materialization applied before the harness launched.
   * Absent on transports that cannot return a materializer receipt; never fabricated.
   */
  profileMaterialization?: WorktreeProfileMaterializationReceipt;
  /** The harness subprocess outcome. */
  harness: {
    name: LocalHarness | 'bridge';
    exitCode: number | null;
    timedOut: boolean;
    killedBySignal: NodeJS.Signals | null;
    durationMs: number;
    stdout: string;
    stderr: string;
    /** Exact Codex JSONL usage when reproducible mode is enabled. */
    usage?: CodexTokenUsage;
    /** Installed CLI version captured immediately before execution. */
    cliVersion?: string;
    /** SHA-256 of the native Codex executable staged read-only in the candidate worktree. */
    executableSha256?: string;
    /** SHA-256 of the exact composed prompt argument proved present in Codex's rendered prompt. */
    requestedPromptSha256?: string;
    /** SHA-256 of `codex debug prompt-input` output for the exact isolated prompt. */
    effectivePromptSha256?: string;
    /** SHA-256 of the exact executable + argv with prompt content replaced by `<PROMPT>`. */
    nonPromptArgsSha256?: string;
    /** SHA-256 of the isolated config that fixes permissions and shell environment. */
    controlledConfigSha256?: string;
    /** SHA-256 of the normalized caller-supplied host read-denial paths. */
    readDeniedPathsSha256?: string;
    /** Sorted normalized caller-supplied host read-denial paths. */
    readDeniedPaths?: string[];
    /** Number of normalized caller-supplied host read-denial paths. */
    readDeniedPathCount?: number;
    /** Explicit isolation claims checked before model execution. */
    executionPolicy?: CodexExecutionPolicy;
  };
  /** Verification signals derived in the live worktree (present only when commands were given). */
  checks?: {
    tests?: WorktreeCommandResult;
    typecheck?: WorktreeCommandResult;
  };
}
/** The single shell-command-in-worktree runner seam (replaces the per-executor copies). */
type WorktreeCheckRunner = (opts: {
  command: string;
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
}) => Promise<{
  exitCode: number | null;
  output: string;
}>;
/** The canonical result of one in-place harness run. The edits are the DIRECTORY, not a patch:
 *  the caller supplied the workspace and reads it directly. */
interface InPlaceHarnessResult {
  /** The directory the harness ran in, exactly as supplied. */
  workspacePath: string;
  /** Exact profile materialization applied before the harness launched, and removed after it. */
  profileMaterialization: WorktreeProfileMaterializationReceipt;
  /** The harness subprocess outcome. */
  harness: WorktreeHarnessResult['harness'];
}
//#endregion
//#region src/runtime/provider-placement.d.ts
/** Caller-declared execution placement. Matching never changes the authored profile.
 * @experimental */
interface ProviderPlacement {
  id: string;
  match: {
    harness: NonNullable<AgentProfile['harness']>;
    provider?: string;
    model?: string;
  };
  create: Omit<Partial<CreateAgentEnvironmentInput>, 'profile' | 'signal' | 'idempotencyKey' | 'requestedId' | 'runtimeAttachments' | 'backend'> & {
    backend: string;
  };
  promptOptions?: ProviderPromptOptions;
}
//#endregion
//#region src/runtime/provider-workspace-retention.d.ts
/** The caller-owned boundary used to retain an executable provider workspace. */
interface ProviderWorkspaceRetentionPort {
  /** Maximum wall-clock time Runtime gives capture and verification. */
  readonly timeoutMs: number;
  /** Reads the durable manifest and archive after capture returns. */
  readonly artifacts: AgentCandidateArtifactPort;
  /** Capture the live environment into the standard candidate workspace evidence shape. */
  capture(context: ProviderWorkspaceRetentionContext): Promise<AgentCandidateWorkspaceSnapshotEvidence>;
}
/** The exact live execution facts supplied to a retention callback. */
interface ProviderWorkspaceRetentionContext {
  readonly environment: AgentEnvironment;
  readonly executionId: string;
  /** The exact profile used to create the provider environment. */
  readonly profile: AgentProfile;
  /** The provider-derived outcome, when one was available before cleanup. */
  readonly outcome?: AgentRunOutcome;
  /** A fresh signal bounded by {@link ProviderWorkspaceRetentionPort.timeoutMs}. */
  readonly signal: AbortSignal;
}
//#endregion
//#region src/runtime/tangle-sandbox-exact-process-provider.d.ts
type SandboxControlClient = Pick<Sandbox, 'create' | 'get' | 'list'>;
interface CreateTangleSandboxExactProcessProviderOptions {
  name?: string;
}
/**
 * Adapt Tangle Sandbox's managed control runtime to Runtime's exact-process provider.
 *
 * The adapter deliberately exposes no ordinary agent environment: an exact experiment
 * must start a fresh Sandbox with no managed agent and launch its declared argv directly.
 */
declare function createTangleSandboxExactProcessProvider(client: SandboxControlClient, options?: CreateTangleSandboxExactProcessProviderOptions): AgentEnvironmentProvider;
//#endregion
//#region src/runtime/environment-provider.d.ts
/** Provider object or registry name accepted by runtime provider adapters.
 * @experimental */
type AgentEnvironmentProviderRef = AgentEnvironmentProvider | string;
/** In-memory registry for named `AgentEnvironmentProvider` instances.
 * @experimental */
interface AgentEnvironmentProviderRegistry {
  register(provider: AgentEnvironmentProvider, options?: {
    replace?: boolean;
  }): void;
  has(name: string): boolean;
  get(name: string): AgentEnvironmentProvider | undefined;
  require(name: string): AgentEnvironmentProvider;
  names(): string[];
  providers(): AgentEnvironmentProvider[];
  capabilities(name: string): Promise<AgentEnvironmentCapabilities>;
}
/** Create a registry that resolves provider names to concrete provider instances.
 * @experimental */
declare function createAgentEnvironmentProviderRegistry(providers?: Iterable<AgentEnvironmentProvider>): AgentEnvironmentProviderRegistry;
/** Resolve a provider instance or registry name, failing loudly when a name is unknown.
 * @experimental */
declare function resolveAgentEnvironmentProvider(provider: AgentEnvironmentProviderRef, registry?: AgentEnvironmentProviderRegistry): AgentEnvironmentProvider;
/** Options for exposing an `AgentEnvironmentProvider` through the legacy sandbox client port.
 * @experimental */
interface ProviderAsSandboxClientOptions {
  defaults?: Partial<CreateAgentEnvironmentInput>;
  requireTerminalEvent?: boolean;
  /** Require declared live continuation plus concrete session controls. */
  requireSession?: boolean;
  mapCreateOptions?: (options: CreateSandboxOptions | undefined) => Partial<CreateAgentEnvironmentInput>;
}
/** Adapt a neutral environment provider to the `SandboxClient` interface used by existing loop paths.
 * @experimental */
declare function providerAsSandboxClient(provider: AgentEnvironmentProvider, options?: ProviderAsSandboxClientOptions): SandboxClient;
/** Options for wrapping the current Tangle sandbox client as an environment provider.
 * @experimental */
interface SandboxClientProviderOptions {
  name?: string;
  defaultBackend?: BackendType;
  capabilities?: AgentEnvironmentCapabilities | (() => AgentEnvironmentCapabilities | Promise<AgentEnvironmentCapabilities>);
  validateProfile?: (profile: AgentProfileRef) => AgentProfileValidationResult | Promise<AgentProfileValidationResult>;
  /** Resolve a named profile before calling Sandbox, which accepts inline profiles only. */
  resolveProfile?: (profileId: string) => AgentProfile | Promise<AgentProfile>;
  /** Map portable creation into a supported SDK or deployment contract. Runtime attachments
   * require this explicit mapper until the maintained Sandbox SDK transports them. */
  mapCreateInput?: (input: CreateAgentEnvironmentInput) => CreateSandboxOptions;
  /**
   * `idleTimeoutSeconds` sent on every Sandbox create this adapter makes (a mapped create, a
   * `mapCreateInput` result, or a fork), unless those create options already name one. Defaults to
   * {@link DEFAULT_SANDBOX_IDLE_TIMEOUT_SECONDS}; a positive whole number of seconds.
   */
  idleTimeoutSeconds?: number;
}
/**
 * The idle timeout this adapter sends when nothing else names one: 1,800 seconds.
 *
 * Sandbox substitutes no value of its own: an omitted field falls back to the platform's global
 * idle timeout, documented as 30 minutes unless an operator changed it, and Runtime sent none. Idle
 * means inactivity to Sandbox, which suspends the sandbox (the container stops; the workspace is
 * kept) rather than deleting it. The SDK does not define inactivity further. A request in flight
 * counts as activity: a Discovery Lab seat created with `idleTimeoutSeconds: 1800` ran one request
 * to 2,252 seconds, ended by a per-request cap, not by idling (fleet-launch-2026-08-22).
 *
 * The value restates the documented default, so it can tighten a longer operator setting but never
 * loosen the default. It is 3.8 times the longest gap between frames recorded across a healthy
 * fleet run (469 seconds, same report), and a supervised provider child is observed through an open
 * stream for its whole turn. It is a backstop for a process that dies holding an environment; the
 * settlement barrier releases retained environments itself (`Executor.releaseRetained`). It does
 * nothing on a driver with a create/delete-only lifecycle, which the SDK says skips suspension.
 */
declare const DEFAULT_SANDBOX_IDLE_TIMEOUT_SECONDS = 1800;
/**
 * Adapt a `SandboxClient` into the shared `AgentEnvironmentProvider` contract.
 * The provider declares the public SDK contract before it creates an environment.
 * Each environment exposes interactive methods only when its deployment declares every required capability.
 * @experimental */
declare function sandboxClientAsProvider(client: SandboxClient, options?: SandboxClientProviderOptions): AgentEnvironmentProvider;
/**
 * What one provider-executed turn settles on: the visible answer plus the event archive the
 * environment streamed. It is the value a `ProviderExecutorOptions.validator` scores.
 *
 * The archive is the streamed sequence, in order, without superseded part updates. A harness
 * streams a text or reasoning part cumulatively: every `message.part.updated` frame restates the
 * part's whole text so far. When a later frame of the same part extends a frame's text, the
 * earlier frame is left out, so each such part is archived once, at its latest frame. Keeping
 * every frame retains frames times text length, and the settled archive is hashed and stored.
 * A frame that does not extend the part's text is kept, and every other event is kept verbatim.
 * Read a part's text from `part.text`; a retained frame's `delta` is only that frame's increment.
 *
 * @experimental
 */
interface ProviderLeafOut {
  content: string;
  events: AgentEnvironmentEvent[];
  /** Portable executable workspace evidence accepted before the source environment was deleted. */
  workspaceSnapshot?: AgentCandidateWorkspaceSnapshotEvidence;
  /** How many streamed part updates the archive left out because a later frame superseded them. */
  supersededPartUpdates?: number;
}
/**
 * Per-run Sandbox prompt options for the provider path — the same field, the same name, and the
 * same kernel-owned exclusions as `ExecCtx.promptOptions` on the sandbox path.
 *
 * The kernel owns `sessionId` and `signal`, so neither is declarable: a caller-chosen session id
 * would make every worker share one server session, and the abort channel belongs to the run.
 * `model` is excluded too, and for a different reason: this executor's materialization record
 * names the model from `AgentProfile`, so a turn-level override would make the record state a
 * model the provider did not run. Declare the instrument on `AgentProfile.model`.
 *
 * Everything else is the per-call configuration a portable profile cannot carry. `backend` is the
 * load-bearing one: `backend.model.authMode` plus `authFiles` is how a caller-owned subscription
 * seat reaches the harness inside the environment. Runtime lowers these onto the turn with the one
 * mapper it already uses in the other direction, so a sandbox-shaped provider reads them from
 * `AgentTurnInput.providerOptions.backend` exactly as it reads a sandbox box's prompt options.
 *
 * @experimental
 */
type ProviderPromptOptions = Omit<PromptOptions, 'model' | 'sessionId' | 'signal'>;
/** Options for running a provider as a supervise-mode executor.
 * @experimental */
interface ProviderExecutorOptions {
  /** Select exactly one caller-declared placement from each child's unchanged profile. */
  placements?: readonly ProviderPlacement[];
  defaults?: Partial<CreateAgentEnvironmentInput>;
  runtime?: Runtime;
  destroyOnSettle?: boolean;
  requireTerminalEvent?: boolean;
  /**
   * Per-run prompt options merged UNDER every streamed turn: a mapped turn's own field wins, and
   * the runtime's abort signal is applied last. `providerOptions` merges one level, so a
   * `taskToTurn` that sets its own provider option cannot silently drop the session credential
   * declared here.
   */
  promptOptions?: ProviderPromptOptions;
  /**
   * OPT-IN executable score for this worker, with the SAME contract the sandbox seam's validator
   * has: `validate` runs while the environment is still alive, so `ValidationCtx.box` can read
   * files and run commands in the environment it is scoring. Every other supervised hook fires
   * after teardown and can only read the artifact.
   * `ValidationCtx.node` identifies the supervised node, including its recursion depth, so a
   * shared validator can apply a root-only contract without applying it to nested managers.
   *
   * The verdict becomes the settled artifact's verdict. Absent, nothing changes and the leaf falls
   * back to its own settle verdict.
   */
  validator?: Validator<ProviderLeafOut>;
  /** Capture and verify a portable executable workspace before Runtime destroys the environment. */
  workspaceRetention?: ProviderWorkspaceRetentionPort;
  /** Transform only the profile sent to `provider.create`. The original profile
   * remains the input to `taskToTurn`, so execution-only normalization cannot
   * rewrite the caller's task mapping. */
  profileForCreate?: (profile: AgentProfile) => AgentProfile;
  /** Map the task while retaining the kernel's canonical prompt mapping by default. */
  taskToTurn?: (task: unknown, specProfile: AgentProfile, defaultTurn: AgentTurnInput) => AgentTurnInput;
  /**
   * How a supervised leaf waits out an upstream that cannot serve now.
   *
   * When the model provider refuses a leaf's turn for capacity (a quota, a rate limit, an
   * overload, or the router's own refused credential; see `upstreamUnavailableSignal`), the leaf
   * keeps its environment, pauses, and continues in the same environment and session with a
   * short instruction to pick up where it stopped. The pause starts at `unavailablePauseMs`
   * (15 s) and doubles to `maxUnavailablePauseMs` (5 min), the same rule a driver follows. Only
   * the leaf's deadline, cancellation and budget end it. Each pause is journaled as a `paused`
   * spawn event, and each continuation as the node's next `execution-input`.
   *
   * Applies to a retained execution under a Scope, the path a supervised leaf takes on a provider
   * that declares `retainedControl`, and not with `workspaceRetention`. `false` ends the execution
   * on the refused turn.
   */
  unavailablePause?: UnavailablePausePolicy | false;
}
/** Adapt an environment provider into an `ExecutorFactory` for `createExecutor`.
 *
 * `createExecutor({ backend: 'provider', provider })` is the composition most callers want; it
 * builds this factory and injects the seam. See `examples/provider-executor/`.
 *
 * Still `@experimental`: the entry point that consumes it, `createExecutor`, carries no stability
 * tag and is therefore experimental by default, so a stable promise here would be reachable only
 * through an experimental symbol.
 *
 * @experimental */
declare function providerAsExecutor(provider: AgentEnvironmentProvider, options?: ProviderExecutorOptions): ExecutorFactory<unknown>;
//#endregion
//#region src/runtime/sandbox-events.d.ts
/** The provider/model the platform reports it actually bound to a turn, when it reports one.
 *  `source` is the platform's own account of where that choice came from — `environment` means
 *  the platform chose, not the request. */
interface SandboxServedBackend {
  readonly provider?: string;
  readonly model?: string;
  readonly source?: string;
}
/**
 * Read the served execution identity off one Sandbox event.
 *
 * The platform reports `effectiveBackend` on `execution.started` and again on the terminal
 * event (`@tangle-network/sandbox`, `EffectiveBackend`). Absence returns `undefined`
 * and must stay unknown — a request is not a receipt, so nothing here may be inferred from
 * what was asked for.
 */
declare function sandboxEventServedBackend(event: SandboxEvent): SandboxServedBackend | undefined;
/**
 * Fail the execution when the platform reports serving a model other than the exact one asked for.
 *
 * Measured motive (agent-runtime#892, live infrastructure 2026-08-17): 6 of 6 boxes whose profile
 * declared `zai-coding-plan/glm-5.2` reported
 * `{"provider":"openai-compat","model":"deepseek/deepseek-v4-flash","source":"environment"}`,
 * while the materialization receipt recorded the declared model as `status: "known"`. Sending
 * `backend.model` makes that substitution unlikely; only reading the report back makes it
 * detectable. A run that cannot say which model produced its evidence must not settle as one
 * that can.
 *
 * Silent when the platform reports no served model: unobserved stays unobserved.
 */
declare function assertSandboxServedModel(event: SandboxEvent, expected: {
  readonly provider?: string;
  readonly model?: string;
} | undefined): void;
/**
 * Extract a `RuntimeStreamEvent`-shaped `llm_call` from a sandbox event when
 * the event carries usage/cost data. Returns `undefined` for non-cost events
 * so the kernel can iterate the full stream without branching.
 *
 * Pure by contract: it never throws on a failed run. The terminal truth
 * boundary is the public Sandbox outcome tracker, applied after the complete
 * stream. Post-hoc readers — {@link sumSandboxUsage}, the
 * analyst trace store, the chat projection — must stay able to read a failed
 * turn's events, which is when reading them matters most.
 *
 * Canonical cost-carrying types observed in the wild:
 *   - `llm_call` — `data: { model, tokensIn, tokensOut, costUsd, ... }`
 *   - `message.completed` / `result` — `data: { usage: { inputTokens,
 *      outputTokens, totalCostUsd? } }`
 *   - `cost.usage` / `usage` — same shape under a dedicated type
 *
 * Numeric coercion is strict: `Number.isFinite` gates every accumulator write
 * so a sentinel `NaN` from a misbehaving backend cannot poison the ledger.
 */
declare function extractLlmCallEvent(event: SandboxEvent, agentRunName: string): (RuntimeStreamEvent & {
  type: 'llm_call';
}) | undefined;
/**
 * Per-turn usage accounting over BOTH the canonical events and the harness-native ones.
 *
 * Some harnesses report a turn's tokens only inside their own event (`harness-usage.ts`), and a
 * stream may carry that report AND a canonical usage event for the same turn. Crediting both
 * counts one turn twice, so this ledger holds the precedence rule: a canonical usage event WINS,
 * and a harness-native report is credited only for a turn in which no canonical usage arrived.
 *
 * The harness-native report is held until the turn ends, because it can arrive before the
 * canonical answer is known — codex emits `turn.completed` ahead of the terminal transport
 * events. Call {@link SandboxUsageLedger.observe} for every event of a turn, then
 * {@link SandboxUsageLedger.settleTurn} once at the turn boundary; settling also resets the
 * ledger for the next turn, so one ledger serves a whole multi-turn session.
 *
 * The ledger never throws on a receipt it cannot read: `observe` returns a receipt with
 * `tokensKnown: false` and `tokensUnknownReason`, so one policy serves every consumer.
 */
interface SandboxUsageLedger {
  /** Cumulative worker tokens, including cache classifications reported after the prompt total. */
  tokenUsage(): LoopTokenUsage;
  /** Account one event. Returns the canonical usage receipt to credit now, if the event is one. */
  observe(event: SandboxEvent, agentRunName: string): (RuntimeStreamEvent & {
    type: 'llm_call';
  }) | undefined;
  /** End the turn. Returns the held harness-native receipt when no canonical usage arrived. */
  settleTurn(agentRunName: string): (RuntimeStreamEvent & {
    type: 'llm_call';
  }) | undefined;
}
/** A {@link SandboxUsageLedger} for one worker. Pass the worker's harness to decode with that
 *  harness's adapter; omit it to try every registered adapter. */
declare function createSandboxUsageLedger(harness?: HarnessType): SandboxUsageLedger;
/**
 * Sum the token usage + USD cost of a sandbox turn's events — the one honest way to meter an
 * `openSandboxRun` cell. Folds a {@link SandboxUsageLedger} over the stream, so it reads usage off
 * EVERY backend event shape — the canonical events plus a harness that reports usage only in its
 * own event — and a `runProfileMatrix` dispatch can report it to `ctx.cost`:
 *
 *     receipt: (turn) => {
 *       const u = sumSandboxUsage(turn.events)
 *       return { model, inputTokens: u.input, outputTokens: u.output,
 *         ...(u.tokensKnown === false ? { usageUnknown: true } : {}),
 *         ...(u.usdKnown !== false && u.costUsd > 0 ? { actualCostUsd: u.costUsd } : {}),
 *         ...(u.usdKnown === false ? { costUnknown: true } : {}),
 *         ...(u.estimatedCostUsd !== undefined ? { estimatedCostUsd: u.estimatedCostUsd } : {}) }
 *     }
 *
 * Without this a cell reads `{tokens:0, cost:0}` and the backend-integrity guard correctly aborts the
 * matrix as a stub. `agentRunName` is the fallback model label for cost-only events (default `'agent'`).
 *
 * Pure by contract, like the ledger it folds: it never throws. A harness receipt the ledger cannot
 * read leaves the result at `tokensKnown: false` with `tokensUnknownReason` carrying the decode
 * message — an unreadable receipt is a different fact from a turn that reported no usage, and a
 * post-hoc reader that threw would lose the whole failed turn it exists to report.
 */
declare function sumSandboxUsage(events: readonly SandboxEvent[], agentRunName?: string): {
  input: number;
  output: number;
  costUsd: number;
  tokensKnown?: false;
  usdKnown?: false;
  estimatedCostUsd?: number;
  tokensUnknownReason?: string;
};
/**
 * Cross-event state for {@link mapSandboxToolEvent}. Sandbox backends emit a
 * tool invocation as MANY `message.part.updated` frames on the same call id
 * (pending → running → completed), so faithful projection needs per-call
 * status memory: one `tool_call` on first sighting, at most one `tool_result`
 * on the terminal transition, nothing on intermediate re-frames. Create one
 * state per turn via {@link createSandboxToolPartState}.
 *
 * @experimental
 */
interface SandboxToolPartState {
  /** Last seen status per tool call id. A terminal status is sticky — later
   *  frames on a settled call project to nothing. */
  statusByCall: Map<string, string>;
  /** Sequence for synthesized call ids when an event carries none. */
  seq: number;
}
/**
 * Fresh per-turn {@link SandboxToolPartState} for {@link mapSandboxToolEvent} — an
 * empty call-status map so each turn projects tool frames independently.
 *
 * @experimental
 */
declare function createSandboxToolPartState(): SandboxToolPartState;
/**
 * Project one `SandboxEvent` onto the `tool_call` / `tool_result` variants of
 * `RuntimeStreamEvent` — the tool-part projection `mapSandboxEvent`
 * deliberately does NOT perform. Opt-in and additive: `mapSandboxEvent`'s
 * default vocabulary (text/reasoning deltas + `llm_call`) is unchanged;
 * consumers that need the tool surface (chat UIs rendering tool activity)
 * compose this projector alongside it — `streamAgentTurn` does exactly that
 * under its `preserveToolParts` option.
 *
 * Handled shapes (observed on the opencode / claude-code sandbox backends):
 *   - `message.part.updated` with `part.type === 'tool'` — stateful: a
 *     `tool_call` on the call id's first frame (args from `state.input` or
 *     `state.metadata.input`), a `tool_result` when the status transitions to
 *     `completed` (result from `state.output` / `metadata.output`) or to a
 *     terminal failure (result is `{ error, status, output? }` — the error
 *     surfaced in-band, never dropped).
 *   - bare `tool*` event types (`tool.call`, `tool_result`, …) — stateless:
 *     `*result*` types project to `tool_result`, the rest to `tool_call`.
 *
 * Returns `[]` for every non-tool event.
 *
 * @experimental
 */
declare function mapSandboxToolEvent(event: SandboxEvent, state: SandboxToolPartState): (RuntimeStreamEvent & {
  type: 'tool_call' | 'tool_result';
})[];
/**
 * Project one `SandboxEvent` onto the `RuntimeStreamEvent` chat-UX vocabulary,
 * for runtimes that bridge a sandbox `streamPrompt` into the
 * `AgentRuntime.act` streaming contract. Returns `undefined` for events that
 * have no faithful projection — the raw stream is preserved separately for the
 * `OutputAdapter`, so an unmapped event never loses data.
 *
 * Mapped (the task-optional incremental variants — no synthesized task
 * lifecycle, no guessed tool-part shapes):
 *   - `message.part.updated` text part → `text_delta`
 *   - `message.part.updated` reasoning/thinking part → `reasoning_delta`
 *   - cost-bearing events → `llm_call` (shared with the ledger extractor)
 *
 * Tool parts are deliberately NOT mapped here (unchanged default) — compose
 * {@link mapSandboxToolEvent} alongside when a consumer needs them.
 *
 * The opencode backend emits incremental text as
 * `{ type: 'message.part.updated', data: { part: { type, text }, delta } }`;
 * `delta` is the increment, `part.text` the running accumulation.
 */
declare function mapSandboxEvent(event: SandboxEvent, opts?: {
  agentRunName?: string;
}): RuntimeStreamEvent | undefined;
/**
 * Project one `SandboxEvent` onto Runtime's executor progress vocabulary: incremental text and
 * reasoning, tool calls and results, and an interaction request. It composes the existing
 * projections ({@link mapSandboxEvent}, {@link mapSandboxToolEvent}, and the canonical Agent
 * Interface decode) so every sandbox-shaped executor publishes live output through one reader.
 * Usage-bearing events project to nothing here — accounting stays on the `tokens`/`cost`
 * channels.
 *
 * Pass one {@link SandboxToolPartState} per turn so a multi-frame tool call yields one call and
 * at most one result.
 *
 * @experimental
 */
declare function sandboxProgressEvents(event: SandboxEvent, state: SandboxToolPartState): ExecutorProgressEvent[];
//#endregion
//#region src/runtime/sandbox-executor-output.d.ts
/**
 * What a settled turn produced, as an explicit marker.
 *
 * `text` carries the byte length of the answer, `empty` says a text-bearing terminal event was
 * observed and carried nothing, and `absent` says no text-bearing event was observed at all.
 * The three are distinct on purpose: an empty settle blob used to be indistinguishable from lost
 * output, so a reader could not tell a box that produced nothing from one whose answer never
 * arrived.
 */
type SandboxOutputMarker = {
  readonly kind: 'text';
  readonly bytes: number;
} | {
  readonly kind: 'empty';
} | {
  readonly kind: 'absent';
};
/** Parsed output of one Sandbox executor turn. */
interface SandboxLeafOut {
  events: SandboxEvent[];
  /** The observed answer. `undefined` when no text-bearing event was observed — never `''`. */
  content: string | undefined;
  /** Explicit account of what the turn produced. */
  output: SandboxOutputMarker;
  /**
   * Provider and model the platform reported serving this turn, when it reported one. Absent means
   * the platform said nothing; it is never filled from the request, because a request is not a
   * receipt.
   */
  servedBackend?: SandboxServedBackend;
  toolCalls?: ExecutorToolCall[];
  outcome?: AgentRunOutcome;
}
//#endregion
//#region src/runtime/shared-box.d.ts
/**
 * The most workers one default box carries at once.
 *
 * It keeps a worker count that the 512-task pids limit of a Tangle box can hold with headroom
 * for the sidecar's own processes and the workers' tool shells: 118 idle tasks plus 8 workers at
 * about 34 tasks each is 390. Memory is not the binding limit: 8 workers used about 4 GB in a
 * 16 GB box. Raise it only for a box whose pids limit was raised with it.
 */
declare const DEFAULT_SHARED_BOX_WORKERS = 8;
/** The box shape the default placement creates: memory for 8 workers at about 0.5 GB each plus
 *  the sidecar, and 4 cores, because the workers wait on the model most of the time. */
declare const DEFAULT_SHARED_BOX_RESOURCES: Readonly<{
  cpuCores: 4;
  memoryMB: 8192;
}>;
/** The request header the router records as a usage row's `clientName`. */
declare const ROUTER_CLIENT_HEADER = "x-tangle-client";
/**
 * The router client name of the worker that runs supervised node `nodeId`.
 *
 * The node id is already in the spawn journal, so a keeper joins a router row to a node without
 * a new record: the row whose `clientName` is `agent-runtime-node/<nodeId>` is that node's spend.
 */
declare function sharedWorkerClientName(nodeId: string): string;
/** The Sandbox box surface a shared box uses. The Sandbox SDK's `SandboxInstance` satisfies it. */
interface SharedBoxHandle {
  readonly id: string;
  exec(command: string, options?: {
    timeoutMs?: number;
  }): Promise<{
    exitCode?: number | null;
    stdout?: string;
    stderr?: string;
  }>;
  readonly fs: {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<unknown>;
  };
  readonly process: {
    spawnExact(executable: string, args: readonly string[], options?: {
      cwd?: string;
      env?: Record<string, string>;
      timeoutMs?: number;
    }): Promise<SharedBoxProcess>;
    list(): Promise<ReadonlyArray<{
      pid: number;
      command?: string;
      cwd?: string;
    }>>;
    get(pid: number): Promise<SharedBoxProcess | null>;
  };
  delete(): Promise<unknown>;
}
/** One process in a shared box, as the Sandbox SDK's process manager returns it. */
interface SharedBoxProcess {
  readonly pid: number;
  wait(): Promise<number>;
  kill(signal?: 'SIGTERM' | 'SIGKILL', options?: {
    tree?: boolean;
  }): Promise<void>;
  stdout(): AsyncIterable<string>;
  stderr(): AsyncIterable<string>;
}
/** Options for {@link sharedBoxPlacement}. */
interface SharedBoxPlacementOptions {
  /** The Sandbox client that creates and deletes the shared boxes. */
  client: SandboxClient;
  /**
   * Create options for every shared box: resources, egress, secrets, lifetime and billing.
   * Runtime owns `backend`, so the box's sidecar never serves a worker turn.
   */
  box?: Omit<CreateSandboxOptions, 'backend'>;
  /** The most workers one box carries at once. Defaults to {@link DEFAULT_SHARED_BOX_WORKERS}. */
  workersPerBox?: number;
  /** Absolute directory in each box that holds one directory per worker. */
  workerRoot?: string;
  /** First wait before repeating a Sandbox call that failed transiently; doubles per attempt. */
  retryDelayMs?: number;
  /**
   * How a worker waits out a model provider that cannot serve now: a quota, a rate limit, an
   * overload, or the router's own refused credential (`unavailableSignalOfFailure`). The worker
   * pauses 15 s, doubling to 5 min, the rule a driver and a dedicated leaf follow, then continues
   * its own opencode session in its own directory. Only cancellation, the turn's `timeoutMs` and
   * the node's deadline and budget, which abort the turn, end the pauses. `false` ends the turn on
   * the refused run.
   */
  unavailablePause?: UnavailablePausePolicy | false;
}
/** Counts that show how the pool placed its workers. */
interface SharedBoxStats {
  readonly boxesCreated: number;
  readonly boxesLive: number;
  readonly workersPlaced: number;
  readonly workersLive: number;
  /** The most workers any one box carried at the same time. */
  readonly peakWorkersPerBox: number;
  /** Every box this pool created, with the workers it served. */
  readonly boxes: ReadonlyArray<{
    readonly id: string;
    readonly workersServed: number;
    readonly deleted: boolean;
    /** Milliseconds from the create request to a box that runs processes. */
    readonly createMs: number;
  }>;
}
/** What {@link SharedBoxPlacement.close} did to each box. */
interface SharedBoxCloseReceipt {
  readonly boxId: string;
  readonly deleted: boolean;
  readonly error?: string;
}
/** Who a shared worker is, for the router rows its model calls leave on the box's key. */
interface SharedWorkerIdentity {
  /** The supervised node the worker runs. Absent for a worker outside a supervised tree. */
  readonly nodeId?: string;
}
/** A shared-box placement: the provider Runtime uses for a profile the placement accepts. */
interface SharedBoxPlacement {
  /**
   * The environment provider that places one accepted worker in a shared box. A worker with a
   * `nodeId` sends `x-tangle-client: agent-runtime-node/<nodeId>` on its router calls; without
   * one, its calls carry no client name and stay charged to the box.
   */
  providerFor(worker?: SharedWorkerIdentity): AgentEnvironmentProvider;
  /** Public identity of this placement, recorded on every execution it serves. */
  readonly identity: {
    readonly id: string;
    readonly digest: string;
  };
  /** Why a shared box cannot carry this profile, or `undefined` when it can. */
  refusal(profile: AgentProfile): string | undefined;
  stats(): SharedBoxStats;
  /** Delete every box this placement created and still holds. Call it when the run settles. */
  close(): Promise<ReadonlyArray<SharedBoxCloseReceipt>>;
}
/**
 * Why a shared box cannot carry `profile`, or `undefined` when it can.
 *
 * A shared box carries a profile whose whole behavior reaches an opencode process through its own
 * working directory, its own configuration and the box's own model credential. Everything else
 * keeps a dedicated box: another harness, a model the box credential cannot reach, a replaced
 * system prompt, MCP servers, connections, hooks, subagents, extensions, tool grants, and any
 * resource the materializer does not lower into the worker's directory.
 */
declare function sharedBoxRefusal(profile: AgentProfile): string | undefined;
/**
 * Place accepted workers as processes in a pool of shared Sandbox boxes.
 *
 * The pool fills a box before it creates the next one and deletes a box when its last worker
 * releases it. Runtime reaches this placement through `createExecutor({ backend: 'provider',
 * shared })`: a profile that {@link SharedBoxPlacement.refusal} accepts runs here, and every other
 * profile keeps the dedicated provider.
 */
declare function sharedBoxPlacement(options: SharedBoxPlacementOptions): SharedBoxPlacement;
//#endregion
//#region src/runtime/harness-usage.d.ts
/**
 * One harness's own token-usage report for one turn, in the runtime's field names.
 *
 * `input` is the provider's TOTAL prompt count and `output` is its TOTAL completion count.
 * The other three counters CLASSIFY a part of one of those totals; none of them adds to it.
 * `cachedInput` and `cacheWriteInput` classify `input`, which is the convention
 * `promptCacheTokenClasses` (`util.ts`) folds: `freshInput = input - cacheRead - cacheWrite`.
 * `reasoningOutput` classifies `output`.
 *
 * A counter the harness does not report stays absent, because a zero would claim the harness
 * measured none.
 */
interface HarnessUsage {
  /** The harness family whose adapter produced this report. */
  readonly harness: HarnessType;
  /** Total prompt tokens the provider charged for the turn, the cached ones included. */
  readonly input: number;
  /** Total completion tokens the provider charged for the turn, the reasoning ones included. */
  readonly output: number;
  /** The part of `input` the provider served from its prompt cache. */
  readonly cachedInput?: number;
  /** The part of `input` the provider wrote into its prompt cache. */
  readonly cacheWriteInput?: number;
  /** The part of `output` the model spent on reasoning. Never added to `output`. */
  readonly reasoningOutput?: number;
}
/**
 * Decode a sandbox event with one harness's adapter, or `undefined` when the event carries no
 * harness-native usage.
 *
 * A NAMED harness reads with that harness's adapter only, and a named harness with no adapter
 * reports nothing. It never falls through to another harness's adapter: a different harness's
 * `turn.completed` decoded as codex would either drop the counters codex does not name or fail on
 * a field codex requires, and both answers would be about the wrong harness. The composite over
 * every registered adapter runs only when the caller cannot name the harness.
 *
 * Throws `ValidationError` when an adapter recognizes the event as its harness's usage carrier and
 * cannot read the numbers.
 */
declare function decodeHarnessUsage(event: SandboxEvent, harness?: HarnessType): HarnessUsage | undefined;
//#endregion
//#region src/runtime/codex-rollout-store.d.ts
/** Who wrote one rollout, exactly as its own `session_meta` states it. Nothing here is inferred. */
interface CodexRolloutIdentity {
  /** The rollout's own thread id (`session_meta.payload.id`). */
  readonly sessionId: string;
  /** The thread this one was spawned or forked from, when it was. */
  readonly parentThreadId?: string;
  /** The thread whose rows are prepended into this file, when this file is a fork. */
  readonly forkedFromId?: string;
  /** True when `thread_source` reads `subagent`: a harness-native child, invisible to the journal. */
  readonly nativeChild: boolean;
  /** The child's own path in the harness's agent tree (`/root/c1_b_grid`), when it has one. */
  readonly agentPath?: string;
  /** The harness's own nickname for the child ("Turing"), when it has one. */
  readonly agentNickname?: string;
  /** Spawn depth the harness recorded. `1` is a direct child of the seat. */
  readonly depth?: number;
  /** The working directory the session ran in, used to attribute a store to a workspace. */
  readonly cwd?: string;
  /** The codex build that wrote it. */
  readonly cliVersion?: string;
  /** When the session itself started, from its own `session_meta` timestamp. */
  readonly startedAtMs?: number;
}
/** How this reader isolated the session's own rows from the parent rows prepended to its file. */
type CodexForkBoundary =
/** Not a fork: every row in the file belongs to this session. */
{
  readonly kind: 'whole-file';
} |
/** A fork whose own first turn was isolated, and by which rule. */
{
  readonly kind: 'resolved';
  readonly rule: 'history-start-ordinal' | 'turn-is-session' | 'turn-uuid-v7' | 'turn-start-time';
  /** The `turn_id` of the session's own first turn. */
  readonly turnId?: string;
  /** Rows credited to the parent and excluded from `own`. */
  readonly inheritedTurns: number;
} |
/** A fork this reader could not isolate. `own` is absent; nothing may be charged. */
{
  readonly kind: 'unresolved';
  readonly reason: string;
};
/** One turn of one session, with the counters it added to the session's cumulative total. */
interface CodexRolloutTurn {
  readonly turnId?: string;
  readonly startedAtMs?: number;
  readonly usage: HarnessUsage;
}
/** One rollout file, read. */
interface CodexRolloutSession {
  readonly identity: CodexRolloutIdentity;
  readonly boundary: CodexForkBoundary;
  /**
   * The session's OWN spend — the cumulative delta from its fork boundary to its last report.
   * ABSENT when the boundary is unresolved: an unattributable number must not be charged.
   */
  readonly own?: HarnessUsage;
  /** The session's own turns, newest last. Empty when the file reported no usage. */
  readonly turns: readonly CodexRolloutTurn[];
  /**
   * The file's final cumulative `total_token_usage`, kept ONLY as the diagnostic that shows how
   * far a naive file total is from the truth. Never charge this.
   */
  readonly fileCumulativeInput: number;
  readonly fileCumulativeOutput: number;
}
/** What one incremental read of a store observed. */
interface CodexStoreDelta {
  /** Spend by sessions that are NOT native children — the seat's own turns. */
  readonly seat: HarnessUsage;
  /** Spend by `thread_source: subagent` sessions — the harness-native children. */
  readonly native: HarnessUsage;
  /** Sessions whose fork boundary could not be isolated, so their spend is absent, not zero. */
  readonly unresolved: ReadonlyArray<{
    readonly sessionId: string;
    readonly reason: string;
  }>;
  /**
   * Every session this read touched, for evidence. Each one states its WHOLE own spend and turn
   * list, which is not the same number as `seat` / `native`: those two carry only what this read
   * newly observed.
   */
  readonly sessions: readonly CodexRolloutSession[];
}
/** A store reader that credits each turn once: it tails only the bytes appended since the last read. */
interface CodexRolloutStoreReader {
  /**
   * Read everything appended since the previous call and attribute it.
   *
   * The FIRST call establishes the baseline. Call it before the first turn so pre-existing rows are
   * consumed and credited to nothing; every later call returns exactly that turn's spend.
   */
  read(): Promise<CodexStoreDelta>;
}
/** Where a harness keeps its own session store, and which workspace may be credited from it. */
interface CodexRolloutStoreRef {
  /**
   * Absolute path to the harness home the CLI writes into — `CODEX_HOME`, or `$HOME/.codex`.
   * This MUST be the run's own isolated store. Pointing it at an ambient host store credits one
   * run with another run's files, which is the exact defect this reader exists to end.
   */
  readonly root: string;
  /**
   * Credit only sessions whose recorded `cwd` is this path or below it. Absent credits every
   * session under `root`, which is correct only for a store no other run writes to.
   */
  readonly workspaceRoot?: string;
}
/**
 * Read one rollout's rows into a session record.
 *
 * `rows` is the file's JSON values in file order. Pass the whole file to read a completed session;
 * the store reader passes appended slices and carries the identity forward itself.
 */
declare function readCodexRolloutSession(rows: Iterable<unknown>): CodexRolloutSession | undefined;
/**
 * Open an incremental reader over a codex store.
 *
 * Nothing is read until `read()` is called, and every read is bounded by the bytes appended since
 * the previous one, so a 695MB rollout is scanned once rather than once per turn.
 */
declare function createCodexRolloutStoreReader(ref: CodexRolloutStoreRef): CodexRolloutStoreReader;
/** Sum two usage reports on every counter both of them state. */
declare function addHarnessUsage(left: HarnessUsage, right: HarnessUsage): HarnessUsage;
/** True when a report states any spend at all. */
declare function harnessUsageIsEmpty(usage: HarnessUsage): boolean;
//#endregion
//#region src/runtime/key-provider.d.ts
/** Resolve named secrets. The ONE seam every secret store adapts to. */
interface KeyProvider {
  /** The value for `name`, or `undefined` when this provider does not hold it. */
  get(name: string): Promise<string | undefined>;
}
/** The env-backed provider: reads the (dotenvx-loaded) process env. Empty /
 *  whitespace-only values count as absent — fail loud, not with a blank key. */
declare function envKeyProvider(env?: Record<string, string | undefined>): KeyProvider;
/** The `AgentProfileMcpServer.metadata` key the declarative secret-env map
 *  rides under: `{ ENV_VAR_NAME: 'PROVIDER_KEY_NAME' }`. Names only — values
 *  are resolved at materialize time and never stored. */
declare const mcpSecretEnvMetadataKey = "secretEnv";
/** Read (and validate) a server entry's declared secret-env map, if any.
 *  Malformed metadata throws — a half-declared secret must never half-boot. */
declare function secretEnvOfMcpServer(server: AgentProfileMcpServer): Record<string, string> | undefined;
/**
 * Resolve a declared secret-env map into the real env entries for a server
 * spawn. Fail-closed: no provider or a missing key throws, naming the KEY
 * NAME only (the value never appears in any message). `label` names the
 * server for the error (e.g. `profile.mcp['exa']`).
 */
declare function resolveSecretEnv(secretEnv: Record<string, string>, keys: KeyProvider | undefined, label: string): Promise<Record<string, string>>;
/** The spawn-ready strings for one stdio MCP server: profile config values
 *  resolved, secrets separated so the client can redact them. */
interface ResolvedMcpServerLaunch {
  args?: string[];
  /** Public env, safe to appear in diagnostics. */
  env?: Record<string, string>;
  /** Resolved secret env. Reaches only the child process; redacted everywhere else. */
  protectedEnv?: Record<string, string>;
}
/**
 * Resolve a profile MCP server's `args`/`env` config values (interface ≥0.40
 * `AgentProfileConfigValue`) plus the legacy `metadata.secretEnv` channel into
 * the plain strings a spawn needs.
 *
 * Rules, all fail-closed:
 * - `args` must be public values. A secret-ref in argv is refused: argv is
 *   readable by every host process (/proc/PID/cmdline) and outside the
 *   protected-value redaction channel, so a secret there cannot be contained.
 * - `env` secret-refs resolve through the KeyProvider (missing provider or key
 *   throws, naming the KEY NAME only) and land in `protectedEnv`.
 * - An env var declared secret on BOTH channels (env secret-ref and
 *   metadata.secretEnv) is ambiguous configuration and throws.
 * - A public `env` entry shadowed by a legacy metadata secret keeps the
 *   pre-0.40 spawn precedence: the secret value wins in the child env.
 */
declare function resolveMcpServerLaunch(server: AgentProfileMcpServer, keys: KeyProvider | undefined, label: string): Promise<ResolvedMcpServerLaunch>;
//#endregion
//#region src/runtime/supervise/bridge-config.d.ts
/**
 * cli-bridge seam. A local OpenAI-compatible bridge that fronts harness CLIs
 * (claude-code / opencode / kimi / pi) behind one HTTP surface. The spawned
 * `AgentProfile` is the sole harness/provider/model and behavioral authority and
 * is forwarded verbatim per request; this seam carries transport data only.
 *
 * The executor opens a resumable cli-bridge session. `sessionId` identifies the
 * harness conversation across turns; each turn also receives its own durable run id.
 * A dropped HTTP reader reattaches to that exact run and explicit cancel is the only
 * operation allowed to stop it. Omit `sessionId` and the executor mints one per spawn.
 *
 * ── HOW TO CONTROL WHAT THE HARNESS LOADS (there is no argv field, by design) ──
 *
 * A worker often needs the harness started in a KNOWN state — no ambient extensions, skills,
 * context files, or prompt templates — because ambient state is how a paired experiment silently
 * loses its pairing: an installed extension that persists memory across runs carries arm A's state
 * into arm B, and nothing reports it.
 *
 * That is what the spawned `AgentProfile` is FOR. `agent_profile`
 * rides every request verbatim, and cli-bridge maps it onto each harness's own native controls:
 *
 *   - Materializing any profile at all already starts the harness isolated from ambient
 *     workspace state — for pi that is `--no-context-files --no-skills --no-prompt-templates`,
 *     applied to every request that carries an `agent_profile`.
 *   - `AgentProfile.extensions.<harness>` is the named, per-harness control channel. An explicit
 *     `extensions: { pi: { load: [] } }` disables ambient extension discovery outright
 *     (pi's `--no-extensions`); listing package names loads exactly those and nothing else.
 *   - `permissions` / `tools` / `mcp` map onto the harness's native tool and server controls.
 *
 * A caller therefore does NOT need to hand-roll an `Executor` to isolate a harness run, and the
 * profile expressing it stays portable: the same declaration means the same thing on a different
 * harness, whereas an argv string means nothing anywhere else.
 *
 * WHY NOT A GENERAL ARGV PASSTHROUGH. `bridgeUrl` addresses a process-spawning server. Forwarding
 * an arbitrary argv array to it would let any caller holding a bearer token choose the flags of a
 * process on the bridge host — which for real harness CLIs includes flags that load code from a
 * path, read a file into the prompt, redirect the working directory, or turn off the isolation the
 * bridge applies. cli-bridge deliberately confines workers (a filesystem jail and deny-by-default
 * network egress), and every one of those confinements is expressed as spawn configuration, so an
 * argv channel is a channel for unwinding them. It would also break this executor's own contract:
 * the durable-run replay protocol, session pinning, and streaming mode are all argv the bridge
 * owns, and a caller-supplied duplicate silently wins or corrupts the parse. The structured profile
 * channel is validated, per-harness, portable, and refuses controls it does not understand — keep
 * new harness capability there.
 */
interface BridgeSeam {
  bridgeUrl: string;
  bridgeBearer: string;
  /**
   * Optional request-scoped model credential.
   *
   * The key name is portable configuration. The provider is a live service and is intentionally
   * not serialised. Runtime resolves both values immediately before every bridge POST and sends
   * them only to a loopback bridge through private request headers.
   */
  modelCredential?: BridgeModelCredential;
  /** Optional working directory forwarded to cli-bridge and persisted with the session. */
  cwd?: string;
  /**
   * The harness's OWN on-disk session store, read as a spend receipt.
   *
   * cli-bridge forwards no token usage for a codex worker, so a turn whose provider counters exist
   * only in codex's rollout meters `{0, 0}` with `tokensKnown: false`. Measured on one live seat
   * (discovery#80): 9 of 9 `metered` events read zero while 27,320,482 codex tokens sat in the same
   * run directory, 1,453,948 of them belonging to harness-native children the journal never saw.
   *
   * Naming the store here turns those rows into evidence. The executor tails it once per turn and
   * credits the DELTA, so each turn is charged once, and it reports the counters with
   * `provenance: 'harness-store'` so a reader can tell a disk receipt from a stream receipt.
   *
   * The path must be the run's OWN isolated store. An ambient host store credits this run with
   * another run's files, and `workspaceRoot` is the structural guard against it.
   */
  harnessStore?: BridgeHarnessStore;
  /** Caller-owned deadline for each bridge turn. Runtime enforces it locally and sends the
   *  same value in `execution.timeoutMs` so the bridge-owned process follows the same policy. */
  timeoutMs?: number;
  /** Stable, caller-owned cli-bridge session id for harness-side resume. Defaults
   *  to a freshly minted per-spawn id so each worker is its own resumable session. */
  sessionId?: string;
  /** Transport reconnects allowed after the first POST. Default 3; set 0 to disable. */
  maxReconnects?: number;
  /** Newest-last activity window `progress()` reports. Default 12. */
  activityWindow?: number;
}
/**
 * A harness's own session store on the bridge host, named so the runtime may read it.
 *
 * Only `codex` has a reader today. Any other harness is REFUSED rather than read with codex's
 * decoder: a different harness's file decoded as a codex rollout would either drop counters it does
 * not name or credit a number that is about the wrong wire shape.
 */
interface BridgeHarnessStore extends CodexRolloutStoreRef {
  /** The harness family that wrote the store. */
  readonly harness: HarnessType;
}
/** A live, request-scoped model credential reference for a local cli-bridge. */
interface BridgeModelCredential {
  /** Provider key name for the scoped model token. */
  key: string;
  /** Provider key name for the exact scoped HTTPS model gateway URL. */
  baseUrlKey: string;
  /** Live credential service. Runtime retains this reference through reusable captures. */
  provider: KeyProvider;
}
//#endregion
//#region src/runtime/supervise/inbox.d.ts
/** A message from the run's AUTHORITY — the parent driver. These two kinds carry instruction. */
interface AuthorityInboxMessage {
  readonly kind: 'steer' | 'answer';
  readonly text: string;
  /** Forceful messages abort the in-flight turn; queued ones wait for the boundary flush. */
  readonly interrupt: boolean;
  /** Present for an `answer` — the question id it resolves. */
  readonly questionId?: string;
}
/** A message from a SIBLING worker. Information, never instruction — the parent stays the only
 *  authority over this worker's task. */
interface PeerInboxMessage {
  readonly kind: 'mail';
  readonly text: string;
  /** Always false. Peer mail is queued by construction; see this file's header. */
  readonly interrupt: false;
  readonly envelope: PeerMailEnvelope;
}
type InboxMessage = AuthorityInboxMessage | PeerInboxMessage;
interface Inbox {
  /** The `Executor.deliver` implementation. Returns false when the raw message is malformed and
   * therefore was not queued; callers must not acknowledge a message this inbox discarded. */
  deliver(msg: unknown): boolean;
  /** Remove and return all pending messages (the flush). */
  drain(): InboxMessage[];
  pending(): number;
  /** Pending messages from the run's AUTHORITY only. This is what the pre-settle fence counts:
   *  a worker may not finish while a steer or answer it never read is queued, but peer mail must
   *  never be able to hold a finished worker open. */
  pendingAuthority(): number;
  /** Open a fresh per-turn interrupt signal; a later forceful `deliver` aborts it. The loop links
   *  this into the signal it passes to its inference call, then re-plans when it fires. */
  freshInterrupt(): AbortSignal;
  /** Render drained messages as ONE operator turn to fold into the worker's conversation. */
  fold(messages: ReadonlyArray<InboxMessage>): string;
}
/** Create the worker-side inbox for the down-leg: the driver's `steer_agent` / `answer_question` messages and a sibling's peer mail queue here, and the worker's loop drains them at step boundaries and before settle. */
declare function createInbox(): Inbox;
//#endregion
//#region src/runtime/supervise/sandbox-session.d.ts
/** Ceiling on continuation turns. Turn 0 is the task; every later turn is a folded steer, so
 *  this bounds how many times a supervisor may redirect ONE worker before it must respawn. */
declare const DEFAULT_SANDBOX_STEERING_MAX_TURNS = 24;
/** Opt-in configuration for the steerable sandbox worker (`SandboxSeam.steering`). Absent, the
 *  sandbox executor keeps its historical single-shot `runAgentRounds` composition verbatim. */
interface SandboxSteeringOptions {
  /** Max turns for one worker (turn 0 + folded steers). Default {@link DEFAULT_SANDBOX_STEERING_MAX_TURNS}. */
  readonly maxTurns?: number;
  /** How many recent tool/turn notes `progress()` reports. Default 12. */
  readonly activityWindow?: number;
  /** Per-turn wall-clock ceiling; the turn's stream is aborted when it elapses. */
  readonly turnTimeoutMs?: number;
}
/** What the steerable session exposes to its executor: the usage stream plus the live reads. */
interface SteerableSandboxSession {
  /** Drive the worker to settlement. `signal` is the spawn-scoped abort handed to `execute`. */
  stream(task: unknown, signal: AbortSignal): AsyncIterable<UsageEvent>;
  progress(): ExecutorProgress;
  /** Ask the box to stop the running execution on this exact session and report what it answered. */
  cancel(request: ExecutorCancellationRequest): Promise<ExecutorCancellation>;
  traceSource(): TraceSource;
  artifact(): {
    outRef: string;
    out: unknown;
    verdict?: DefaultVerdict;
    spent: Spend;
  } | undefined;
  teardown(): Promise<void>;
}
interface SteerableSandboxArgs {
  readonly controller: AbortController;
  readonly profile: AgentProfile;
  readonly harness: BackendType;
  readonly sandboxClient: SandboxClient;
  readonly inbox: Inbox;
  readonly taskToPrompt: (task: unknown) => string;
  readonly options?: SandboxSteeringOptions;
  readonly loopCtx?: Partial<Omit<ExecCtx, 'sandboxClient' | 'signal'>>;
  /**
   * Inherited `TRACE_ID` / `PARENT_SPAN_ID` for the box, merged into `CreateSandboxOptions.env` so
   * the remote worker's own spans join the supervisor's trace under the spawning node's span.
   * Absent when the run records no spans — the create options are then untouched.
   */
  readonly traceEnv?: Record<string, string>;
  readonly contentRef: (prefix: string, value: unknown) => string;
  readonly now?: () => number;
}
/** One steerable sandbox worker. The returned session is inert until `stream()` is drained. */
declare function createSteerableSandboxSession(args: SteerableSandboxArgs): SteerableSandboxSession;
//#endregion
//#region src/runtime/supervise/runtime.d.ts
/**
 * Router/inline transport seam. The profile owns model, prompt, and generation behavior.
 */
interface RouterSeam {
  routerBaseUrl: string;
  routerKey: string;
  /** Injectable transport for offline/local execution; still passes through Runtime metering. */
  complete?: RouterConfig['complete'];
  /** When present, return one turn's requested tool calls without executing them. */
  tools?: ReadonlyArray<ToolSpec>;
}
/**
 * Sandbox executor seam. The `sandboxClient` the composed `runAgentRounds` creates
 * boxes through, plus the optional trace/run/lineage wiring forwarded into the
 * loop. `lineage` is opaque here (PR #150's `RunAgentRoundsOptions.lineage`): forwarded
 * forward-compatibly, never inspected — this executor does NOT reinvent
 * checkpoint/fork.
 */
interface SandboxSeam {
  sandboxClient: SandboxClient;
  /** Forwarded into the composed `runAgentRounds`'s `ctx` (trace emitter, run handle, etc.). */
  loopCtx?: Partial<Omit<ExecCtx, 'sandboxClient' | 'signal'>>;
  /** PR #150 `RunAgentRoundsOptions.lineage` passthrough — opaque; forwarded, not parsed. */
  lineage?: unknown;
  /** Hard cap on the composed loop's iterations. The budget pool reserves against
   *  the spawn `Budget.maxIterations`; this is the leaf's own ceiling. Default 1. */
  maxIterations?: number;
  /**
   * OPT-IN executable score for this worker. Forwarded to the composed
   * `runAgentRounds` as its `validator`, so the kernel calls `validate` while the
   * iteration's box is still alive: `ValidationCtx.box` is a LIVE `SandboxInstance`
   * and the check can run commands or read files in the container it is scoring.
   * Every other supervised hook fires after teardown and can only read the artifact.
   *
   * The resulting verdict becomes the winner's verdict, which this executor already
   * surfaces on its `ExecutorResult`. Absent, nothing changes: the loop runs
   * unscored and the leaf falls back to its own settle verdict.
   *
   * Not representable with `steering` — a steerable session is a multi-turn session
   * on one box, not a `runAgentRounds` composition, so the pair is rejected instead
   * of silently dropping the score.
   */
  validator?: Validator<SandboxLeafOut>;
  /**
   * OPT-IN: run this worker as a multi-turn, STEERABLE session instead of the historical
   * single-shot `runAgentRounds` composition. Setting it gives the sandbox worker an `Executor.deliver`
   * inbox (so `Scope.send` / `steer_agent` actually reach it), a live tool-activity trace, and a
   * `progress()` read — turning the default cloud worker from something a supervisor can only
   * wait on into something it can watch and correct.
   *
   * Absent, nothing changes: the same `runAgentRounds` leaf, no inbox, `steer_agent` still reports
   * `delivered:false`. Opt-in because a steerable worker holds ONE box across several turns,
   * which is a different resource profile from a fire-and-forget shot.
   */
  steering?: SandboxSteeringOptions;
}
/**
 * UNMETERED CLI subprocess seam. `bin` + `args` describe the process to spawn.
 *
 * READ THIS BEFORE CHOOSING `backend: 'cli'`. This backend pipes a prompt to a subprocess's stdin
 * and reads its stdout. It has no usage receipt of any kind, so it reports its spend with
 * `Spend.tokensKnown: false`: the work is recorded, its `{0,0}` tokens and `$0` are a FLOOR rather
 * than a measurement, and a ceiling priced from either is a ceiling that cannot fire. The executor
 * is also `budgetExempt: true`, which is why `driveHarnessFromBackend` refuses it outright rather
 * than pretending to budget it.
 *
 * If you need a metered harness worker, use `backend: 'bridge'` (a cli-bridge session, which
 * reports the harness's real per-turn tokens and cost) or `backend: 'cli-worktree'` with
 * `codexReproducible`. Reach for this seam only when the subprocess genuinely is not an inference
 * agent, or when you have accepted that its cost is invisible.
 *
 * `args` is argv for a LOCAL, in-process spawn under this process's own privileges. It is not a
 * remote channel and nothing forwards it over a wire.
 */
interface CliSeam {
  bin: string;
  args?: string[];
  /** Extra environment for the subprocess (merged over `process.env`). */
  env?: Record<string, string>;
  /** Working directory for the subprocess. */
  cwd?: string;
}
/**
 * cli-worktree seam. A supervisor-authored `AgentProfile` driving a local coding-harness CLI
 * (claude / codex / opencode) on its own git worktree — the leaf `createWorktreeCliExecutor`
 * named as data. `repoRoot` is transport data; `AgentProfile.harness` selects the CLI.
 * `taskPrompt` remains an optional direct-call fallback for callers that execute with `undefined`.
 * The authored
 * `profile.prompt.systemPrompt` + `profile.model.default` reach the harness via the §1.5
 * `harnessInvocation` mapper. Everything else mirrors `WorktreeCliExecutorOptions`.
 */
interface CliWorktreeSeam {
  repoRoot: string;
  taskPrompt?: string;
  runId?: string;
  baseRef?: string;
  harnessTimeoutMs?: number;
  /** Isolated, network-off Codex execution with terminal JSONL usage capture. */
  codexReproducible?: boolean;
  /** Absolute host paths denied to reproducible Codex. */
  codexReadDeniedPaths?: ReadonlyArray<string>;
  testCmd?: string;
  typecheckCmd?: string;
  checkTimeoutMs?: number;
  checkOutputCap?: number;
  budgetExempt?: boolean;
  /** Live cli-bridge transport inside the worktree. When set, the worktree leaf accepts
   *  `deliver()` messages and resumes the same bridge session in this worktree cwd. */
  bridge?: CliWorktreeBridgeSeam;
  /** Test seam — forwarded to worktree helpers. */
  runGit?: GitRunner;
  /** Test seam — forwarded to verification checks. */
  runCommand?: WorktreeCheckRunner;
}
/**
 * cli-in-place seam. A supervisor-authored `AgentProfile` driving a local coding-harness CLI
 * (claude-code / codex / opencode / pi) on a workspace the CALLER supplies — the leaf
 * `createInPlaceCliExecutor` named as data. `workspacePath` is transport data;
 * `AgentProfile.harness` selects the CLI, and the authored `profile.prompt.systemPrompt` +
 * `profile.model.default` reach the harness via the §1.5 `harnessInvocation` mapper.
 *
 * READ THIS BEFORE CHOOSING BETWEEN THIS AND `cli-worktree`. They differ in ONE thing, and it is
 * the thing that decides which one a caller wants:
 *
 *   - `cli-worktree` cuts a git worktree of its OWN off `repoRoot`, runs the harness there,
 *     returns the captured patch, and removes the worktree at teardown. The directory it was
 *     given is never edited. That is correct for a fanout of N candidate authors that must not
 *     clobber each other, and for a caller whose deliverable IS the patch.
 *   - `cli-in-place` runs the harness in `workspacePath` itself. The edits stay in that directory
 *     after the call, so the NEXT call sees them. That is what a caller needs when the workspace
 *     has to persist between calls — a multi-shot author resuming on top of its own edits
 *     (`agenticGenerator`), or a candidate directory the caller commits itself.
 *
 * Because the workspace persists, so would the profile inputs this path materializes into it. They
 * are removed before the call returns, so the directory a caller inspects afterwards holds the
 * harness's own edits and nothing else, and a `git status` over it answers "did the author change
 * anything" rather than "did Runtime write a settings file".
 *
 * There is no reproducible-Codex mode here: that mode stages an executable and a write probe INTO
 * its working directory, which a caller-owned workspace is not the place for. Use `cli-worktree`
 * with `codexReproducible` when the isolated, metered Codex run is what you want.
 */
interface CliInPlaceSeam {
  /** Absolute path to the EXISTING directory the harness edits. Runtime never creates, cleans, or
   *  removes it. */
  workspacePath: string;
  taskPrompt?: string;
  harnessTimeoutMs?: number;
  /** Test seam — inject the harness runner so unit tests script a `LocalHarnessResult`. */
  runHarness?: typeof runLocalHarness;
}
interface CliWorktreeBridgeSeam {
  bridgeUrl: string;
  bridgeBearer: string;
  /** Caller-owned deadline for each bridge turn. Runtime enforces it locally and sends the
   *  same value in `execution.timeoutMs` so cli-bridge cannot substitute its own cutoff. */
  timeoutMs?: number;
  /** Stable cli-bridge session id. Defaults to `bridge-worktree-${runId}`. */
  sessionId?: string;
  /** Transport reconnects allowed after the first POST. Default 3; set 0 to disable. */
  maxReconnects?: number;
}
/**
 * Generic environment provider executor config. External packages implement
 * `AgentEnvironmentProvider`; this built-in wrapper lets `createExecutor` consume them as backend
 * data while preserving the existing usage channel. Runtime depends on no provider package, so a
 * Tangle provider and a hand-written one compose identically. Worked wiring:
 * `examples/provider-executor/`.
 *
 * Everything a create needs travels on `CreateAgentEnvironmentInput` through
 * {@link ProviderExecutorOptions.defaults}; everything one turn needs travels on
 * {@link ProviderExecutorOptions.promptOptions}. Wrapping the provider's own client to reach a
 * field is what this seam exists to replace: the wrapper is invisible to Runtime, so its options
 * are absent from every record the run produces.
 *
 * READINESS IS THE PROVIDER'S CONTRACT. `provider.create` resolves with an environment that can
 * take a turn, so this seam streams straight into it and adds no readiness wait of its own. The
 * sandbox seam's `acquireSandbox` exists because a raw `SandboxClient.create` returns before the
 * box is ready; a second poll here would hide a provider that does not honor the contract, and
 * that provider is an upstream defect to report rather than a race to paper over.
 */
interface ProviderSeam extends ProviderExecutorOptions {
  provider: AgentEnvironmentProvider$1 | string;
  registry?: AgentEnvironmentProviderRegistry;
  /**
   * Compose the provider through the existing steerable sandbox session.
   * The exact profile must name its harness, and the provider must expose live
   * continuation plus session controls. The provider still owns environment
   * creation and session semantics.
   */
  steering?: SandboxSteeringOptions;
  /**
   * Place each worker whose profile a shared box can carry as its own process in a pool of shared
   * boxes, and keep a dedicated environment from `provider` for every other profile. Build it with
   * `sharedBoxPlacement`. A manager never uses it: its coordination credential is create-time
   * environment that every co-tenant of a shared box could read.
   */
  shared?: SharedBoxPlacement;
}
/**
 * Router seam WITH tool use — the tool-using router backend. Same direct
 * OpenAI-compatible endpoint as `RouterSeam`, but each turn passes `tools`; when
 * the model emits tool_calls they run via `executeToolCall` ON THIS HOST and the
 * results fold back as `tool` messages, repeating until the model answers without
 * a tool or `maxTurns` is hit. A real agentic loop, OFF-BOX — no sandbox, so it
 * is unaffected by a box's egress allowlist. One turn = one completion = the
 * equal-compute unit. `executeToolCall` receives the task so per-task tool
 * surfaces (e.g. a gym keyed by task) can dispatch correctly.
 */
interface RouterToolsSeam {
  routerBaseUrl: string;
  routerKey: string;
  complete?: RouterConfig['complete'];
  tools: ReadonlyArray<ToolSpec>;
  executeToolCall: (name: string, args: Record<string, unknown>, task: unknown) => Promise<string>;
  /** Exact conversation to continue. Runtime validates its system message against the profile. */
  initialMessages?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Observe the detached final conversation for session persistence. */
  onMessages?: (messages: ReadonlyArray<Readonly<Record<string, unknown>>>) => void | Promise<void>;
  /** Online observer of each tool step — the seam a `DetectorMonitor` taps to watch the live pipe
   *  (raise a `finding` when the worker loops/errors). Called after every tool call resolves, with
   *  real per-call wall-clock (`startedAt`/`endedAt`/`durationMs`) so a push `TraceSource` can carry
   *  non-zero span durations onto the unified timeline. */
  onToolStep?: (step: {
    toolName: string;
    args: Record<string, unknown>;
    status: 'ok' | 'error';
    startedAt?: number;
    endedAt?: number;
    durationMs?: number;
  }) => void;
}
/**
 * The leaf `createWorktreeCliExecutor` as a backend-as-data factory: a supervisor-authored
 * `AgentProfile` driving claude / codex / opencode on its own worktree. `budgetExempt` like
 * the other CLI leaves; the authored systemPrompt + model reach the harness via §1.5.
 */
declare const cliWorktreeExecutor: ExecutorFactory<unknown>;
/**
 * The leaf `createInPlaceCliExecutor` as a backend-as-data factory: a supervisor-authored
 * `AgentProfile` driving a local coding CLI in the workspace the caller supplied, so its edits are
 * still there for the next spawn. `budgetExempt` like the other CLI leaves; the authored
 * systemPrompt + model reach the harness via §1.5.
 */
declare const cliInPlaceExecutor: ExecutorFactory<unknown>;
/**
 * Config for {@link createExecutor}: the backend is DATA — the cost dial a profile,
 * an experiment config, or a replay journal can name — not an import choice. Each
 * variant carries its backend's seam.
 */
type ExecutorConfig = ({
  backend: 'router';
} & RouterSeam) | ({
  backend: 'router-tools';
} & RouterToolsSeam) | ({
  backend: 'bridge';
} & BridgeSeam) | ({
  backend: 'cli';
} & CliSeam) | ({
  backend: 'cli-worktree';
} & CliWorktreeSeam) | ({
  backend: 'cli-in-place';
} & CliInPlaceSeam) | ({
  backend: 'provider';
} & ProviderSeam) | ({
  backend: 'sandbox';
} & SandboxSeam);
/**
 * The single built-in executor factory. Picks a leaf backend by data (`config.backend`),
 * injects the matching seam, and delegates to that backend's built-in implementation.
 * The `Executor` port stays OPEN: bring-your-own agents implement `Executor` directly, while Scope
 * or `createExecutorRegistry` still parses and seals their exact profile before use. Use this instead of a
 * per-vendor adapter or a closed `inline|sandbox|cli` switch — those bypass the
 * `UsageEvent` reporting channel.
 */
declare function createExecutor(config: ExecutorConfig): ExecutorFactory<unknown>;
/**
 * The open resolver/registry. Pre-registers the three built-ins under their
 * runtime tags (`'router'`, `'sandbox'`, `'cli'`) and accepts `register(name,
 * factory)` for any additional runtime. A BYO `AgentSpec.executor` has highest routing precedence
 * after the same exact-profile intake validation. Registration + BYO remain open extension points.
 *
 * `resolve` precedence (frozen in `ExecutorRegistry`): a BYO `spec.executorFactory` →
 * `spec.executor` → `harness === null` → the `'router'` factory; else a registered factory for the
 * harness-derived runtime (`'sandbox'` for any `BackendType`); else fail loud.
 */
declare function createExecutorRegistry(): ExecutorRegistry;
//#endregion
//#region src/runtime/stream-agent-turn.d.ts
/**
 * The execution substrate one turn runs on — a closed discriminated union over
 * the three stream surfaces the runtime already owns.
 *
 * @stable
 */
type AgentTurnBackend = {
  /** A Runtime-owned executor factory materialized from this exact canonical profile. */
  kind: 'executor';
  factory: ExecutorFactory<unknown>;
  /** Exact canonical identity materialized by the executor. */
  profile: AgentProfile;
  /** Model label stamped on cost-only `llm_call` events. Default `'agent'`. */
  agentRunName?: string;
};
/** @stable */
interface StreamAgentTurnOptions {
  /** Caller-initiated cancellation. Terminates the stream with `final.status: 'aborted'`. */
  signal?: AbortSignal;
  /**
   * Wall-clock deadline for the whole turn in ms. An expired deadline aborts
   * the backend and terminates the stream with `final.status: 'failed'`
   * (a blown deadline is a turn failure, not a caller cancellation).
   */
  timeoutMs?: number;
  /** Stable logical paid-call id, forwarded as the provider idempotency key and retained in evidence. */
  callId?: string;
  /** Caller trace tag retained in evidence and forwarded when the transport supports it. */
  correlationId?: string;
  /**
   * Opt-in tool-part projection for box and executor backends: sandbox tool
   * parts additionally surface in-stream as
   * `tool_call` / `tool_result` events (`mapSandboxToolEvent`), so a consumer
   * rendering tool activity needs no bespoke sandbox-event parser. Default
   * off — the stream vocabulary existing consumers see is unchanged. No-op
   * for the `chat` kind (its backend emits `RuntimeStreamEvent`s directly,
   * tool events included when the backend produces them).
   */
  preserveToolParts?: boolean;
  /**
   * Raw-event tap for box-kind backends: called (and awaited) with every
   * unmapped `SandboxEvent` BEFORE it is projected, so a consumer can read
   * parts the chat-UX projection drops (part ids, step markers, custom
   * backend events) without forking the mapper. Purely observational — it
   * cannot alter the mapped stream. Never called for the `chat` kind, which
   * has no sandbox events.
   */
  onRawEvent?: (event: SandboxEvent) => void | Promise<void>;
}
/**
 * Metered usage of one turn, summed over every cost-bearing event the backend
 * emitted. `input`/`output` are token counts and are accompanied by
 * `tokensKnown: false` when the backend did not report them. `costUsd`/`model`
 * are present only when the backend actually reported them.
 *
 * @stable
 */
interface AgentTurnUsage {
  input: number;
  output: number;
  /** Present when a real turn ran but the provider did not report token usage. */
  tokensKnown?: false;
  costUsd?: number;
  /** Present when Runtime could not prove the full dollar amount. */
  usdKnown?: false;
  /** Separately-labelled local/catalog estimate; never billed spend. */
  estimatedCostUsd?: number;
  /** Provider-reported prompt-cache fields; absent fields remain unknown. */
  promptCache?: Readonly<Record<string, number | string>>;
  /** Provider-reported reasoning-token subset of output, when available. */
  reasoningTokens?: number;
  model?: string;
}
/**
 * A drained turn: the terminal summary plus every event the stream yielded.
 * `status`/`error` mirror the terminal `final` event so a failed or aborted
 * turn stays inspectable without re-scanning `events`.
 *
 * @stable
 */
interface CollectedAgentTurn {
  finalText: string;
  /** Exact terminal artifact output from a Runtime-owned executor. */
  output?: unknown;
  usage: AgentTurnUsage;
  /** Exact underlying transport calls when the Runtime-owned executor reports them. */
  transportAttempts?: number;
  toolCalls: Array<{
    id?: string;
    name: string;
    arguments: string;
  }>;
  events: RuntimeStreamEvent[];
  status: AgentTaskStatus;
  error?: BackendErrorDetail;
  /** Public Sandbox outcome, when the turn ran through a Sandbox stream or executor. */
  sandboxOutcome?: AgentRunOutcome;
}
/**
 * Run ONE agent turn on any backend kind and stream its events. Yields the
 * `RuntimeStreamEvent` vocabulary incrementally and always ends with a `final`
 * event carrying the turn's text and usage (`metadata.tokenUsage`,
 * `metadata.costUsd?`, `metadata.model?`) — on success, failure, abort, and
 * timeout alike. The generator never throws; failures surface in-band as
 * `backend_error` + `final` with a typed `error` detail.
 *
 * @stable
 */
declare function streamAgentTurn(backend: AgentTurnBackend, input: AgentTurnInput, opts?: StreamAgentTurnOptions): AsyncGenerator<RuntimeStreamEvent>;
/**
 * Drain a `streamAgentTurn` stream (or any `RuntimeStreamEvent` stream that
 * honors its terminal contract) into the turn summary plus the full event
 * list. Fail-loud: throws when the stream ends without a terminal `final`
 * event — a stream that violates the contract must not read as an empty turn.
 *
 * @stable
 */
declare function collectAgentTurn(stream: AsyncIterable<RuntimeStreamEvent>): Promise<CollectedAgentTurn>;
//#endregion
export { decodeHarnessUsage as $, PeerMailLimits as $n, ResourceRequest as $t, createInbox as A, DEFAULT_LOCAL_HARNESS as An, AgentEnvironmentProvider$1 as At, secretEnvOfMcpServer as B, ToolSpec as Bn, AgentTurnResult$2 as Bt, SteerableSandboxArgs as C, WorktreeHandle as Cn, mapSandboxToolEvent as Ct, Inbox as D, CodexExecutionEvidence as Dn, AgentEnvironment$1 as Dt, AuthorityInboxMessage as E, removeWorktree as En, sumSandboxUsage as Et, ResolvedMcpServerLaunch as F, harnessSupportsReasoningEffort as Fn, AgentEnvironmentSummary as Ft, CodexRolloutStoreRef as G, ToolLoopMessageRecord as Gn, ExecRequest as Gt, CodexRolloutIdentity as H, ToolLoopChat as Hn, CheckpointRequest as Ht, envKeyProvider as I, localHarnessExecutable as In, AgentProfileRef$1 as It, addHarnessUsage as J, DEFAULT_PEER_MAIL_LIMITS as Jn, PlacementInfo as Jt, CodexRolloutTurn as K, ToolLoopToolCall as Kn, ExecResult as Kt, mcpSecretEnvMetadataKey as L, parseCodexTokenUsage as Ln, AgentSession as Lt, BridgeModelCredential as M, LocalHarness as Mn, AgentEnvironmentProviderRegistry as Mt, BridgeSeam as N, LocalHarnessResult as Nn, AgentEnvironmentQuery as Nt, InboxMessage as O, CodexExecutionPolicy as On, AgentEnvironmentCapabilities$1 as Ot, KeyProvider as P, RunLocalHarnessOptions as Pn, AgentEnvironmentStatus as Pt, HarnessUsage as Q, PeerMailKind as Qn, ProviderPromptOptions as Qt, resolveMcpServerLaunch as R, runLocalHarness as Rn, AgentSessionRef as Rt, SandboxSteeringOptions as S, RemoveWorktreeOptions as Sn, mapSandboxEvent as St, createSteerableSandboxSession as T, createWorktree as Tn, sandboxProgressEvents as Tt, CodexRolloutSession as U, ToolLoopCompaction as Un, CreateAgentEnvironmentInput$1 as Ut, CodexForkBoundary as V, ToolLoopCallContext as Vn, CheckpointRef as Vt, CodexRolloutStoreReader as W, ToolLoopCompactionOptions as Wn, DEFAULT_SANDBOX_IDLE_TIMEOUT_SECONDS as Wt, harnessUsageIsEmpty as X, PeerMailEnvelope as Xn, ProviderExecutorOptions as Xt, createCodexRolloutStoreReader as Y, PEER_MAIL_WIRE_KEY as Yn, ProviderAsSandboxClientOptions as Yt, readCodexRolloutSession as Z, PeerMailEvent as Zn, ProviderLeafOut as Zt, cliInPlaceExecutor as _, WorktreeProfileMaterializationReceipt as _n, defaultRedactor as _r, SandboxUsageLedger as _t, StreamAgentTurnOptions as a, resolveAgentEnvironmentProvider as an, PeerMailboxOptions as ar, SharedBoxPlacement as at, createExecutorRegistry as b, DiffResult as bn, createSandboxUsageLedger as bt, CliInPlaceSeam as c, SandboxControlClient as cn, isPeerMailEnvelope as cr, SharedBoxStats as ct, CliWorktreeSeam as d, ProviderWorkspaceRetentionPort as dn, JsonRpcMessage as dr, sharedBoxRefusal as dt, SandboxClientProviderOptions as en, PeerMailOutcome as er, DEFAULT_SHARED_BOX_RESOURCES as et, ExecutorConfig as f, ProviderPlacement as fn, JsonRpcResponse as fr, sharedWorkerClientName as ft, SandboxSeam as g, WorktreeHarnessResult as gn, Redactor as gr, SandboxToolPartState as gt, RouterToolsSeam as h, WorktreeCommandResult as hn, McpTransport as hr, SandboxServedBackend as ht, CollectedAgentTurn as i, providerAsSandboxClient as in, PeerMailbox as ir, SharedBoxHandle as it, BridgeHarnessStore as j, LOCAL_HARNESSES as jn, AgentEnvironmentProviderRef as jt, PeerInboxMessage as k, CodexTokenUsage as kn, AgentEnvironmentEvent$1 as kt, CliSeam as l, createTangleSandboxExactProcessProvider as ln, peerMailTools as lr, SharedWorkerIdentity as lt, RouterSeam as m, WorktreeCheckRunner as mn, McpToolDescriptor as mr, SandboxOutputMarker as mt, AgentTurnInput$1 as n, createAgentEnvironmentProviderRegistry as nn, PeerMailRefusal as nr, ROUTER_CLIENT_HEADER as nt, collectAgentTurn as o, sandboxClientAsProvider as on, claimsAuthority as or, SharedBoxPlacementOptions as ot, ProviderSeam as p, InPlaceHarnessResult as pn, McpToolAnnotations as pr, SandboxLeafOut as pt, CodexStoreDelta as q, AUTHORITY_MARKERS as qn, ForkRequest as qt, AgentTurnUsage as r, providerAsExecutor as rn, PeerMailSendInput as rr, SharedBoxCloseReceipt as rt, streamAgentTurn as s, CreateTangleSandboxExactProcessProviderOptions as sn, createPeerMailbox as sr, SharedBoxProcess as st, AgentTurnBackend as t, WorkspaceRequest as tn, PeerMailReadout as tr, DEFAULT_SHARED_BOX_WORKERS as tt, CliWorktreeBridgeSeam as u, ProviderWorkspaceRetentionContext as un, peerMailVerbNames as ur, sharedBoxPlacement as ut, cliWorktreeExecutor as v, CreateWorktreeOptions as vn, resolveRedactor as vr, assertSandboxServedModel as vt, SteerableSandboxSession as w, captureWorktreeDiff as wn, sandboxEventServedBackend as wt, DEFAULT_SANDBOX_STEERING_MAX_TURNS as x, GitRunner as xn, extractLlmCallEvent as xt, createExecutor as y, DiffOptions as yn, createSandboxToolPartState as yt, resolveSecretEnv as z, RouterTransportConfig as zn, AgentSessionStatus$1 as zt };
//# sourceMappingURL=stream-agent-turn-Bk79CnTw.d.ts.map