import * as interfaceModule from '@tangle-network/agent-interface'
import * as runtime from '@tangle-network/agent-runtime/kernel'
import { runUpstreamContract } from './lib/upstream-contract.mjs'

const check = process.argv[2] ?? process.env.UPSTREAM_CONTRACT_CHECK
if (!check) throw new Error('usage: node upstream-contract-consumer.mjs UP-XX')

const result = await runUpstreamContract({ check, runtime, interfaceModule })
process.stdout.write(`${JSON.stringify(result)}\n`)
