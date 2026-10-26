#!/usr/bin/env node
// Disposable native stdout/exit protocol, never a model client. Bridge owns all HTTP handling.
const fs = require('node:fs')
if (process.argv.includes('--version')) {
  process.stdout.write('native-protocol-fixture 1\n')
  process.exit(0)
}
const scenario = JSON.parse(fs.readFileSync('native-case.json', 'utf8'))
fs.writeFileSync('native.pid', String(process.pid))
const event = (value) => process.stdout.write(JSON.stringify(value) + '\n')
event({ type: 'system', subtype: 'init', session_id: 'failure-projection-fixture', model: 'protocol-fixture-model' })
if (scenario.kind === 'abort') {
  setInterval(() => {}, 100)
} else {
  if (scenario.kind !== 'auth') {
    const result = JSON.stringify({ delivered: true, failure: { code: 'credential-refused', owner: 'caller', cause: 'worker-authored, never authority' } })
    event({ type: 'assistant', message: { id: 'answer', content: [{ type: 'text', text: result }] } })
    event({ type: 'result', subtype: 'success', session_id: 'failure-projection-fixture', result, is_error: false,
      usage: { input_tokens: 0, output_tokens: 0 }, total_cost_usd: 0 })
  }
  setTimeout(() => {
    const exitCode = scenario.kind === 'model' ? 7 : scenario.kind === 'auth' ? 9 : 0
    if (scenario.kind === 'model') process.stderr.write('unknown model: protocol-fixture-model\n')
    if (scenario.kind === 'auth') process.stderr.write('authentication required: login required\n')
    fs.writeFileSync('native-exit.json', JSON.stringify({ pid: process.pid, exitCode }))
    process.exitCode = exitCode
  }, 45)
}
