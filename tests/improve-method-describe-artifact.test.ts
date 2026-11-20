import { describe, expect, it } from 'vitest'
import { improve } from '../src/improvement/improve'
import { improvementOptions } from './helpers/improvement-method-fixture'

// From agent-eval 2.0.0, compareOptimizationMethods forwards a describeArtifact it is given to
// every method's input. Runtime's method mode passes its remaining options to that call, so a
// hook set beside the method would reach the official GEPA and SkillOpt evaluators without the
// redaction officialGepa and officialSkillOpt apply, and outside their evaluation identity.
describe('describeArtifact in improve() method mode', () => {
  it('refuses a describeArtifact set beside the method before the method is built or an agent runs', async () => {
    const options = improvementOptions()
    let factoryCalls = 0
    let agentCalls = 0
    const opts = {
      ...options,
      describeArtifact: (artifact: string) => ({ artifact }),
      method: (context: Parameters<typeof options.method>[0]) => {
        factoryCalls++
        return options.method(context)
      },
      agent: async (...args: Parameters<typeof options.agent>) => {
        agentCalls++
        return options.agent(...args)
      },
    }
    await expect(
      improve({ prompt: { systemPrompt: 'BASELINE' } }, opts as unknown as typeof options),
    ).rejects.toThrow(/describeArtifact belongs on the method/)
    expect(factoryCalls).toBe(0)
    expect(agentCalls).toBe(0)
  })
})
