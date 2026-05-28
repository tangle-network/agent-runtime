/**
 * Agents of all shapes → one decision packet. No sandbox. No deploy.
 *
 *   pnpm tsx examples/agents-of-all-shapes/run.ts
 *
 * Runs every shape (Tangle runtime / OpenAI-compatible router / Mastra /
 * Claude Agent SDK), converts each to canonical OTel GenAI spans, and feeds
 * the merged stream through the in-process intelligence engine
 * (`fromOtelSpans → analyzeRuns`). Prints the fleet `InsightReport` plus a
 * per-shape breakdown.
 *
 * Optional hosted path: set TANGLE_API_KEY (and INTELLIGENCE_BASE) to also
 * POST the spans to the hosted OTLP ingest for the dashboard.
 */

import { allShapes } from './shapes'
import { shipToTangleOtlp, spansForRuns, toInsightReport } from './shared/intelligence'

async function main() {
  const shapes = allShapes()
  const allRuns = Object.values(shapes).flat()
  const allSpans = spansForRuns(allRuns)

  // The fleet view — every framework's runs in one vocabulary.
  const fleet = await toInsightReport(allSpans)
  console.log('=== Fleet InsightReport (all shapes) ===')
  console.log(`runs:            ${fleet.composite.n}`)
  console.log(`composite mean:  ${fleet.composite.mean.toFixed(3)}`)
  console.log(`composite p50:   ${fleet.composite.p50.toFixed(3)}`)
  console.log(`failure modes:   ${JSON.stringify(fleet.failureModes ?? [])}`)
  console.log(`recommendations: ${fleet.recommendations.length}`)
  for (const r of fleet.recommendations.slice(0, 3)) {
    console.log(`  [${r.priority}] ${r.title}`)
  }

  // Per-shape — prove the SAME engine works on each framework alone.
  console.log('\n=== Per-shape composite ===')
  for (const [name, runs] of Object.entries(shapes)) {
    const report = await toInsightReport(spansForRuns(runs))
    console.log(
      `${name.padEnd(20)} n=${report.composite.n} mean=${report.composite.mean.toFixed(3)}`,
    )
  }

  // Optional: also ship to the hosted ingest for the dashboard.
  const apiKey = process.env.TANGLE_API_KEY
  if (apiKey) {
    const endpoint = process.env.INTELLIGENCE_BASE ?? 'https://intelligence.tangle.tools/v1/otlp'
    await shipToTangleOtlp(allSpans, { endpoint, apiKey })
    console.log(`\nShipped ${allSpans.length} spans to ${endpoint} for the dashboard.`)
  } else {
    console.log('\n(set TANGLE_API_KEY to also ship to the hosted dashboard)')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
