import { z } from 'zod'
import { ValidationError } from '../../errors'

export interface GraphParameterBindings {
  readonly params?: Readonly<Record<string, unknown>>
  readonly trigger?: Readonly<Record<string, unknown>>
}

const triggerPart = z.strictObject({ trigger: z.array(z.string()).min(1) })
const literalPart = z.strictObject({ literal: z.string() })
/** Explicit authored trigger slots in compiled graph data. An empty list marks fully bound data. */
export const graphTriggerBindingsSchema = z.array(
  z
    .strictObject({
      path: z.array(z.union([z.string(), z.number().int().nonnegative()])).min(1),
      mode: z.enum(['value', 'text']),
      parts: z.array(z.union([literalPart, triggerPart])).min(1),
    })
    .superRefine((slot, context) => {
      if (
        !slot.parts.some((part) => 'trigger' in part) ||
        (slot.mode === 'value' && (slot.parts.length !== 1 || !('trigger' in slot.parts[0]!)))
      )
        context.addIssue({
          code: 'custom',
          message: 'binding requires authored trigger parts; value slots require one trigger',
        })
    }),
)
/** @useDeclaredType */
export type GraphTriggerBinding = z.infer<typeof graphTriggerBindingsSchema>[number]

type Part = GraphTriggerBinding['parts'][number]

function readBinding(
  namespace: keyof GraphParameterBindings,
  keys: readonly string[],
  bindings: GraphParameterBindings,
): unknown {
  let found: unknown = bindings[namespace]
  for (const key of keys) {
    if (!found || typeof found !== 'object' || !Object.hasOwn(found, key))
      throw new ValidationError(`graph parameters: missing ${[namespace, ...keys].join('.')}`)
    found = (found as Record<string, unknown>)[key]
  }
  if (found === undefined)
    throw new ValidationError(`graph parameters: missing ${[namespace, ...keys].join('.')}`)
  return structuredClone(found)
}

function textValue(value: unknown, expression: string): string {
  if (value !== null && typeof value === 'object')
    throw new ValidationError(`graph parameters: ${expression} needs a whole JSON slot`)
  return String(value)
}

function pendingText(parts: readonly Part[]): string {
  return parts
    .map((part) => ('literal' in part ? part.literal : `\${trigger.${part.trigger.join('.')}}`))
    .join('')
}

/** Compile authored slots once. Inserted values are data, never recursively parsed templates. */
export function compileGraphParameters(
  value: unknown,
  bindings: GraphParameterBindings,
  options: { readonly defer?: readonly (keyof GraphParameterBindings)[] } = {},
): { value: unknown; triggerBindings: GraphTriggerBinding[] } {
  const visiting = new Set<object>()
  const triggerBindings: GraphTriggerBinding[] = []
  const bind = (item: unknown, path: Array<string | number>): unknown => {
    if (typeof item === 'string') {
      if (item.replace(/\$\{[^{}]+\}/g, '').includes('${'))
        throw new ValidationError('graph parameters: malformed reference')
      const whole = /^\$\{([^{}]+)\}$/.exec(item)
      const parts: Part[] = []
      let cursor = 0
      let wholeValue: unknown
      let boundWhole = false
      for (const match of item.matchAll(/\$\{([^{}]+)\}/g)) {
        if (match.index > cursor) parts.push({ literal: item.slice(cursor, match.index) })
        const [namespace, ...keys] = match[1]!.split('.')
        if ((namespace !== 'params' && namespace !== 'trigger') || keys.length === 0)
          throw new ValidationError(`graph parameters: unsupported reference \${${match[1]}}`)
        if (options.defer?.includes(namespace)) {
          if (namespace === 'trigger') parts.push({ trigger: keys })
          else parts.push({ literal: match[0] })
        } else {
          const found = readBinding(namespace, keys, bindings)
          if (whole) {
            wholeValue = found
            boundWhole = true
          } else parts.push({ literal: textValue(found, match[1]!) })
        }
        cursor = match.index + match[0].length
      }
      if (boundWhole) return wholeValue
      if (cursor === 0) return item
      if (cursor < item.length) parts.push({ literal: item.slice(cursor) })
      if (parts.some((part) => 'trigger' in part))
        triggerBindings.push({ path, mode: whole ? 'value' : 'text', parts })
      return pendingText(parts)
    }
    if (!item || typeof item !== 'object') return item
    if (visiting.has(item)) throw new ValidationError('graph parameters: cyclic data is not JSON')
    visiting.add(item)
    const bound = Array.isArray(item)
      ? item.map((child, index) => bind(child, [...path, index]))
      : Object.fromEntries(
          Object.entries(item).map(([key, child]) => [key, bind(child, [...path, key])]),
        )
    visiting.delete(item)
    return bound
  }
  return { value: bind(value, []), triggerBindings }
}

/** Legacy authored-data binding. Compiled graphs use bindCompiledGraphTriggers instead. */
export function bindGraphParameters(
  value: unknown,
  bindings: GraphParameterBindings,
  options: { readonly defer?: readonly (keyof GraphParameterBindings)[] } = {},
): unknown {
  return compileGraphParameters(value, bindings, options).value
}

/** Check provenance against the exact provisional values without reading trigger data. */
export function assertGraphTriggerBindings(
  value: unknown,
  slots: readonly GraphTriggerBinding[],
): void {
  const seen = new Set<string>()
  for (const slot of graphTriggerBindingsSchema.parse(slots)) {
    const key = JSON.stringify(slot.path.map(String))
    if (seen.has(key)) throw new ValidationError('graph parameters: duplicate trigger binding path')
    seen.add(key)
    let found: unknown = value
    for (const key of slot.path) {
      if (!found || typeof found !== 'object' || !Object.hasOwn(found, key))
        throw new ValidationError('graph parameters: trigger binding path does not exist')
      found = (found as Record<string | number, unknown>)[key]
    }
    if (found !== pendingText(slot.parts))
      throw new ValidationError(
        'graph parameters: trigger binding does not match its provisional value',
      )
  }
}

/** Only explicitly recorded authored slots bind. Literal parameter/trigger values are untouched. */
export function bindCompiledGraphTriggers<T>(
  value: T,
  slots: readonly GraphTriggerBinding[],
  trigger: GraphParameterBindings['trigger'],
): T {
  assertGraphTriggerBindings(value, slots)
  const bound = structuredClone(value)
  for (const slot of slots) {
    let parent = bound as Record<string | number, unknown>
    for (const key of slot.path.slice(0, -1)) parent = parent[key] as typeof parent
    parent[slot.path.at(-1)!] =
      slot.mode === 'value'
        ? readBinding('trigger', (slot.parts[0]! as { trigger: string[] }).trigger, { trigger })
        : slot.parts
            .map((part) =>
              'literal' in part
                ? part.literal
                : textValue(
                    readBinding('trigger', part.trigger, { trigger }),
                    `trigger.${part.trigger.join('.')}`,
                  ),
            )
            .join('')
  }
  return bound
}
