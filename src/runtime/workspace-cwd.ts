import type { WorkspaceRequest } from '@tangle-network/agent-interface/environment-provider'

/**
 * Resolve the one provider-owned cwd that an interactive retained start must use.
 * Runtime preserves this provider string and does not interpret its path syntax.
 */
export function effectiveWorkspaceCwd(
  explicitCwd: string | undefined,
  workspaceCwd: WorkspaceRequest['cwd'],
): string | undefined {
  if (explicitCwd !== undefined && workspaceCwd !== undefined && explicitCwd !== workspaceCwd) {
    throw new Error('retained interactive cwd conflicts with environment.workspace.cwd')
  }
  return explicitCwd ?? workspaceCwd
}
