/** Validate the named execution seams shared by built-in executor adapters. */

import type { AgentProfileMcpServer } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type { ExecutorContext } from './types'

export function assertExactConfigKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  context: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key))
  if (unknown.length > 0) {
    throw new ValidationError(
      `${context}: unknown fields ${unknown.sort().join(', ')}; execution behavior belongs in AgentProfile`,
    )
  }
}

// ── Shared helpers ──────────────────────────────────────────────────────────────

/** Narrow a named seam off the `ExecutorContext`, failing loud when absent — no
 *  silent default for a required external-boundary seam. */
export function readSeam<T>(ctx: ExecutorContext, key: string, who: string): T {
  const seam = ctx.seams[key]
  if (seam === undefined || seam === null) {
    throw new ValidationError(`${who} executor: missing required seam "${key}" on ExecutorContext`)
  }
  return seam as T
}

export function readOptionalAbortSignal(
  ctx: ExecutorContext,
  key: string,
  who: string,
): AbortSignal | undefined {
  const value = ctx.seams[key]
  if (value === undefined) return undefined
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof (value as { aborted?: unknown }).aborted !== 'boolean' ||
    typeof (value as { addEventListener?: unknown }).addEventListener !== 'function'
  ) {
    throw new ValidationError(`${who} executor: seam "${key}" must be an AbortSignal`)
  }
  return value as AbortSignal
}

/** Narrow the Runtime-owned MCP attachment seam. Absent means the run mounts nothing; a present
 *  value must be a named map of MCP servers, never an empty one that would silently mount nothing. */
export function readOptionalMcpAttachments(
  ctx: ExecutorContext,
  key: string,
  who: string,
): Readonly<Record<string, AgentProfileMcpServer>> | undefined {
  const value = ctx.seams[key]
  if (value === undefined) return undefined
  const entries =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>)
      : undefined
  if (
    entries === undefined ||
    entries.length === 0 ||
    entries.some(([, server]) => server === null || typeof server !== 'object')
  ) {
    throw new ValidationError(
      `${who} executor: seam ${JSON.stringify(key)} must be a non-empty map of MCP servers`,
    )
  }
  return value as Record<string, AgentProfileMcpServer>
}
