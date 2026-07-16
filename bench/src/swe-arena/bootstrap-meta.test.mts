/**
 * Unit tests for the metadata bootstrap's validation layer — pure, no dataset
 * load. The adapter-backed loaders are exercised by the calibration CLI.
 */

import { describe, expect, it } from 'vitest'
import { assertSweInstance } from './bootstrap-meta.mts'

const full = {
  instance_id: 'django__django-11532',
  repo: 'django/django',
  base_commit: 'a5308514fb4bc5086c9a16a8a24a945eeebb073c',
  problem_statement: 'Email messages crash on non-ASCII domain…',
  patch: 'diff --git a/django/core/mail/utils.py …',
  test_patch: 'diff --git a/tests/mail/tests.py …',
  FAIL_TO_PASS: '["test_unicode_dns (mail.tests.MailTests)"]',
  PASS_TO_PASS: '["test_ascii (mail.tests.MailTests)"]',
  version: '3.0',
  environment_setup_commit: '419a78300f7cd27611196e1e464d50fd0385ff27',
}

describe('assertSweInstance', () => {
  it('accepts a complete metadata record and returns the typed instance', () => {
    const inst = assertSweInstance('django__django-11532', full)
    expect(inst.instance_id).toBe('django__django-11532')
    expect(inst.patch).toContain('diff --git')
    expect(inst.version).toBe('3.0')
  })

  it('normalizes absent optional fields to null', () => {
    const inst = assertSweInstance('django__django-11532', {
      ...full,
      version: undefined,
      environment_setup_commit: '',
    })
    expect(inst.version).toBeNull()
    expect(inst.environment_setup_commit).toBeNull()
  })

  it('throws on a missing/empty load-bearing field (never a silent blank)', () => {
    expect(() => assertSweInstance('django__django-11532', { ...full, problem_statement: '' })).toThrow(
      /problem_statement/,
    )
    expect(() => assertSweInstance('django__django-11532', { ...full, patch: undefined })).toThrow(/patch/)
    expect(() => assertSweInstance('django__django-11532', undefined)).toThrow(/no metadata/)
  })

  it('throws on an instance_id mismatch', () => {
    expect(() => assertSweInstance('astropy__astropy-13033', full)).toThrow(/instance_id/)
  })
})
