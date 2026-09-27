import { At as TraceContext, Mt as mergeTraceEnv, Nt as readTraceContextFromEnv, Pt as traceContextToEnv, ba as SandboxClient, jt as createPropagatingTraceEmitter, la as LoopSandboxPlacement } from "../types-D56jQad-.js";
import { $d as DEFAULT_AWAIT_EVENT_TIMEOUT_MS, $f as DelegateHandlerOptions, $p as DelegateResearchResult, Af as createCoordinationTools, Am as createDelegationTraceCollector, Ap as createDetachedTurnResumeDriver, Bd as AnalystRegistry, Bf as SpawnResourceReader, Bp as DelegationRunContext, Cm as DELEGATION_TRACE_MAX_SPANS, Cp as createSiblingSandboxExecutor, Df as WorkerWatchOptions, Dm as buildDelegationTraceSpans, Dp as DriveTurnCapableBox, Ef as WorkerSpawnContext, Em as DelegationTraceSpan, Ep as DetachedTurnResumeDriverOptions, Fd as ANALYST_DEFINITION_BOUNDS, Ff as ResolveSpawnResourcePathsResult, Fm as FileDelegationStoreOptions, Fp as DelegationArgs, Gd as AuthorizeDownMessage, Gf as McpServerOptions, Gp as hashIdempotencyInput, Hf as hostDirectoryReader, Hp as DelegationTaskQueueOptions, Id as AnalystDefinitionIssue, If as ResolvedSpawnResourcePath, Im as InMemoryDelegationStore, Ip as DelegationRecord, Jf as DELEGATE_DESCRIPTION, Jp as DelegateCodeResult, Kd as AuthorizedDownMessage, Kf as createInProcessTransport, Kp as DelegateCodeArgs, Ld as AnalystFindingEvent, Lf as SPAWN_RESOURCE_PATH_MAX_BYTES, Lm as CoderOutput, Lp as DelegationResumeContext, Mm as DelegationStateCorruptError, Mp as formatDetachedSessionRef, Nf as parseAuthoredAnalystDefinition, Nm as DelegationStore, Np as parseDetachedSessionRef, Of as analystToolGroupNames, Om as capDelegationTrace, Op as DriveTurnTick, Pf as questionEscalationTargets, Pm as FileDelegationStore, Pp as runDetachedTurn, Qd as CoordinationToolsOptions, Qf as DelegateError, Qp as DelegateResearchConfig, Rd as AnalystKind, Rf as SpawnResourceBytes, Rp as DelegationResumeDriver, Sm as DELEGATION_TRACE_MAX_BYTES, Sp as createFleetWorkspaceExecutor, Tm as DelegationTraceCollector, Tp as DetachedTurn, Ud as AuthoredAnalystDefinition, Uf as resolveSpawnResourcePaths, Up as SubmitInput, Vd as AnalystToolGroupName, Vf as environmentReader, Vp as DelegationTaskQueue, Wd as AuthoredAnalystLimits, Wf as McpServer, Wp as SubmitOutput, Xf as DELEGATE_TOOL_NAME, Xp as DelegateFeedbackResult, Yd as CoordinationEvent, Yf as DELEGATE_INPUT_SCHEMA, Yp as DelegateFeedbackArgs, Zd as CoordinationTools, Zf as DelegateArgs, Zp as DelegateResearchArgs, _f as QuestionRecord, _m as ResearchOutputShape, _p as settleDetachedCoderTurn, af as EscalateQuestion, am as DelegationFeedbackSnapshot, ap as InMemoryFeedbackStore, bm as delegationProfiles, bp as FleetWorkspaceExecutorOptions, cf as ManagerReentryState, cm as DelegationHistoryResult, cp as CoderReview, df as QuestionEscalationOutcome, dm as DelegationResultPayload, dp as DetachedSessionDelegateOptions, ef as DefinedAnalystRecord, em as DelegateUiAuditArgs, ep as DelegateResult, ff as QuestionEscalationRecord, fm as DelegationStatus, fp as DetachedWinnerSelection, gf as QuestionPolicy, gm as FeedbackRefersTo, gp as detachedSessionDelegate, hf as QuestionOption, hm as FeedbackRating, hp as coderTaskFromArgs, if as DownMessageEvent, im as DelegationError, ip as FeedbackStore, jf as downMessageRefusalReasons, jm as DelegationPersistenceError, jp as detachedTurnEvents, km as composeLoopTraceEmitters, kp as RunDetachedTurnOptions, lf as Question, lm as DelegationProfile, lp as CoderReviewer, mf as QuestionLevel, mm as DelegationStatusResult, mp as UiAuditorDelegate, nf as DownMessageDeliveryAttempt, nm as DelegateUiAuditResult, np as validateDelegateArgs, of as EventAcknowledgement, om as DelegationHistoryArgs, op as eventToSnapshot, pf as QuestionEscalationTarget, pm as DelegationStatusArgs, pp as SettleDetachedCoderTurnOptions, qd as ContinuationInstruction, qf as createMcpServer, qp as DelegateCodeConfig, rf as DownMessageDeliveryOutcome, rm as DelegateUiAuditRoute, rp as FeedbackEvent, sf as MakeWorkerAgent, sm as DelegationHistoryEntry, sp as CoderDelegate, tf as DownMessageAuthorizationInput, tm as DelegateUiAuditConfig, tp as createDelegateHandler, uf as QuestionDecision, um as DelegationProgress, up as DelegateRunCtx, vf as QuestionUrgency, vm as UiAuditLensFilter, vp as DelegationExecutor, wm as DelegationTraceCaps, wp as DetachedSessionRefParts, xm as CappedDelegationTrace, xp as SiblingSandboxExecutorOptions, yf as SettledWorker, ym as UiAuditorDelegationOutput, yp as FleetHandle, zf as SpawnResourceRead, zp as DelegationResumeTick } from "../index-Dm8SHDGW.js";
import { An as DEFAULT_LOCAL_HARNESS, Cn as WorktreeHandle, Dn as CodexExecutionEvidence, En as removeWorktree, Fn as harnessSupportsReasoningEffort, In as localHarnessExecutable, Ln as parseCodexTokenUsage, Mn as LocalHarness, Nn as LocalHarnessResult, On as CodexExecutionPolicy, Pn as RunLocalHarnessOptions, Rn as runLocalHarness, Sn as RemoveWorktreeOptions, Tn as createWorktree, bn as DiffResult, dr as JsonRpcMessage, fr as JsonRpcResponse, hr as McpTransport, jn as LOCAL_HARNESSES, kn as CodexTokenUsage, mr as McpToolDescriptor, pr as McpToolAnnotations, vn as CreateWorktreeOptions, wn as captureWorktreeDiff, xn as GitRunner, yn as DiffOptions } from "../stream-agent-turn-Bk79CnTw.js";
import { d as ResearchSource, o as UiLens } from "../substrate-CHQ5GYnU.js";
import { a as KbGateResult, i as FactJudgeVerdict, n as FactCandidate, o as createKbGate, r as FactJudge, t as CreateKbGateOptions } from "../kb-gate-C8z2juK8.js";
import { n as mcpToolsForRuntimeMcpSubset, t as mcpToolsForRuntimeMcp } from "../openai-tools-H8QPhTVE.js";
import { AgentProfileMcpServer, HarnessType } from "@tangle-network/agent-interface";
//#region src/mcp/codex-diagnostics.d.ts
/** Bounded, credential-redacted process context attached when reproducible Codex output fails
 * validation. The process still fails closed; this only preserves enough evidence to diagnose it. */
