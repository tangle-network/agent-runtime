/** Built-in executor configuration and selection over the shared Executor contract. */

export type { SandboxLeafOut, SandboxOutputMarker } from '../sandbox-executor-output'
export type { BridgeHarnessStore, BridgeModelCredential, BridgeSeam } from './bridge-config'
export { bridgeRuntimeAttachmentsKey, bridgeStopSignalKey } from './bridge-config'
export { bridgeExecutor } from './bridge-executor'
export { bridgeAdmissionRefusal, bridgeModelRouteRefusal } from './bridge-transport'
export { cliInPlaceExecutor, cliWorktreeExecutor } from './cli-executor-factories'
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
