import { z } from 'zod'
import { resolveJsonPointer } from '../../mcp/tools/coordination-map-routing'
import type { RouteWhen } from '../../mcp/tools/coordination-route-contracts'

const scalar = z.union([z.string(), z.number().finite(), z.boolean(), z.null()])
const pointer = z.string().regex(/^(?:\/(?:[^~]|~[01])*)*$/)
const matchBase = { node: z.string().min(1).optional(), pointer }
const equals = z.strictObject({ ...matchBase, equals: scalar })
const oneOf = z.strictObject({ ...matchBase, in: z.array(scalar) })
const exists = z.strictObject({ ...matchBase, exists: z.boolean() })
const match = z.union([equals, oneOf, exists])

/** The same data grammar as routes; no executable expressions or additional operators. */
export const graphRouteWhenSchema = z.union([match, z.strictObject({ all: z.array(match).min(1) })])

const parameter = z.strictObject({
  default: z.unknown().optional(),
  type: z.enum(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']).optional(),
})
const command = z.strictObject({
  command: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
})
const nonnegativeInteger = z.number().int().nonnegative()

/** Authoring envelope. Canonical profiles and topology are validated by their existing owners. */
export const graphFileSchema = z.strictObject({
  digest: z.string().min(1).optional(),
  graph: z.string().min(1).optional(),
  describe: z.string().optional(),
  params: z.record(z.string().min(1), parameter).optional(),
  nodes: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        profile: z.record(z.string(), z.unknown()).optional(),
        seat: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
        needs: z.array(z.string().min(1)).optional(),
      }),
    )
    .min(1),
  entry: z
    .array(
      z.union([z.string().min(1), z.strictObject({ node: z.string().min(1), task: z.unknown() })]),
    )
    .min(1)
    .optional(),
  edges: z.array(z.record(z.string(), z.unknown())),
  gates: z.array(z.unknown()).optional(),
  budget: z.strictObject({
    maxIterations: nonnegativeInteger,
    maxTokens: nonnegativeInteger,
    maxUsd: z.number().finite().nonnegative().optional(),
    deadlineMs: nonnegativeInteger.optional(),
    resources: z
      .record(z.string(), z.strictObject({ unit: z.string().min(1), limit: nonnegativeInteger }))
      .optional(),
  }),
  check: z
    .union([
      equals.extend({ describe: z.string().optional() }),
      oneOf.extend({ describe: z.string().optional() }),
      exists.extend({ describe: z.string().optional() }),
      z.strictObject({ describe: z.string().optional(), all: z.array(match).min(1) }),
      z.strictObject({ describe: z.string().optional(), command }),
    ])
    .optional(),
  deliverable: z
    .strictObject({
      describe: z.string().optional(),
      checkRef: z.string().min(1),
      command: command.optional(),
      when: graphRouteWhenSchema.optional(),
    })
    .optional(),
  on: z.unknown().optional(),
})

/** Judge the flow's terminal-output map with RouteWhen's own JSON-pointer semantics. */
export function checkGraphRoute(when: RouteWhen, output: unknown): boolean {
  return ('all' in when ? when.all : [when]).every((condition) => {
    let document = output
    if (condition.node !== undefined) {
      if (!output || typeof output !== 'object' || !Object.hasOwn(output, condition.node))
        return false
      document = (output as Record<string, unknown>)[condition.node]
    }
    const selected = resolveJsonPointer(document, condition.pointer)
    if ('exists' in condition) return selected.found === condition.exists
    if (!selected.found) return false
    return 'equals' in condition
      ? selected.value === condition.equals
      : condition.in.some((value) => value === selected.value)
  })
}