interface CodexExecutionFailureDiagnostic {
  exitCode: number | null;
  killedBySignal: NodeJS.Signals | null;
  timedOut: boolean;
  aborted?: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}
/** Thrown when reproducible Codex exits without one valid terminal usage event. */
declare class CodexExecutionDiagnosticError extends Error {
  readonly reason: string;
  readonly diagnostic: CodexExecutionFailureDiagnostic;
  readonly code = "CODEX_EXECUTION_DIAGNOSTIC";
  constructor(reason: string, diagnostic: CodexExecutionFailureDiagnostic, cause?: unknown);
}
//#endregion
//#region src/mcp/bin-helpers.d.ts
/** @experimental */
interface DetectExecutorArgs {
  sandboxClient: SandboxClient;
  /** Raw env (defaults to `process.env`). Pass an explicit map for tests. */
  env?: Record<string, string | undefined>;
  /**
   * Override how a fleet handle is resolved from the client + fleet id. The
   * default reads `client.fleets.get(fleetId)` and validates the returned
   * shape against the structural `FleetHandle` contract.
   */
  resolveFleet?: (client: SandboxClient, fleetId: string) => Promise<FleetHandle>;
}
/**
 * Pick the right executor for an MCP server invocation based on env vars.
 *
 * - `TANGLE_FLEET_ID` set → fleet-workspace placement; resolves the handle
 *   via `sandboxClient.fleets.get(...)`.
 * - Otherwise → sibling-sandbox placement; each delegation creates a fresh
 *   sandbox via `sandboxClient.create(...)`.
 *
 * Fails loud (throws) when fleet mode is requested but the SDK shape is
 * incompatible — the operator chose fleet semantics, silently degrading to
 * sibling mode would lie about workspace topology.
 *
 * @experimental
 */
