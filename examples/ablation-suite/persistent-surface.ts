/**
 * persistentSurface — wrap an AgenticSurface so every worker solving the SAME task shares ONE workspace.
 *
 * Default surfaces open a fresh workspace per worker (the stub, re-written). A supervisor that re-spawns
 * after a stall then starts each worker from scratch — best-of-N, never building on prior progress. This
 * wrapper memoizes the open per task id, so the artifact (the solution file) ACCUMULATES across spawns: a
 * fresh worker (clean context) picks up where the last one plateaued and runs `run_tests` to fix what's
 * still failing. That build-on-progress is the structural reason a supervisor's fresh-context respawns can
 * exceed one worker's degrading N shots (the context-lifecycle thesis) — the lever no prompt can supply.
 */
import type {
  AgenticSurface,
  AgenticTask,
  ArtifactHandle,
} from '@tangle-network/agent-runtime/loops'

export function persistentSurface(base: AgenticSurface): AgenticSurface {
  // One opened handle per task id, shared by every worker on that task. Reference-counted so the shared
  // workspace is torn down only when the LAST holder closes — never on an individual worker's settle.
  const handles = new Map<string, { handle: Promise<ArtifactHandle>; refs: number }>()
  return {
    name: `persistent:${base.name}`,
    async open(task: AgenticTask): Promise<ArtifactHandle> {
      let entry = handles.get(task.id)
      if (!entry) {
        // base.open writes the stub exactly once per task — subsequent workers see the accumulated file.
        entry = { handle: base.open(task), refs: 0 }
        handles.set(task.id, entry)
      }
      entry.refs++
      return entry.handle
    },
    tools(task, handle) {
      return base.tools(task, handle)
    },
    call(handle, name, args) {
      return base.call(handle, name, args)
    },
    score(task, handle) {
      return base.score(task, handle)
    },
    async close(handle: ArtifactHandle): Promise<void> {
      // Find the entry that owns this handle and decrement; only the last release tears down the box.
      for (const [id, entry] of handles) {
        const resolved = await entry.handle
        if (resolved.id !== handle.id) continue
        entry.refs--
        if (entry.refs <= 0) {
          handles.delete(id)
          await base.close(resolved)
        }
        return
      }
    },
  }
}
