[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / CliSeam

# Interface: CliSeam

Defined in: [runtime/supervise/runtime.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L91)

CLI subprocess seam. `bin` + `args` describe the Halo/RLM process to spawn.

## Properties

### bin

> **bin**: `string`

Defined in: [runtime/supervise/runtime.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L92)

***

### args?

> `optional` **args?**: `string`[]

Defined in: [runtime/supervise/runtime.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L93)

***

### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Defined in: [runtime/supervise/runtime.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L95)

Extra environment for the subprocess (merged over `process.env`).

***

### cwd?

> `optional` **cwd?**: `string`

Defined in: [runtime/supervise/runtime.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L97)

Working directory for the subprocess.
