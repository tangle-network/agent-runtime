import { ValidationError } from '../errors'

/**
 * Interface 5.3 admits proxy secrets and private config values, but the current Sandbox SDK
 * carries Interface 4.0. Refuse these fields before either candidate conversion or a direct
 * Sandbox create can silently lose them. Remove this guard when Sandbox carries the fields.
 */
export function assertSandboxProfileCompatibility(
  profile: unknown,
  context = 'candidate profile',
): void {
  if (!isRecord(profile)) return
  if (profile.proxySecrets !== undefined) refuseField('proxySecrets', context)
  if (isRecord(profile.mcp)) {
    for (const [name, server] of Object.entries(profile.mcp)) {
      if (!isRecord(server)) continue
      refuseNonPublicConfigValues(server.args, `mcp.${name}.args`, context)
      refuseNonPublicConfigValues(server.env, `mcp.${name}.env`, context)
    }
  }
  if (isRecord(profile.hooks)) {
    for (const [event, hooks] of Object.entries(profile.hooks)) {
      if (!Array.isArray(hooks)) continue
      for (const [index, hook] of hooks.entries()) {
        if (!isRecord(hook)) continue
        refuseNonPublicConfigValues(hook.args, `hooks.${event}[${index}].args`, context)
        refuseNonPublicConfigValues(hook.env, `hooks.${event}[${index}].env`, context)
      }
    }
  }
}

function refuseNonPublicConfigValues(values: unknown, path: string, context: string): void {
  const entries = Array.isArray(values)
    ? values.map((value, index) => [`${path}[${index}]`, value] as const)
    : isRecord(values)
      ? Object.entries(values).map(([name, value]) => [`${path}.${name}`, value] as const)
      : []
  for (const [field, value] of entries) {
    if (isRecord(value) && value.kind !== 'public') {
      refuseField(`${field} (${String(value.kind)})`, context)
    }
  }
}

function refuseField(field: string, context: string): never {
  throw new ValidationError(
    `${context} field ${field} is refused: Sandbox's Interface 4.0.0 cannot carry it yet, and Runtime does not drop it`,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
