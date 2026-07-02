/**
 *
 * The loop-shape registry — the OPEN, content-free extension point for the personify layer.
 *
 * A `LoopShape` is reusable STRUCTURE (how to decompose / fan out / verify / synthesize),
 * parameterized by a persona's CONTENT. The registry lets a caller resolve a composed shape by
 * NAME: register a factory once, then `runPersonified({ shape: '<name>' })` resolves it with zero
 * edits elsewhere. `register` fails loud on a duplicate; `resolve` returns a typed outcome so an
 * unknown name is a named error, never a silent default.
 *
 * No shape is pre-registered: the generic combinators (`pipeline`/`fanout`/`loopUntil`/`panel`/
 * `verify`/`widen`) take spec arguments, so they are not bare zero-arg factories — a caller that
 * wants name-resolution registers its own COMPOSED shape (a combinator already applied to its
 * spec) on a registry instance. The registry carries SHAPE only; the domain lives on the persona.
 *
 * @experimental
 */

import { ValidationError } from '../../errors'
import type { LoopShape, ShapeRegistry } from './types'

/**
 * Build a fresh open `ShapeRegistry`. A factory is stored type-erased and re-cast on resolve — the
 * caller asserts the `<Task, D>` it expects, exactly as the executor registry stores its factories.
 */
export function createShapeRegistry(): ShapeRegistry {
  const shapes = new Map<string, LoopShape<unknown, unknown>>()
  return {
    register<Task, D>(name: string, factory: LoopShape<Task, D>): void {
      if (shapes.has(name)) {
        throw new ValidationError(`shape registry: shape "${name}" already registered`)
      }
      shapes.set(name, factory as LoopShape<unknown, unknown>)
    },
    resolve<Task, D>(name: string) {
      const factory = shapes.get(name)
      if (!factory) {
        return { succeeded: false as const, error: `shape registry: unknown shape "${name}"` }
      }
      return { succeeded: true as const, value: factory as LoopShape<Task, D> }
    },
    names(): string[] {
      return [...shapes.keys()]
    },
  }
}

/** The default registry `runPersonified` resolves a shape name against. Empty by construction —
 *  a caller registers its own composed shapes; the engine ships no domain shape. */
export const builtinShapes: ShapeRegistry = createShapeRegistry()

/** Register a composed shape on the default `builtinShapes` registry — the one-call extension
 *  point a caller invokes so its shape is resolvable by name with zero edits to the engine. */
export function registerShape<Task, D>(name: string, factory: LoopShape<Task, D>): void {
  builtinShapes.register(name, factory)
}
