import { z } from 'zod'
import { ValidationError } from '../../errors'
import { assertJsonData } from '../../json-data'
import { admitContinuationPolicy, type ContinuationPolicy } from './continuation'
import { detachedFrozen } from './snapshot'

/** Record-owned policy data; callbacks, panel execution and a host-computed best stay outside. */
export type PortableContinuationPolicy = Omit<
  ContinuationPolicy,
  'append' | 'runPanel' | 'panel' | 'panelUsd' | 'best'
> & { readonly panel: 'off' }

/** The canonical policy admission, restricted to portable JSON rather than host callbacks. */
export const portableContinuationPolicySchema = z
  .unknown()
  .transform<PortableContinuationPolicy>((value, context) => {
    try {
      assertJsonData(value, 'graph continuation')
      const policy = value as unknown as PortableContinuationPolicy
      admitContinuationPolicy(policy, 'graph continuation')
      if (
        policy.panel !== 'off' ||
        'append' in policy ||
        'runPanel' in policy ||
        'panelUsd' in policy
      )
        throw new ValidationError(
          'graph continuation: portable policies cannot carry host callbacks or panel execution',
        )
      for (const [record, keys, name] of [
        [
          policy,
          ['deadline', 'maxBarren', 'profile', 'failures', 'panel', 'bar', 'reference', 'session'],
          'policy',
        ],
        [
          policy.profile,
          [
            'id',
            'opening',
            'plan',
            'rules',
            'headings',
            'barRule',
            'questions',
            'panelModel',
            'review',
          ],
          'profile',
        ],
        [
          policy.profile.headings,
          ['failures', 'protected', 'changed', 'findings', 'bar', 'plan', 'rules'],
          'headings',
        ],
      ] as const) {
        const allowed = new Set<string>(keys)
        for (const key of Object.keys(record))
          if (!allowed.has(key))
            throw new ValidationError(`graph continuation: unknown ${name} field '${key}'`)
      }
      return detachedFrozen(policy)
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : String(error),
      })
      return z.NEVER
    }
  })