declare function detectExecutor(args: DetectExecutorArgs): Promise<DelegationExecutor>;
//#endregion
//#region src/mcp/harness-native-tools.d.ts
/**
 * Sourced native sub-agent tool names, keyed by the same `HarnessType` vocabulary the rest of the
 * runtime draws harness names from, so a harness the interface renames is a compile error here.
 */
declare const harnessNativeTools: {
  readonly codex: readonly ["spawn_agent", "send_input", "resume_agent", "close_agent", "list_agents", "wait_agent", "send_message", "interrupt_agent", "followup_task"];
  readonly 'claude-code': readonly ["Agent", "Task", "SendMessage", "TaskStop", "KillAgent"];
  readonly opencode: readonly ["task"];
};
/** A harness with a sourced native tool list. */
type SourcedHarness = keyof typeof harnessNativeTools;
/** The harnesses this registry has a sourced list for. */
declare const sourcedHarnesses: ReadonlyArray<SourcedHarness>;
/**
 * The tool names `harness` publishes natively, or `undefined` when no list has been sourced for it.
 * The two are different facts and a caller must not read one as the other.
 */
declare function harnessNativeToolNames(harness: HarnessType): ReadonlyArray<string> | undefined;
/**
 * The sourced harnesses that publish `name` natively — empty when the name is clear of all of them.
 *
 * The comparison folds case. A model resolving a bare word out of a prompt does not hold the
 * harness's exact casing, so `task` and `Task` are one collision, not two distinct names.
 */
declare function collidesWithHarnessNativeTool(name: string): ReadonlyArray<SourcedHarness>;
//#endregion
//#region src/mcp/in-process-executor.d.ts
/** @experimental */
interface InProcessExecutorOptions {
  /** Absolute path to the git repo (the workspace). Worktrees go under `<repoRoot>/.agent-worktrees/`. */
  repoRoot: string;
  /** Optional per-delegation test command run in the worktree after the harness exits. */
  testCmd?: string;
  /** Optional per-delegation typecheck command. Same shape as `testCmd`. */
  typecheckCmd?: string;
  /** Optional wall-clock cap per harness subprocess (ms). Omit it for no timer. */
  harnessTimeoutMs?: number;
  /** Wall-clock cap per test/typecheck subprocess (ms). Default 2min. */
  postCheckTimeoutMs?: number;
  /** Test seam — override the git runner used by the worktree helpers. */
  runGit?: GitRunner;
  /** Test seam — override the harness runner (defaults to the real CLI via `runLocalHarness`). */
  runHarness?: typeof runLocalHarness;
  /** Test seam — override the post-check runner (defaults to a `sh -c` spawn). A throw is folded
   *  into a non-fatal `{exitCode:-1}` so a broken check command fails the signal, not the run. */
  runPostCheck?: (cmd: string, cwd: string, signal?: AbortSignal) => Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
}
/** @experimental */
interface InProcessExecutorDescribePlacement extends LoopSandboxPlacement {
  /** Worktree path in the parent sandbox's filesystem (set so traces correlate to on-disk artifacts). */
  worktreePath?: string;
  /** Which harness handled this delegation. */
  harness?: LocalHarness;
}
/**
 * Build an in-process executor. Returns a {@link DelegationExecutor} whose `client.create()`
 * returns a minimal virtual `SandboxInstance`; the kernel calls `streamPrompt(msg)` on it, which
 * runs the shared worktree-harness core and emits one `result` event whose `data.result` is the
 * raw `WorktreeHarnessResult` (the content-addressed patch artifact). The authored profile
 * (`backend.profile`) threads its systemPrompt + model into the harness via the core.
 *
 * There is no box, so a per-prompt `backend` or `model` override is refused rather than dropped;
 * other per-prompt options (`timeoutMs`, `context`) are accepted and ignored.
 *
 * @experimental
 */
declare function createInProcessExecutor(options: InProcessExecutorOptions): DelegationExecutor;
//#endregion
//#region src/mcp/tool-server.d.ts
/**
 * Protocol versions this server speaks, newest first. `initialize` answers with
 * the client's requested version when it is listed here, and otherwise with
 * `PROTOCOL_VERSION` (2024-11-05), which every client that speaks 2024-11-05 accepts.
 */
