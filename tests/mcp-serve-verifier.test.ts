import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mcpServeVerifier } from '../src/improvement/mcp-serve-verifier'

// A minimal stdio MCP server (newline-delimited JSON-RPC 2.0) used as the
// "built server" the verifier boots. Variants exercise each outcome.
function serverScript(variant: 'ok' | 'no-tools' | 'crash' | 'hang' | 'closed-stdin'): string {
  if (variant === 'crash') return 'process.exit(1)\n'
  if (variant === 'hang') return 'setInterval(() => {}, 1000)\n' // never answers
  if (variant === 'closed-stdin') {
    return [
      'import { closeSync } from "node:fs"',
      'process.stdin.on("error", () => {})',
      'process.stdin.once("data", (chunk) => {',
      '  const request = JSON.parse(String(chunk).trim())',
      '  closeSync(0)',
      '  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake", version: "0" } } }) + "\\n")',
      '})',
      'setInterval(() => {}, 1000)',
    ].join('\n')
  }
  const tools =
    variant === 'no-tools'
      ? '[]'
      : '[{ name: "echo", description: "echo", inputSchema: { type: "object" } }]'
  return [
    'import { createInterface } from "node:readline"',
    'const rl = createInterface({ input: process.stdin })',
    'const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n")',
    'rl.on("line", (line) => {',
    '  let msg; try { msg = JSON.parse(line) } catch { return }',
    '  if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake", version: "0" } } })',
    `  else if (msg.method === "tools/list") send({ jsonrpc: "2.0", id: msg.id, result: { tools: ${tools} } })`,
    '})',
  ].join('\n')
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-verify-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function write(variant: 'ok' | 'no-tools' | 'crash' | 'hang' | 'closed-stdin'): string {
  const path = join(dir, `server-${variant}.mjs`)
  writeFileSync(path, serverScript(variant))
  return path
}

describe('mcpServeVerifier — boot-and-probe', () => {
  it('passes a server that serves tools over the handshake', async () => {
    const verify = mcpServeVerifier({ command: 'node', args: [write('ok')] })
    expect(await verify(dir)).toEqual({ ok: true })
  })

  it('fails a server that exposes no tools', async () => {
    const verify = mcpServeVerifier({ command: 'node', args: [write('no-tools')] })
    const res = await verify(dir)
    expect(res.ok).toBe(false)
    expect(res.feedback).toContain('need >= 1')
  })

  it('fails a server that crashes on boot', async () => {
    const verify = mcpServeVerifier({ command: 'node', args: [write('crash')] })
    const res = await verify(dir)
    expect(res.ok).toBe(false)
    expect(res.feedback).toMatch(/exited|serving/)
  })

  it('fails when the server closes stdin during the handshake', async () => {
    const verify = mcpServeVerifier({
      command: 'node',
      args: [write('closed-stdin')],
      timeoutMs: 800,
    })
    const res = await verify(dir)
    expect(res.ok).toBe(false)
    expect(res.feedback).toContain('writing to MCP server stdin failed')
  })

  it('fails (does not hang) a server that never answers, via timeout', async () => {
    const verify = mcpServeVerifier({ command: 'node', args: [write('hang')], timeoutMs: 800 })
    const res = await verify(dir)
    expect(res.ok).toBe(false)
    expect(res.feedback).toContain('did not complete the handshake')
  })

  it('throws (setup bug) when the start binary is missing', async () => {
    const verify = mcpServeVerifier({ command: 'definitely-not-a-real-binary-xyz' })
    await expect(verify(dir)).rejects.toThrow(/not found in PATH/)
  })
})
