import { createHmac, randomBytes } from 'node:crypto'

import {
  DEFAULT_REDACTION_RULES,
  REDACTION_VERSION,
  type RedactionRule,
  redactString,
} from '@tangle-network/agent-eval'

export interface ProtectedRedactionReport {
  version: string
  redactionCount: number
  byRule: Record<string, number>
}

export interface ProtectedTraceIdentity {
  readonly runId: string
  readonly tags: Readonly<Record<string, string>>
}

export interface ProtectedRecordRedactor {
  record<T>(value: T): T
  query<T>(value: T): T
  identifier(value: string): string
  traceIdentity(trace: ProtectedTraceIdentity): ProtectedTraceIdentity
  report(): ProtectedRedactionReport
}

/** Create one execution-local namespace for identifiers changed by redaction. */
export function createProtectedRecordRedactor(
  protectedValues: readonly string[],
): ProtectedRecordRedactor {
  const identityKey = randomBytes(32)
  const aggregate: ProtectedRedactionReport = {
    version: REDACTION_VERSION,
    redactionCount: 0,
    byRule: {},
  }

  const mergeReport = (report: ProtectedRedactionReport): void => {
    aggregate.version = report.version
    aggregate.redactionCount += report.redactionCount
    for (const [rule, count] of Object.entries(report.byRule)) {
      aggregate.byRule[rule] = (aggregate.byRule[rule] ?? 0) + count
    }
  }

  const redactScalar = <T>(value: T, record: boolean): T => {
    const redacted = redactProtectedValue(value, protectedValues)
    if (record) mergeReport(redacted.report)
    return redacted.value
  }

  const identifier = (value: string, record: boolean): string => {
    const redacted = redactScalar(value, record)
    if (redacted === value) return value
    const digest = createHmac('sha256', identityKey).update(value).digest('hex')
    return `${redacted}:hmac-sha256:${digest}`
  }

  const transform = <T>(value: T, record: boolean): T => {
    const transformed = transformProtectedRecord(
      value,
      undefined,
      record,
      redactScalar,
      identifier,
    ) as T
    assertNoProtectedEvidence(transformed, protectedValues)
    return transformed
  }

  return Object.freeze({
    record: <T>(value: T): T => transform(value, true),
    query: <T>(value: T): T => transform(value, false),
    identifier: (value: string): string => identifier(value, false),
    traceIdentity: (trace: ProtectedTraceIdentity): ProtectedTraceIdentity =>
      transform(trace, false),
    report: (): ProtectedRedactionReport => ({
      version: aggregate.version,
      redactionCount: aggregate.redactionCount,
      byRule: { ...aggregate.byRule },
    }),
  })
}

/** Redact protected values at the first persistence boundary, including object keys and bytes. */
export function redactProtectedValue<T>(
  value: T,
  protectedValues: readonly string[],
): { value: T; report: ProtectedRedactionReport } {
  const report: ProtectedRedactionReport = {
    version: REDACTION_VERSION,
    redactionCount: 0,
    byRule: {},
  }
  const rules = protectedRedactionRules(protectedValues)
  const redacted = redactNode(value, protectedValues, rules, report) as T
  assertNoProtectedEvidence(redacted, protectedValues)
  return { value: redacted, report }
}

export function redactProtectedReason(reason: string, protectedValues: readonly string[]): string {
  try {
    return redactProtectedValue(reason, protectedValues).value
  } catch {
    return 'candidate execution failed with a protected error'
  }
}

export function assertNoProtectedEvidence(
  value: unknown,
  protectedValues: readonly string[],
): void {
  if (value instanceof Uint8Array) {
    assertNoProtectedBytes(value, protectedValues)
    return
  }
  if (typeof value === 'string') {
    for (const protectedValue of protectedValueVariants(protectedValues)) {
      if (value.includes(protectedValue)) {
        throw new Error('protected value survived candidate evidence redaction')
      }
    }
    if (decodedBase64ContainsProtectedValue(value, protectedValues)) {
      throw new Error('base64 protected value survived candidate evidence redaction')
    }
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) assertNoProtectedEvidence(entry, protectedValues)
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      assertNoProtectedEvidence(key, protectedValues)
      assertNoProtectedEvidence(entry, protectedValues)
    }
  }
}

export function assertNoProtectedBytes(
  bytes: Uint8Array,
  protectedValues: readonly string[],
): void {
  if (containsProtectedBytes(bytes, protectedValues)) {
    throw new Error('protected value survived candidate evidence byte redaction')
  }
}

