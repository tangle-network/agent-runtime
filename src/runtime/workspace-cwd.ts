import { posix } from 'node:path'
import type { WorkspaceRequest } from '@tangle-network/agent-interface/environment-provider'

const MAX_WORKSPACE_CWD_LENGTH = 16_384

/** Normalize one provider workspace cwd without resolving it against this process. */
export function normalizeWorkspaceCwd(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('workspace cwd must be a non-empty string')
  }
  if (value.length > MAX_WORKSPACE_CWD_LENGTH) {
    throw new Error('workspace cwd exceeds the contract length bound')
  }
  if (value.includes('\u0000') || value.includes('\r') || value.includes('\n')) {
    throw new Error('workspace cwd contains a forbidden control character')
  }
  if (value.split(/[\\/]+/u).some((segment) => segment === '..')) {
    throw new Error('workspace cwd must not contain path traversal segments')
  }

  const normalized = posix.normalize(value)
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error('workspace cwd must not escape its workspace')
  }
  return normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
}

/** Canonicalize a workspace request before it enters retained identity material. */
export function normalizeWorkspaceEnvironment<T extends { readonly workspace?: WorkspaceRequest }>(
  environment: T,
): T {
  const workspace = environment.workspace
  if (workspace === undefined || workspace.cwd === undefined) return environment
  const cwd = normalizeWorkspaceCwd(workspace.cwd)
  if (cwd === workspace.cwd) return environment
  return {
    ...environment,
    workspace: { ...workspace, cwd },
  } as T
}

/** Resolve the one cwd that an interactive retained start must use. */
export function effectiveWorkspaceCwd(
  explicitCwd: unknown,
  workspaceCwd: unknown,
): string | undefined {
  const explicit = normalizeWorkspaceCwd(explicitCwd)
  const workspace = normalizeWorkspaceCwd(workspaceCwd)
  if (explicit !== undefined && workspace !== undefined && explicit !== workspace) {
    throw new Error('retained interactive cwd conflicts with environment.workspace.cwd')
  }
  return explicit ?? workspace
}
