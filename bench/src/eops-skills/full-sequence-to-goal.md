---
name: full-sequence-to-goal
description: Plan the COMPLETE ordered sequence that brings the database to the required final state.
---
Think in terms of the required FINAL state, then plan the full ordered sequence of calls that gets there from the seeded start — including any reads needed to ground values, and in an order that respects dependencies (create before reference, set status before close). Do not stop at the first action.
