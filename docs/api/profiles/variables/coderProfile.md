[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [profiles](../README.md) / coderProfile

# Variable: coderProfile

> `const` **coderProfile**: `AgentProfile`

Defined in: [profiles/coder.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/coder.ts#L72)

**`Experimental`**

The coder `AgentProfile` — the §1.5 DATA the substrate materializes into a harness invocation.
Stateless and harness-agnostic: a consumer overrides `model`/`metadata.backendType` by spreading
a copy, never by a factory. `worktreeFanout` authors one such profile per harness leaf.
