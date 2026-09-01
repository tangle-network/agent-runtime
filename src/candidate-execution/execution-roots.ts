import { posix } from 'node:path'

/** Absolute container roots owned by one isolated candidate execution. */
export interface AgentCandidateExecutionRoots {
  readonly taskRoot: string
  readonly candidateRoot?: string
  /** Private runtime HOME used for agent-scoped profile files, when needed. */
  readonly profileRoot?: string
}

/** Validate the canonical identity and isolation boundary for execution roots. */
export function assertAgentCandidateExecutionRoots(roots: AgentCandidateExecutionRoots): void {
  const entries = [
    ['task', roots.taskRoot],
    ['candidate', roots.candidateRoot],
    ['profile', roots.profileRoot],
  ] as const
  for (const [name, root] of entries) {
    if (root === undefined) continue
    if (!posix.isAbsolute(root) || posix.normalize(root) !== root) {
      throw new Error(`execution ${name} root must be a canonical absolute path`)
    }
  }
  for (let left = 0; left < entries.length; left++) {
    const entry = entries[left]
    if (!entry) continue
    const [leftName, leftRoot] = entry
    if (leftRoot === undefined) continue
    for (let right = left + 1; right < entries.length; right++) {
      const rightEntry = entries[right]
      if (!rightEntry) continue
      const [rightName, rightRoot] = rightEntry
      if (rightRoot !== undefined && executionPathsOverlap(leftRoot, rightRoot)) {
        throw new Error(
          `execution ${leftName} and ${rightName} roots must be distinct and non-overlapping`,
        )
      }
    }
  }
}

export function executionPathsOverlap(left: string, right: string): boolean {
  const a = posix.normalize(left)
  const b = posix.normalize(right)
  return (
    a === b || b.startsWith(a === '/' ? '/' : `${a}/`) || a.startsWith(b === '/' ? '/' : `${b}/`)
  )
}
