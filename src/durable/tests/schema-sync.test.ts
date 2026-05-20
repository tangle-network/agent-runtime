/**
 * Guard: the inlined `DURABLE_SCHEMA_SQL` constant must stay byte-identical
 * to `src/durable/schema.sql`. If the .sql file is the source of truth, the
 * constant cannot drift — otherwise consumers and tests see different
 * schemas and the D1 store silently goes inconsistent.
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { DURABLE_SCHEMA_SQL, DURABLE_SCHEMA_VERSION } from '../schema'

describe('durable schema', () => {
  it('inlined SQL constant matches schema.sql byte-for-byte', () => {
    const fileSql = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
    expect(DURABLE_SCHEMA_SQL).toBe(fileSql)
  })

  it('schema version is positive integer', () => {
    expect(DURABLE_SCHEMA_VERSION).toBeGreaterThan(0)
    expect(Number.isInteger(DURABLE_SCHEMA_VERSION)).toBe(true)
  })
})
