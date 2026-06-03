import { describe, expect, it } from 'vitest'
import type { UiAuditorDelegate } from '../../src/mcp/delegates'
import { DelegationTaskQueue } from '../../src/mcp/task-queue'
import {
  createDelegateUiAuditHandler,
  DELEGATE_UI_AUDIT_DESCRIPTION,
  DELEGATE_UI_AUDIT_INPUT_SCHEMA,
  DELEGATE_UI_AUDIT_TOOL_NAME,
  validateDelegateUiAuditArgs,
} from '../../src/mcp/tools/delegate-ui-audit'

const stubDelegate: UiAuditorDelegate = async (args) => ({
  workspaceDir: args.workspaceDir,
  indexFile: 'index.md',
  findings: [],
  iterations: 0,
})

describe('validateDelegateUiAuditArgs', () => {
  it('requires workspaceDir + non-empty routes', () => {
    expect(() => validateDelegateUiAuditArgs({})).toThrow(/workspaceDir/)
    expect(() => validateDelegateUiAuditArgs({ workspaceDir: '/ws' })).toThrow(/routes/)
    expect(() => validateDelegateUiAuditArgs({ workspaceDir: '/ws', routes: [] })).toThrow(/routes/)
  })

  it('rejects relative workspaceDir at the wire boundary', () => {
    for (const wsDir of ['.', './tmp', '../parent', 'relative/path', 'tmp']) {
      expect(() =>
        validateDelegateUiAuditArgs({
          workspaceDir: wsDir,
          routes: [{ name: 'home', url: 'https://example.com' }],
        }),
      ).toThrow(/must be an absolute path/)
    }
  })

  it('accepts an absolute workspaceDir', () => {
    expect(() =>
      validateDelegateUiAuditArgs({
        workspaceDir: '/tmp/audits/foo',
        routes: [{ name: 'home', url: 'https://example.com' }],
      }),
    ).not.toThrow()
  })

  it('rejects routes missing name or url', () => {
    expect(() =>
      validateDelegateUiAuditArgs({ workspaceDir: '/ws', routes: [{ name: 'home' }] }),
    ).toThrow(/url/)
    expect(() =>
      validateDelegateUiAuditArgs({
        workspaceDir: '/ws',
        routes: [{ url: 'https://example.com' }],
      }),
    ).toThrow(/name/)
  })

  it('rejects malformed URLs at the wire boundary', () => {
    expect(() =>
      validateDelegateUiAuditArgs({
        workspaceDir: '/ws',
        routes: [{ name: 'home', url: 'not a url' }],
      }),
    ).toThrow(/parseable URL/)
  })

  it('rejects non-http(s) URL schemes (SSRF defense)', () => {
    for (const url of [
      'file:///etc/passwd',
      'data:text/html,<script>alert(1)</script>',
      'javascript:alert(1)',
      'ftp://example.com/x',
    ]) {
      expect(() =>
        validateDelegateUiAuditArgs({
          workspaceDir: '/ws',
          routes: [{ name: 'home', url }],
        }),
      ).toThrow(/must use http or https/)
    }
  })

  it('accepts both http and https', () => {
    expect(() =>
      validateDelegateUiAuditArgs({
        workspaceDir: '/ws',
        routes: [{ name: 'home', url: 'http://localhost:3000' }],
      }),
    ).not.toThrow()
    expect(() =>
      validateDelegateUiAuditArgs({
        workspaceDir: '/ws',
        routes: [{ name: 'home', url: 'https://example.com/path?q=1' }],
      }),
    ).not.toThrow()
  })

  it('rejects unknown lenses', () => {
    expect(() =>
      validateDelegateUiAuditArgs({
        workspaceDir: '/ws',
        routes: [{ name: 'home', url: 'https://example.com' }],
        config: { lenses: ['not-a-lens'] },
      }),
    ).toThrow(/must be one of/)
  })

  it('rejects non-positive viewport dimensions', () => {
    expect(() =>
      validateDelegateUiAuditArgs({
        workspaceDir: '/ws',
        routes: [
          {
            name: 'home',
            url: 'https://example.com',
            viewports: [{ width: 0, height: 800 }],
          },
        ],
      }),
    ).toThrow(/positive integer/)
  })

  it('accepts a minimally complete payload and preserves the lens order', () => {
    const ok = validateDelegateUiAuditArgs({
      workspaceDir: '/ws',
      routes: [{ name: 'home', url: 'https://example.com' }],
      config: { lenses: ['consistency', 'hierarchy', 'layout'] },
    })
    expect(ok.workspaceDir).toBe('/ws')
    expect(ok.routes).toHaveLength(1)
    expect(ok.config?.lenses).toEqual(['consistency', 'hierarchy', 'layout'])
  })
})

describe('tool descriptor', () => {
  it('exposes a stable name + non-empty schema', () => {
    expect(DELEGATE_UI_AUDIT_TOOL_NAME).toBe('delegate_ui_audit')
    expect(DELEGATE_UI_AUDIT_DESCRIPTION.length).toBeGreaterThan(0)
    expect((DELEGATE_UI_AUDIT_INPUT_SCHEMA as { type?: string }).type).toBe('object')
  })
})

describe('createDelegateUiAuditHandler', () => {
  it('returns a taskId and binds the ui-auditor profile + namespace', async () => {
    const queue = new DelegationTaskQueue()
    const handler = createDelegateUiAuditHandler({ queue, delegate: stubDelegate })
    const { taskId } = await handler({
      workspaceDir: '/ws',
      routes: [{ name: 'home', url: 'https://example.com' }],
      namespace: 'tenant-a',
    })
    expect(taskId).toMatch(/^dlg-/)
    // Drain microtasks so the record transitions out of `pending`.
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    const status = queue.status(taskId)
    expect(status?.profile).toBe('ui-auditor')
    expect(['running', 'completed']).toContain(status?.status)
    const history = queue.history({ namespace: 'tenant-a', profile: 'ui-auditor' })
    expect(history).toHaveLength(1)
    expect(history[0]?.namespace).toBe('tenant-a')
  })

  it('idempotency: identical input yields the same taskId', async () => {
    const queue = new DelegationTaskQueue()
    const handler = createDelegateUiAuditHandler({ queue, delegate: stubDelegate })
    const args = {
      workspaceDir: '/ws',
      routes: [{ name: 'home', url: 'https://example.com' }],
    }
    const a = await handler(args)
    const b = await handler(args)
    expect(a.taskId).toBe(b.taskId)
  })
})
