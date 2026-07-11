/** Executable parser for official Pier `result.json` evidence. Reads JSON on stdin. */
const chunks = []
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
const rewards = result?.verifier_result?.rewards
if (!rewards || typeof rewards !== 'object' || Array.isArray(rewards)) {
  throw new Error('official Pier result omitted verifier_result.rewards')
}
const dimensions = {}
for (const name of Object.keys(rewards).sort()) {
  const value = rewards[name]
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(name)) {
    throw new Error(`official Pier reward name is not normalized: ${name}`)
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`official Pier reward ${name} is outside [0, 1]`)
  }
  dimensions[name] = value
}
if (typeof dimensions.reward !== 'number') {
  throw new Error('official Pier result omitted the reward dimension')
}
process.stdout.write(
  JSON.stringify({
    score: dimensions.reward,
    passed: dimensions.reward === 1,
    dimensions,
    raw: {},
  }),
)
