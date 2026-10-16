# Retained owner capture and retry

- A committed executor result whose outcome reports failure remains a failed attempt.
  Incomplete workspace capture cannot replace its classification. The driver retry loop owns
  transient retries, unavailable pauses, budget and deadline bounds, and cancellation.
- Before reusing a retained environment, the owner tries the existing evidence recovery path.
  If a failed attempt still lacks a complete capture, the owner records pending capture through
  the existing `execution-evidence` journal with the original execution, environment, control,
  node, and profile identifiers. The next invocation uses another environment. The source stays
  preserved until its exact capture receipt authorizes cleanup.
- An accepted attempt still requires complete capture before its workspace may change.
  Pending capture keeps the pursuit re-enterable and cannot seal a winner. Partial or foreign
  captures never authorize reuse or deletion. Explicit cancellation retains its settlement rules.

Scenario coverage lives in `tests/kernel/supervise-retained-owner-pending.test.ts` and
`tests/runtime/retained-capture-resume.test.ts`.
