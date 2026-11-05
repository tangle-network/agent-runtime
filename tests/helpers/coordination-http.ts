import type { AwaitWakeInput } from '../../src/mcp/tools/coordination-events'

/** A wake input that waits on no timer unless the test sets one. */
export const wakeInput = (over: Partial<AwaitWakeInput> = {}): AwaitWakeInput => ({
  signal: new AbortController().signal,
  heartbeatMs: 60_000,
  debounceMs: 0,
  ...over,
})

export async function jsonRpc(
  url: string,
  method: string,
  params: unknown,
  headers?: Readonly<Record<string, string>>,
): Promise<{ result?: unknown; error?: unknown }> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return (await r.json()) as { result?: unknown; error?: unknown }
}
