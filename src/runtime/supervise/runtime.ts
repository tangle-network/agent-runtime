/** Built-in executor configuration and selection over the shared Executor contract. */

export type { ToolSpec } from '../router-client'
export type { SandboxLeafOut, SandboxOutputMarker } from '../sandbox-executor-output'
export type { BridgeHarnessStore, BridgeModelCredential, BridgeSeam } from './bridge-config'
export { bridgeRuntimeAttachmentsKey, bridgeStopSignalKey } from './bridge-config'
export { bridgeExecutor } from './bridge-executor'
export type { BridgeModelRouteRefusal } from './bridge-transport'
export { bridgeAdmissionRefusal, bridgeModelRouteRefusal } from './bridge-transport'
export { cliInPlaceExecutor, cliWorktreeExecutor } from './cli-executor-factories'
export { cliExecutor } from './cli-process-executor'
export type { ExecutorConfig } from './executor-config'
export {
  bindReusableExecutorExecutionId,
  captureReusableExecutorConfig,
  createExecutor,
  snapshotExecutorConfig,
} from './executor-config'
export { createExecutorRegistry } from './executor-registry'
export { routerInlineExecutor } from './router-inline-executor'
export { routerToolsInlineExecutor } from './router-tools-executor'
export type {
  CliInPlaceSeam,
  CliSeam,
  CliWorktreeBridgeSeam,
  CliWorktreeSeam,
  ProviderSeam,
  RouterSeam,
  RouterToolsSeam,
  SandboxSeam,
} from './runtime-seams'
export { sandboxExecutor } from './sandbox-leaf-executor'
// Re-export the verdict + spend surface so a consumer importing the runtime
// built-ins gets the budget vocabulary from one place.
export type { DefaultVerdict, Executor, ExecutorResult, Spend, UsageEvent } from './types'
