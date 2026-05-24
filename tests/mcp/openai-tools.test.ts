import { describe, expect, it } from 'vitest'
import { mcpToolsForRuntimeMcp, mcpToolsForRuntimeMcpSubset } from '../../src/mcp/openai-tools'
import {
  DELEGATE_CODE_DESCRIPTION,
  DELEGATE_CODE_INPUT_SCHEMA,
  DELEGATE_CODE_TOOL_NAME,
} from '../../src/mcp/tools/delegate-code'
import {
  DELEGATE_FEEDBACK_DESCRIPTION,
  DELEGATE_FEEDBACK_TOOL_NAME,
} from '../../src/mcp/tools/delegate-feedback'
import {
  DELEGATE_RESEARCH_DESCRIPTION,
  DELEGATE_RESEARCH_INPUT_SCHEMA,
  DELEGATE_RESEARCH_TOOL_NAME,
} from '../../src/mcp/tools/delegate-research'
import { DELEGATION_HISTORY_TOOL_NAME } from '../../src/mcp/tools/delegation-history'
import { DELEGATION_STATUS_TOOL_NAME } from '../../src/mcp/tools/delegation-status'

describe('mcpToolsForRuntimeMcp', () => {
  it('returns exactly the 5 delegation tools', () => {
    const tools = mcpToolsForRuntimeMcp()
    expect(tools).toHaveLength(5)
    for (const tool of tools) {
      expect(tool.type).toBe('function')
      expect(typeof tool.function.name).toBe('string')
      expect(tool.function.name.length).toBeGreaterThan(0)
    }
  })

  it('emits tool names matching the canonical DELEGATE_*_TOOL_NAME constants', () => {
    const names = mcpToolsForRuntimeMcp().map((t) => t.function.name)
    expect(names).toEqual([
      DELEGATE_CODE_TOOL_NAME,
      DELEGATE_RESEARCH_TOOL_NAME,
      DELEGATE_FEEDBACK_TOOL_NAME,
      DELEGATION_STATUS_TOOL_NAME,
      DELEGATION_HISTORY_TOOL_NAME,
    ])
  })

  it('delegate_code parameters require goal + repoRoot', () => {
    const tool = mcpToolsForRuntimeMcp().find((t) => t.function.name === DELEGATE_CODE_TOOL_NAME)
    expect(tool).toBeDefined()
    const params = tool!.function.parameters as Record<string, unknown>
    expect(params.type).toBe('object')
    expect(params.required).toEqual(['goal', 'repoRoot'])
    const properties = params.properties as Record<string, unknown>
    expect(properties).toHaveProperty('goal')
    expect(properties).toHaveProperty('repoRoot')
  })

  it('delegate_research parameters require question + namespace', () => {
    const tool = mcpToolsForRuntimeMcp().find(
      (t) => t.function.name === DELEGATE_RESEARCH_TOOL_NAME,
    )
    expect(tool).toBeDefined()
    const params = tool!.function.parameters as Record<string, unknown>
    expect(params.required).toEqual(['question', 'namespace'])
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

  it('projects the canonical description + schema verbatim (no drift)', () => {
    const codeTool = mcpToolsForRuntimeMcp().find(
      (t) => t.function.name === DELEGATE_CODE_TOOL_NAME,
    )!
    expect(codeTool.function.description).toBe(DELEGATE_CODE_DESCRIPTION)
    expect(codeTool.function.parameters).toEqual(DELEGATE_CODE_INPUT_SCHEMA)
    const researchTool = mcpToolsForRuntimeMcp().find(
      (t) => t.function.name === DELEGATE_RESEARCH_TOOL_NAME,
    )!
    expect(researchTool.function.description).toBe(DELEGATE_RESEARCH_DESCRIPTION)
    expect(researchTool.function.parameters).toEqual(DELEGATE_RESEARCH_INPUT_SCHEMA)
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
    const subset = mcpToolsForRuntimeMcpSubset([DELEGATE_RESEARCH_TOOL_NAME])
    expect(subset).toHaveLength(1)
    expect(subset[0].function.name).toBe(DELEGATE_RESEARCH_TOOL_NAME)
  })

  it('returns multiple named tools preserving canonical ordering', () => {
    const subset = mcpToolsForRuntimeMcpSubset([
      DELEGATION_HISTORY_TOOL_NAME,
      DELEGATE_CODE_TOOL_NAME,
    ])
    expect(subset.map((t) => t.function.name)).toEqual([
      DELEGATE_CODE_TOOL_NAME,
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
