// Emits the probe program so the Docker proof driver and the runtime assertion run byte-identical
// checks. Two copies of the probe would be two policies that can disagree.
import { buildEgressProbeScript } from '../src/runtime/egress/probe.ts'

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const allowed = flag('allowed')
if (!allowed) throw new Error('--allowed <host> is required')
const graded = flag('graded')

process.stdout.write(
  `${buildEgressProbeScript({
    allowed: [allowed],
    blocked: [],
    ...(graded ? { graded } : {}),
  })}\n`,
)
