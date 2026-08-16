from __future__ import annotations

import re
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def remove_import_symbols(
    text: str,
    *,
    header_end: str,
    symbols: tuple[str, ...],
    label: str,
) -> str:
    boundary = text.find(header_end)
    if boundary < 0:
        raise SystemExit(f"{label}: import boundary not found")
    header = text[:boundary]
    body = text[boundary:]
    for symbol in symbols:
        pattern = re.compile(rf"(?m)^[ \t]+(?:type[ \t]+)?{re.escape(symbol)},\n")
        matches = pattern.findall(header)
        if len(matches) != 1:
            raise SystemExit(
                f"{label}: expected one imported {symbol}, found {len(matches)}"
            )
        header = pattern.sub("", header, count=1)
    return header + body


def remove_function(text: str, signature: str) -> str:
    count = text.count(signature)
    if count != 1:
        raise SystemExit(f"{signature}: expected one function, found {count}")
    start = text.index(signature)
    brace = text.index("{", start)
    depth = 0
    quote: str | None = None
    escaped = False
    line_comment = False
    block_comment = False
    index = brace
    while index < len(text):
        char = text[index]
        next_char = text[index + 1] if index + 1 < len(text) else ""
        if line_comment:
            if char == "\n":
                line_comment = False
            index += 1
            continue
        if block_comment:
            if char == "*" and next_char == "/":
                block_comment = False
                index += 2
            else:
                index += 1
            continue
        if quote is not None:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            index += 1
            continue
        if char == "/" and next_char == "/":
            line_comment = True
            index += 2
            continue
        if char == "/" and next_char == "*":
            block_comment = True
            index += 2
            continue
        if char in ("'", '"', "`"):
            quote = char
            index += 1
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                end = index + 1
                while end < len(text) and text[end] == "\n":
                    end += 1
                return text[:start] + text[end:]
        index += 1
    raise SystemExit(f"{signature}: unbalanced function")