declare const SUPPORTED_PROTOCOL_VERSIONS: readonly string[];
/** @experimental */
interface StdioToolServerOptions {
  /** Server display name surfaced via `initialize`. */
  serverName: string;
  /** Server version surfaced via `initialize`. */
  serverVersion: string;
  /** The tools to serve. Duplicate names throw — a silent shadow would hide a tool. */
  tools: readonly McpToolDescriptor[];
}
/** @experimental */
interface StdioToolServer {
  /** Tools currently registered, keyed by name. */
  readonly tools: ReadonlyMap<string, McpToolDescriptor>;
  /** Handle a single parsed JSON-RPC message. Returns the response object (or `null` for notifications). */
  handle(message: JsonRpcMessage): Promise<JsonRpcResponse | null>;
  /** Drive the server on a stdio-shaped transport until `stop()` is called. */
  serve(transport?: McpTransport): Promise<void>;
  /** Stop a `serve` call. Subsequent requests are rejected. */
  stop(): void;
}
/** Build the generic stdio JSON-RPC tool server. */
declare function createStdioToolServer(options: StdioToolServerOptions): StdioToolServer;
//#endregion
//#region src/mcp/memory-server.d.ts
/** One row of agent memory: a crisp lesson/fact with provenance. */
interface MemoryItem {
  /** Stable id (content-hash by convention; see `memoryArtifactFromLessons`). */
  id: string;
  /** The lesson itself — one imperative or observation the agent should recall. */
  text: string;
  /** Optional retrieval tags, matched by `memory_search` alongside the text. */
  tags?: string[];
  /** Provenance: the finding / trace / curation pass this row came from. */
  source?: string;
}
/**
 * The `memory` artifact payload — HOW a profile's memory is stored and served:
 *
 *   - `store: 'file'` — served by the in-repo memory bin
 *     (`agent-runtime-memory-mcp`, src/mcp/memory-bin.ts): rows load from
 *     `path` (a JSON array or JSONL file of `MemoryItem`) and/or the inline
 *     `items` seed (inline wins on id collision). At least one of
 *     `path`/`items` is required.
 *   - `store: 'mcp'`  — an EXTERNAL, already-runnable MCP server that exposes
 *     the memory tools itself; `server` is required and mounts verbatim.
 *
 * `logPath` makes the served memory append one JSONL row per `memory_search`
 * — the retrieval log a holdout estimator reads (see module doc).
 */
interface AgentMemorySpec {
  store: 'file' | 'mcp';
  /** `store:'file'` — host path to the durable row store (JSON array or JSONL). */
  path?: string;
  /** Inline seed rows, served alongside (and winning over) `path` rows. */
  items?: MemoryItem[];
  /** `store:'mcp'` — the external server that already serves memory tools. */
  server?: AgentProfileMcpServer;
  /** JSONL retrieval log: one row per `memory_search` (ts, query, k, returned). */
  logPath?: string;
}
/** Env var naming the durable row store file the memory bin loads (the
 *  `memoryMcpServer` ↔ memory-bin contract). */
declare const MEMORY_FILE_ENV = "AGENT_MEMORY_FILE";
/** Env var carrying inline JSON `MemoryItem` rows (win over file rows on id). */
declare const MEMORY_ITEMS_ENV = "AGENT_MEMORY_ITEMS";
/** Env var naming the JSONL retrieval log (one row per `memory_search`). */
declare const MEMORY_LOG_ENV = "AGENT_MEMORY_LOG";
/** Env var overriding the served display name (default 'agent-memory'). */
declare const MEMORY_NAME_ENV = "AGENT_MEMORY_NAME";
interface CreateMemoryToolServerOptions {
  /** The rows to serve. MUST be non-empty (an empty memory is never served). */
  items: readonly MemoryItem[];
  /** Server display name surfaced via `initialize`. Default 'agent-memory'. */
  serverName?: string;
  /** Server version surfaced via `initialize`. Default '0'. */
  serverVersion?: string;
  /** Default result count for `memory_search`. Default 5. */
  defaultK?: number;
  /** Append one JSONL row per `memory_search` (the retrieval-holdout seam). */
  logPath?: string;
}
/**
 * Build the memory MCP server: `memory_search` (lexical top-k over the rows)
 * and `memory_get` (one row by id) on the generic stdio JSON-RPC core.
 */
