import { isRecord } from '@tangle-network/agent-core'
import { ValidationError } from '../errors'

/** Refuse private config values that the Sandbox profile transport cannot carry. */
export function assertSandboxProfileCompatibility(
  profile: unknown,
  context = 'candidate profile',
): void {
  if (!isRecord(profile)) return
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
      refuseSandboxProfileField(`${field} (${String(value.kind)})`, context)
    }
  }
}

export function refuseSandboxProfileField(field: string, context = 'candidate profile'): never {
  throw new ValidationError(
    `${context} field ${field} is refused: Sandbox's Interface 4.0.0 cannot carry it yet, and Runtime does not drop it`,
  )
}