SUPPORT = """import { CostLedger, type CostLedgerHandle } from '@tangle-network/agent-eval'
import {
  type CampaignScenarioIdentity,
  campaignSplitDigestFromIdentities,
} from '@tangle-network/agent-eval/campaign'
import {
  sealAgentProfileImprovementSuite,
  sealAgentProfileImprovementTask,
} from '@tangle-network/agent-eval/contract'
import type {
  AgentCandidateEvaluationPolicy,
  AgentImprovementCost,
  AgentImprovementSource,
  AgentProfile,
  AgentProfileImprovementMeasuredComparison,
  AgentProfileImprovementSuiteInputs,
  AgentProfileImprovementTask,
  AgentProfileImprovementTaskMaterial,
  Sha256Digest,
} from '@tangle-network/agent-interface'
import {
  AGENT_IMPROVEMENT_SOURCE_METADATA_KEY,
  agentImprovementSourceMetadata,
  agentProfileImprovementArmSchema,
  numbersApproximatelyEqual,
} from '@tangle-network/agent-interface'
import { immutableCandidateValue } from '../candidate-execution/digest'
import {
  assertNoCallerOptimizationReceipt,
  attachOptimizationActivationReceipt,
  createOptimizationActivationReceipt,
} from './optimization-receipt'
import type { AgentImprovementProfileStateDigest } from './profile-activation'

export interface ProfileImprovementBenchmarkInput {
  tasks: [AgentProfileImprovementTaskMaterial, ...AgentProfileImprovementTaskMaterial[]]
  reps: number
  seeds: [number, ...number[]]
  policy: AgentCandidateEvaluationPolicy
}

export function createProfileImprovementCostLedger(
  budgetUsd: number,
  context = 'profile improvement',
): CostLedger {
  if (!Number.isFinite(budgetUsd) || budgetUsd < 0) {
    throw new Error(`${context} budgetUsd must be a non-negative finite number`)
  }
  return new CostLedger({ costCeilingUsd: budgetUsd })
}

export function profilePolicyWithBudget(
  policy: AgentCandidateEvaluationPolicy,
  budgetUsd: number,
  context = 'profile improvement',
): AgentCandidateEvaluationPolicy {
  if (policy.budgetUsd !== undefined && !numbersApproximatelyEqual(policy.budgetUsd, budgetUsd)) {
    throw new Error(`${context} policy budgetUsd must equal the run budgetUsd`)
  }
  return { ...policy, budgetUsd }
}

export function profilePreparationAccounting(
  costLedger: CostLedgerHandle,
  startedAt: number,
): { wallDurationMs: number; cost: AgentImprovementCost } {
  const summary = costLedger.summary()
  if (!summary.accountingComplete || summary.costProvenance.kind === 'uncaptured') {
    throw new Error('profile improvement preparation cost is incomplete')
  }
  return {
    wallDurationMs: Math.max(0, performance.now() - startedAt),
    cost: {
      usd: summary.costProvenance.usd,
      provenance: summary.costProvenance.kind,
    },
  }
}

export function profileStateDigest(
  stateDigest: AgentImprovementProfileStateDigest,
  identity: string,
  profile: AgentProfile,
): Sha256Digest {
  return agentProfileImprovementArmSchema.parse({
    stateDigest: stateDigest({ identity, profile }),
  }).stateDigest
}

export function sealProfileImprovementBenchmark(
  input: ProfileImprovementBenchmarkInput,
): AgentProfileImprovementSuiteInputs {
  const tasks = input.tasks.map((task) => sealAgentProfileImprovementTask(task)) as [
    AgentProfileImprovementTask,
    ...AgentProfileImprovementTask[],
  ]
  return sealAgentProfileImprovementSuite({
    splitDigest: campaignSplitDigestFromIdentities(
      tasks.map(profileTaskScenarioIdentity),
      input.reps,
    ),
    tasks,
    reps: input.reps,
    seeds: input.seeds,
  })
}

export function profileTaskScenarioIdentity(
  task: AgentProfileImprovementTask,
): CampaignScenarioIdentity {
  return {
    id: task.scenario.id,
    kind: task.scenario.kind,
    scenarioDigest: task.scenario.digest,
  }
}

export function profileImprovementMetadata(
  metadata: AgentProfileImprovementMeasuredComparison['metadata'],
  source: AgentImprovementSource,
  optimizationReceipt?: ReturnType<typeof createOptimizationActivationReceipt>,
): NonNullable<AgentProfileImprovementMeasuredComparison['metadata']> {
  assertNoCallerOptimizationReceipt(metadata)
  if (metadata && Object.hasOwn(metadata, AGENT_IMPROVEMENT_SOURCE_METADATA_KEY)) {
    throw new Error(
      `candidate metadata reserves '${AGENT_IMPROVEMENT_SOURCE_METADATA_KEY}' for Runtime`,
    )
  }
  const merged = { ...(metadata ?? {}), ...agentImprovementSourceMetadata(source) }
  return optimizationReceipt
    ? attachOptimizationActivationReceipt(merged, optimizationReceipt)
    : immutableCandidateValue(merged)
}
"""


Path("src/intelligence/profile-improvement-experiment.ts").write_text(SUPPORT)

