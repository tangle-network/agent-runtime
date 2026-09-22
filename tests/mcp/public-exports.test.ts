import { describe, expect, it } from 'vitest'
import * as mcp from '../../src/mcp'

describe('MCP public exports', () => {
  it('keeps binary-only executor detection private', () => {
    expect(mcp).not.toHaveProperty('detectExecutor')
  })
})
