import vm from 'node:vm'
import { ValidationError } from '../errors'
import type { WorkflowMeta } from './types'

export interface ParsedWorkflowScript {
  meta: WorkflowMeta
  body: string
}

const FORBIDDEN_BODY_PATTERNS: Array<[RegExp, string]> = [
  [/\bimport\b/, 'import'],
  [/\bexport\b/, 'export'],
  [/\brequire\b/, 'require'],
  [/\bprocess\b/, 'process'],
  [/\bDate\b/, 'Date'],
  [/\bFunction\b/, 'Function'],
  [/\beval\b/, 'eval'],
  [/\bfetch\b/, 'fetch'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\bsetTimeout\b/, 'setTimeout'],
  [/\bsetInterval\b/, 'setInterval'],
  [/\bsetImmediate\b/, 'setImmediate'],
  [/\bqueueMicrotask\b/, 'queueMicrotask'],
  [/\bglobalThis\b/, 'globalThis'],
  [/\bwindow\b/, 'window'],
  [/\bdocument\b/, 'document'],
  [/\bself\b/, 'self'],
  [/\bconstructor\b/, 'constructor'],
  [/\bprototype\b/, 'prototype'],
  [/\b__proto__\b/, '__proto__'],
  [/\bmodule\b/, 'module'],
  [/\bexports\b/, 'exports'],
  [/\bwhile\b/, 'while'],
  [/\bdo\b/, 'do'],
  [/\bfor\s*\(/, 'for-loop'],
  [/\bMath\s*\.\s*random\b/, 'Math.random'],
]

const FORBIDDEN_META_PATTERNS: Array<[RegExp, string]> = [
  [/\(/, 'call expression'],
  [/\bfunction\b/, 'function'],
  [/=>/, 'arrow function'],
  [/\bnew\b/, 'new'],
  [/\bclass\b/, 'class'],
  [/\.\.\./, 'spread'],
  [/`/, 'template literal'],
  [/\bconstructor\b/, 'constructor'],
  [/\bprototype\b/, 'prototype'],
  [/\b__proto__\b/, '__proto__'],
]

export function parseWorkflowScript(source: string): ParsedWorkflowScript {
  if (typeof source !== 'string' || source.trim().length === 0) {
    throw new ValidationError('workflow source must be a non-empty string')
  }
  const marker = /^\s*export\s+const\s+meta\s*=\s*/.exec(source)
  if (!marker) {
    throw new ValidationError('workflow source must start with `export const meta = { ... }`')
  }
  const literalStart = marker[0].length
  const literalEnd = findObjectLiteralEnd(source, literalStart)
  const literal = source.slice(literalStart, literalEnd)
  const restStart = consumeOptionalSemicolon(source, literalEnd)
  const body = source.slice(restStart).trim()
  const meta = evaluateMetaLiteral(literal)
  validateWorkflowBody(body)
  return { meta, body }
}

export function validateWorkflowBody(body: string): void {
  if (body.length === 0) {
    throw new ValidationError('workflow body must not be empty')
  }
  if (body.includes('`')) {
    throw new ValidationError('workflow body cannot use template literals')
  }
  const stripped = stripStringsAndComments(body)
  for (const [pattern, label] of FORBIDDEN_BODY_PATTERNS) {
    if (pattern.test(stripped)) {
      throw new ValidationError(`workflow body uses forbidden capability: ${label}`)
    }
  }
}

function findObjectLiteralEnd(source: string, start: number): number {
  let i = start
  while (/\s/.test(source[i] ?? '')) i += 1
  if (source[i] !== '{') {
    throw new ValidationError('workflow meta must be an object literal')
  }
  let depth = 0
  let quote: '"' | "'" | undefined
  let escaped = false
  for (; i < source.length; i += 1) {
    const ch = source[i]!
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === quote) {
        quote = undefined
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '`') throw new ValidationError('workflow meta cannot use template literals')
    if (ch === '{' || ch === '[') depth += 1
    if (ch === '}' || ch === ']') {
      depth -= 1
      if (depth === 0) return i + 1
    }
  }
  throw new ValidationError('workflow meta object literal is not closed')
}

function consumeOptionalSemicolon(source: string, start: number): number {
  let i = start
  while (/\s/.test(source[i] ?? '')) i += 1
  if (source[i] === ';') return i + 1
  return i
}

function evaluateMetaLiteral(literal: string): WorkflowMeta {
  for (const [pattern, label] of FORBIDDEN_META_PATTERNS) {
    if (pattern.test(literal)) {
      throw new ValidationError(`workflow meta uses forbidden syntax: ${label}`)
    }
  }
  let value: unknown
  try {
    value = new vm.Script(`(${literal})`).runInNewContext(Object.create(null), {
      timeout: 50,
      contextCodeGeneration: { strings: false, wasm: false },
    })
  } catch (err) {
    throw new ValidationError(
      `workflow meta is not a parseable object literal: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    )
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('workflow meta must evaluate to an object')
  }
  const raw = value as { name?: unknown; description?: unknown; phases?: unknown }
  if (typeof raw.name !== 'string' || raw.name.trim().length === 0) {
    throw new ValidationError('workflow meta.name must be a non-empty string')
  }
  if (typeof raw.description !== 'string' || raw.description.trim().length === 0) {
    throw new ValidationError('workflow meta.description must be a non-empty string')
  }
  const out: WorkflowMeta = {
    name: raw.name,
    description: raw.description,
  }
  if (raw.phases !== undefined) {
    if (!Array.isArray(raw.phases))
      throw new ValidationError('workflow meta.phases must be an array')
    out.phases = raw.phases.map((phase, index) => {
      if (!phase || typeof phase !== 'object' || Array.isArray(phase)) {
        throw new ValidationError(`workflow meta.phases[${index}] must be an object`)
      }
      const title = (phase as { title?: unknown }).title
      if (typeof title !== 'string' || title.trim().length === 0) {
        throw new ValidationError(`workflow meta.phases[${index}].title must be a non-empty string`)
      }
      return { title }
    })
  }
  return out
}

function stripStringsAndComments(source: string): string {
  let out = ''
  let quote: '"' | "'" | undefined
  let escaped = false
  let lineComment = false
  let blockComment = false
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!
    const next = source[i + 1]
    if (lineComment) {
      if (ch === '\n') {
        lineComment = false
        out += '\n'
      } else {
        out += ' '
      }
      continue
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false
        out += '  '
        i += 1
      } else {
        out += ch === '\n' ? '\n' : ' '
      }
      continue
    }
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === quote) {
        quote = undefined
      }
      out += ch === '\n' ? '\n' : ' '
      continue
    }
    if (ch === '/' && next === '/') {
      lineComment = true
      out += '  '
      i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      blockComment = true
      out += '  '
      i += 1
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      out += ' '
      continue
    }
    out += ch
  }
  return out
}
