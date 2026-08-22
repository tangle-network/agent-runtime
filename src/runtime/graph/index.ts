/**
 * `@tangle-network/agent-runtime/graph` — the runtime-native multi-agent graph engine.
 *
 * Design record: agent-runtime#966 (the map) and its closed tickets. Build sequence: #979 (this
 * contract + registry + the four core kinds), #980 (scheduler over typed ports), #981 (journal
 * fold and kill-anywhere replay), #982 (the `runGraph` preset).
 */

export {
  assertAuthoredCode,
  type CodeAuthor,
  type CodeModeConfig,
  type CodeOperation,
  type CodeOperationResult,
  type CodeRunner,
  codemodeKind,
  extractCodeBlock,
  inlineCodeRunner,
  renderCodeApi,
} from './codemode'
export {
  type CompiledEdge,
  type CompiledGraph,
  type CompiledNode,
  compileGraph,
  isEngineFired,
  schemaAccepts,
} from './compile'
export {
  CONDITION_OPS,
  type Condition,
  type ConditionLeaf,
  type ConditionOp,
  evaluateCondition,
  validateCondition,
} from './condition'
export {
  DEFAULT_MAX_NODE_VISITS,
  type EngineGraphEdge,
  type EngineGraphNode,
  type EngineGraphSpec,
  type GraphEdgeKind,
  JOIN_RULES,
  type JoinRule,
  MAX_MAX_NODE_VISITS,
} from './definition'
export { createGraphEngine, type GraphEngine, type GraphEngineOptions } from './engine'
export {
  applyGraphFoldEvent,
  emptyFoldState,
  type FoldEdge,
  type FoldEdgeState,
  type FoldInstance,
  type FoldInstanceStatus,
  type FoldNode,
  type FoldSuspension,
  foldGraphJournal,
  type GraphFoldState,
} from './fold'
export { decideJoin, type GatingEdge, type JoinDecision } from './join'
export {
  type AnyNodeKind,
  type BudgetMode,
  type EffectContext,
  type EffectName,
  type GraphHost,
  type JsonSchema,
  kindHandle,
  type NodeFlags,
  type NodeKind,
  narrowEffects,
  type OnCrash,
  type PortSpec,
  validateNodeKind,
} from './kind'
export {
  type AgentKindConfig,
  agentKind,
  type ScriptBody,
  type ScriptKindConfig,
  type SubgraphKindConfig,
  type SupervisorKindConfig,
  scriptKind,
  subgraphKind,
  supervisorKind,
} from './kinds'
export { createEdgeLedger, type EdgeLedger } from './ledger'
export { graphFromRunGraph, RUN_GRAPH_ROOT_KIND } from './preset-run-graph'
export { applyProjection, type Projection, validateProjection } from './projection'
export {
  createRegistry,
  formatRegistryHandle,
  parseRegistryHandle,
  type Registered,
  type Registry,
  type RegistryHandle,
} from './registry'
export {
  assembleGraphResult,
  type FinalizerChoice,
  materializeSettles,
} from './result'
export { type GraphRunContext, openGraphRun } from './run-context'
export {
  admitPayload,
  createGraphRun,
  ENGINE_WOKEN_SEQ_BASE,
  type GraphEdgeTraversal,
  type GraphNodeSettle,
  type GraphRunHandle,
  type GraphRunOptions,
  type GraphRunReason,
  type GraphRunResult,
  runEngineGraph,
  type SuspensionRequest,
  suspended,
} from './scheduler'
export {
  isSuspensionRequest,
  mintSuspensionToken,
  suspensionNodeId,
  tokenFromSuspensionNodeId,
} from './suspension'
