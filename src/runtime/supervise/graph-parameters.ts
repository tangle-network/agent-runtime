import { ValidationError } from '../../errors'

export interface GraphParameterBindings {
  readonly params?: Readonly<Record<string, unknown>>
  readonly trigger?: Readonly<Record<string, unknown>>
}

/** Bind JSON slots without evaluating code. Whole slots retain their JSON type. */
export function bindGraphParameters(
  value: unknown,
  bindings: GraphParameterBindings,
  options: { readonly defer?: readonly (keyof GraphParameterBindings)[] } = {},
): unknown {
  const visiting = new Set<object>()
  const read = (expression: string): { value: unknown } | undefined => {
    const [namespace, ...keys] = expression.split('.')
    if ((namespace !== 'params' && namespace !== 'trigger') || keys.length === 0)
      throw new ValidationError(`graph parameters: unsupported reference \${${expression}}`)
    if (options.defer?.includes(namespace)) return undefined
    let found: unknown = bindings[namespace]
    for (const key of keys) {
      if (!found || typeof found !== 'object' || !Object.hasOwn(found, key))
        throw new ValidationError(`graph parameters: missing ${expression}`)
      found = (found as Record<string, unknown>)[key]
    }
    if (found === undefined) throw new ValidationError(`graph parameters: missing ${expression}`)
    return { value: structuredClone(found) }
  }
  const bind = (item: unknown): unknown => {
    if (typeof item === 'string') {
      if (item.replace(/\$\{[^{}]+\}/g, '').includes('${'))
        throw new ValidationError('graph parameters: malformed reference')
      const whole = /^\$\{([^{}]+)\}$/.exec(item)
      if (whole) {
        const bound = read(whole[1]!)
        return bound ? bound.value : item
      }
      return item.replace(/\$\{([^{}]+)\}/g, (slot, expression: string) => {
        const bound = read(expression)
        if (!bound) return slot
        if (bound.value !== null && typeof bound.value === 'object')
          throw new ValidationError(`graph parameters: ${expression} needs a whole JSON slot`)
        return String(bound.value)
      })
    }
    if (!item || typeof item !== 'object') return item
    if (visiting.has(item)) throw new ValidationError('graph parameters: cyclic data is not JSON')
    visiting.add(item)
    const bound = Array.isArray(item)
      ? item.map(bind)
      : Object.fromEntries(Object.entries(item).map(([key, child]) => [key, bind(child)]))
    visiting.delete(item)
    return bound
  }
  return bind(value)
}
