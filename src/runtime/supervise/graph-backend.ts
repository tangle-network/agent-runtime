import { ValidationError } from '../../errors'
import type { RunGraphOptions } from './graph'

/** Graph nodes share the same resumable Bridge transport as Braid. Hosts own its lifecycle. */
export function graphExecutionOptions(options: RunGraphOptions): RunGraphOptions {
  if (options.makeLeafAgent) return options
  const backend = options.backend
  if (backend)
    return backend.backend === 'bridge'
      ? { ...options, backend: { ...backend, outputFormat: 'json' } }
      : options
  const bridgeUrl = process.env.CLI_BRIDGE_URL
  const bridgeBearer = process.env.BRIDGE_BEARER ?? process.env.CLI_BRIDGE_BEARER
  if (!bridgeUrl || !bridgeBearer)
    throw new ValidationError(
      'runGraph: start CLI Bridge and supply backend: { backend: "bridge", bridgeUrl, bridgeBearer, cwd }, or configure CLI_BRIDGE_URL and BRIDGE_BEARER',
    )
  return {
    ...options,
    backend: {
      backend: 'bridge',
      bridgeUrl,
      bridgeBearer,
      cwd: process.cwd(),
      outputFormat: 'json',
    },
  }
}
