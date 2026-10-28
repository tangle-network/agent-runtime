import { mkdir } from 'node:fs/promises'
import {
  type AgentInteractiveTerminalSession,
  agentInteractiveSessionPromptRequestDigest,
  agentInteractiveSessionStopRequestDigest,
} from '@tangle-network/agent-interface'
import {
  claimRetainedInteractiveControl,
  reconnectRetainedInteractiveRun,
} from '@tangle-network/agent-runtime/kernel'
import { networkInteractiveControlProvider, ref } from './interactive-control-network'

const journalRoot = process.env.CONTROL_JOURNAL_ROOT ?? ''
await mkdir(journalRoot, { recursive: true, mode: 0o700 })
const provider = networkInteractiveControlProvider(process.env.CONTROL_ENDPOINT ?? '')
const handle = await reconnectRetainedInteractiveRun({ provider, ref, journalRoot })
if (!handle) throw new Error('missing retained session')
let terminal: AgentInteractiveTerminalSession | undefined
let previousTerminal: AgentInteractiveTerminalSession | undefined
process.send?.({ ready: true })
process.on(
  'message',
  (message: { id: number; action: string; operationId: string; prompt?: string }) => {
    void (async () => {
      let result: unknown
      if (message.action === 'offer') {
        const control = await claimRetainedInteractiveControl({
          handle,
          holderId: `terminal-owner-${process.pid}`,
          delegation: 'offer',
        })
        previousTerminal = terminal
        terminal = await handle.attach({ control, cols: 80, rows: 24 })
        result = { generation: control.generation, holderId: control.holderId }
      } else if (message.action === 'invalid-generation') {
        await claimRetainedInteractiveControl({
          handle,
          holderId: 'invalid',
          delegation: 'accept',
          expectedGeneration: -1,
        })
      } else if (
        message.action === 'steer' ||
        message.action === 'crash-after-prompt' ||
        message.action === 'cancelled-steer'
      ) {
        const control = await claimRetainedInteractiveControl({
          handle,
          holderId: 'control-client',
          delegation: 'accept',
        })
        const material = {
          operationId: message.operationId,
          ref: handle.ref,
          control,
          prompt: message.prompt ?? 'inspect',
        }
        const command = {
          ...material,
          requestDigest: agentInteractiveSessionPromptRequestDigest(material),
        }
        if (message.action === 'crash-after-prompt') {
          const environment = await provider.get?.(ref.run.environmentId)
          await environment?.interactive?.(ref).sendPrompt?.(command)
          process.kill(process.pid, 'SIGKILL')
          return
        }
        const controller = new AbortController()
        if (message.action === 'cancelled-steer')
          controller.abort(new Error('cancelled before provider delivery'))
        result = {
          status: (await handle.sendPrompt(command, { signal: controller.signal })).status,
          generation: control.generation,
          holderId: control.holderId,
        }
      } else if (message.action === 'terminal') {
        if (!terminal) throw new Error('no terminal')
        await terminal.input({ data: 'still attached' })
        await terminal.resize({ cols: 120, rows: 40 })
      } else if (message.action === 'stale-close') {
        await previousTerminal?.close()
      } else if (message.action === 'detach') {
        const closing = terminal
        await closing?.close()
        if (terminal === closing) terminal = undefined
      } else if (message.action === 'stop') {
        const control = await claimRetainedInteractiveControl({
          handle,
          holderId: 'control-client',
          delegation: 'accept',
        })
        const material = { operationId: message.operationId, ref: handle.ref, control }
        result = {
          status: (
            await handle.stop({
              ...material,
              requestDigest: agentInteractiveSessionStopRequestDigest(material),
            })
          ).status,
        }
      } else if (message.action === 'close') {
        const closing = terminal
        await closing?.close()
        if (terminal === closing) terminal = undefined
      } else throw new Error('unknown action')
      process.send?.({ id: message.id, result })
      if (message.action === 'close') process.disconnect?.()
    })().catch((error: unknown) => process.send?.({ id: message.id, error: String(error) }))
  },
)