function redactNode(
  value: unknown,
  protectedValues: readonly string[],
  rules: readonly RedactionRule[],
  report: ProtectedRedactionReport,
): unknown {
  if (value instanceof Uint8Array) {
    if (containsProtectedBytes(value, protectedValues)) {
      recordRedaction(report, 'candidate-access-binary', 1)
      return Uint8Array.from(Buffer.from('[redacted:candidate-access-binary]', 'utf8'))
    }
    return Uint8Array.from(value)
  }
  if (typeof value === 'string') {
    if (decodedBase64ContainsProtectedValue(value, protectedValues)) {
      recordRedaction(report, 'candidate-access-binary', 1)
      return '[redacted:candidate-access-binary]'
    }
    const redacted = redactString(value, [...rules])
    for (const [rule, count] of Object.entries(redacted.report.byRule)) {
      recordRedaction(report, rule, count)
    }
    return redacted.output
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactNode(entry, protectedValues, rules, report))
  }
  if (value && typeof value === 'object') {
    const entries: Array<[string, unknown]> = []
    const seenKeys = new Set<string>()
    for (const [key, entry] of Object.entries(value)) {
      const redactedKey = redactNode(key, protectedValues, rules, report)
      if (typeof redactedKey !== 'string' || seenKeys.has(redactedKey)) {
        throw new Error('protected evidence redaction produced an ambiguous object key')
      }
      seenKeys.add(redactedKey)
      entries.push([redactedKey, redactNode(entry, protectedValues, rules, report)])
    }
    return Object.fromEntries(entries)
  }
  return value
}

function transformProtectedRecord(
  value: unknown,
  fieldName: string | undefined,
  record: boolean,
  redactScalar: <T>(value: T, record: boolean) => T,
  redactIdentifier: (value: string, record: boolean) => string,
): unknown {
  if (value instanceof Uint8Array) return redactScalar(value, record)
  if (typeof value === 'string') {
    return fieldName && isIdentifierFieldName(fieldName)
      ? redactIdentifier(value, record)
      : redactScalar(value, record)
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      transformProtectedRecord(entry, fieldName, record, redactScalar, redactIdentifier),
    )
  }
  if (!value || typeof value !== 'object') return value

  if (fieldName === 'tags') {
    return transformTagMap(value, record, redactScalar, redactIdentifier)
  }
  if (fieldName === 'tag') {
    return transformTagFilter(value, record, redactScalar, redactIdentifier)
  }

  const entries: Array<[string, unknown]> = []
  const seenKeys = new Set<string>()
  for (const [key, entry] of Object.entries(value)) {
    const redactedKey = redactScalar(key, record)
    if (seenKeys.has(redactedKey)) {
      throw new Error('protected evidence redaction produced an ambiguous object key')
    }
    seenKeys.add(redactedKey)
    entries.push([
      redactedKey,
      transformProtectedRecord(entry, key, record, redactScalar, redactIdentifier),
    ])
  }
  return Object.fromEntries(entries)
}

function transformTagMap(
  value: object,
  record: boolean,
  redactScalar: <T>(value: T, record: boolean) => T,
  redactIdentifier: (value: string, record: boolean) => string,
): Record<string, unknown> {
  const entries: Array<[string, unknown]> = []
  const seenKeys = new Set<string>()
  for (const [key, entry] of Object.entries(value)) {
    const redactedKey = redactIdentifier(key, record)
    if (seenKeys.has(redactedKey)) {
      throw new Error('protected evidence redaction produced an ambiguous trace tag')
    }
    seenKeys.add(redactedKey)
    entries.push([
      redactedKey,
      typeof entry === 'string'
        ? redactIdentifier(entry, record)
        : transformProtectedRecord(entry, key, record, redactScalar, redactIdentifier),
    ])
  }
  return Object.fromEntries(entries)
}

function transformTagFilter(
  value: object,
  record: boolean,
  redactScalar: <T>(value: T, record: boolean) => T,
  redactIdentifier: (value: string, record: boolean) => string,
): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const redactedKey = redactScalar(key, record)
    output[redactedKey] =
      (key === 'key' || key === 'value') && typeof entry === 'string'
        ? redactIdentifier(entry, record)
        : transformProtectedRecord(entry, key, record, redactScalar, redactIdentifier)
  }
  return output
}

function isIdentifierFieldName(name: string): boolean {
  return /ids?$/i.test(name)
}

function protectedRedactionRules(protectedValues: readonly string[]): RedactionRule[] {
  const exactRules = protectedValueVariants(protectedValues)
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .map((value, index) => ({
      id: `candidate-access-${index}`,
      pattern: new RegExp(escapeRegularExpression(value), 'g'),
      replacement: '[redacted:candidate-access]',
    }))
  return [...exactRules, ...DEFAULT_REDACTION_RULES]
}

function recordRedaction(report: ProtectedRedactionReport, rule: string, count: number): void {
  if (count <= 0) return
  report.redactionCount += count
  report.byRule[rule] = (report.byRule[rule] ?? 0) + count
}

function containsProtectedBytes(bytes: Uint8Array, protectedValues: readonly string[]): boolean {
  const source = Buffer.from(bytes)
  return protectedValueVariants(protectedValues).some((value) =>
    source.includes(Buffer.from(value, 'utf8')),
  )
}

function decodedBase64ContainsProtectedValue(
  value: string,
  protectedValues: readonly string[],
): boolean {
  if (value.length < 4 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    return false
  }
  try {
    return containsProtectedBytes(Buffer.from(value, 'base64'), protectedValues)
  } catch {
    return false
  }
}

function protectedValueVariants(protectedValues: readonly string[]): string[] {
  const variants = new Set<string>()
  for (const value of normalizedProtectedValues(protectedValues)) {
    variants.add(value)
    variants.add(Buffer.from(value, 'utf8').toString('base64'))
    variants.add(Buffer.from(value, 'utf8').toString('base64url'))
    variants.add(encodeURIComponent(value))
  }
  return [...variants]
}

function normalizedProtectedValues(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))]
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
