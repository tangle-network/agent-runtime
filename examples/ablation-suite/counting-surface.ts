/**
 * countingSurface — wrap an AgenticSurface so every tool call is tallied per tool name.
 *
 * Default surfaces expose no observability over HOW a worker used its tools. This wrapper
 * counts each `call(handle, name, ...)` by tool name and exposes the running tally via a
 * getter, so a run can report per-tool call counts (e.g. how many read_file vs write_file vs
 * run_tests a continuous worker spent before plateauing). It is otherwise transparent — open,
 * tools, score, and close pass straight through to the base surface, exactly like
 * persistentSurface. Compose them freely: `countingSurface(persistentSurface(base))` counts
 * tool calls over a shared, accumulating workspace.
 */
import type {
  AgenticSurface,
  AgenticTask,
  ArtifactHandle,
} from '@tangle-network/agent-runtime/kernel'

export interface CountingSurface extends AgenticSurface {
  /** A snapshot of how many times each tool was called, keyed by tool name. Reading it
   *  returns a fresh plain object, so callers can record it without aliasing live state. */
  readonly toolCounts: Readonly<Record<string, number>>
  /** Total tool calls across all tools. */
  readonly toolCallTotal: number
  /** Zero every tally (e.g. between independent runs that share one wrapper instance). */
  resetToolCounts(): void
}

export function countingSurface(base: AgenticSurface): CountingSurface {
  const tally = new Map<string, number>()
  return {
    name: `counting:${base.name}`,
    get toolCounts(): Readonly<Record<string, number>> {
      return Object.fromEntries(tally)
    },
    get toolCallTotal(): number {
      let n = 0
      for (const c of tally.values()) n += c
      return n
    },
    resetToolCounts(): void {
      tally.clear()
    },
    open(task: AgenticTask): Promise<ArtifactHandle> {
      return base.open(task)
    },
    tools(task: AgenticTask, handle: ArtifactHandle) {
      return base.tools(task, handle)
    },
    call(handle: ArtifactHandle, name: string, args: Record<string, unknown>): Promise<string> {
      tally.set(name, (tally.get(name) ?? 0) + 1)
      return base.call(handle, name, args)
    },
    score(task: AgenticTask, handle: ArtifactHandle) {
      return base.score(task, handle)
    },
    close(handle: ArtifactHandle): Promise<void> {
      return base.close(handle)
    },
  }
}
