import type {
  Budget,
  DefaultVerdict,
  ExecutionBindingReceipt,
  NodeExecutionIdentity,
  NodeId,
  ProfileMaterializationReceipt,
  Runtime,
  Spend,
  WaitSpec,
  WorkerTraceEvidence,
} from './types-core'

export type SpawnEvent =
  | {
      kind: 'spawned'
      id: NodeId
      parent?: NodeId
      label: string
      key?: string
      assignmentId?: string
      budget: Budget
      runtime: Runtime
      ownedTreeRoot?: NodeId
      identity?: NodeExecutionIdentity
      seq: number
      at: string
    }
  | {
      kind: 'execution-bound'
      id: NodeId
      binding: ExecutionBindingReceipt
      seq: number
      at: string
    }
  | {
      kind: 'materialized'
      id: NodeId
      receipt: ProfileMaterializationReceipt
      seq: number
      at: string
    }
  | {
      kind: 'settled'
      id: NodeId
      status: 'done' | 'down'
      outRef?: string
      verdict?: DefaultVerdict
      spent: Spend
      infra?: boolean
      reason?: string
      trace?: WorkerTraceEvidence
      seq: number
      at: string
    }
  | { kind: 'cancelled'; id: NodeId; reason: string; seq: number; at: string }
  | {
      kind: 'waiting'
      id: NodeId
      parent?: NodeId
      label: string
      spec: WaitSpec
      armedAt: number
      seq: number
      at: string
    }
  | {
      kind: 'woken'
      id: NodeId
      by: 'fired' | 'timeout' | 'cancelled'
      outRef?: string
      seq: number
      at: string
    }
  | { kind: 'metered'; id: NodeId; spend: Spend; seq: number; at: string }
  | {
      kind: 'edge'
      id: NodeId
      edge: { kind: 'delegates' | 'analyzes'; from: string; to: string; directive: string }
      traversal: number
      outcome: 'delivered' | 'stripped' | 'empty' | 'unpropagated'
      bytes: number
      reason?: string
      seq: number
      at: string
    }
  | {
      kind: 'trace-unpropagated'
      id: NodeId
      expectedTraceId: string
      backend: string
      reason: 'no-env-channel' | 'no-worker-process' | 'caller-omitted'
      seq: number
      at: string
    }

export interface SpawnJournal {
  loadTree(root: NodeId): Promise<SpawnEvent[] | undefined>
  beginTree(root: NodeId, at: string): Promise<void>
  appendEvent(root: NodeId, ev: SpawnEvent): Promise<void>
}

export interface ResultBlobStore {
  put(outRef: string, artifact: unknown): Promise<void>
  get(outRef: string): Promise<unknown | undefined>
}
