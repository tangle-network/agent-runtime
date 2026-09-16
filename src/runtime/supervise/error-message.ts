import { defaultRedactor } from '../../redact'

const maxCauseDepth = 4
const maxMessageLength = 32_768
const maxPartLength = 2_048

/** A persisted failure must explain its wrappers without exporting credentials or unbounded data. */
export function errorText(value: unknown): string {
  let text: string
  try {
    text = typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value))
  } catch {
    text = '[unprintable rejection]'
  }
  return String(defaultRedactor(text)).slice(0, maxMessageLength)
}

export function errorProperty(
  error: Error,
  field: 'name' | 'message' | 'stack',
): string | undefined {
  try {
    const value = error[field]
    return value === undefined
      ? undefined
      : errorText(value).slice(0, field === 'name' ? 256 : maxMessageLength)
  } catch {
    return `[unreadable error ${field}]`
  }
}

/** An HTTP status carried on a thrown error, read without trusting its getter. Provider SDKs put
 *  one on their own error classes, so this is how a refusal is recognised outside the transport
 *  taxonomy — for the persisted message here, and for the driver's retry verdict. */
export function errorHttpStatus(error: Error): number | undefined {
  try {
    const status: unknown = Reflect.get(error, 'status')
    return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
      ? status
      : undefined
  } catch {
    return undefined
  }
}

/** Shared by child settlements, driver attempts, and the final no-winner result. */
export function errMessage(error: unknown): string {
  const parts: string[] = []
  const seen = new Set<Error>()
  let current = error
  for (let depth = 0; depth <= maxCauseDepth; depth += 1) {
    try {
      if (!(current instanceof Error)) {
        parts.push(errorText(current).slice(0, maxPartLength))
        break
      }
      if (seen.has(current)) {
        parts.push('[circular]')
        break
      }
      seen.add(current)
      const status = errorHttpStatus(current)
      const message =
        (status === undefined ? '' : `HTTP ${status}: `) + (errorProperty(current, 'message') ?? '')
      parts.push(
        (depth === 0 ? message : `${errorProperty(current, 'name')}: ${message}`).slice(
          0,
          maxPartLength,
        ),
      )
      current = current.cause
      if (current === undefined || current === null) break
      if (depth === maxCauseDepth) parts.push('[cause chain truncated]')
    } catch {
      parts.push('[unreadable error cause]')
      break
    }
  }
  return parts.join(': caused by ').slice(0, maxMessageLength)
}
