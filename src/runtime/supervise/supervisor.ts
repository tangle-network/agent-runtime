import { RuntimeRunStateError } from '../../errors'
import { createRootHandle, type RootControl, rootControlFor } from './supervisor-root-control'
import { runSupervisor } from './supervisor-run'
import type { Agent, RootHandle, Supervisor } from './types'

export type { NoWinnerError } from './types'
export { createRootHandle }

/** Create a supervisor that owns one recursive agent execution tree. */
export function createSupervisor<Task, Out>(): Supervisor<Task, Out> {
  let attached: RootControl | undefined
  return {
    run(root: Agent<Task, Out>, task: Task, opts) {
      return runSupervisor(root, task, opts, attached)
    },
    attach(handle: RootHandle<Out>): void {
      const control = rootControlFor(handle as RootHandle<unknown>)
      if (!control) {
        throw new RuntimeRunStateError(
          'supervisor.attach: handle was not minted by createRootHandle (no control channel)',
        )
      }
      attached = control
    },
  }
}
