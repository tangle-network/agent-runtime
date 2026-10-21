// Profile review instructions and their mounted verdict page.

import type { AgentProfileDiff } from '@tangle-network/agent-interface'
import type { CheckVerdict } from '../runtime/supervise/completion-gate'
import { failedItems } from '../runtime/supervise/continuation'
import type { NextPursuitVersion } from './pursuit-versions'

/** Where `'review-of-best'` mounts a review: `inputs/review/version-<n>.md`. One review lives in
 *  a profile at a time. */
const REVIEW_DIR = 'inputs/review/'

/**
 * `'review-of-best'`: fork from the kept version with its check's verdict mounted under
 * {@link REVIEW_DIR} and the profile's review words as one instruction. The previous review's
 * mount and instruction are removed, so a profile carries one review.
 */
export function reviewOfBest(runId: string, words: string): NextPursuitVersion {
  return ({ best, versions }) => {
    const n = versions.length + 1
    const verdict = best.verdict.check
    const path = `${REVIEW_DIR}version-${best.version}.md`
    const instruction = words
      .replaceAll('{version}', String(best.version))
      .replaceAll('{path}', path)
      .replaceAll('{score}', best.verdict.score === null ? 'none' : String(best.verdict.score))
      .trim()
    const page = reviewPage(best.version, best.verdict.score, verdict)
    // Instructions are set and removed by value: an earlier review instruction equal to this one
    // stays as it is, and every other earlier one is removed.
    const earlier = best.change?.set?.prompt?.instructions ?? []
    const earlierInstructions = earlier.filter((text) => text !== instruction)
    const earlierMounts = (best.profile.resources?.files ?? [])
      .map((file) => file.path)
      .filter((mounted) => mounted.startsWith(REVIEW_DIR) && mounted !== path)
    return {
      kind: 'agent-profile-diff',
      id: `${runId}-v${n}-review-of-v${best.version}`,
      title: `Version ${n}: review of version ${best.version}`,
      source: {
        kind: 'optimizer',
        notes: [`review-of-best: version ${best.version}`, `judge ${best.verdict.judgeDigest}`],
      },
      set: {
        ...(earlier.includes(instruction) ? {} : { prompt: { instructions: [instruction] } }),
        resources: {
          files: [{ path, resource: { kind: 'inline', name: path, content: page } }],
        },
      },
      ...(earlierInstructions.length > 0 || earlierMounts.length > 0
        ? {
            remove: {
              ...(earlierInstructions.length > 0
                ? { prompt: { instructions: [...earlierInstructions] } }
                : {}),
              ...(earlierMounts.length > 0 ? { resources: { files: earlierMounts } } : {}),
            },
          }
        : {}),
    } as AgentProfileDiff
  }
}

/** The review page: facts only, in the check's own lines. */
function reviewPage(
  version: number,
  score: number | null,
  verdict: CheckVerdict | undefined,
): string {
  if (verdict === undefined) {
    return [
      `# Version ${version}`,
      '',
      `Score: ${score ?? 'none'}. The judge reported no per-item verdict.`,
      '',
    ].join('\n')
  }
  const failing = failedItems(verdict)
  return [
    `# Version ${version}`,
    '',
    `Score: ${score ?? 'none'}.${verdict.threshold === undefined ? '' : ` The check passes at ${verdict.threshold}.`}`,
    '',
    '## Items',
    '',
    ...Object.entries(verdict.items ?? {}).map(
      ([item, value]) => `- ${item}: ${value >= 1 ? 'passes' : `fails (${value})`}`,
    ),
    '',
    ...(failing.length === 0 ? [] : ['## Failures', '', ...(verdict.failures ?? []), '']),
    ...(verdict.review === undefined ? [] : ["## The check's review", '', verdict.review, '']),
  ].join('\n')
}
