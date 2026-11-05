const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')

// Offline native actor: real process, protocol messages, durable event bytes and held result.
const directory = process.argv[2]
let timer
let initial
let mode
let replayReads = 0
const write = (file, value) =>
  fs.appendFileSync(path.join(directory, file), `${JSON.stringify(value)}\n`)
const frame = (sequence) => ({
  id: `event-${sequence}`,
  type: 'message',
  data: { content: `native progress ${sequence}`, sequence },
})
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, op, ...input } = JSON.parse(line)
  let value = true
  if (op === 'start') {
    mode = input.mode
    initial = frame(0)
    write('events.jsonl', initial)
    if (input.mode === 'duplicate')
      timer = setInterval(() => write('events.jsonl', initial), input.quietMs / 4)
    if (input.mode === 'progress') {
      let sequence = 0
      timer = setInterval(() => {
        write('events.jsonl', frame(++sequence))
        if (sequence === 5) {
          clearInterval(timer)
        }
      }, input.quietMs / 2)
    }
  } else if (
    op === 'observe' &&
    mode.startsWith('replay') &&
    input.since &&
    !fs.existsSync(path.join(directory, 'result')) &&
    (mode !== 'replay-cold' || replayReads++ > 0)
  ) {
    const sequence = Number(input.since.slice('event-'.length)) + 1
    write('events.jsonl', frame(sequence))
    if (sequence === 2) fs.writeFileSync(path.join(directory, 'result'), 'finished')
  } else if (op === 'status') value = 'running'
  else if (op === 'finish') {
    clearInterval(timer)
    fs.writeFileSync(path.join(directory, 'result'), 'finished')
  } else if (op === 'unblock')
    fs.writeFileSync(path.join(directory, 'persistence.fifo'), 'committed')
  const reply = () => {
    write('protocol.jsonl', { op, ...input, value })
    process.stdout.write(`${JSON.stringify({ id, value })}\n`)
  }
  if (op === 'status' && mode === 'probe') {
    write('protocol.jsonl', { op: 'status-enter' })
    setTimeout(reply, 150)
  } else reply()
})
