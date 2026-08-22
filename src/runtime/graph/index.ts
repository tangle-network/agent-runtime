/**
 * `@tangle-network/agent-runtime/graph` — the runtime-native multi-agent graph engine.
 *
 * Design record: agent-runtime#966 (the map) and its closed tickets. Build sequence: #979 (this
 * contract + registry + the four core kinds), #980 (scheduler over typed ports), #981 (journal
 * fold and kill-anywhere replay), #982 (the `runGraph` preset).
 */

export { createGraphEngine, type GraphEngine, type GraphEngineOptions } from './engine'
export {
  type BudgetMode,
  type EffectContext,
  type EffectName,
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
  type SupervisorKindConfig,
  scriptKind,
  subgraphKind,
  supervisorKind,
} from './kinds'
export {
  createRegistry,
  formatRegistryHandle,
  parseRegistryHandle,
  type Registered,
  type Registry,
  type RegistryHandle,
} from './registry'
