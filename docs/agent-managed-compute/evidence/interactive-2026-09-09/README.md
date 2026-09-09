# Live retained terminal evidence

Two bounded Sandbox runs exercised the maintained Runtime retained interactive path on 2026-09-09.
Neither run sent a model prompt.
Both used Codex with no initial prompt and terminal input `/help`.
These observations establish partial Sandbox conformance for issue [#773](https://github.com/tangle-network/agent-runtime/issues/773).

| Observation | First run | Second run |
|---|---|---|
| Initial output frames | 168 | 192 |
| Replay frames | 168 | 192 |
| Identical sequence and SHA-256 pairs | 168/168 | 192/192 |
| Contiguous sequences | 1–168 | 1–192 |
| Process running after detach | Yes | Yes |
| Terminal close acknowledgement | `unknown` | Not called |
| Interactive stop acknowledgement | Not called | `accepted`, effect `stopped` |
| Status after interactive stop | Not checked | `exited` |
| Sandbox deleted and absence verified | Yes | Yes |
| Model prompts | 0 | 0 |
| Process exit code | 0 | 0 |

Both runs returned an exact preparation receipt with matching authored and effective profile digests.
Both resized the terminal from 80×24 to 100×30 and then 120×40.
Both reconstructed the retained handle from its exact reference and acquired fresh control before replay.
The second run stopped through that reconstructed handle.
Terminal close alone did not establish native-process termination in the first run.

## Scope and limits

Runtime source revision: `2f13fc7b`.
Packages: Sandbox `0.38.2`, provider-tangle `1.1.6`, and agent-interface `2.6.0`.
Each run requested 1 CPU, 1024 MB RAM, 1 GB disk, blocked egress, and a 180-second maximum lifetime.
Each requested a 60-second idle timeout and used a 180-second client abort timer.
These resource values are requests, not independent measurements of platform enforcement.
No model token usage or billing measurement was collected; no model prompt API was invoked.

This proof does not test worker native-child binding, a live Braid coordinator restart, or environment expiry semantics.
Local CLI Bridge conformance remains blocked by [cli-bridge#183](https://github.com/drewstone/cli-bridge/issues/183).
The inspected Bridge revision `30038a6` lacked the PTY and duplex attach contract.
These records do not satisfy every #773 acceptance condition and do not justify closing that issue.

## Artifacts and reproduction

[close-result.json](./close-result.json) and [stop-result.json](./stop-result.json) preserve public identities, preparation digests, and output frame digests.
Terminal bytes, credentials, account email, and transport URLs are excluded.
The command recorded in each result names its original scratch script.

[close-proof.mts](./close-proof.mts) and [stop-proof.mts](./stop-proof.mts) preserve the executed logic with portable source locations and sanitized output.
The preserved scripts remove account email and error messages from output and restrict admissions to public identifiers.
They were syntax-checked after these recording changes; they were not rerun against another sandbox.

Copy the chosen script into a scratch directory and install the pinned packages there:

```sh
npm install --save-exact @tangle-network/sandbox@0.38.2 @tangle-network/agent-provider-tangle@1.1.6 @tangle-network/agent-interface@2.6.0
```

Set `RUNTIME_SOURCE` to the Runtime checkout and `SANDBOX_CLI_SOURCE` to the maintained Sandbox CLI `src` directory.
Set `EXPECTED_SANDBOX_EMAIL` to the authorized account email.
The scripts read existing Sandbox credentials through the maintained CLI configuration and verify account ownership through its read-only account API.
They require the production Sandbox origin and never print credentials.
Run `tsx stop-proof.mts` or `tsx close-proof.mts` from the scratch directory.
Each script creates a sandbox and deletes it in `finally`, then checks that it is absent.
