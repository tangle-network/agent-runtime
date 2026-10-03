import { describe, expect, it } from 'vitest'
import { freshTurnInput, promptOptionsFromAgentTurnInput, providerMessageText } from './turn-input'

describe('providerMessageText', () => {
  it('keeps the last-user-message preference for messages-only turns', () => {
    expect(
      providerMessageText({
        messages: [
          { role: 'user', content: 'first request' },
          { role: 'assistant', content: 'assistant response' },
        ],
      }),
    ).toBe('first request')
  })

  it('skips non-text and non-user messages while searching backwards', () => {
    expect(
      providerMessageText({
        messages: [
          { role: 'user', content: 'usable request' },
          { role: 'user', content: [{ type: 'text', text: 'structured request' }] },
          { role: 'tool', content: 'tool output' },
        ],
      }),
    ).toBe('usable request')
  })
})

describe('typed turn profile transport', () => {
  it('preserves the exact profile across fresh retained turns and SDK projection', () => {
    const profile = { name: 'independent-verifier' }
    const fresh = freshTurnInput(
      { profile, prompt: 'Continue', providerOptions: { backend: { type: 'claude-code' } } },
      { turnId: 'next-turn', detach: true, sessionId: 'same-session' },
    )
    expect(fresh.profile).toEqual(profile)
    expect(promptOptionsFromAgentTurnInput(fresh).backend).toEqual({ type: 'claude-code', profile })
    expect(() =>
      promptOptionsFromAgentTurnInput({
        profile,
        providerOptions: { backend: { profile: { ...profile, name: 'substituted-verifier' } } },
      }),
    ).toThrow('conflicting AgentProfiles')
  })
})
