import type { AgentCandidateWorkspaceSnapshotEvidence } from '@tangle-network/agent-interface'
import type { AgentEnvironment } from '@tangle-network/agent-interface/environment-provider'
import {
  type ProviderWorkspaceCaptureReceipt,
  workspaceCaptureReceipt,
} from '../provider-workspace-retention'
import type { StreamProviderExecutorArgs } from './contracts'

export function providerWorkspaceCaptureReceipt(
  args: Pick<
    StreamProviderExecutorArgs,
    | 'executionId'
    | 'profile'
    | 'node'
    | 'workspaceProvenance'
    | 'workspaceCoverage'
    | 'workspaceControlRef'
  >,
  environment: AgentEnvironment,
  snapshot: AgentCandidateWorkspaceSnapshotEvidence,
  fallbackSessionId: string | null,
): ProviderWorkspaceCaptureReceipt {
  const coverage = args.workspaceCoverage()
  const controlRef = args.workspaceControlRef()
  return workspaceCaptureReceipt(
    {
      executionId: args.executionId,
      ...(controlRef === undefined ? {} : { controlRef }),
      ...(args.node === undefined ? {} : { node: args.node }),
      environment,
      profile: args.profile,
      providerSessionId: controlRef?.sessionId ?? fallbackSessionId,
    },
    {
      snapshot,
      provenance: args.workspaceProvenance() ?? {
        status: 'unavailable',
        missing: ['Capture coverage metadata was not retained'],
      },
      coverageComplete: coverage.complete,
      ...(coverage.incompleteReason === undefined
        ? {}
        : { incompleteReason: coverage.incompleteReason }),
    },
  )
}
