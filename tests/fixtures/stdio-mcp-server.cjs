const fs = require('node:fs')
const readline = require('node:readline')

if (process.env.WRITE_MARKER === '1') {
  fs.writeFileSync(process.env.MARKER_PATH, process.env.MESSAGE || 'missing')
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (message.id === undefined) return
  const reply = (result) => {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`)
  }
  if (message.method === 'initialize') {
    reply({
      protocolVersion: '2024-11-05',
      capabilities: {},
      serverInfo: { name: 'hello', version: '0' },
    })
  } else if (message.method === 'tools/list') {
    reply({
      tools: [
        {
          name: 'hello',
          description: 'say hello',
          inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        },
      ],
    })
  } else if (message.method === 'tools/call') {
    const name = message.params?.arguments?.name || 'world'
    reply({ content: [{ type: 'text', text: `hello ${name}` }] })
  }
})
