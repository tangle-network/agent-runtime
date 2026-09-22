export function assertCohortPackageContracts({
  agentInterface,
  agentEval,
  agentKnowledge,
  agentRuntime,
}) {
  assertExactDependency(agentEval, agentInterface)
  assertExactDependency(agentKnowledge, agentInterface)
  assertExactDependency(agentKnowledge, agentEval)
  assertExactDependency(agentRuntime, agentKnowledge)
  assertRequiredPeer(agentRuntime, agentInterface)
  assertRequiredPeer(agentRuntime, agentEval)
}

function assertExactDependency(owner, dependency) {
  const declared = owner.packageJson.dependencies?.[dependency.name]
  if (declared !== dependency.version) {
    throw new Error(
      `${owner.name} requires ${dependency.name}@${declared}, packed ${dependency.version}`,
    )
  }
}

function assertRequiredPeer(owner, dependency) {
  if (!owner.packageJson.peerDependencies?.[dependency.name]) {
    throw new Error(`${owner.name} must declare ${dependency.name} as a required peer`)
  }
  if (owner.packageJson.peerDependenciesMeta?.[dependency.name]?.optional) {
    throw new Error(`${owner.name} cannot make ${dependency.name} optional`)
  }
}
