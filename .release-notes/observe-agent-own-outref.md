type: patch
---
`observe_agent` reads a settled worker's own `outRef`, the content address its settlement event names, as well as the `subtree.results` ones. On Discovery run canary-chain-20261103e the root passed the outRef from its worker's settlement and got `unknown-result`; it had to observe by `workerId` instead. The refusal for any other digest now names what it accepts.
