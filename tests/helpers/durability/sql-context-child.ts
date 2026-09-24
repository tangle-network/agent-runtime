import { createSqlRunContext } from '../../../src/runtime/supervise/sql-run-context'
import { openSqlite } from './sqlite-adapter'

const [file, mode] = process.argv.slice(2)
if (!file || !mode) throw new Error('usage: sql-context-child.ts <database> <hold|attempt>')
const connection = openSqlite(file)
try {
  const context = await createSqlRunContext(connection.db, { runId: 'run', leaseMs: 1000 })
  if (mode === 'attempt') {
    process.send?.({ kind: 'acquired' })
    await context.close()
    connection.close()
    process.disconnect?.()
  } else {
    process.send?.({ kind: 'ready' })
    process.on('message', async (message: { kind: string }) => {
      if (message.kind === 'append') {
        try {
          await context.journal.beginTree('late-owner', new Date().toISOString())
          process.send?.({ kind: 'unsafe-append' })
        } catch {
          process.send?.({ kind: 'fenced' })
        }
      } else if (message.kind === 'close') {
        await context.close()
        connection.close()
        process.disconnect?.()
      }
    })
  }
} catch (error) {
  if (mode !== 'attempt' || !(error instanceof Error) || !/owned|busy|lease/i.test(error.message)) throw error
  process.send?.({ kind: 'busy' })
  connection.close()
  process.disconnect?.()
}
