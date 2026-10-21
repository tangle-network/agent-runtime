/**
 * The search's proposer port: the kernel asks it for children of chosen
 * parents, and it runs the caller's `SurfaceProposer` on the train split only.
 * The proposal's paid calls carry its operation id, so its accounting is
 * exactly them.
 */
import type { ProposalFinding } from '@tangle-network/agent-eval'
import {
  isProposedCandidate,
  type ProposeContext,
  renderSearchSummary,
  type Scenario,
  type SearchProposerPort,
  type SearchSourceRef,
  searchProposalExecution,
  searchProposerView,
  searchReceiptAccounting,
} from '@tangle-network/agent-eval/campaign'
import { canonicalCandidateDigest } from '../candidate-execution/digest'
import { ConfigError } from '../errors'
import { searchCallTags, taggedLedger } from './search-executor'
import { type ProfileNode, profileNodeOf, type SearchSession } from './search-session'

const PROPOSAL_PHASE = 'search.proposal'

export function searchProposerPort<TScenario extends Scenario, TArtifact>(
  session: SearchSession<TScenario, TArtifact>,
): SearchProposerPort<ProfileNode> {
  const { method, prepared, recorder, costLedger, searchId } = session
  const { proposer } = method
  const proposerSource: SearchSourceRef = {
    uri: `proposer:${proposer.kind}`,
    revision: canonicalCandidateDigest({
      kind: proposer.kind,
      propose: Function.prototype.toString.call(proposer.propose),
      decide: proposer.decide ? Function.prototype.toString.call(proposer.decide) : null,
    }),
  }
  return {
    name: proposer.kind,
    kind: 'optimizer',
    source: proposerSource,
    execution: { kind: 'deterministic', source: proposerSource },
    childrenPerProposal: method.childrenPerProposal,
    async propose(request) {
      // The proposal's calls carry its operation, so its accounting is exactly them.
      const tags = searchCallTags(searchId, { operation: request.operationId })
      // Read the ledger once, synchronously, before any await: the kernel
      // retires a state view when it appends.
      const state = await recorder.state()
      const parents = request.parents.map(({ nodeId, artifact }) => ({
        nodeId,
        artifact: artifact.surface,
      }))
      const context: ProposeContext<ProposalFinding> = Object.freeze({
        currentSurface: parents[0]?.artifact ?? prepared.baselineSurface,
        operator: request.operator,
        parents,
        train: searchProposerView(state),
        summary: renderSearchSummary(state, { split: 'train' }),
        history: [],
        findings: prepared.findings,
        populationSize: method.childrenPerProposal,
        generation: request.expansion,
        signal: request.signal,
        costLedger: taggedLedger(costLedger, tags),
        costPhase: PROPOSAL_PHASE,
      })
      const decision = proposer.decide?.({ history: [] })
      const proposed = decision?.stop ? [] : await proposer.propose(context)
      if (!Array.isArray(proposed)) {
        throw new ConfigError('improve(): the search proposer must return an array')
      }
      const fresh = costLedger.list({ phase: PROPOSAL_PHASE, tags })
      return {
        children: proposed.slice(0, method.childrenPerProposal).map((child) =>
          isProposedCandidate(child)
            ? {
                artifact: profileNodeOf(prepared, child.surface),
                label: child.label,
                rationale: child.rationale,
                ...(child.attribution ? { attribution: child.attribution } : {}),
              }
            : { artifact: profileNodeOf(prepared, child), label: '', rationale: '' },
        ),
        ...(decision?.stop ? { stop: decision.reason ?? 'the proposer decided to stop' } : {}),
        accounting: searchReceiptAccounting(fresh),
        execution: searchProposalExecution(
          fresh,
          prepared.searchIdentity.model.provider,
          proposerSource,
        ),
      }
    },
  }
}
