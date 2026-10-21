import type { McpToolDescriptor } from '../../mcp/server'
import { errorMessage } from '../util'

/** Run a work tool. A throw is data to the driver (it can recover next turn), not a crash — fold
 *  the error back as a string result. null/undefined passes through (the caller treats it as "not
 *  handled" and falls to the coordination dispatch). */
export async function runExtraTool(
  execute: (name: string, args: Record<string, unknown>) => Promise<string | null | undefined>,
  name: string,
  args: Record<string, unknown>,
): Promise<string | null | undefined> {
  try {
    return await execute(name, args)
  } catch (e) {
    return `error: ${errorMessage(e)}`
  }
}

export async function runTool(
  tool: McpToolDescriptor,
  args: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await tool.handler(args)
  } catch (e) {
    // A tool throw is data to the driver (it can recover), not a crash — fold it back.
    return { error: errorMessage(e) }
  }
}
