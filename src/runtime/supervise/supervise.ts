import { ValidationError } from '../../errors'
import type { ToolLoopChat } from '../tool-loop'
import { withRunContext } from './run-context'
import { freezeDetached } from './supervise-identity'
import { captureSuperviseOptions } from './supervise-option-capture'
import type { SuperviseOptions, SuperviseTestOptions } from './supervise-options'
import { superviseInternal } from './supervise-run-lifecycle'
import type { SupervisorProfile } from './supervisor-agent'

/** Capabilities a data-only consumer may require before building an opted-in run. `graphTools`:
 *  a manager whose profile grants `run_graph` can start an agent graph as one subtask. */
export const superviseFleetCapabilities = Object.freeze({
  peerAudit: true,
  traceTools: true,
  graphTools: true,
})

/** One-call supervisor: build + run a supervisor from its exact profile. @stable */
export function supervise(profile: SupervisorProfile, task: unknown, opts: SuperviseOptions) {
  if ('brain' in opts) {
    throw new ValidationError(
      'supervise: direct brain injection is test-only; production execution derives the model call from AgentProfile',
    )
  }
  return superviseWithContext(profile, task, opts)
}

/** Deterministic scripted-brain path for tests. Not exported from Runtime's main entry. */
export function superviseWithTestBrain(
  profile: SupervisorProfile,
  task: unknown,
  opts: SuperviseTestOptions,
) {
  const { brain, ...runtimeOptions } = opts
  return superviseWithContext(profile, task, runtimeOptions, brain)
}

function superviseWithContext(
  profile: SupervisorProfile,
  task: unknown,
  opts: SuperviseOptions,
  brain?: ToolLoopChat,
): ReturnType<typeof superviseInternal> {
  if (opts.runContext?.acquire === undefined) return superviseInternal(profile, task, opts, brain)
  const options = captureSuperviseOptions(opts)
  const capturedProfile = freezeDetached(profile)
  const capturedTask = freezeDetached(task)
  return withRunContext(opts.runContext, options.signal, (runContext, signal) =>
    superviseInternal(
      capturedProfile,
      capturedTask,
      {
        ...options,
        runContext,
        ...(signal === undefined ? {} : { signal }),
      },
      brain,
    ),
  )
}

export {
  captureSuperviseOptions,
  SUPERVISE_EXECUTABLE_OPTION_KEYS,
} from './supervise-option-capture'
export type {
  AuthorizedSpawn,
  AuthorizedSpawnContext,
  DeliverableResolutionInput,
  SuperviseOptions,
  SuperviseTestOptions,
} from './supervise-options'
export { DEFAULT_AUTHORED_PROFILE_SECURITY_POLICY } from './supervise-profile-admission'
export type { SuperviseRegistry, SuperviseRegistryTable } from './supervise-registry'
export { profileGuidanceComposer, superviseRootProfile } from './supervise-root-profile'
export { workerFromBackend } from './supervise-worker-backend'