cycle_path = Path("src/intelligence/improvement-cycle.ts")
cycle = cycle_path.read_text()
cycle = remove_import_symbols(
    cycle,
    header_end="\n\nexport type {",
    symbols=(
        "campaignSplitDigestFromIdentities",
        "sealAgentProfileImprovementSuite",
        "sealAgentProfileImprovementTask",
        "AgentImprovementCost",
        "AgentProfileImprovementTask",
        "AGENT_IMPROVEMENT_SOURCE_METADATA_KEY",
        "agentImprovementSourceMetadata",
        "agentProfileImprovementArmSchema",
        "attachOptimizationActivationReceipt",
    ),
    label="improvement-cycle imports",
)
shared_import = """import {
  createProfileImprovementCostLedger,
  profileImprovementMetadata,
  profilePolicyWithBudget,
  profilePreparationAccounting,
  profileStateDigest,
  profileTaskScenarioIdentity,
  sealProfileImprovementBenchmark,
} from './profile-improvement-experiment'
"""
cycle = replace_once(
    cycle,
    "import type { AgentImprovementProfileStateDigest } from './profile-activation'\n",
    shared_import
    + "import type { AgentImprovementProfileStateDigest } from './profile-activation'\n",
    "improvement-cycle shared support import",
)
for function in (
    "function createProfileImprovementCostLedger(",
    "function profilePolicyWithBudget(",
    "function profilePreparationAccounting(",
    "function profileStateDigest(",
    "function sealProfileImprovementBenchmark(",
    "function profileTaskScenarioIdentity(",
    "function profileImprovementMetadata(",
):
    cycle = remove_function(cycle, function)
cycle_path.write_text(cycle)

authored_path = Path("src/intelligence/authored-profile-improvement.ts")
authored = authored_path.read_text()
authored = replace_once(
    authored,
    "import { CostLedger } from '@tangle-network/agent-eval'\n",
    "",
    "authored CostLedger import",
)
authored = remove_import_symbols(
    authored,
    header_end="\n\n/** Lineage accepted",
    symbols=(
        "campaignSplitDigestFromIdentities",
        "sealAgentProfileImprovementSuite",
        "sealAgentProfileImprovementTask",
        "AgentProfileImprovementTask",
        "AGENT_IMPROVEMENT_SOURCE_METADATA_KEY",
        "agentImprovementSourceMetadata",
        "agentProfileImprovementArmSchema",
        "numbersApproximatelyEqual",
    ),
    label="authored-profile imports",
)
authored = replace_once(
    authored,
    "import type { AgentImprovementProfileStateDigest } from './profile-activation'\n",
    shared_import
    + "import type { AgentImprovementProfileStateDigest } from './profile-activation'\n",
    "authored shared support import",
)
authored = replace_once(
    authored,
    "const costLedger = createMeasurementCostLedger(options.budgetUsd)",
    "const costLedger = createProfileImprovementCostLedger(\n"
    "    options.budgetUsd,\n"
    "    'authored profile improvement',\n"
    "  )",
    "authored cost ledger call",
)
authored = replace_once(
    authored,
    "const policy = profilePolicyWithBudget(options.benchmark.policy, options.budgetUsd)",
    "const policy = profilePolicyWithBudget(\n"
    "    options.benchmark.policy,\n"
    "    options.budgetUsd,\n"
    "    'authored profile',\n"
    "  )",
    "authored policy call",
)
preparation_pattern = re.compile(
    r"  const preparation = \{\n"
    r"    wallDurationMs: Math\.max\(0, performance\.now\(\) - preparationStartedAt\),\n"
    r"    cost: \{ usd: 0, provenance: 'observed' as const \},\n"
    r"  \}"
)
authored, count = preparation_pattern.subn(
    "  const preparation = profilePreparationAccounting(costLedger, preparationStartedAt)",
    authored,
    count=1,
)
if count != 1:
    raise SystemExit(f"authored preparation accounting: expected one match, found {count}")
authored = replace_once(
    authored,
    "metadata: directProfileImprovementMetadata(options.metadata, source),",
    "metadata: profileImprovementMetadata(options.metadata, source),",
    "authored metadata call",
)
for function in (
    "function createMeasurementCostLedger(",
    "function profilePolicyWithBudget(",
    "function profileStateDigest(",
    "function sealProfileImprovementBenchmark(",
    "function profileTaskScenarioIdentity(",
    "function directProfileImprovementMetadata(",
):
    authored = remove_function(authored, function)
authored_path.write_text(authored)
