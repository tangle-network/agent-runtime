# quickstart

The smallest complete agent loop, in one file: a driver runs a worker, reads the worker's real output, and writes the next prompt from it until a check passes.
Offline and deterministic — the worker is a scripted stand-in (`inProcessSandboxClient`), so it runs with zero credentials.

```bash
pnpm build && pnpm tsx examples/quickstart/quickstart.ts
```

Expected output:

```text
shot 0: reject — "Shipped one-click restore."
shot 1: PASS — "Shipped one-click restore with an instant rollback path."
decision: pick-winner — winner: shot 1
```

This is the loop the root README shows.
The fully annotated version, with every seam explained (the fold, terminal decisions, the output adapter, the validator), is [`../driver-loop`](../driver-loop).
