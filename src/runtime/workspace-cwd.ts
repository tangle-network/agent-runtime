import { type WorkspaceCwd, workspaceCwdPathForBase } from '@tangle-network/agent-interface'
import type { AgentEnvironmentCapabilities } from '@tangle-network/agent-interface/environment-provider'

/**
 * Reject an explicit interactive cwd that disagrees with the public workspace
 * request before the durable intent is admitted.
 */
export function assertWorkspaceCwdMatches(
  explicitCwd: string | undefined,
  workspaceCwd: WorkspaceCwd | undefined,
): void {
  if (explicitCwd === undefined || workspaceCwd === undefined) return
  const requestedCwd = workspaceCwdPathForBase(workspaceCwd, workspaceCwd.base, 'Runtime')
  if (explicitCwd !== requestedCwd) {
    throw new Error('retained interactive cwd conflicts with environment.workspace.cwd')
  }
}

/**
 * Resolve one provider-facing cwd after capability negotiation.
 * Runtime does not interpret the path syntax for either public base.
 */
export function effectiveWorkspaceCwd(
  explicitCwd: string | undefined,
  workspaceCwd: WorkspaceCwd | undefined,
  providerName: string,
  cwdBases: AgentEnvironmentCapabilities['workspace']['cwdBases'],
): string | undefined {
  const resolvedCwd = (() => {
    if (workspaceCwd === undefined) return undefined
    if (cwdBases?.[workspaceCwd.base] !== true) {
      throw new Error(
        `provider "${providerName}" does not advertise workspace cwd base "${workspaceCwd.base}"`,
      )
    }
    return workspaceCwdPathForBase(workspaceCwd, workspaceCwd.base, providerName)
  })()
  if (explicitCwd !== undefined && resolvedCwd !== undefined && explicitCwd !== resolvedCwd) {
    throw new Error('retained interactive cwd conflicts with environment.workspace.cwd')
  }
  return explicitCwd ?? resolvedCwd
}
