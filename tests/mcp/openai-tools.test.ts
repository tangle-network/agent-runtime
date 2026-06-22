import { describe, expect, it } from 'vitest'
import { mcpToolsForRuntimeMcp, mcpToolsForRuntimeMcpSubset } from '../../src/mcp/openai-tools'
import {
  DELEGATE_FEEDBACK_DESCRIPTION,
  DELEGATE_FEEDBACK_TOOL_NAME,
} from '../../src/mcp/tools/delegate-feedback'
import { DELEGATION_HISTORY_TOOL_NAME } from '../../src/mcp/tools/delegation-history'
import { DELEGATION_STATUS_TOOL_NAME } from '../../src/mcp/tools/delegation-status'

describe('mcpToolsForRuntimeMcp', () => {
  it('returns exactly the 3 queue-bound delegation tools', () => {
    const tools = mcpToolsForRuntimeMcp()
    expect(tools).toHaveLength(3)
    for (const tool of tools) {
      expect(tool.type).toBe('function')
      expect(typeof tool.function.name).toBe('string')
      expect(tool.function.name.length).toBeGreaterThan(0)
    }
  })

  it('emits tool names matching the canonical DELEGATE_*_TOOL_NAME constants', () => {
    const names = mcpToolsForRuntimeMcp().map((t) => t.function.name)
    expect(names).toEqual([
      DELEGATE_FEEDBACK_TOOL_NAME,
      DELEGATION_STATUS_TOOL_NAME,
      DELEGATION_HISTORY_TOOL_NAME,
    ])
  })

  it('every tool carries a non-empty, non-placeholder description', () => {
    for (const tool of mcpToolsForRuntimeMcp()) {
      expect(tool.function.description).toBeDefined()
      const desc = tool.function.description!
      expect(desc.length).toBeGreaterThan(40)
      expect(desc).not.toMatch(/\bTODO\b/i)
      expect(desc).not.toMatch(/\bplaceholder\b/i)
      expect(desc).not.toMatch(/\blorem ipsum\b/i)
    }
  })

  it('projects the canonical description verbatim (no drift)', () => {
    const feedbackTool = mcpToolsForRuntimeMcp().find(
      (t) => t.function.name === DELEGATE_FEEDBACK_TOOL_NAME,
    )!
    expect(feedbackTool.function.description).toBe(DELEGATE_FEEDBACK_DESCRIPTION)
  })

  it('returns a fresh parameters object each call so callers cannot poison the source', () => {
    const first = mcpToolsForRuntimeMcp()
    ;(first[0].function.parameters as Record<string, unknown>).injected = true
    const second = mcpToolsForRuntimeMcp()
    expect(second[0].function.parameters).not.toHaveProperty('injected')
  })
})

describe('mcpToolsForRuntimeMcpSubset', () => {
  it('returns only the named tool', () => {
    const subset = mcpToolsForRuntimeMcpSubset([DELEGATION_STATUS_TOOL_NAME])
    expect(subset).toHaveLength(1)
    expect(subset[0].function.name).toBe(DELEGATION_STATUS_TOOL_NAME)
  })

  it('returns multiple named tools preserving canonical ordering', () => {
    const subset = mcpToolsForRuntimeMcpSubset([
      DELEGATION_HISTORY_TOOL_NAME,
      DELEGATE_FEEDBACK_TOOL_NAME,
    ])
    expect(subset.map((t) => t.function.name)).toEqual([
      DELEGATE_FEEDBACK_TOOL_NAME,
      DELEGATION_HISTORY_TOOL_NAME,
    ])
  })

  it('silently ignores unknown names', () => {
    expect(mcpToolsForRuntimeMcpSubset(['nonexistent_tool'])).toEqual([])
  })

  it('returns empty array for empty input', () => {
    expect(mcpToolsForRuntimeMcpSubset([])).toEqual([])
  })
})
