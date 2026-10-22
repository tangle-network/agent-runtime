import { ValidationError } from '../../errors'
import { resolveAgentEnvironmentProvider } from '../environment-provider/provider-registry'
import type { SuperviseOptions } from './supervise-options'

/** What a SQL run context admits, in two phases: identity and worker seam before any compute (a
 *  synchronous configuration fault), then coordinator and retained-control capabilities at start. */
export function assertSqlRunOptions(options: SuperviseOptions): void {
  if (options.runContext?.durability !== 'sql') return
  if (
    options.runDir !== undefined ||
    (options.journal !== undefined && options.journal !== options.runContext.journal) ||
    (options.blobs !== undefined && options.blobs !== options.runContext.blobs) ||
    (options.runId !== undefined && options.runId !== options.runContext.runId)
  ) {
    throw new ValidationError(
      'supervise: SQL runContext cannot be mixed with another run identity or persistence path',
    )
  }
  if (options.backend?.backend !== 'provider' || options.makeWorkerAgent || options.makeLeafAgent) {
    throw new ValidationError(
      'supervise: SQL runContext requires backend-derived retained provider workers',
    )
  }
}

/** The start-time half of {@link assertSqlRunOptions} for a run on a SQL context: it reads the
 *  provider's capabilities. */
export async function assertSqlRunProvider(options: SuperviseOptions): Promise<void> {
  if (
    options.backend?.backend !== 'provider' ||
    options.backend.steering ||
    options.driveHarness ||
    options.resolveDriveHarness ||
    options.driverBackend
  ) {
    throw new ValidationError(
      'supervise: SQL runContext requires a local coordinator and non-steering retained provider workers',
    )
  }
  const provider = resolveAgentEnvironmentProvider(
    options.backend.provider,
    options.backend.registry,
  )
  const capabilities = await provider.capabilities()
  if (
    !capabilities.retainedControl ||
    !capabilities.streaming.turnIdempotency ||
    !capabilities.streaming.replay ||
    !provider.get
  ) {
    throw new ValidationError(
      'supervise: SQL runContext requires retainedControl, replay, turn idempotency, and provider.get',
    )
  }
}
