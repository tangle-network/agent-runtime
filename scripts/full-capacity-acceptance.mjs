#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { assessCapacity, deriveCapacityTarget } from './lib/full-capacity-acceptance.mjs'
import { collectCapacityEvidence } from './lib/full-capacity-collector.mjs'

const [command, contractPath, capacityPath, ...observationPaths] = process.argv.slice(2)
const json = async (path) => JSON.parse(await readFile(path, 'utf8'))
try {
  const contract = await json(contractPath)
  if (command === 'sample') {
    const evidence = await collectCapacityEvidence(contract, resolve(capacityPath))
    console.log(JSON.stringify({ observation: resolve(capacityPath, 'observation.json'), attempts: evidence.attempts.length, samples: evidence.samples.length, errors: evidence.observationErrors.length }))
    if (evidence.observationErrors.length) process.exitCode = 2
  } else if (command === 'plan') {
    const plan = deriveCapacityTarget(contract, await json(capacityPath))
    console.log(JSON.stringify(plan, null, 2))
    if (plan.target === null || plan.target === 0) process.exitCode = 2
  } else if (command === 'assess') {
    if (!observationPaths.length) throw new Error('at least one observation required')
    const observations = await Promise.all(observationPaths.map(json))
    observations.sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt))
    const latest = observations.at(-1)
    if (observations.some((observation) => observation.contractDigest !== latest.contractDigest)) throw new Error('observations belong to different frozen contracts')
    const evidence = { ...latest, samples: observations.flatMap((o) => o.samples), observationErrors: observations.flatMap((o) => o.observationErrors ?? []) }
    const report = await assessCapacity(contract, await json(capacityPath), evidence)
    console.log(JSON.stringify(report, null, 2))
    process.exitCode = report.verdict === 'pass' ? 0 : report.verdict === 'fail' ? 1 : 2
  } else throw new Error('usage: full-capacity-acceptance.mjs plan CONTRACT CAPACITY | sample CONTRACT NEW_DIRECTORY | assess CONTRACT CAPACITY OBSERVATION...')
} catch (error) {
  console.error(JSON.stringify({ verdict: 'incomplete', error: error.message }))
  process.exitCode = 2
}
