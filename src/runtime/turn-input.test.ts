import { describe, expect, it } from 'vitest'
import { providerMessageText } from './turn-input'

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
