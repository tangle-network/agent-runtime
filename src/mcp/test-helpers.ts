import type { JsonRpcResponse } from './protocol'

/** Return a successful JSON-RPC result or fail the test at the response boundary. */
export function requireJsonRpcResult<T>(response: JsonRpcResponse | null): T {
  if (response?.result !== undefined) return response.result as T

  if (response?.error !== undefined) {
    throw new Error(
      `Expected JSON-RPC result, received ${response.error.code ?? 'unknown'}: ${response.error.message ?? 'unknown error'}`,
    )
  }

  throw new Error('Expected JSON-RPC result, received no response')
}
