import type { ToolDefinition } from '@tangle-network/agent-interface'
import { createQmdKnowledgeTools, type QmdSearchProvider } from '@tangle-network/agent-knowledge'
import {
  type AgentMemoryBranch,
  createPlayMemoryTools,
} from '@tangle-network/agent-knowledge/memory'
import type {
  ResolveSupervisorTools,
  SupervisorToolDescriptor,
} from '@tangle-network/agent-runtime/kernel'

type MemoryToolsOptions = Parameters<typeof createPlayMemoryTools>[0]

export interface PlayKnowledgeBinding {
  /** One execution identity and the logical play namespace, retained in the commissioned input. */
  readonly run: { readonly runId: string; readonly namespace: string }
  /** Rebound within the same play; forked into a fresh branch and namespace for a new play. */
  readonly branch: AgentMemoryBranch
  readonly qmd?: QmdSearchProvider
  readonly onCheckpoint: MemoryToolsOptions['onCheckpoint']
  readonly recordRetrieval?: MemoryToolsOptions['recordRetrieval']
}

function runtimeTool(tool: ToolDefinition): SupervisorToolDescriptor {
  if (!tool.inputSchemaJson) throw new Error(`Knowledge tool ${tool.name} has no JSON schema`)
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchemaJson,
    handler: async (input) => tool.handler(input, {}),
  }
}

/** Example consumer binding over Runtime's existing node-scoped tool resolver. */
export async function createPlayKnowledgeResolver(
  options: PlayKnowledgeBinding,
): Promise<ResolveSupervisorTools> {
  const { branch, onCheckpoint, recordRetrieval, qmd } = options
  const run = Object.freeze({ ...options.run })
  if (!run.runId.trim() || !run.namespace.trim()) {
    throw new Error('A play knowledge binding requires its commissioned runId and namespace')
  }
  const checkpoint = await branch.snapshot()
  if (checkpoint.baseScope.namespace !== run.namespace || checkpoint.lifetime !== 'resumable') {
    throw new Error('The memory checkpoint does not belong to this resumable play')
  }
  if (qmd && qmd.scopeId !== run.namespace) {
    throw new Error('The QMD snapshot does not belong to this commissioned play')
  }
  // Scope admission precedes I/O; every source is checked before any node driver starts.
  await qmd?.verifySnapshot()
  const qmdTools = qmd ? createQmdKnowledgeTools({ provider: qmd }).map(runtimeTool) : []
  const playToolNames = new Set(['memory_recall', 'memory_record', 'qmd_search', 'qmd_read'])
  return (context) => {
    if (context.runId !== run.runId || context.runNamespace !== run.namespace) {
      throw new Error('Runtime context does not match the commissioned play knowledge binding')
    }
    const granted = new Set(
      [...playToolNames].filter(
        (name) => context.profile.tools?.[`agent_runtime_coordination_${name}`] === true,
      ),
    )
    const tools = [
      ...createPlayMemoryTools({
        branch,
        actorId: JSON.stringify([context.runId, context.nodeId]),
        onCheckpoint,
        ...(recordRetrieval ? { recordRetrieval } : {}),
      }).map(runtimeTool),
      ...qmdTools,
    ]
    for (const name of granted) {
      if (!tools.some((tool) => tool.name === name)) {
        throw new Error(`Declared play tool ${name} has no admitted source binding`)
      }
    }
    return tools.filter((tool) => granted.has(tool.name))
  }
}