declare function createMemoryToolServer(opts: CreateMemoryToolServerOptions): StdioToolServer;
/** Coerce an untrusted JSON array into validated `MemoryItem` rows. */
declare function parseMemoryItems(value: unknown, source: string): MemoryItem[];
/** Read a memory store file: a JSON array, or JSONL (one `MemoryItem` per line). */
declare function readMemoryItemsFile(path: string): MemoryItem[];
/** What the memory bin resolved from its environment. */
interface ResolvedMemoryEnv {
  items: MemoryItem[];
  serverName?: string;
  logPath?: string;
}
/**
 * Resolve the bin's memory from `AGENT_MEMORY_FILE` (durable store) and/or
 * `AGENT_MEMORY_ITEMS` (inline JSON rows; wins on id collision). Zero rows is
 * a boot FAILURE, matching the fail-closed materialization discipline.
 */
declare function resolveMemoryFromEnv(env: Record<string, string | undefined>): ResolvedMemoryEnv;
//#endregion
//#region src/mcp/tools/delegate-feedback.d.ts
/** MCP tool name for the `delegate_feedback` feedback-recording tool. @stable */
declare const DELEGATE_FEEDBACK_TOOL_NAME = "delegate_feedback";
/** Human-readable description of the `delegate_feedback` MCP tool, injected into the tool manifest. @stable */
declare const DELEGATE_FEEDBACK_DESCRIPTION: string;
/** JSON Schema for `delegate_feedback` tool arguments (`refersTo`, `rating`, `by`, optional fields). @stable */
declare const DELEGATE_FEEDBACK_INPUT_SCHEMA: {
  readonly type: "object";
  readonly properties: {
    readonly refersTo: {
      readonly type: "object";
      readonly properties: {
        readonly kind: {
          readonly type: "string";
          readonly enum: readonly ["delegation", "artifact", "outcome"];
        };
        readonly ref: {
          readonly type: "string";
        };
      };
      readonly required: readonly ["kind", "ref"];
      readonly additionalProperties: false;
    };
    readonly rating: {
      readonly type: "object";
      readonly properties: {
        readonly score: {
          readonly type: "number";
          readonly minimum: 0;
          readonly maximum: 1;
        };
        readonly label: {
          readonly type: "string";
          readonly enum: readonly ["good", "bad", "neutral", "mixed"];
        };
        readonly notes: {
          readonly type: "string";
        };
      };
      readonly required: readonly ["score", "notes"];
      readonly additionalProperties: false;
    };
    readonly by: {
      readonly type: "string";
      readonly enum: readonly ["agent", "user", "downstream-judge"];
    };
    readonly capturedAt: {
      readonly type: "string";
    };
    readonly namespace: {
      readonly type: "string";
    };
  };
  readonly required: readonly ["refersTo", "rating", "by"];
  readonly additionalProperties: false;
};
/** Parse and validate raw MCP tool input into typed `DelegateFeedbackArgs`; throws `TypeError` on bad input. @stable */
declare function validateDelegateFeedbackArgs(raw: unknown): DelegateFeedbackArgs;
/** @stable */
interface DelegateFeedbackHandlerOptions {
  queue: DelegationTaskQueue;
  store: FeedbackStore;
  generateId?: () => string;
  now?: () => string;
}
/** Build the MCP tool handler that persists feedback events and attaches them to delegation records. @stable */
declare function createDelegateFeedbackHandler(options: DelegateFeedbackHandlerOptions): (raw: unknown) => Promise<DelegateFeedbackResult>;
//#endregion
//#region src/mcp/tools/delegate-ui-audit.d.ts
/** MCP tool name for the `delegate_ui_audit` async kickoff tool. @experimental */
declare const DELEGATE_UI_AUDIT_TOOL_NAME = "delegate_ui_audit";
/** Human-readable description of the `delegate_ui_audit` MCP tool, injected into the tool manifest. @experimental */
declare const DELEGATE_UI_AUDIT_DESCRIPTION: string;
/** JSON Schema for `delegate_ui_audit` tool arguments (`workspaceDir`, `routes`, optional config). @experimental */
declare const DELEGATE_UI_AUDIT_INPUT_SCHEMA: {
  readonly type: "object";
  readonly properties: {
    readonly workspaceDir: {
      readonly type: "string";
      readonly description: "Absolute path for the audit workspace.";
    };
    readonly routes: {
      readonly type: "array";
      readonly items: {
        readonly type: "object";
        readonly properties: {
          readonly name: {
            readonly type: "string";
            readonly description: "Stable route name (used in screenshot filenames).";
          };
          readonly url: {
            readonly type: "string";
            readonly description: "Fully-qualified URL.";
          };
          readonly viewports: {
            readonly type: "array";
            readonly items: {
              readonly type: "object";
              readonly properties: {
                readonly width: {
                  readonly type: "integer";
                  readonly minimum: 1;
                };
                readonly height: {
                  readonly type: "integer";
                  readonly minimum: 1;
                };
              };
              readonly required: readonly ["width", "height"];
              readonly additionalProperties: false;
            };
            readonly description: "Viewports to capture at. Default [{1280, 800}].";
          };
          readonly fullPage: {
            readonly type: "boolean";
          };
          readonly waitFor: {
            readonly type: "string";
            readonly description: "CSS selector to wait for before capturing.";
          };
        };
        readonly required: readonly ["name", "url"];
        readonly additionalProperties: false;
      };
      readonly minItems: 1;
    };
    readonly namespace: {
      readonly type: "string";
      readonly description: "Multi-tenant scope.";
    };
    readonly config: {
      readonly type: "object";
      readonly properties: {
        readonly lenses: {
          readonly type: "array";
          readonly items: {
            readonly type: "string";
            readonly enum: readonly UiLens[];
          };
          readonly description: "Lenses to iterate. Default: every lens except \"other\".";
        };
        readonly maxIterations: {
          readonly type: "integer";
          readonly minimum: 1;
        };
        readonly maxConcurrency: {
          readonly type: "integer";
          readonly minimum: 1;
        };
        readonly productContext: {
          readonly type: "string";
        };
      };
      readonly additionalProperties: false;
    };
  };
  readonly required: readonly ["workspaceDir", "routes"];
  readonly additionalProperties: false;
};
/** Parse and validate raw MCP tool input into typed `DelegateUiAuditArgs`; throws `TypeError` on bad input. @experimental */
declare function validateDelegateUiAuditArgs(raw: unknown): DelegateUiAuditArgs;
/** @experimental */
interface DelegateUiAuditHandlerOptions {
  queue: DelegationTaskQueue;
  delegate: UiAuditorDelegate;
  estimateDurationMs?: (args: DelegateUiAuditArgs) => number;
}
/** Build the MCP tool handler that validates input, deduplicates via idempotency key, and enqueues a UI audit. @experimental */
declare function createDelegateUiAuditHandler(options: DelegateUiAuditHandlerOptions): (raw: unknown) => Promise<DelegateUiAuditResult>;
//#endregion
//#region src/mcp/tools/delegation-history.d.ts
/** MCP tool name for the `delegation_history` read-past-delegations tool. @stable */
declare const DELEGATION_HISTORY_TOOL_NAME = "delegation_history";
/** Human-readable description of the `delegation_history` MCP tool, injected into the tool manifest. @stable */
declare const DELEGATION_HISTORY_DESCRIPTION: string;
/** JSON Schema for `delegation_history` tool arguments (optional `namespace`, `profile`, `since`, `limit`). @stable */
declare const DELEGATION_HISTORY_INPUT_SCHEMA: {
  readonly type: "object";
  readonly properties: {
    readonly namespace: {
      readonly type: "string";
    };
    readonly profile: {
      readonly type: "string";
      readonly enum: readonly ["coder", "researcher", "ui-auditor"];
    };
    readonly since: {
      readonly type: "string";
      readonly description: "ISO datetime — earliest startedAt to include.";
    };
    readonly limit: {
      readonly type: "integer";
      readonly minimum: 1;
      readonly maximum: 500;
    };
  };
  readonly additionalProperties: false;
};
/** Parse and validate raw MCP tool input into typed `DelegationHistoryArgs`; throws `TypeError` on bad input. @stable */
declare function validateDelegationHistoryArgs(raw: unknown): DelegationHistoryArgs;
/** @stable */
interface DelegationHistoryHandlerOptions {
  queue: DelegationTaskQueue;
}
/** Build the MCP tool handler that reads filtered past delegations from a `DelegationTaskQueue`. @stable */
declare function createDelegationHistoryHandler(options: DelegationHistoryHandlerOptions): (raw: unknown) => Promise<DelegationHistoryResult>;
//#endregion
//#region src/mcp/tools/delegation-status.d.ts
/** MCP tool name for the `delegation_status` synchronous-poll tool. @stable */
declare const DELEGATION_STATUS_TOOL_NAME = "delegation_status";
/** Human-readable description of the `delegation_status` MCP tool, injected into the tool manifest. @stable */
declare const DELEGATION_STATUS_DESCRIPTION: string;
/** JSON Schema for `delegation_status` tool arguments (`taskId` + optional `includeTrace`). @stable */
declare const DELEGATION_STATUS_INPUT_SCHEMA: {
  readonly type: "object";
  readonly properties: {
    readonly taskId: {
      readonly type: "string";
      readonly description: "Returned by delegate_ui_audit.";
    };
    readonly includeTrace: {
      readonly type: "boolean";
      readonly description: "Also return the journaled loop-trace span tree for this delegation. Default false.";
    };
  };
  readonly required: readonly ["taskId"];
  readonly additionalProperties: false;
};
/** Parse and validate raw MCP tool input into typed `DelegationStatusArgs`; throws `TypeError` on bad input. @stable */
declare function validateDelegationStatusArgs(raw: unknown): DelegationStatusArgs;
/** @stable */
interface DelegationStatusHandlerOptions {
  queue: DelegationTaskQueue;
}
/** Build the MCP tool handler that polls a `DelegationTaskQueue` for task status. @stable */
declare function createDelegationStatusHandler(options: DelegationStatusHandlerOptions): (raw: unknown) => Promise<DelegationStatusResult>;
//#endregion
export { ANALYST_DEFINITION_BOUNDS, type AgentMemorySpec, type AnalystDefinitionIssue, type AnalystFindingEvent, type AnalystKind, type AnalystRegistry, type AnalystToolGroupName, type AuthoredAnalystDefinition, type AuthoredAnalystLimits, type AuthorizeDownMessage, type AuthorizedDownMessage, type CappedDelegationTrace, type CoderDelegate, type CoderOutput, type CoderReview, type CoderReviewer, CodexExecutionDiagnosticError, type CodexExecutionEvidence, type CodexExecutionFailureDiagnostic, type CodexExecutionPolicy, type CodexTokenUsage, type ContinuationInstruction, type CoordinationEvent, type CoordinationTools, type CoordinationToolsOptions, type CreateKbGateOptions, type CreateMemoryToolServerOptions, type CreateWorktreeOptions, DEFAULT_AWAIT_EVENT_TIMEOUT_MS, DEFAULT_LOCAL_HARNESS, DELEGATE_DESCRIPTION, DELEGATE_FEEDBACK_DESCRIPTION, DELEGATE_FEEDBACK_INPUT_SCHEMA, DELEGATE_FEEDBACK_TOOL_NAME, DELEGATE_INPUT_SCHEMA, DELEGATE_TOOL_NAME, DELEGATE_UI_AUDIT_DESCRIPTION, DELEGATE_UI_AUDIT_INPUT_SCHEMA, DELEGATE_UI_AUDIT_TOOL_NAME, DELEGATION_HISTORY_DESCRIPTION, DELEGATION_HISTORY_INPUT_SCHEMA, DELEGATION_HISTORY_TOOL_NAME, DELEGATION_STATUS_DESCRIPTION, DELEGATION_STATUS_INPUT_SCHEMA, DELEGATION_STATUS_TOOL_NAME, DELEGATION_TRACE_MAX_BYTES, DELEGATION_TRACE_MAX_SPANS, type DefinedAnalystRecord, type DelegateArgs, type DelegateCodeArgs, type DelegateCodeConfig, type DelegateCodeResult, type DelegateError, type DelegateFeedbackArgs, type DelegateFeedbackHandlerOptions, type DelegateFeedbackResult, type DelegateHandlerOptions, type DelegateResearchArgs, type DelegateResearchConfig, type DelegateResearchResult, type DelegateResult, type DelegateRunCtx, type DelegateUiAuditArgs, type DelegateUiAuditConfig, type DelegateUiAuditHandlerOptions, type DelegateUiAuditResult, type DelegateUiAuditRoute, type DelegationArgs, type DelegationError, type DelegationExecutor, type DelegationFeedbackSnapshot, type DelegationHistoryArgs, type DelegationHistoryEntry, type DelegationHistoryHandlerOptions, type DelegationHistoryResult, DelegationPersistenceError, type DelegationProfile, type DelegationProgress, type DelegationRecord, type DelegationResultPayload, type DelegationResumeContext, type DelegationResumeDriver, type DelegationResumeTick, type DelegationRunContext, DelegationStateCorruptError, type DelegationStatus, type DelegationStatusArgs, type DelegationStatusHandlerOptions, type DelegationStatusResult, type DelegationStore, DelegationTaskQueue, type DelegationTaskQueueOptions, type DelegationTraceCaps, type DelegationTraceCollector, type DelegationTraceSpan, type DetachedSessionDelegateOptions, type DetachedSessionRefParts, type DetachedTurn, type DetachedTurnResumeDriverOptions, type DetachedWinnerSelection, type DetectExecutorArgs, type DiffOptions, type DiffResult, type DownMessageAuthorizationInput, type DownMessageDeliveryAttempt, type DownMessageDeliveryOutcome, type DownMessageEvent, type DriveTurnCapableBox, type DriveTurnTick, type EscalateQuestion, type EventAcknowledgement, type FactCandidate, type FactJudge, type FactJudgeVerdict, type FeedbackEvent, type FeedbackRating, type FeedbackRefersTo, type FeedbackStore, FileDelegationStore, type FileDelegationStoreOptions, type FleetHandle, type FleetWorkspaceExecutorOptions, type GitRunner, InMemoryDelegationStore, InMemoryFeedbackStore, type InProcessExecutorDescribePlacement, type InProcessExecutorOptions, type JsonRpcMessage, type JsonRpcResponse, type KbGateResult, LOCAL_HARNESSES, type LocalHarness, type LocalHarnessResult, MEMORY_FILE_ENV, MEMORY_ITEMS_ENV, MEMORY_LOG_ENV, MEMORY_NAME_ENV, type MakeWorkerAgent, type ManagerReentryState, type McpServer, type McpServerOptions, type McpToolAnnotations, type McpToolDescriptor, type McpTransport, type MemoryItem, type Question, type QuestionDecision, type QuestionEscalationOutcome, type QuestionEscalationRecord, type QuestionEscalationTarget, type QuestionLevel, type QuestionOption, type QuestionPolicy, type QuestionRecord, type QuestionUrgency, type RemoveWorktreeOptions, type ResearchOutputShape, type ResearchSource, type ResolveSpawnResourcePathsResult, type ResolvedMemoryEnv, type ResolvedSpawnResourcePath, type RunDetachedTurnOptions, type RunLocalHarnessOptions, SPAWN_RESOURCE_PATH_MAX_BYTES, SUPPORTED_PROTOCOL_VERSIONS, type SettleDetachedCoderTurnOptions, type SettledWorker, type SiblingSandboxExecutorOptions, type SourcedHarness, type SpawnResourceBytes, type SpawnResourceRead, type SpawnResourceReader, type StdioToolServer, type StdioToolServerOptions, type SubmitInput, type SubmitOutput, type TraceContext, type UiAuditLensFilter, type UiAuditorDelegate, type UiAuditorDelegationOutput, type WorkerSpawnContext, type WorkerWatchOptions, type WorktreeHandle, analystToolGroupNames, buildDelegationTraceSpans, capDelegationTrace, captureWorktreeDiff, coderTaskFromArgs, collidesWithHarnessNativeTool, composeLoopTraceEmitters, createCoordinationTools, createDelegateFeedbackHandler, createDelegateHandler, createDelegateUiAuditHandler, createDelegationHistoryHandler, createDelegationStatusHandler, createDelegationTraceCollector, createDetachedTurnResumeDriver, createFleetWorkspaceExecutor, createInProcessExecutor, createInProcessTransport, createKbGate, createMcpServer, createMemoryToolServer, createPropagatingTraceEmitter, createSiblingSandboxExecutor, createStdioToolServer, createWorktree, delegationProfiles, detachedSessionDelegate, detachedTurnEvents, detectExecutor, downMessageRefusalReasons, environmentReader, eventToSnapshot, formatDetachedSessionRef, harnessNativeToolNames, harnessNativeTools, harnessSupportsReasoningEffort, hashIdempotencyInput, hostDirectoryReader, localHarnessExecutable, mcpToolsForRuntimeMcp, mcpToolsForRuntimeMcpSubset, mergeTraceEnv, parseAuthoredAnalystDefinition, parseCodexTokenUsage, parseDetachedSessionRef, parseMemoryItems, questionEscalationTargets, readMemoryItemsFile, readTraceContextFromEnv, removeWorktree, resolveMemoryFromEnv, resolveSpawnResourcePaths, runDetachedTurn, settleDetachedCoderTurn, sourcedHarnesses, traceContextToEnv, validateDelegateArgs, validateDelegateFeedbackArgs, validateDelegateUiAuditArgs, validateDelegationHistoryArgs, validateDelegationStatusArgs };
//# sourceMappingURL=index.d.ts.map