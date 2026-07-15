import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createCodexExecutionDiagnosticError,
  readCodexAuthRedactionText,
} from '../../src/mcp/codex-diagnostics'

describe('Codex failure diagnostics', () => {
  it('redacts credentials from the message, structured fields, and stored cause', () => {
    const secret = 'sk-cause-proof-1234567890'
    const codexHome = '/tmp/private-codex-home'
    const error = createCodexExecutionDiagnosticError({
      reason: `request failed: Bearer ${secret}`,
      exitCode: 1,
      killedBySignal: null,
      timedOut: false,
      durationMs: 12,
      stdout: JSON.stringify({ type: 'error', access_token: secret }),
      stderr: `auth path ${codexHome}; client_secret="${secret}"`,
      codexHome,
      redactionValues: [secret],
      cause: new Error(`provider rejected api_key=${secret}`),
    })

    const cause = error.cause as Error
    const serialized = JSON.stringify({
      message: error.message,
      reason: error.reason,
      diagnostic: error.diagnostic,
      cause: cause.stack,
    })
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain(codexHome)
    expect(serialized).toContain('<REDACTED_CREDENTIAL>')
    expect(serialized).toContain('<ISOLATED_CODEX_HOME>')
  })

  it('refuses non-regular and oversized auth sources before reading them', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-runtime-codex-auth-read-'))
    const oversized = join(root, 'oversized.json')
    writeFileSync(oversized, Buffer.alloc(1024 * 1024 + 1))
    try {
      await expect(readCodexAuthRedactionText(root)).rejects.toThrow(/regular file/)
      await expect(readCodexAuthRedactionText(oversized)).rejects.toThrow(/no larger than 1 MiB/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
