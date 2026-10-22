import { isRecord } from '@tangle-network/agent-core'

export function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}
